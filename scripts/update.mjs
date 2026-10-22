// Pulls Raiders data into data/*.json for the static site. Run hourly by .github/workflows/update.yml.
// Node 20+, no dependencies.
//   node scripts/update.mjs               normal run (odds only inside the 12h -> 1h pre-kickoff window)
//   node scripts/update.mjs --force-odds  take an odds snapshot now, whatever the time (testing only)
// Every source fails on its own: when a feed is down, the last good data for it is kept and the failure is
// recorded in site.json `sources`, which the page shows as a stale-data notice.
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { get } from "./lib/fetch.mjs";
import * as P from "./lib/parse.mjs";
import * as NV from "./lib/nflverse.mjs";

const TEAM = P.TEAM;
const AFC_WEST = ["13", "12", "7", "24"]; // LV, KC, DEN, LAC
const SEASON = 2026;
const HISTORY_FROM = 2016;
const YT_CHANNEL = "UC24qVyqQyKXDeXLFqBF6F_Q";
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const ODDS_OPEN_H = 12, ODDS_CLOSE_H = 1, H = 36e5;
const NFLVERSE_EVERY_H = 12; // the play-by-play release is rebuilt about once a day
const NEWS_FEEDS = [
  ["Raiders.com", "https://www.raiders.com/rss/news"],
  ["Las Vegas Review-Journal", "https://www.reviewjournal.com/sports/raiders/feed/"],
  ["Silver & Black Pride", "https://www.silverandblackpride.com/rss/index.xml"],
  ["RaidersBeat", "https://raidersbeat.com/feed/"],
];

const now = new Date();
const forceOdds = process.argv.includes("--force-odds");
const dir = new URL("../data/", import.meta.url);
const log = (...a) => console.log("[update]", ...a);

async function readJSON(name, fallback) {
  try { return JSON.parse(await readFile(new URL(name, dir), "utf8")); } catch { return fallback; }
}
// Write only when content changed (timestamps ignored), so quiet hours make no commits.
const stable = o => JSON.stringify(o, (k, v) => (k === "updated" || k === "at" ? undefined : v));
async function save(name, obj, prev) {
  if (prev && stable(prev) === stable(obj)) { log(name, "unchanged"); return false; }
  await writeFile(new URL(name, dir), JSON.stringify(obj, null, 1) + "\n");
  log(name, "written");
  return true;
}
const status = {};
async function source(name, fn, fallback) {
  try { const v = await fn(); status[name] = { ok: true, at: now.toISOString() }; return v; }
  catch (e) {
    status[name] = { ok: false, at: now.toISOString(), error: String(e?.message || e).slice(0, 200) };
    log("FAILED", name, e?.message || e);
    return fallback;
  }
}
const clone = v => (v == null ? v : structuredClone(v));

// ---------- load previous ----------
await mkdir(dir, { recursive: true });
const prev = {
  site: await readJSON("site.json", null), odds: await readJSON("odds.json", null), news: await readJSON("news.json", null),
  stats: await readJSON("stats.json", null), games: await readJSON("games.json", null), media: await readJSON("media.json", null),
  history: await readJSON("history.json", null),
};
const keep = k => clone(prev.site?.[k]);

// ---------- schedule, standings, games ----------
// A feed that answers with nothing (or far less than last time) is treated as failed, so its last good data is kept
// instead of an empty page being published. Throwing inside source() records the failure and returns the fallback.
const nonEmpty = (name, list, prevList, min = 1) => {
  const n = list?.length ?? 0, p = prevList?.length ?? 0;
  if (n < min || (p >= 10 && n < p / 2)) throw new Error(`${name}: ${n} records (last good run had ${p}); keeping the last good data`);
  return list;
};
const sched = await source("schedule", async () => {
  const j = await get(`${SITE}/teams/lv/schedule?season=${SEASON}`);
  return { bye: j.byeWeek ?? null, games: nonEmpty("schedule", (j.events || []).map(e => P.mapEvent(e)), prev.site?.schedule?.games) };
}, keep("schedule"));
const allStandings = await source("standings", async () => nonEmpty("standings", P.mapStandings(await get(`https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=${SEASON}`)), null, 32), null);
const byId = Object.fromEntries((allStandings || []).map(r => [r.id, r]));

