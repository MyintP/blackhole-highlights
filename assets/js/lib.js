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
