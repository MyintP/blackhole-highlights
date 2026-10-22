// Pure transforms from raw feed data to the site's JSON shapes. No network here, so it's unit-tested (tests/parse.test.mjs).

export const TEAM = "13"; // ESPN id for Las Vegas

// ---------- small helpers ----------
export function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
export const rankText = r => (r ? String(r).replace(/^Tied-/, "T-") : null);
export const num = v => (v == null || v === "" ? null : Number(String(v).replace(/^[ou]/i, "")));
export function hash(s) { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return h.toString(36); }
export function decode(s) {
  return String(s ?? "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;|&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
const stripTags = s => decode(String(s ?? "").replace(/<!\[CDATA\[|\]\]>/g, "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
export const record = (w, l, t) => `${w}-${l}${t ? "-" + t : ""}`;

// ---------- RSS / Atom ----------
export function parseFeed(xml) {
  const blocks = String(xml).split(/<item[\s>]|<entry[\s>]/).slice(1);
  const tag = (s, t) => { const m = s.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`)); return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : null; };
  return blocks.map(s => ({
    title: stripTags(tag(s, "title")),
    link: decode(tag(s, "link") || (s.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "").trim() || null,
    date: tag(s, "pubDate") || tag(s, "published") || tag(s, "updated"),
    desc: stripTags(tag(s, "description") || tag(s, "summary") || ""),
    author: stripTags(tag(s, "dc:creator") || tag(s, "name") || "") || null,
  })).filter(i => i.title && i.link);
}

// ---------- news ----------
// Who is speaking: the team itself, a news organisation, or a fan/opinion outlet. Rumors override all three.
export const SOURCES = {
  "Raiders.com": { kind: "Official" },
  "ESPN": { kind: "Reporting" },
  "Las Vegas Review-Journal": { kind: "Reporting" },
  "Silver & Black Pride": { kind: "Opinion" },
  "RaidersBeat": { kind: "Opinion" },
};
const KIND_RANK = { Official: 0, Reporting: 1, Opinion: 2, Rumor: 3 };

export function kindFor(title, src) {
  if (/\brumou?rs?\b|\breportedly\b|\bshould (trade|sign|target)\b|\btrade target|\blinked to\b|\bcould (trade|land|target)\b|\bwould make sense\b/i.test(title)) return "Rumor";
  return SOURCES[src]?.kind || "Reporting";
}
export function categoryFor(title) {
  const s = title.toLowerCase();
  if (/injur|concussion|\bquestionable\b|ruled out|\bir\b|hamstring|\bankle\b|\bknee\b|\bout for\b/.test(s)) return "Injuries";
  if (/\btrades?\b|\btraded\b|\bsign(s|ed|ing)?\b|\bwaive|\breleas|\broster\b|depth chart|practice squad|\bactivat|\bclaim(s|ed)?\b|\bcuts?\b|\bcontract|\bextension\b|free agen/.test(s)) return "Roster";
  if (/\bdraft|\bmock\b|\bprospects?\b|\bcombine\b/.test(s)) return "Draft";
  if (/\bcoach|\bcoordinator|play-?call|\bstaff\b/.test(s)) return "Coaching";
  if (/\brecap|takeaways|\bgrades\b|observations|holds off|\bbeats?\b|\bfalls?\b|loss to|win over|\bpreview|predict|\bodds\b|keys to|what to watch|\bweek \d+|\bvs\b|game day|kickoff|power rank/.test(s)) return "Games";
  if (/mailbag|\bfilm\b|analysis|breakdown|\bstats?\b|\bnumbers\b|\bfacts\b|\bhistory\b|ranking/.test(s)) return "Analysis";
  return "Team";
}

const STOP = new Set("the a an and or of to in on for at by with from as is are be vs raiders raider las vegas nfl week after into over his their its this that how why what".split(" "));
const tokens = t => new Set(t.toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)));
export function similar(a, b) {
  const A = tokens(a), B = tokens(b);
  if (A.size < 3 || B.size < 3) return false;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.5;
}

// Only http(s) links reach the page: a feed could otherwise inject javascript: or data: URLs.
export const isWebUrl = u => /^https?:\/\/[^\s"<>]+$/i.test(String(u || ""));

export function toItem(raw, src) {
  const d = new Date(raw.date);
  if (!raw.title || !isWebUrl(raw.link) || isNaN(d)) return null;
  return {
    id: hash(raw.link), title: raw.title, link: raw.link, src, date: d.toISOString(),
    kind: kindFor(raw.title, src), cat: categoryFor(raw.title),
    desc: (raw.desc || "").slice(0, 260), author: raw.author || null,
  };
}

// Merge new items into the archive. Same link -> one item. Same story from several outlets within 48h -> one item
// with the others under `also`; the primary is the most authoritative (Official > Reporting > Opinion > Rumor).
export function mergeNews(archive, fresh, { now = new Date(), maxDays = 180, maxItems = 600 } = {}) {
  const flat = new Map();
  for (const it of [...(archive || []).flatMap(a => [a, ...(a.also || [])]), ...fresh]) {
    if (!it?.id) continue;
    const { also, ...rest } = it;
    if (!flat.has(it.id)) flat.set(it.id, rest);
  }
  const cutoff = now.getTime() - maxDays * 864e5;
  const items = [...flat.values()].filter(i => new Date(i.date).getTime() >= cutoff)
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.date.localeCompare(a.date));
  const out = [];
  for (const it of items) {
    const t = new Date(it.date).getTime();
    const host = out.find(o => Math.abs(new Date(o.date).getTime() - t) < 48 * 36e5 && similar(o.title, it.title));
    if (host) (host.also ||= []).push({ id: it.id, title: it.title, link: it.link, src: it.src, date: it.date, kind: it.kind });
    else out.push({ ...it });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, maxItems);
}

// ---------- schedule, standings, history ----------
// ESPN status names: STATUS_POSTPONED, STATUS_CANCELED, STATUS_SUSPENDED (a weather delay is STATUS_DELAYED and still live)
export const isPostponed = st => /POSTPONED|CANCELED|CANCELLED|SUSPENDED/.test(st?.name || "");

export function mapEvent(e, team = TEAM) {
  const c = e.competitions[0], st = c.status.type;
  const us = c.competitors.find(x => x.team.id === team), them = c.competitors.find(x => x.team.id !== team);
  const sc = x => Number(x.score?.value ?? x.score);
  const scored = st.completed || st.state === "in";
  return {
    id: e.id, week: e.week?.number ?? null, date: e.date, timeTBD: e.timeValid === false || !!c.status.isTBDFlex,
    home: us.homeAway === "home",
    opp: { id: them.team.id, name: them.team.shortDisplayName, location: them.team.location, abbr: them.team.abbreviation },
    tv: (c.broadcasts || []).map(b => b.media?.shortName).filter(Boolean).join(" / ") || null,
    state: st.state, final: !!st.completed, detail: st.state === "in" ? st.shortDetail || null : null, postponed: isPostponed(st),
    score: scored ? { us: sc(us), them: sc(them) } : null,
    win: st.completed ? (sc(us) === sc(them) ? null : !!us.winner) : null,
    tie: st.completed && sc(us) === sc(them),
  };
}

// Live state from a game summary (fresher than the team schedule during a game): score, clock, quarter.
export function liveFrom(summary, team = TEAM) {
  const c = summary?.header?.competitions?.[0], st = c?.status?.type;
  const us = c?.competitors?.find(x => x.team?.id === team), them = c?.competitors?.find(x => x.team?.id !== team);
  if (!st || !us || !them || st.state === "pre") return null;
  const sc = x => Number(x.score?.value ?? x.score);
  if (isNaN(sc(us)) || isNaN(sc(them))) return null;
  return { state: st.state, detail: st.state === "in" ? st.shortDetail || null : null, score: { us: sc(us), them: sc(them) } };
}

// How long the update job should wait before running itself again, in seconds, or null to leave it to the
// (best-effort, often hours-late) cron. Chains from 18h before a Raiders kickoff: hourly through the odds window
// with a last capture just before it closes, then every 10 minutes for live scores until 4.5h after kickoff.
// `others` are kickoff times of the week's other AFC West games: 10 minutes while one is on, for the scores strip.
export function nextWait(g, now = new Date(), others = []) {
  const M = 6e4, t = now.getTime(), waits = [];
  if (g && !g.timeTBD && !g.final && !g.postponed) {
    const kick = new Date(g.date).getTime(), open = kick - 12 * 60 * M, close = kick - 60 * M;
    if (!isNaN(kick) && t >= kick - 18 * 60 * M && t <= kick + 270 * M) {
      if (t < open) waits.push(Math.min(open - t + 2 * M, 60 * M));
      else if (t < close) waits.push(close - t > 70 * M ? 60 * M : Math.max(close - t - 8 * M, M));
      else waits.push(10 * M);
    }
  }
  for (const d of others) {
    const k = new Date(d).getTime();
    if (isNaN(k)) continue;
    if (t >= k && t <= k + 270 * M) waits.push(10 * M);
    else if (t < k && k - t <= 60 * M) waits.push(Math.max(k - t + M, M)); // first check just after kickoff
  }
  return waits.length ? Math.round(Math.min(...waits) / 1000) : null;
}

// This week's games involving `teams` (ESPN ids) from the league scoreboard, plus which of them are on bye.
export function mapScoreboard(json, teams) {
  const sc = x => { const v = Number(x?.score?.value ?? x?.score); return isNaN(v) ? null : v; };
  const games = (json?.events || []).flatMap(e => {
    const c = e.competitions?.[0], st = c?.status?.type;
    if (!c || !st || !c.competitors?.some(x => teams.includes(x.team?.id))) return [];
    const side = ha => { const x = c.competitors.find(y => y.homeAway === ha); return { id: x?.team?.id, abbr: x?.team?.abbreviation, score: st.state === "pre" ? null : sc(x), winner: !!x?.winner }; };
    return [{
      id: e.id, date: e.date, state: st.state, final: !!st.completed, detail: st.shortDetail || null,
      postponed: isPostponed(st),
      away: side("away"), home: side("home"),
      link: (e.links || []).find(l => (l.rel || []).includes("summary"))?.href || null,
    }];
  }).sort((a, b) => new Date(a.date) - new Date(b.date));
  const byes = (json?.week?.teamsOnBye || []).filter(t => teams.includes(t.id)).map(t => t.abbreviation);
  return { week: json?.week?.number ?? null, games, byes };
}

export function seasonRecord(events, team = TEAM) {
  let w = 0, l = 0, t = 0, pf = 0, pa = 0;
  for (const e of events) {
    const g = mapEvent(e, team);
    if (!g.final) continue;
    pf += g.score.us; pa += g.score.them;
    if (g.tie) t++; else if (g.win) w++; else l++;
  }
  return { w, l, t, pf, pa, record: record(w, l, t) };
}

export function mapStandings(json) {
  const rows = json.children.flatMap(conf => conf.standings.entries.map(en => {
    const s = Object.fromEntries(en.stats.map(x => [x.name, x]));
    const w = s.wins?.value ?? 0, l = s.losses?.value ?? 0, t = s.ties?.value ?? 0, gp = w + l + t;
    const loc = en.team.location;
    return {
      id: en.team.id, conf: conf.abbreviation,
      name: loc === "Los Angeles" ? "LA " + en.team.name : loc === "New York" ? "NY " + en.team.name : loc,
      abbr: en.team.abbreviation, w, l, t, record: record(w, l, t),
      pct: s.winPercent?.displayValue ?? null, pctValue: s.winPercent?.value ?? 0,
      seed: s.playoffSeed?.value ?? null, diff: s.differential?.displayValue ?? s.pointDifferential?.displayValue ?? null,
      papg: gp ? (s.pointsAgainst?.value ?? 0) / gp : null,
    };
  }));
  const ranked = rows.filter(r => r.papg != null).sort((a, b) => a.papg - b.papg);
  for (const r of ranked) {
    const better = ranked.filter(x => x.papg < r.papg - 1e-9).length, tied = ranked.filter(x => Math.abs(x.papg - r.papg) < 1e-9).length;
    r.paRank = (tied > 1 ? "T-" : "") + ordinal(better + 1);
  }
  return rows;
}

// ---------- injuries, leaders, box scores ----------
const INJ_ORDER = ["Out", "Injured Reserve", "Doubtful", "Questionable"];
export function mapInjuries(list) {
  const order = s => { const i = INJ_ORDER.findIndex(x => s.startsWith(x)); return i < 0 ? 9 : i; };
  return (list || []).filter(i => i.status && i.status !== "Active").map(i => ({
    name: i.athlete?.displayName, pos: i.athlete?.position?.abbreviation || "",
    injury: i.details?.type || "", status: i.status, ret: i.details?.returnDate || null,
  })).sort((a, b) => order(a.status) - order(b.status));
}

export function leadersFrom(summ, teamId, wanted) {
  const cats = (summ?.leaders || []).find(x => x.team?.id === teamId)?.leaders || [];
  return wanted.map(n => cats.find(c => c.name === n)).filter(Boolean).map(c => {
    const L = c.leaders?.[0];
    return L ? { cat: c.displayName, name: L.athlete?.displayName, value: L.mainStat?.value ?? L.displayValue, unit: L.mainStat?.label || "", line: L.summary || L.displayValue } : null;
  }).filter(Boolean);
}

export const BOX_KEYS = ["totalYards", "netPassingYards", "rushingYards", "firstDowns", "thirdDownEff", "turnovers", "totalPenaltiesYards", "possessionTime"];
export function boxFrom(summ, teamId) {
  const t = (summ?.boxscore?.teams || []).find(x => x.team?.id === teamId);
  return Object.fromEntries((t?.statistics || []).map(s => [s.name, s.displayValue]));
}

export function gameDetail(summ, game, team = TEAM) {
  const comp = summ.header?.competitions?.[0];
  const ls = id => (comp?.competitors.find(c => c.team.id === id)?.linescores || []).map(l => Number(l.displayValue ?? l.value));
  const bu = boxFrom(summ, team), bt = boxFrom(summ, game.opp.id);
  const wanted = ["passingYards", "rushingYards", "receivingYards", "sacks", "totalTackles"];
  return {
    id: game.id, week: game.week, date: game.date, home: game.home, opp: game.opp, score: game.score, win: game.win, tie: game.tie,
    lines: { us: ls(team), them: ls(game.opp.id) },
    box: BOX_KEYS.filter(k => bu[k] != null || bt[k] != null).map(k => ({ key: k, us: bu[k] ?? null, them: bt[k] ?? null })),
    leaders: { us: leadersFrom(summ, team, wanted), them: leadersFrom(summ, game.opp.id, wanted) },
    recap: summ.article ? { title: summ.article.headline, link: (summ.article.links?.web?.href || "").replace(/^http:/, "https:"), desc: (summ.article.description || "").slice(0, 300) } : null,
    attendance: summ.gameInfo?.attendance ?? null,
  };
}

// ---------- team and player stats ----------
export const TEAM_STATS = [
  ["general", "totalPointsPerGame", "Points per game"],
  ["passing", "yardsPerGame", "Total yards per game"],
  ["passing", "passingYardsPerGame", "Passing yards per game"],
  ["rushing", "rushingYardsPerGame", "Rushing yards per game"],
  ["rushing", "yardsPerRushAttempt", "Yards per rush"],
  ["passing", "completionPct", "Completion %"],
  ["passing", "QBRating", "Passer rating"],
  ["miscellaneous", "thirdDownConvPct", "3rd-down conversion %"],
  ["miscellaneous", "redzoneScoringPct", "Red-zone scoring %"],
  ["miscellaneous", "turnOverDifferential", "Turnover differential"],
  ["defensive", "sacks", "Defensive sacks"],
  ["defensiveInterceptions", "interceptions", "Interceptions"],
];
export function mapTeamStats(json) {
  const cats = Object.fromEntries((json?.splits?.categories || []).map(c => [c.name, c.stats]));
  const any = n => Object.values(cats).flat().find(s => s.name === n);
  return TEAM_STATS.map(([cat, name, label]) => {
    const s = (cats[cat] || []).find(x => x.name === name) || any(name);
    return s ? { key: name, label, value: s.displayValue, v: Number(s.value), rank: rankText(s.rankDisplayValue) } : null;
  }).filter(Boolean);
}

export function mapRoster(json) {
  const GROUP = { offense: "Offense", defense: "Defense", specialTeam: "Special teams", injuredReserveOrOut: "Injured reserve / out", practiceSquad: "Practice squad", suspended: "Suspended" };
  return (json?.athletes || []).flatMap(g => g.items.map(a => ({
    id: String(a.id), name: a.displayName, jersey: a.jersey ?? null, pos: a.position?.abbreviation || "",
    posName: a.position?.displayName || "", group: GROUP[g.position] || g.position,
    age: a.age ?? null, ht: a.displayHeight || null, wt: a.displayWeight || null,
    exp: a.experience?.years ?? null, college: a.college?.name || null,
    link: (a.links || []).find(l => (l.rel || []).includes("playercard"))?.href || null,
  })));
}

export const PLAYER_CATS = [
  ["passingYards", "Passing"], ["rushingYards", "Rushing"], ["receivingYards", "Receiving"],
  ["totalTackles", "Tackles"], ["sacks", "Sacks"], ["interceptions", "Interceptions"],
];
export function mapPlayerLeaders(json, roster, limit = 8) {
  const byId = Object.fromEntries((roster || []).map(p => [p.id, p]));
  return PLAYER_CATS.map(([name, label]) => {
    const c = (json?.categories || []).find(x => x.name === name);
    if (!c) return null;
    const rows = c.leaders.slice(0, limit).map(L => {
      const id = (L.athlete?.$ref || "").match(/athletes\/(\d+)/)?.[1];
      const p = byId[id];
      return { id, name: p?.name || null, pos: p?.pos || "", link: p?.link || null, value: L.value, line: L.displayValue };
    }).filter(r => r.name);
    return { key: name, label, rows };
  }).filter(c => c && c.rows.length);
}

// ---------- odds ----------
export function snapshot(summ, next, now = new Date()) {
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

// Grade closing lines against final scores, then total them on top of the published Weeks 1-6 baseline.
// Regraded on every run from the current final score, so a stat correction to a score flows through. Games that
// aren't final (scheduled, live, postponed) and games without a captured line aren't graded or counted.
export function grade(odds, games) {
  for (const g of games) {
    const h = odds.closing[g.id];
    if (!g.final || !h || !g.score) continue;
    const margin = g.score.us - g.score.them, pts = g.score.us + g.score.them, tot = num(h.total);
    const sp = /^\s*(pk|pick|even)\s*$/i.test(String(h.spread ?? "")) ? 0 : num(h.spread); // pick'em = 0
    h.final = { us: g.score.us, them: g.score.them };
    h.result = {
      ats: sp == null || isNaN(sp) ? null : margin + sp > 0 ? "W" : margin + sp < 0 ? "L" : "P",
      ou: tot == null || isNaN(tot) ? null : pts > tot ? "O" : pts < tot ? "U" : "P",
    };
  }
  const ats = [...odds.baseline.ats], ou = [...odds.baseline.ou];
  for (const h of Object.values(odds.closing)) {
    if (!h.result || h.week <= odds.baseline.throughWeek) continue;
    if (h.result.ats) ats[{ W: 0, L: 1, P: 2 }[h.result.ats]]++;
    if (h.result.ou) ou[{ O: 0, U: 1, P: 2 }[h.result.ou]]++;
  }
  odds.record = { ats, ou };
  return odds;
}