const games = sched?.games || [];
if (allStandings) for (const g of games) g.opp.record = byId[g.opp.id]?.record ?? null;
const next = games.find(g => !g.final) || null;
const last = [...games].reverse().find(g => g.final) || null;

const nextSumm = next ? await source("game preview", () => get(`${SITE}/summary?event=${next.id}`), null) : null;
// During a game the summary's score and clock are fresher than the team schedule's.
const live = P.liveFrom(nextSumm);
if (next && live) Object.assign(next, live);

// Finished games: fetch each box score once, then keep it.
const gameDetails = clone(prev.games?.games) || {};
for (const g of games.filter(g => g.final && !gameDetails[g.id]?.recap)) {
  const d = await source(`game ${g.week}`, async () => P.gameDetail(await get(`${SITE}/summary?event=${g.id}`), g), null);
  if (d) gameDetails[g.id] = d;
}
for (const id of Object.keys(gameDetails)) if (!games.some(g => g.id === id)) delete gameDetails[id];

// ---------- team stats, players, injuries ----------
const roster = await source("roster", async () => nonEmpty("roster", P.mapRoster(await get(`${SITE}/teams/${TEAM}/roster`)), prev.stats?.roster, 40), clone(prev.stats?.roster) || []);
const teamStats = await source("team stats", async () => nonEmpty("team stats", P.mapTeamStats(await get(`${CORE}/seasons/${SEASON}/types/2/teams/${TEAM}/statistics`)), prev.stats?.team), clone(prev.stats?.team) || []);
const players = await source("player stats", async () => nonEmpty("player stats", P.mapPlayerLeaders(await get(`${CORE}/seasons/${SEASON}/types/2/teams/${TEAM}/leaders`), roster), prev.stats?.players), clone(prev.stats?.players) || []);

// This week's AFC West games for the scores strip
const week = await source("scoreboard", async () => P.mapScoreboard(await get(`${SITE}/scoreboard`), AFC_WEST), keep("week") || null);

// nflverse (twice a day): EPA and tendencies for the Stats page, a profile for every player, a play-level breakdown
// of each game. Each file is fetched on its own, so one missing release only blanks the part that needs it.
const NV_BASE = "https://github.com/nflverse/nflverse-data/releases/download";
const prevPlayers = await readJSON("players.json", null), prevBreakdown = await readJSON("breakdown.json", null);
let adv = clone(prev.stats?.advanced) || null, tend = clone(prev.stats?.tendencies) || null;
let playersOut = clone(prevPlayers), breakdown = clone(prevBreakdown);
// The last attempt is kept in site.json, so a failing nflverse is retried hourly, not on every 10-minute game-day run.
let nflverseTried = prev.site?.nflverseTried ?? null;
const nvDue = !playersOut?.fetched || now - new Date(playersOut.fetched) > NFLVERSE_EVERY_H * H;
if (nvDue && (!nflverseTried || now - new Date(nflverseTried) > H)) {
  nflverseTried = now.toISOString();
  const csv = (name, file, gz = false, columns = null) => source(`nflverse ${name}`, async () => {
    const b = await get(`${NV_BASE}/${file}`, { type: "buffer", timeout: 90000 });
    return NV.parseCSV((gz ? gunzipSync(b) : b).toString("utf8"), columns);
  }, null);
  const pbp = await csv("play-by-play", `pbp/play_by_play_${SEASON}.csv.gz`, true, NV.PBP_COLUMNS);
  const ftn = await csv("charting", `ftn_charting/ftn_charting_${SEASON}.csv`);
  const statsReg = await csv("player stats", `stats_player/stats_player_reg_${SEASON}.csv`);
  const pfr = {};
  for (const k of ["def", "rec", "rush", "pass"]) pfr[k] = await csv(`PFR ${k}`, `pfr_advstats/advstats_week_${k}_${SEASON}.csv`);
  const snaps = await csv("snap counts", `snap_counts/snap_counts_${SEASON}.csv`);
  const fetched = now.toISOString();
  if (pbp) {
    adv = NV.advanced(pbp, "LV") ?? adv;
    if (adv) adv.fetched = fetched;
    if (ftn) tend = NV.tendencies(pbp, ftn, "LV") ?? tend;
    // nflverse ids games by week and teams (2026_07_LA_LV); the site uses ESPN ids
    const byWeek = Object.fromEntries(games.map(g => [g.week, g.id]));
    const bd = NV.gameBreakdowns(pbp, "LV"), mapped = {};
    for (const g of Object.values(bd)) if (byWeek[g.week]) mapped[byWeek[g.week]] = g;
    // Merge over the last good file: a game is replaced when the new file has it, never dropped when it doesn't
    breakdown = { fetched, throughWeek: adv?.throughWeek ?? breakdown?.throughWeek ?? null, games: { ...(breakdown?.games || {}), ...mapped } };
  }
  if (statsReg) {
    const list = await source("nflverse player profiles", async () => nonEmpty("player profiles",
      NV.players({ statsReg, pfrDef: pfr.def || [], pfrRec: pfr.rec || [], pfrRush: pfr.rush || [], pfrPass: pfr.pass || [], snaps: snaps || [] }, "LV"), prevPlayers?.players, 20), null);
    if (list) {
      playersOut = { fetched, throughWeek: adv?.throughWeek ?? playersOut?.throughWeek ?? null, players: list };
      // Link each profile to the ESPN player page and jersey number from the ESPN roster when the names match
      const espn = Object.fromEntries((roster || []).map(r => [NV.slug(r.name), r]));
      for (const p of playersOut.players) { const r = espn[p.id]; if (r) { p.jersey = r.jersey ?? null; p.link = r.link ?? null; p.status = r.group; } }
    }
  }
}

