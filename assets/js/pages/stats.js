import * as L from "../lib.js";
import * as A from "../app.js";
const { $ } = A, { esc } = L;

A.initChrome();
A.runPage($("page-error"), async () => {
  const d = await A.loadAll(["site", "stats"], ["history"]);
  const site = d.site, stats = d.stats;
  A.dataNotice(site);
  $("st-season").textContent = `${site.season} season · ${site.record || ""}`;

  const standings = (rows, seed) => `<table><thead><tr>${seed ? '<th scope="col" class="n">Seed</th>' : ""}<th scope="col">Team</th><th scope="col" class="n">W</th><th scope="col" class="n">L</th><th scope="col" class="n">Pct</th><th scope="col" class="n">Diff</th></tr></thead><tbody>${rows.map(r =>
    `<tr${r.us ? ' class="us"' : ""}>${seed ? `<td class="n">${esc(r.seed ?? "")}</td>` : ""}<td>${esc(r.name)}</td><td class="n">${r.w}</td><td class="n">${r.l}${r.t ? "-" + r.t : ""}</td><td class="n">${esc(r.pct)}</td><td class="n">${esc(r.diff ?? "")}</td></tr>`).join("")}</tbody></table>`;
  $("afc").innerHTML = site.standings?.afc?.length ? standings(site.standings.afc, true) : A.empty("Standings unavailable.");
  $("west").innerHTML = site.standings?.west?.length ? standings(site.standings.west, false) : A.empty("Standings unavailable.");

  $("team-stats").innerHTML = (stats.team || []).map(s => `<div class="kpi"><b>${esc(L.statValue(s))}</b><span>${esc(s.label.replace(/ %$/, ""))}${s.rank ? " · " + esc(s.rank) : ""}</span></div>`).join("") || A.empty("Team stats unavailable.");

  $("player-tables").innerHTML = (stats.players || []).map(c => `<div><h3 class="panel-title">${esc(c.label)}</h3><table><thead><tr><th scope="col">Player</th><th scope="col" class="n">${esc(c.label === "Passing" || c.label === "Rushing" || c.label === "Receiving" ? "Yds" : "Total")}</th></tr></thead><tbody>${
    c.rows.map(r => `<tr><td>${r.link ? `<a class="ext" href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)} <small>${esc(r.pos)}</small>${r.line && String(r.line) !== String(r.value) ? `<br><small>${esc(r.line)}</small>` : ""}</td><td class="n">${esc(Number(r.value).toLocaleString("en-US"))}</td></tr>`).join("")}</tbody></table></div>`).join("") || A.empty("Player stats unavailable.");

  // Roster with search + group filter
  const roster = stats.roster || [];
  const groups = [...new Set(roster.map(p => p.group))];
  $("ro-g").insertAdjacentHTML("beforeend", groups.map(g => `<option>${esc(g)}</option>`).join(""));
  const drawRoster = () => {
    const q = L.tokenize($("ro-q").value), g = $("ro-g").value;
    const list = roster.filter(p => (!g || p.group === g) && (!q.length || L.search(q.join(" "), { roster: [p] }).players.length));
    $("ro-count").textContent = `${list.length} of ${roster.length} players`;
    $("ro-body").innerHTML = list.map(p => `<tr><td class="n">${esc(p.jersey ?? "")}</td><td>${p.link ? `<a class="ext" href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}</td><td>${esc(p.pos)}</td><td class="n">${esc(p.age ?? "")}</td><td>${esc([p.ht, p.wt].filter(Boolean).join(", "))}</td><td class="n">${p.exp === 0 ? "R" : esc(p.exp ?? "")}</td><td>${esc(p.college || "")}</td><td><small>${esc(p.group)}</small></td></tr>`).join("")
      || `<tr><td colspan="8" class="muted">No players match.</td></tr>`;
  };
  $("ro-q").addEventListener("input", drawRoster);
  $("ro-g").addEventListener("change", drawRoster);
  $("ro-filters").addEventListener("submit", e => e.preventDefault());
  drawRoster();

  // History: completed seasons plus this season so far
  const seasons = [{ year: site.season, record: (site.record || "") + " (in progress)", current: true }, ...(d.history?.seasons || [])];
  $("hist").innerHTML = `<table><thead><tr><th scope="col">Season</th><th scope="col">Record</th><th scope="col" class="n">Points for</th><th scope="col" class="n">Points against</th></tr></thead><tbody>${
    seasons.map(s => `<tr${s.current ? ' class="us"' : ""}><td>${esc(s.year)}</td><td>${esc(s.record)}</td><td class="n">${esc(s.pf ?? "")}</td><td class="n">${esc(s.pa ?? "")}</td></tr>`).join("")}</tbody></table>`;
});
