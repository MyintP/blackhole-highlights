import * as L from "../lib.js";
import * as A from "../app.js";
const { $ } = A, { esc } = L;

const UNIT = pos => (/^(QB|RB|FB|WR|TE|T|OT|G|C|OL)$/.test(pos) ? "Offense" : /^(K|P|LS)$/.test(pos) ? "Special teams" : pos ? "Defense" : "");
const POS_ORDER = ["QB", "RB", "FB", "WR", "TE", "T", "OT", "G", "C", "OL", "DE", "DT", "DL", "LB", "OLB", "ILB", "CB", "S", "SAF", "DB", "K", "P", "LS"];
const val = (p, group, k) => p.stats?.[group]?.find(s => s.k === k)?.v ?? 0;
const n = v => Number(v).toLocaleString("en-US");

// Stat value as shown: EPA totals signed to one decimal, shares as percentages, counts with separators.
function fmt(s) {
  if (s.v == null) return "-";
  if (/_epa$/.test(s.k)) return (s.v > 0 ? "+" : s.v < 0 ? "−" : "") + Math.abs(s.v).toFixed(1);
  if (s.k === "passing_cpoe") return (s.v > 0 ? "+" : "") + s.v.toFixed(1);
  if (s.k === "target_share") return L.pctText(s.v);
  if (s.k === "fg_pct") return L.pctText(s.v > 1 ? s.v / 100 : s.v);
  return Number.isInteger(s.v) ? n(s.v) : String(Math.round(s.v * 10) / 10);
}

// One line under a name in the list: the numbers people look for first at that position.
function summary(p) {
  const parts = [];
  const add = (v, label) => { if (v) parts.push(`${n(v)} ${label}`); };
  if (p.stats.Passing) { add(val(p, "Passing", "passing_yards"), "pass yds"); add(val(p, "Passing", "passing_tds"), "TD"); add(val(p, "Passing", "passing_interceptions"), "INT"); }
  else if (p.stats.Kicking) { parts.push(`${val(p, "Kicking", "fg_made")}/${val(p, "Kicking", "fg_att")} FG`); }
  else if (p.stats.Punting) { add(val(p, "Punting", "pt_att"), "punts"); }
  else {
    const rush = () => { if (p.stats.Rushing) { add(val(p, "Rushing", "rushing_yards"), "rush yds"); add(val(p, "Rushing", "rushing_tds"), "TD"); } };
    const rec = () => { if (p.stats.Receiving) { add(val(p, "Receiving", "receptions"), "rec"); add(val(p, "Receiving", "receiving_yards"), "yds"); add(val(p, "Receiving", "receiving_tds"), "TD"); } };
    if (/^(WR|TE)$/.test(p.pos)) { rec(); rush(); } else { rush(); rec(); }
    if (p.stats.Defense) {
      add(val(p, "Defense", "def_tackles_solo") + val(p, "Defense", "def_tackle_assists"), "tkl");
      add(val(p, "Defense", "def_sacks"), "sacks"); add(val(p, "Defense", "def_interceptions"), "INT");
    }
  }
  if (!parts.length && p.snaps) parts.push(`${n(p.snaps.off + p.snaps.def + p.snaps.st)} snaps`);
  return parts.slice(0, 3).join(" · ");
}

const rankText = s => (s.tied ? "T-" : "") + L.ordinal(s.rank);

// Headline facts: the stats where this player ranks near the top of the league (not shared with half the league).
function facts(p) {
  const out = [];
  for (const rows of Object.values(p.stats || {})) for (const s of rows) if (s.rank && s.rank <= 25 && s.v > 0 && !(s.tied > 5)) out.push(s);
  return out.sort((a, b) => a.rank - b.rank).slice(0, 4);
}

const cells = list => `<dl class="statline">${list.filter(Boolean).map(([label, value, note]) =>
  `<div><dt>${esc(label)}</dt><dd>${esc(value)}${note ? `<small>${esc(note)}</small>` : ""}</dd></div>`).join("")}</dl>`;