let matchup = keep("matchup") || null;
if (next && allStandings) {
  matchup = await source("matchup", async () => {
    const off = async id => {
      const s = P.mapTeamStats(await get(`${CORE}/seasons/${SEASON}/types/2/teams/${id}/statistics`));
      const f = k => { const x = s.find(r => r.key === k); return x ? { v: x.v, rank: x.rank } : null; };
      return { ppg: f("totalPointsPerGame"), ypg: f("yardsPerGame"), pass: f("passingYardsPerGame"), rush: f("rushingYardsPerGame") };
    };
    const [a, b] = await Promise.all([off(TEAM), off(next.opp.id)]);
    const box = id => Object.fromEntries((nextSumm?.boxscore?.teams || []).find(t => t.team?.id === id)?.statistics?.map(s => [s.name, Number(s.displayValue)]) || []);
    const bu = box(TEAM), bt = box(next.opp.id), su = byId[TEAM], st = byId[next.opp.id];
    const row = (label, u, t, higher) => (u && t && u.v != null && t.v != null && !isNaN(u.v) && !isNaN(t.v) ? { label, us: u, them: t, higher } : null);
    return {
      gameId: next.id, opp: next.opp.name,
      rows: [
        row("Points / game", a.ppg, b.ppg, true),
        row("Total offense", a.ypg, b.ypg, true),
        row("Passing offense", a.pass, b.pass, true),
        row("Rushing offense", a.rush, b.rush, true),
        row("Yards allowed", { v: bu.yardsPerGameAllowed, rank: null }, { v: bt.yardsPerGameAllowed, rank: null }, false),
        row("Points allowed", { v: su?.papg, rank: su?.paRank }, { v: st?.papg, rank: st?.paRank }, false),
      ].filter(Boolean),
    };
  }, matchup);
}

const injuries = next ? await source("injuries", async () => {
  const j = await get(`${SITE}/injuries`);
  const team = id => P.mapInjuries((j.injuries || []).find(x => String(x.id) === id)?.injuries);
  return { gameId: next.id, us: team(TEAM), them: team(next.opp.id), opp: next.opp.name };
}, keep("injuries")) : null;

// ---------- news and media ----------
let espnArticles = [];
const fresh = [];
for (const [src, url] of NEWS_FEEDS) {
  const items = await source(`news: ${src}`, async () => P.parseFeed(await get(url, { type: "text" })), []);
  fresh.push(...items.map(i => P.toItem(i, src)).filter(Boolean));
}
await source("news: ESPN", async () => {
  const j = await get(`${SITE}/news?team=${TEAM}&limit=40`);
  espnArticles = j.articles || [];
  for (const a of espnArticles) {
    const ids = (a.categories || []).filter(c => c.type === "team").map(c => String(c.teamId));
    if (!ids.includes(TEAM) || ids.length > 3 || a.type === "Media") continue;
    const it = P.toItem({ title: a.headline, link: (a.links?.web?.href || "").replace(/^http:/, "https:"), date: a.published, desc: a.description }, "ESPN");
    if (it) fresh.push(it);
  }
});
const newsItems = P.mergeNews(prev.news?.items, fresh, { now });

