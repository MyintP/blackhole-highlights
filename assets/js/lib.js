// Pure helpers shared by every page. No DOM access, so tests/lib.test.mjs runs them in Node.
export const TZ = "America/Los_Angeles";

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// Escaped URL for href/src: only http(s) gets through, anything else (javascript:, data:) becomes "#".
export const url = u => (/^https?:\/\//i.test(String(u || "")) ? esc(u) : "#");
export const fmt =(d, o) => new Date(d).toLocaleString("en-US", { timeZone: TZ, ...o });
export const day = d => fmt(d, { weekday: "short", month: "short", day: "numeric" });
export const short = d => fmt(d, { month: "short", day: "numeric" });
export const time = d => fmt(d, { hour: "numeric", minute: "2-digit" });
export const dateTime = d => `${day(d)}, ${time(d)} PT`;
const dayKey = d => fmt(d, { year: "numeric", month: "2-digit", day: "2-digit" });

export function ago(d, now = Date.now()) {
  const s = Math.max(0, (now - new Date(d).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 7 * 86400) { const n = Math.round(s / 86400); return `${n} day${n > 1 ? "s" : ""} ago`; }
  return short(d);
}

export function dayLabel(d, now = Date.now()) {
  const k = dayKey(d);
  if (k === dayKey(now)) return "Today";
  if (k === dayKey(now - 864e5)) return "Yesterday";
  return fmt(d, { weekday: "long", month: "short", day: "numeric" });
}
export function groupByDay(items, now = Date.now()) {
  const out = [];
  for (const it of items) {
    const label = dayLabel(it.date, now);
    if (!out.length || out[out.length - 1].label !== label) out.push({ label, items: [] });
    out[out.length - 1].items.push(it);
  }
  return out;
}

export const tokenize = q => String(q || "").toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/).filter(Boolean);
const hay = (...parts) => " " + parts.filter(Boolean).join(" ").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ") + " ";
const hasWord = (h, t) => h.includes(" " + t); // prefix match on word starts

export function filterNews(items, { cat = "", kind = "", src = "", q = "" } = {}) {
  const toks = tokenize(q);
  return (items || []).filter(i =>
    (!cat || i.cat === cat) && (!kind || i.kind === kind) && (!src || i.src === src || (i.also || []).some(a => a.src === src)) &&
    (!toks.length || toks.every(t => hasWord(hay(i.title, i.desc, i.src, i.cat, i.kind, ...(i.also || []).map(a => a.title)), t))));
}
export function countBy(items, key) {
  const m = {};
  for (const i of items || []) m[i[key]] = (m[i[key]] || 0) + 1;
  return m;
}

// Site search: every query word must match somewhere; title matches weigh most; newer stories rank higher.
export function search(q, { news = [], roster = [], games = [], pages = [] } = {}, now = Date.now()) {
  const toks = tokenize(q);
  if (!toks.length) return { stories: [], players: [], games: [], pages: [], total: 0 };
  const score = (fields) => {
    let s = 0;
    for (const t of toks) {
      let best = 0;
      for (const [text, w] of fields) if (hasWord(hay(text), t)) best = Math.max(best, w);
      if (!best) return 0;
      s += best;
    }
    return s;
  };
  const rank = (list, fields, bonus = () => 0) => list.map(x => ({ x, s: score(fields(x)) })).filter(r => r.s > 0)
    .sort((a, b) => b.s + bonus(b.x) - (a.s + bonus(a.x))).map(r => r.x);
  const stories = rank(news, i => [[i.title, 3], [i.desc, 1], [i.cat + " " + i.kind + " " + i.src, 1]],
    i => Math.max(0, 1 - (now - new Date(i.date).getTime()) / (30 * 864e5)));
  const players = rank(roster, p => [[p.name, 3], [p.pos + " " + p.posName, 2], [p.college, 1], [p.jersey != null ? "#" + p.jersey + " " + p.jersey : "", 1]]);
  const gm = rank(games, g => [[g.opp.location + " " + g.opp.name + " " + g.opp.abbr, 3], ["week " + g.week, 2]]);
  const pg = rank(pages, p => [[p.title, 3], [p.text, 1]]);
  return { stories, players, games: gm, pages: pg, total: stories.length + players.length + gm.length + pg.length };
}

export const injuryClass = s => (/^(Out|Injured)/.test(s) ? "out" : /^(Doubtful|Questionable)/.test(s) ? "q" : "");
export const injuryLabel = s => (s === "Injured Reserve" ? "IR" : s);
export function lastName(name) {
  const p = String(name || "").split(" ");
  const l = p[p.length - 1];
  return /^(Jr\.?|Sr\.?|II|III|IV)$/.test(l) && p.length > 2 ? p[p.length - 2] : l;
}
export const gameLabel = g => (g.home ? "vs " : "at ") + g.opp.name;
export const resultText = g => (g.tie ? "T" : g.win ? "W" : "L") + " " + g.score.us + "-" + g.score.them;
// "86.96" -> "87.0%" for percentage stats; other values unchanged
export const statValue = s => (/%/.test(s.label) && !isNaN(Number(s.value)) ? Number(s.value).toFixed(1) + "%" : s.value);
export const recordText =a => a ? a.slice(0, a[2] ? 3 : 2).join("-") : "";

// The data is stale when the hourly job hasn't succeeded for `hours`.
export const isStale = (iso, hours = 3, now = Date.now()) => !iso || now - new Date(iso).getTime() > hours * 36e5;
// Kickoff to 4.5 hours after: scores move, so pages poll for fresh data.
export const isLive = (g, now = Date.now()) => {
  if (!g || g.final || g.timeTBD) return false;
  const k = new Date(g.date).getTime();
  return g.state === "in" || (now >= k && now <= k + 4.5 * 36e5);
};
// How old the last successful update can be before pages warn. Around a game the job runs hourly or faster
// (see nextWait in scripts/lib/parse.mjs); otherwise GitHub's cron often runs 3-6 hours late, which isn't news.
export const staleHours = (g, now = Date.now()) => {
  if (!g || g.timeTBD) return 8;
  const k = new Date(g.date).getTime();
  return now >= k - 12 * 36e5 && now <= k + 4.5 * 36e5 ? 2 : 8;
};
// Same as slug() in scripts/lib/nflverse.mjs: player ids on the Players page (?p=maxx-crosby).
export const slug = name => String(name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const ordinal = n => { const v = n % 100; return n + (["th", "st", "nd", "rd"][(v - 20) % 10] || ["th", "st", "nd", "rd"][v] || "th"); };
// EPA reads as +0.204 / -0.243; success rates as 44.0%.
export const epaText = v => (v == null ? "-" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(3));
export const pctText = v => (v == null ? "-" : (v * 100).toFixed(1) + "%");

export const KINDS = {
  Official: "Published by the Raiders.",
  Reporting: "News reporting from an established outlet.",
  Opinion: "Fan analysis and opinion.",
  Rumor: "Unconfirmed: speculation or a report not confirmed by the team.",
};
export const CATS = ["Games", "Injuries", "Roster", "Coaching", "Draft", "Analysis", "Team"];

// ---------- game-week strip ----------
// Which game the strip is about, and in what state, from the schedule and the time. Never "live" without a live
// status from the feed: a game past kickoff with no live data reads "kickoff", and past 4.5h "awaiting final".
const HR = 36e5;
export function stripState(site, now = Date.now()) {
  const n = site?.next || null, last = site?.last || null;
  if (!n) return last ? { kind: "done", game: last } : { kind: "none" };
  if (n.postponed) return { kind: "postponed", game: n };
  const kick = new Date(n.date).getTime(), age = now - new Date(site.updated).getTime();
  if (n.state === "in") return { kind: "live", game: n, stale: age > 25 * 6e4 };
  if (!n.timeTBD && now >= kick) return { kind: now > kick + 4.5 * HR ? "awaiting" : "kickoff", game: n };
  const lastKick = last ? new Date(last.date).getTime() : null;
  // Recent result first: until 3.5 days after the last kickoff, unless the next game is less than a day away
  if (last?.final && now - lastKick < 84 * HR && kick - now > 24 * HR) return { kind: "post", game: last, next: n };
  if (last && n.week - last.week > 1 && kick - now > 7 * 864e5) return { kind: "bye", game: n, week: last.week + 1 };
  return { kind: "pre", game: n };
}

// ---------- stat of the day ----------
// Day in Pacific time ("2026-10-23"), so the pick changes at midnight PT for everyone.
export const ptDate = (d = Date.now()) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(d)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };
const hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// How a stat reads in a sentence ("14 touchdown passes"). Stats without a phrase aren't used as headline facts.
const PHRASE = {
  passing_yards: "passing yards", passing_tds: "touchdown passes", passing_first_downs: "passing first downs",
  rushing_yards: "rushing yards", rushing_tds: "rushing touchdowns", rushing_first_downs: "rushing first downs",
  receptions: "catches", targets: "targets", receiving_yards: "receiving yards", receiving_tds: "receiving touchdowns",
  receiving_yards_after_catch: "yards after the catch", receiving_first_downs: "receiving first downs",
  def_tackles_solo: "solo tackles", def_tackles_for_loss: "tackles for loss", def_sacks: "sacks", def_qb_hits: "QB hits",
  def_interceptions: "interceptions", def_pass_defended: "passes defended", def_fumbles_forced: "forced fumbles",
  fumble_recovery_opp: "fumble recoveries", def_tds: "defensive touchdowns", kickoff_return_yards: "kickoff return yards",
  punt_return_yards: "punt return yards", fg_made: "field goals", pt_inside_20: "punts inside the 20",
};
const n0 = v => Number(v).toLocaleString("en-US");

// Every candidate is built from the published data and carries its source and date range. Kinds rotate by day.
export function statCandidates({ players, stats, history, site } = {}) {
  const thru = players?.throughWeek, season = site?.season ?? stats?.season;
  const range = thru ? `${season} regular season through Week ${thru}` : `${season} season`;
  const out = { player: [], quiz: [], team: [], history: [] };
  const list = players?.players || [];
  const rk = s => (s.tied ? "tied for " : "") + ordinal(s.rank);
  for (const p of list) for (const [group, rows] of Object.entries(p.stats || {})) for (const s of rows) {
    // whole tie group inside the top 10, so "tied for 1st" never hides a 40-way tie
    if (PHRASE[s.k] && s.rank && s.v > 0 && s.rank + (s.tied || 1) - 1 <= 10) out.player.push({
      id: `p:${p.id}:${s.k}`, kind: "Player stat", big: n0(s.v), unit: PHRASE[s.k], who: p.name,
      text: `${p.name} has ${n0(s.v)} ${PHRASE[s.k]}, ${rk(s)} in the NFL.`, link: `players.html?p=${encodeURIComponent(p.id)}`,
      source: `nflverse player stats (${group.toLowerCase()}), ${range}`,
    });
  }
  const QUIZ = [["Defense", "def_qb_hits", "QB hits"], ["Defense", "def_sacks", "sacks"], ["Defense", "def_interceptions", "interceptions"],
    ["Defense", "def_tackles_solo", "solo tackles"], ["Receiving", "receiving_yards", "receiving yards"], ["Receiving", "receptions", "catches"], ["Rushing", "rushing_yards", "rushing yards"]];
  for (const [group, k, label] of QUIZ) {
    const ranked = list.map(p => ({ p, v: p.stats?.[group]?.find(s => s.k === k)?.v ?? 0 })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    if (!ranked.length || (ranked[1] && ranked[0].v === ranked[1].v)) continue; // no clear leader, no question
    out.quiz.push({ id: `q:${k}`, kind: "Quiz", question: `Who leads the Raiders in ${label}?`, big: n0(ranked[0].v), unit: label, who: ranked[0].p.name,
      text: `${ranked[0].p.name} leads the team with ${n0(ranked[0].v)} ${label}. ${ranked[1] ? `Next: ${ranked[1].p.name}, ${n0(ranked[1].v)}.` : "No other Raider has one yet."}`, link: `players.html?p=${encodeURIComponent(ranked[0].p.id)}`,
      source: `nflverse player stats, ${range}` });
  }
  const adv = stats?.advanced, advRange = adv?.throughWeek ? `${season} regular season through Week ${adv.throughWeek}` : range;
  for (const m of adv?.metrics || []) if (m.rank && (m.rank <= 8 || m.rank >= 25)) out.team.push({
    id: `t:${m.side}:${m.key}`, kind: "Team trend", big: ordinal(m.rank), unit: m.label, who: "Raiders " + (m.side === "off" ? "offense" : "defense"),
    text: `The Raiders rank ${ordinal(m.rank)} of 32 in ${m.label.replace(/^Success/, "success")} (${m.key === "sr" ? pctText(m.v) : epaText(m.v)}; NFL average ${m.key === "sr" ? pctText(m.nfl) : epaText(m.nfl)}).`,
    link: "stats.html#advanced", source: `nflverse play-by-play (EPA model: nflfastR), ${advRange}` });
  for (const r of stats?.tendencies?.rows || []) if (r.rank && (r.rank <= 5 || r.rank >= 28)) out.team.push({
    id: `t:tend:${r.key}`, kind: "Team trend", big: ordinal(r.rank), unit: r.label, who: "Raiders " + (r.side === "off" ? "offense" : "defense"),
    // rank 1 = does it most; near the bottom it reads better as "fewest" (32nd highest = fewest)
    text: `${r.label}: ${r.fmt === "pct" ? pctText(r.v) : r.v.toFixed(1)}, ${r.rank <= 5 ? (r.rank === 1 ? "the most" : `${ordinal(r.rank)} most`) : (r.rank === 32 ? "the fewest" : `${ordinal(33 - r.rank)} fewest`)} in the NFL (average ${r.fmt === "pct" ? pctText(r.nfl) : r.nfl.toFixed(1)}).`,
    link: "stats.html#advanced", source: `FTN charting via nflverse, ${advRange}` });
  // History: this season's scoring pace against each full season since the oldest on record
  const ppg = stats?.team?.find(t => t.key === "totalPointsPerGame")?.v, past = (history?.seasons || []).filter(s => s.w + s.l + s.t > 0);
  if (ppg && past.length) {
    const better = past.filter(s => s.pf / (s.w + s.l + s.t) >= ppg).sort((a, b) => b.year - a.year)[0];
    const oldest = Math.min(...past.map(s => s.year));
    out.history.push({ id: "h:ppg", kind: "History", big: Number(ppg).toFixed(1), unit: "points per game", who: `${season} Raiders`,
      text: better ? `The Raiders are scoring ${Number(ppg).toFixed(1)} points a game, their most since ${better.year} (${(better.pf / (better.w + better.l + better.t)).toFixed(1)}).`
        : `The Raiders are scoring ${Number(ppg).toFixed(1)} points a game, more than in any full season since at least ${oldest}.`,
      link: "stats.html#history", source: `ESPN team stats (${season} to date) and ESPN season records ${oldest}-${season - 1}` });
  }
  return out;
}

// One pick per Pacific day: the kind rotates by day number, the item within it by a hash of the date.
export function statOfDay(cands, date = ptDate()) {
  const kinds = ["player", "quiz", "team", "history"].filter(k => cands?.[k]?.length);
  if (!kinds.length) return null;
  const dayNum = Math.floor(Date.parse(date + "T12:00:00Z") / 864e5);
  const list = cands[kinds[dayNum % kinds.length]];
  return { ...list[hash(date) % list.length], date };
}