const block = (title, body, sub = "") => `<div class="pl-block"><h3 class="panel-title">${esc(title)}${sub ? ` <small class="muted">${esc(sub)}</small>` : ""}</h3>${body}</div>`;

function profileHTML(p, through) {
  const unit = UNIT(p.pos);
  const head = `<header class="pl-head">
    <span class="eyebrow">${esc([p.pos, unit, p.jersey != null ? "#" + p.jersey : null].filter(Boolean).join(" · "))}</span>
    <h2>${esc(p.name)}</h2>
    <p class="muted">${esc([p.games ? `${p.games} game${p.games === 1 ? "" : "s"}` : null, p.status && p.status !== "Offense" && p.status !== "Defense" && p.status !== "Special teams" ? p.status : null].filter(Boolean).join(" · "))}${
      p.link ? `${p.games ? " · " : ""}<a class="ext" href="${L.url(p.link)}" target="_blank" rel="noopener">ESPN player page</a>` : ""}</p>
  </header>`;
  const f = facts(p);
  const factHTML = f.length ? `<ul class="facts">${f.map(s => `<li><b>${esc(fmt(s))}</b><span>${esc(s.label)}</span><small>${esc(rankText(s))} in the NFL</small></li>`).join("")}</ul>` : "";

  const snaps = p.snaps ? block("Snaps", `<div class="snapbars">${[["Offense", p.snaps.off, p.snaps.offPct], ["Defense", p.snaps.def, p.snaps.defPct], ["Special teams", p.snaps.st, p.snaps.stPct]]
    .filter(([, c]) => c > 0).map(([label, c, pct]) => `<div class="snapbar"><span>${esc(label)}</span><span class="track" aria-hidden="true"><i style="width:${Math.round(Math.min(1, pct || 0) * 100)}%"></i></span><span class="tnum">${esc(n(c))} <small>${esc(L.pctText(pct).replace(".0%", "%"))} avg share</small></span></div>`).join("")}</div>`, `${p.snaps.games} games`) : "";

  // Zeros past the first four stats of a group are noise (no safeties, no fumble return yards).
  const groups = Object.entries(p.stats || {}).map(([g, rows]) => block(g, cells(rows.filter((s, i) => i < 4 || s.v !== 0).map(s => [s.label, fmt(s), s.rank && s.rank <= 50 ? rankText(s) + " NFL" : ""])))).join("");

  const chart = [];
  if (p.coverage) chart.push(block("In coverage", cells([
    ["Targets", n(p.coverage.targets)], ["Catches allowed", n(p.coverage.completions)], ["Comp %", L.pctText(p.coverage.cmpPct)],
    ["Yards allowed", n(p.coverage.yards)], ["Yds / target", p.coverage.ydsPerTgt], ["TD allowed", p.coverage.td], ["INT", p.coverage.int],
    ["Rating allowed", p.coverage.rating ?? "-", "QB rating when targeted"]])));
  if (p.passRush) chart.push(block("Pass rush", cells([
    ["Pressures", p.passRush.pressures], ["Sacks", p.passRush.sacks], ["QB hits", p.passRush.hits], ["Hurries", p.passRush.hurries], ["Blitzes", p.passRush.blitzes]])));
  if (p.tackling) chart.push(block("Tackling", cells([["Tackles", n(p.tackling.tackles)], ["Missed", p.tackling.missed], ["Missed %", L.pctText(p.tackling.missedPct)]])));
  if (p.contact) chart.push(block("Running", cells([
    ["Yds before contact", n(p.contact.ybc), `${p.contact.ybcPer} per carry`], ["Yds after contact", n(p.contact.yac), `${p.contact.yacPer} per carry`], ["Broken tackles", p.contact.broken]])));
  if (p.catching) chart.push(block("Catching", cells([["Drops", p.catching.drops], ["Broken tackles", p.catching.broken]])));
  if (p.pocket) chart.push(block("In the pocket", cells([
    ["Pressured", p.pocket.pressured], ["Blitzed", p.pocket.blitzed], ["Hurried", p.pocket.hurried], ["Hit", p.pocket.hit], ["Sacked", p.pocket.sacked], ["Bad throws", p.pocket.badThrows], ["Drops by receivers", p.pocket.drops]])));

  return head + factHTML + snaps
    + (groups ? `<h3 class="pl-sec">Season stats <small class="muted">${through ? `through Week ${esc(through)}` : ""}</small></h3><div class="pl-grid">${groups}</div>` : "")
    + (chart.length ? `<h3 class="pl-sec">Charting <small class="muted">from film review</small></h3><div class="pl-grid">${chart.join("")}</div>` : "")
    + (!groups && !chart.length ? A.empty("No stats recorded yet.") : "");
}

