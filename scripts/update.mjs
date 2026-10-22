// Pulls Raiders data into data/site.json and data/odds.json for the static page.
// Run hourly by .github/workflows/update.yml. Node 20+, no dependencies.
//   node scripts/update.mjs               normal run (odds only inside the 12h -> 1h window)
//   node scripts/update.mjs --force-odds  take an odds snapshot now, whatever the time
// Each source fails on its own: if one feed is down, the last good data for it is kept.
import { readFile, writeFile, mkdir } from "node:fs/promises";

const TEAM = "13";                        // ESPN id for Las Vegas
const AFC_WEST = ["13", "12", "7", "24"]; // LV, KC, DEN, LAC
const SEASON = 2026;
const YT_CHANNEL = "UC24qVyqQyKXDeXLFqBF6F_Q";
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const ODDS_OPEN_H = 12, ODDS_CLOSE_H = 1;
const H = 36e5;

const now = new Date();
const forceOdds = process.argv.includes("--force-odds");
const dir = new URL("../data/", import.meta.url);
const log = (...a) => console.log("[update]", ...a);

async function get(url, type = "json") {
  const r = await fetch(url, { headers: { "user-agent": "BlackHoleHighlights/1.0 (+https://myintp.github.io/blackhole-highlights/)" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return type === "json" ? r.json() : r.text();
}
async function readJSON(name, fallback) {
  try { return JSON.parse(await readFile(new URL(name, dir), "utf8")); } catch { return fallback; }
}
// Write only when content (ignoring the timestamp) changed, so quiet hours make no commits.
async function writeIfChanged(name, obj, prev) {
  const strip = o => JSON.stringify({ ...o, updated: null });
  if (prev && strip(prev) === strip(obj)) { log(name, "unchanged"); return false; }
  await writeFile(new URL(name, dir), JSON.stringify(obj, null, 1) + "\n");
  log(name, "written");
  return true;
}
const rankText = r => (r || "").replace(/^Tied-/, "T-") || null;
const num = v => (v == null || v === "" ? null : Number(String(v).replace(/^[ou]/, "")));
const status = {};
async function source(name, fn, fallback) {
  try { const v = await fn(); status[name] = { ok: true, at: now.toISOString() }; return v; }
  catch (e) { status[name] = { ok: false, at: now.toISOString(), error: String(e.message || e).slice(0, 200) }; log("FAILED", name, e.message); return fallback; }
}

// ---------- sources ----------
async function schedule() {
  const j = await get(`${SITE}/teams/lv/schedule?season=${SEASON}`);
  const games = j.events.map(e => {
    const c = e.competitions[0], st = c.status.type;
    const us = c.competitors.find(x => x.team.id === TEAM), them = c.competitors.find(x => x.team.id !== TEAM);
    const scored = st.completed || st.state === "in";
    return {
      id: e.id, week: e.week?.number ?? null, date: e.date, timeTBD: e.timeValid === false || !!c.status.isTBDFlex,
      home: us.homeAway === "home",
      opp: { id: them.team.id, name: them.team.shortDisplayName, location: them.team.location, abbr: them.team.abbreviation },
      tv: (c.broadcasts || []).map(b => b.media?.shortName).filter(Boolean).join(" / ") || null,
      state: st.state, final: !!st.completed,
      score: scored ? { us: Number(us.score?.value ?? us.score), them: Number(them.score?.value ?? them.score) } : null,
      win: st.completed ? !!us.winner : null,
    };
  });
  return { bye: j.byeWeek ?? null, games };
}

async function standings() {
  const j = await get(`https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=${SEASON}`);
  const rows = j.children.flatMap(conf => conf.standings.entries.map(en => {
    const s = Object.fromEntries(en.stats.map(x => [x.name, x]));
    const w = s.wins?.value ?? 0, l = s.losses?.value ?? 0, t = s.ties?.value ?? 0, gp = w + l + t;
    const loc = en.team.location;
    return {
      id: en.team.id,
      name: loc === "Los Angeles" ? "LA " + en.team.name : loc === "New York" ? "NY " + en.team.name : loc,
      w, l, t, record: `${w}-${l}${t ? "-" + t : ""}`, pct: s.winPercent?.displayValue ?? null,
      pctValue: s.winPercent?.value ?? 0, papg: gp ? (s.pointsAgainst?.value ?? 0) / gp : null,
    };
  }));
  // Points allowed per game, ranked across the league (lower is better)
  const ranked = rows.filter(r => r.papg != null).sort((a, b) => a.papg - b.papg);
  for (const r of ranked) {
    const better = ranked.filter(x => x.papg < r.papg - 1e-9).length, tied = ranked.filter(x => Math.abs(x.papg - r.papg) < 1e-9).length;
    r.paRank = (tied > 1 ? "T-" : "") + ordinal(better + 1);
  }
  const west = rows.filter(r => AFC_WEST.includes(r.id)).sort((a, b) => b.pctValue - a.pctValue || a.l - b.l)
    .map(({ id, name, w, l, t, pct }) => ({ id, name, w, l, t, pct, us: id === TEAM }));
  return { west, byId: Object.fromEntries(rows.map(r => [r.id, r])) };
}
function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

async function offense(teamId) {
  const j = await get(`${CORE}/seasons/${SEASON}/types/2/teams/${teamId}/statistics`);
  const all = j.splits.categories.flatMap(c => c.stats);
  const pick = n => { const s = all.find(x => x.name === n); return s ? { v: Number(s.value), rank: rankText(s.rankDisplayValue) } : null; };
  return { ppg: pick("totalPointsPerGame"), ypg: pick("yardsPerGame"), pass: pick("passingYardsPerGame"), rush: pick("rushingYardsPerGame") };
}

const summary = id => get(`${SITE}/summary?event=${id}`);

// League-wide feed: the game preview only lists five players per team.
async function injuries(ids) {
  const j = await get(`${SITE}/injuries`);
  const order = s => ["Out", "Injured Reserve", "Doubtful", "Questionable"].findIndex(x => s.startsWith(x)) + 1 || 9;
  return Object.fromEntries(ids.map(id => {
    const t = (j.injuries || []).find(x => String(x.id) === id);
    const list = (t?.injuries || []).filter(i => i.status && i.status !== "Active").map(i => ({
      name: i.athlete?.displayName, pos: i.athlete?.position?.abbreviation || "",
      injury: i.details?.type || "", status: i.status, ret: i.details?.returnDate || null,
    })).sort((a, b) => order(a.status) - order(b.status));
    return [id, list];
  }));
}
function leadersFrom(summ, teamId, wanted) {
  const t = (summ.leaders || []).find(x => x.team?.id === teamId);
  const cats = t?.leaders || [];
  const order = wanted.filter(n => cats.some(c => c.name === n));
  return order.map(n => {
    const c = cats.find(x => x.name === n), L = c.leaders?.[0];
    return L ? { cat: c.displayName, name: L.athlete?.displayName, value: L.mainStat?.value ?? L.displayValue, unit: L.mainStat?.label || "", line: L.summary || L.displayValue } : null;
  }).filter(Boolean);
}
function boxFrom(summ, teamId) {
  const t = (summ.boxscore?.teams || []).find(x => x.team?.id === teamId);
  return Object.fromEntries((t?.statistics || []).map(s => [s.name, Number(s.displayValue)]));
}

async function rss(url) {
  const x = await get(url, "text");
  const items = x.split(/<item[\s>]|<entry[\s>]/).slice(1);
  const tag = (s, t) => { const m = s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim()) : null; };
  return items.map(s => ({
    title: tag(s, "title"),
    link: tag(s, "link") || (s.match(/<link[^>]*href="([^"]+)"/) || [])[1] || null,
    date: tag(s, "pubDate") || tag(s, "published") || tag(s, "updated"),
    desc: (tag(s, "description") || "").replace(/<[^>]+>/g, "").trim(),
  }));
}
function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}
function tagFor(t) {
  const s = t.toLowerCase();
  if (/injur|concussion|questionable|ruled out|\bir\b/.test(s)) return "Injury";
  if (/trade|sign|waive|release|roster|depth chart|practice squad|activate/.test(s)) return "Roster";
  if (/recap|takeaways|grades|observations|holds off|beat|falls|loss to|win over/.test(s)) return "Recap";
  if (/preview|prediction|odds|keys to|what to watch|week \d+/.test(s)) return "Preview";
  if (/mailbag|film|analysis|breakdown|stats and facts/.test(s)) return "Analysis";
  return "News";
}
async function news() {
  const [rai, sbp, espn] = await Promise.all([
    rss("https://www.raiders.com/rss/news").catch(() => []),
    rss("https://www.silverandblackpride.com/rss/index.xml").catch(() => []),
    get(`${SITE}/news?team=${TEAM}&limit=25`).then(j => j.articles
      .filter(a => { const ids = (a.categories || []).filter(c => c.type === "team").map(c => String(c.teamId)); return ids.includes(TEAM) && ids.length <= 2; })
      .map(a => ({ title: a.headline, link: a.links?.web?.href, date: a.published, desc: a.description || "" }))).catch(() => []),
  ]);
  const tagged = (list, src) => list.filter(i => i.title && i.link).map(i => ({ ...i, src, iso: new Date(i.date).toISOString() }));
  const all = [...tagged(rai, "Raiders.com"), ...tagged(sbp, "Silver & Black Pride"), ...tagged(espn, "ESPN")];
  if (!all.length) throw new Error("no news from any feed");
  const seen = new Set();
  return all.sort((a, b) => b.iso.localeCompare(a.iso))
    .filter(i => { const k = i.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 10)
    .map(i => ({ title: i.title, link: i.link, date: i.iso, src: i.src, tag: tagFor(i.title), desc: i.desc.slice(0, 220) }));
}

// YouTube's feed intermittently 404s for cloud IPs (GitHub runners), so retry, then try the uploads-playlist feed.
async function youtubeFeed() {
  const urls = [`channel_id=${YT_CHANNEL}`, `channel_id=${YT_CHANNEL}`, `channel_id=${YT_CHANNEL}`, `playlist_id=UU${YT_CHANNEL.slice(2)}`];
  let err;
  for (const [i, q] of urls.entries()) {
    try { return await get(`https://www.youtube.com/feeds/videos.xml?${q}`, "text"); }
    catch (e) { err = e; await new Promise(r => setTimeout(r, 2000 * (i + 1))); }
  }
  throw err;
}
async function videos() {
  const x = await youtubeFeed();
  return x.split("<entry>").slice(1, 9).map(s => ({
    id: (s.match(/<yt:videoId>([^<]+)/) || [])[1],
    title: decode((s.match(/<title>([^<]*)/) || [])[1] || ""),
    date: (s.match(/<published>([^<]+)/) || [])[1],
    thumb: (s.match(/<media:thumbnail url="([^"]+)"/) || [])[1],
  })).filter(v => v.id).map(v => ({ ...v, url: /shorts/i.test(v.title) ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}` }));
}

// ---------- odds ----------
function snapshot(summ, next) {
  const p = summ?.pickcenter?.[0];
  if (!p?.pointSpread) return null;
  const us = next.home ? "home" : "away", them = next.home ? "away" : "home";
  const side = s => ({
    spread: p.pointSpread[s]?.close?.line ?? null, spreadOdds: p.pointSpread[s]?.close?.odds ?? null,
    ml: p.moneyline?.[s]?.close?.odds ?? null,
    openSpread: p.pointSpread[s]?.open?.line ?? null, openMl: p.moneyline?.[s]?.open?.odds ?? null,
  });
  return {
    gameId: next.id, week: next.week, asOf: now.toISOString(), book: p.provider?.name || "Sportsbook",
    us: side(us), them: { ...side(them), abbr: next.opp.abbr },
    total: {
      line: num(p.total?.over?.close?.line ?? p.overUnder), over: p.total?.over?.close?.odds ?? null,
      under: p.total?.under?.close?.odds ?? null, open: num(p.total?.over?.open?.line),
    },
  };
}
function grade(odds, games) {
  for (const g of games) {
    const h = odds.closing[g.id];
    if (!g.final || !h || h.result) continue;
    const margin = g.score.us - g.score.them, pts = g.score.us + g.score.them, sp = num(h.spread);
    h.result = {
      ats: sp == null ? null : margin + sp > 0 ? "W" : margin + sp < 0 ? "L" : "P",
      ou: h.total == null ? null : pts > h.total ? "O" : pts < h.total ? "U" : "P",
    };
  }
  const ats = [...odds.baseline.ats], ou = [...odds.baseline.ou];
  for (const h of Object.values(odds.closing)) {
    if (!h.result || h.week <= odds.baseline.throughWeek) continue;
    if (h.result.ats) ats[{ W: 0, L: 1, P: 2 }[h.result.ats]]++;
    if (h.result.ou) ou[{ O: 0, U: 1, P: 2 }[h.result.ou]]++;
  }
  odds.record = { ats, ou };
}

// ---------- run ----------
await mkdir(dir, { recursive: true });
const prevSite = await readJSON("site.json", null);
const prevOdds = await readJSON("odds.json", null);
const keep = k => (prevSite?.[k] == null ? prevSite?.[k] : structuredClone(prevSite[k])); // clone so fallbacks never mutate prevSite

const sched = await source("schedule", schedule, keep("schedule"));
const stand = await source("standings", standings, null);
const games = sched?.games || [];
const next = games.find(g => !g.final) || null;
const last = [...games].reverse().find(g => g.final) || null;

let nextSumm = null, lastSumm = null;
if (next) nextSumm = await source("game preview", () => summary(next.id), null);
if (last) lastSumm = await source("last game", () => summary(last.id), null);

// Opponent records on every schedule row
if (stand) for (const g of games) g.opp.record = stand.byId[g.opp.id]?.record ?? null;

let matchup = keep("matchup") || null;
if (next && stand) {
  matchup = await source("team stats", async () => {
    const [a, b] = await Promise.all([offense(TEAM), offense(next.opp.id)]);
    const boxUs = nextSumm ? boxFrom(nextSumm, TEAM) : {}, boxThem = nextSumm ? boxFrom(nextSumm, next.opp.id) : {};
    const su = stand.byId[TEAM], st = stand.byId[next.opp.id];
    const row = (label, u, t, higher) => (u && t && u.v != null && t.v != null ? { label, us: u, them: t, higher } : null);
    return {
      gameId: next.id, opp: next.opp.name,
      rows: [
        row("Points / game", a.ppg, b.ppg, true),
        row("Total offense", a.ypg, b.ypg, true),
        row("Passing offense", a.pass, b.pass, true),
        row("Rushing offense", a.rush, b.rush, true),
        row("Yards allowed", { v: boxUs.yardsPerGameAllowed, rank: null }, { v: boxThem.yardsPerGameAllowed, rank: null }, false),
        row("Points allowed", { v: su.papg, rank: su.paRank }, { v: st.papg, rank: st.paRank }, false),
      ].filter(Boolean),
    };
  }, matchup);
}

const site = {
  updated: now.toISOString(),
  season: SEASON,
  record: stand?.byId[TEAM]?.record ?? keep("record") ?? null,
  next: next ? {
    ...next,
    oppRecord: stand?.byId[next.opp.id]?.record ?? null,
    venue: nextSumm?.gameInfo?.venue ? { name: nextSumm.gameInfo.venue.fullName, city: nextSumm.gameInfo.venue.address?.city } : keep("next")?.venue ?? null,
  } : null,
  last: last ? {
    ...last,
    leaders: lastSumm ? leadersFrom(lastSumm, TEAM, ["passingYards", "rushingYards", "receivingYards", "sacks"]) : keep("last")?.leaders ?? [],
    recap: lastSumm?.article ? { title: lastSumm.article.headline, link: lastSumm.article.links?.web?.href } : keep("last")?.recap ?? null,
  } : null,
  schedule: sched,
  standings: stand?.west ?? keep("standings") ?? [],
  matchup,
  injuries: next ? await source("injuries", async () => {
    const m = await injuries([TEAM, next.opp.id]);
    return { us: m[TEAM], them: m[next.opp.id], opp: next.opp.name };
  }, keep("injuries") ?? null) : null,
  leaders: nextSumm ? leadersFrom(nextSumm, TEAM, ["passingYards", "rushingYards", "receivingYards", "sacks", "totalTackles"]) : keep("leaders") ?? [],
  news: await source("news", news, keep("news") || []),
  videos: await source("videos", videos, keep("videos") || []),
  sources: status,
};

// Odds: snapshot hourly from 12h to 1h before kickoff. The last snapshot in the window is the closing line.
const odds = prevOdds ? structuredClone(prevOdds) : { // clone: writeIfChanged compares against prevOdds
  updated: null, current: null, window: null, closing: {}, record: null,
  // Weeks 1-6 from public ATS reports (Bleacher Nation, iHeart) plus the Week 6 line (CBS, Bills -5.5, 53.5).
  baseline: { throughWeek: 6, ats: [5, 1, 0], ou: [4, 2, 0], note: "Weeks 1-6 from public reports" },
};
if (next) {
  const kick = new Date(next.date).getTime();
  odds.window = { gameId: next.id, opens: new Date(kick - ODDS_OPEN_H * H).toISOString(), closes: new Date(kick - ODDS_CLOSE_H * H).toISOString() };
  const inWindow = now >= kick - ODDS_OPEN_H * H && now <= kick - ODDS_CLOSE_H * H;
  if ((inWindow || forceOdds) && nextSumm && !next.timeTBD) {
    const snap = snapshot(nextSumm, next);
    if (snap) {
      odds.current = snap;
      odds.closing[next.id] = { week: next.week, spread: snap.us.spread, total: snap.total.line, asOf: snap.asOf, book: snap.book };
      log("odds snapshot", snap.us.spread, snap.total.line);
    } else log("odds: no lines posted yet");
  } else log("odds: outside window", odds.window.opens, "to", odds.window.closes);
}
grade(odds, games);
odds.updated = now.toISOString();

const a = await writeIfChanged("site.json", site, prevSite && { ...prevSite, sources: site.sources });
const b = await writeIfChanged("odds.json", odds, prevOdds);
const failed = Object.entries(status).filter(([, s]) => !s.ok).map(([k]) => k);
log("done", { siteChanged: a, oddsChanged: b, failed });