const media = {
  updated: now.toISOString(),
  youtube: await source("videos", youtube, clone(prev.media?.youtube) || []),
  podcasts: await source("podcasts", async () => P.parseFeed(await get("https://www.raiders.com/rss/audio", { type: "text" })).filter(i => P.isWebUrl(i.link) && !isNaN(new Date(i.date))).slice(0, 12)
    .map(i => ({ title: i.title, link: i.link, date: new Date(i.date).toISOString(), desc: i.desc.slice(0, 220), src: "Raiders.com" })), clone(prev.media?.podcasts) || []),
  espn: espnArticles.length ? espnArticles.filter(a => a.type === "Media" && (a.categories || []).some(c => c.type === "team" && String(c.teamId) === TEAM))
    .slice(0, 12).map(a => ({ title: a.headline, link: (a.links?.web?.href || "").replace(/^http:/, "https:"), date: a.published, desc: (a.description || "").slice(0, 220), src: "ESPN" }))
    : clone(prev.media?.espn) || [],
};

async function youtube() {
  // Optional: with repo secret YT_API_KEY use the official API (GitHub runners can't reach the RSS feed).
  const key = process.env.YT_API_KEY;
  const toVideo = (id, title, date, thumb) => ({ id, title, date, thumb, url: /#shorts|shorts/i.test(title) ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}` });
  if (key) {
    const j = await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=12&playlistId=UU${YT_CHANNEL.slice(2)}&key=${key}`);
    return (j.items || []).map(i => i.snippet).filter(s => s.resourceId?.videoId)
      .map(s => toVideo(s.resourceId.videoId, s.title, s.publishedAt, s.thumbnails?.high?.url || s.thumbnails?.default?.url));
  }
  let err;
  for (const q of [`channel_id=${YT_CHANNEL}`, `channel_id=${YT_CHANNEL}`, `playlist_id=UU${YT_CHANNEL.slice(2)}`]) {
    try {
      const x = await get(`https://www.youtube.com/feeds/videos.xml?${q}`, { type: "text", tries: 1 });
      return x.split("<entry>").slice(1, 13).map(s => toVideo(
        (s.match(/<yt:videoId>([^<]+)/) || [])[1], P.decode((s.match(/<title>([^<]*)/) || [])[1] || ""),
        (s.match(/<published>([^<]+)/) || [])[1], (s.match(/<media:thumbnail url="([^"]+)"/) || [])[1])).filter(v => v.id);
    } catch (e) { err = e; await new Promise(r => setTimeout(r, 3000)); }
  }
  throw err;
}

// ---------- history (past seasons fetched once) ----------
const history = clone(prev.history) || { seasons: [] };
for (let y = HISTORY_FROM; y < SEASON; y++) {
  if (history.seasons.some(s => s.year === y)) continue;
  const r = await source(`history ${y}`, async () => ({ year: y, ...P.seasonRecord((await get(`${SITE}/teams/lv/schedule?season=${y}&seasontype=2`)).events || []) }), null);
  if (r && r.w + r.l + r.t > 0) history.seasons.push(r); // an empty response would otherwise be stored as 0-0 for good
}
history.seasons.sort((a, b) => b.year - a.year);

// ---------- odds ----------
const odds = clone(prev.odds) || {
  updated: null, current: null, window: null, closing: {}, record: null,
  // Weeks 1-6 from public ATS reports (Bleacher Nation, iHeart) plus the Week 6 line (CBS: Bills -5.5, 53.5).
  baseline: { throughWeek: 6, ats: [5, 1, 0], ou: [4, 2, 0], note: "Weeks 1-6 from public reports" },
};
if (next) {
  const kick = new Date(next.date).getTime();
  odds.window = { gameId: next.id, opens: new Date(kick - ODDS_OPEN_H * H).toISOString(), closes: new Date(kick - ODDS_CLOSE_H * H).toISOString() };
  const inWindow = now >= kick - ODDS_OPEN_H * H && now <= kick - ODDS_CLOSE_H * H;
  if ((inWindow || forceOdds) && nextSumm && !next.timeTBD) {
    const snap = P.snapshot(nextSumm, next, now);
    if (snap) {
      odds.current = snap;
      // Every capture is kept (about 12 a game) so line movement can be shown and the closing line audited.
      const hist = ((odds.history ||= {})[next.id] ||= []);
      hist.push({ asOf: snap.asOf, spread: snap.us.spread, spreadOdds: snap.us.spreadOdds, ml: snap.us.ml, oppMl: snap.them.ml, total: snap.total.line, book: snap.book });
      if (hist.length > 30) hist.splice(0, hist.length - 30);
      odds.closing[next.id] = { week: next.week, opp: next.opp.abbr, spread: snap.us.spread, ml: snap.us.ml, total: snap.total.line, asOf: snap.asOf, book: snap.book, captures: hist.length };
      log("odds snapshot", snap.us.spread, snap.total.line);
    } else log("odds: no lines posted yet");
  } else log("odds: outside window", odds.window.opens, "to", odds.window.closes);
}
P.grade(odds, games);
odds.updated = now.toISOString();

// ---------- assemble ----------
const west = (allStandings || []).filter(r => AFC_WEST.includes(r.id)).sort((a, b) => b.pctValue - a.pctValue || a.l - b.l)
  .map(r => ({ id: r.id, name: r.name, w: r.w, l: r.l, t: r.t, pct: r.pct, diff: r.diff, us: r.id === TEAM }));
const afc = (allStandings || []).filter(r => r.conf === "AFC").sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99))
  .map(r => ({ id: r.id, name: r.name, w: r.w, l: r.l, t: r.t, pct: r.pct, seed: r.seed, diff: r.diff, us: r.id === TEAM }));
const lastDetail = last ? gameDetails[last.id] : null;

const site = {
  updated: now.toISOString(),
  season: SEASON,
  record: byId[TEAM]?.record ?? keep("record") ?? null,
  divisionPlace: west.length ? P.ordinal(west.findIndex(r => r.us) + 1) + " in AFC West" : keep("divisionPlace") ?? null,
  next: next ? {
    ...next, oppRecord: byId[next.opp.id]?.record ?? null,
    venue: nextSumm?.gameInfo?.venue ? { name: nextSumm.gameInfo.venue.fullName, city: nextSumm.gameInfo.venue.address?.city } : keep("next")?.venue ?? null,
  } : null,
  last: last ? { ...last, leaders: lastDetail?.leaders?.us ?? [], recap: lastDetail?.recap ?? null } : null,
  schedule: sched,
  week,
  standings: west.length ? { west, afc } : keep("standings"),
  matchup,
  injuries,
  leaders: nextSumm ? P.leadersFrom(nextSumm, TEAM, ["passingYards", "rushingYards", "receivingYards", "sacks", "totalTackles"]) : keep("leaders") ?? [],
  sources: status,
  nflverseTried,
};

const changed = {
  site: await save("site.json", site, prev.site),
  odds: await save("odds.json", odds, prev.odds),
  news: await save("news.json", { updated: now.toISOString(), items: newsItems }, prev.news),
  stats: await save("stats.json", { updated: now.toISOString(), season: SEASON, team: teamStats, players, roster, advanced: adv, tendencies: tend }, prev.stats),
  games: await save("games.json", { updated: now.toISOString(), games: gameDetails }, prev.games),
  media: await save("media.json", media, prev.media),
  history: await save("history.json", history, prev.history),
  players: playersOut ? await save("players.json", playersOut, prevPlayers) : false,
  breakdown: breakdown ? await save("breakdown.json", breakdown, prevBreakdown) : false,
};
// Tell the workflow when to run again (see P.nextWait); outside game windows the hourly cron is all there is.
const wait = P.nextWait(next, now, (week?.games || []).filter(g => g.id !== next?.id && !g.final && !g.postponed).map(g => g.date));
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `wait=${wait ?? ""}\n`);
log("next run", wait == null ? "on cron" : `in ${Math.round(wait / 60)} min`);
log("done", { changed: Object.keys(changed).filter(k => changed[k]), failed: Object.entries(status).filter(([, s]) => !s.ok).map(([k]) => k) });