A.initChrome();
A.runPage($("page-error"), async () => {
  // players.json is optional: it appears after the update job's first nflverse pass, and the page says so until then
  const d = await A.loadAll(["site"], ["players"]);
  A.dataNotice(d.site);
  const all = d.players?.players || [], through = d.players?.throughWeek;
  $("pl-season").textContent = `${d.site.season} season${through ? ` · through Week ${through}` : ""} · ${all.length} players`;
  if (!all.length) { $("pl-list").innerHTML = ""; $("pl-profile").innerHTML = A.empty("Player stats aren't available yet."); return; }

  const params = new URLSearchParams(location.search);
  let current = all.find(p => p.id === params.get("p")) || all[0];
  const snapsOf = p => (p.snaps ? p.snaps.off + p.snaps.def + p.snaps.st : 0);

  const show = (p, { focus = false } = {}) => {
    current = p;
    $("pl-profile").innerHTML = profileHTML(p, through);
    document.title = `${p.name} stats · Raiders players · Black Hole Highlights`;
    history.replaceState(null, "", `?p=${encodeURIComponent(p.id)}${location.hash}`);
    document.querySelectorAll("#pl-list a").forEach(a => a.toggleAttribute("aria-current", a.dataset.id === p.id));
    if (focus) {
      const h = $("pl-profile").querySelector("h2");
      h.tabIndex = -1; h.focus({ preventScroll: true });
      if (matchMedia("(max-width: 900px)").matches) $("pl-profile").scrollIntoView();
    }
  };

  const draw = () => {
    const q = L.tokenize($("pl-q").value), unit = $("pl-unit").value, sort = $("pl-sort").value;
    let list = all.filter(p => (!unit || UNIT(p.pos) === unit) && q.every(t => L.tokenize(`${p.name} ${p.pos} ${UNIT(p.pos)}`).some(w => w.startsWith(t))));
    if (sort === "snaps") list = [...list].sort((a, b) => snapsOf(b) - snapsOf(a));
    else if (sort === "name") list = [...list].sort((a, b) => L.lastName(a.name).localeCompare(L.lastName(b.name)));
    else list = [...list].sort((a, b) => ((POS_ORDER.indexOf(a.pos) + 1 || 99) - (POS_ORDER.indexOf(b.pos) + 1 || 99)) || snapsOf(b) - snapsOf(a));
    $("pl-list").innerHTML = list.length ? `<ul>${list.map(p => `<li><a href="?p=${encodeURIComponent(p.id)}" data-id="${esc(p.id)}"${p.id === current.id ? " aria-current" : ""}>
      <span class="nm">${esc(p.name)}</span><span class="ps">${esc(p.pos || "")}${p.jersey != null ? " #" + esc(p.jersey) : ""}</span><span class="ln">${esc(summary(p))}</span></a></li>`).join("")}</ul>`
      : A.empty("No players match.");
  };

  $("pl-list").addEventListener("click", e => {
    const a = e.target.closest("a[data-id]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    show(all.find(p => p.id === a.dataset.id), { focus: true });
  });
  $("pl-q").addEventListener("input", draw);
  $("pl-unit").addEventListener("change", draw);
  $("pl-sort").addEventListener("change", draw);
  $("pl-filters").addEventListener("submit", e => {
    e.preventDefault();
    const first = $("pl-list").querySelector("a[data-id]");
    if (first) show(all.find(p => p.id === first.dataset.id), { focus: true });
  });
  draw();
  show(current);
});
