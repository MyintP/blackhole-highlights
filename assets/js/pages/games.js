import * as L from "../lib.js";
import * as A from "../app.js";
const { $ } = A, { esc } = L;

const BOX_LABELS = {
  totalYards: "Total yards", netPassingYards: "Passing yards", rushingYards: "Rushing yards", firstDowns: "First downs",
  thirdDownEff: "3rd down", turnovers: "Turnovers", totalPenaltiesYards: "Penalties-yards", possessionTime: "Possession",
};

A.initChrome();
A.runPage($("page-error"), async () => {
  const d = await A.loadAll(["site"], ["odds", "editorial", "games"]);
  const site = d.site, n = site.next, ed = d.editorial || {};
  A.dataNotice(site);
  $("gc-season").textContent = `${site.season} season · ${site.record || ""}${site.divisionPlace ? " · " + site.divisionPlace : ""}`;

  if (n) {
    $("next-sub").textContent = `Week ${n.week} · ${L.gameLabel(n)}`;
    $("board").innerHTML = A.boardHTML(site, n, ed);
    A.countdown($("board"), n);
  } else $("board").innerHTML = A.empty("No upcoming game. The season is complete.");
  $("pick").innerHTML = A.pickHTML(n, ed);
  $("odds").innerHTML = A.oddsHTML(n, d.odds);

  const inj = site.injuries && n && site.injuries.gameId === n.id ? site.injuries : null;
  $("inj-us").innerHTML = inj ? A.injuriesHTML(inj.us) : A.empty("No report yet.");
  $("inj-them-h").textContent = inj ? inj.opp : n ? n.opp.name : "Opponent";
  $("inj-them").innerHTML = inj ? A.injuriesHTML(inj.them) : A.empty("No report yet.");
  $("tape").innerHTML = A.tapeHTML(site.matchup, n);

  $("sched").innerHTML = A.scheduleHTML(site, n, { link: "games.html" });

  // Results, newest first; each opens to line score, team stats, leaders and the recap link.
  const details = d.games?.games || {};
  const finals = (site.schedule?.games || []).filter(g => g.final).reverse();
  $("res").innerHTML = finals.length ? finals.map((g, idx) => {
    const x = details[g.id];
    const head = `<summary><span class="wkl">Week ${esc(g.week)}</span><span class="who">${esc(L.gameLabel(g))}</span><span class="fs ${g.win ? "w" : g.tie ? "" : "l"}">${esc(L.resultText(g))}</span></summary>`;
    if (!x) return `<details class="result" id="g-${esc(g.id)}">${head}<div class="body">${A.empty("Box score not available yet.")}</div></details>`;
    const q = Math.max(x.lines.us.length, x.lines.them.length);
    const qh = Array.from({ length: q }, (_, i) => `<th class="n" scope="col">${i < 4 ? "Q" + (i + 1) : "OT"}</th>`).join("");
    const row = (who, arr, total) => `<tr><th scope="row">${esc(who)}</th>${arr.map(v => `<td class="n">${esc(v)}</td>`).join("")}<td class="n"><strong>${esc(total)}</strong></td></tr>`;
    const leaders = (list, who) => `<div><h3 class="panel-title">${esc(who)} leaders</h3><ul class="inj">${list.map(l => `<li><span>${esc(l.name)} <small>· ${esc(l.cat)}</small></span><span class="st">${esc(l.line || l.value)}</span></li>`).join("") || "<li><span class='muted'>Not available.</span></li>"}</ul></div>`;
    return `<details class="result" id="g-${esc(g.id)}"${idx === 0 ? " open" : ""}>${head}<div class="body">
      <p class="muted">${esc(L.day(g.date))}${x.attendance ? ` · Attendance ${Number(x.attendance).toLocaleString("en-US")}` : ""}</p>
      <div class="table-wrap"><table><caption class="vh">Score by quarter</caption><thead><tr><th scope="col">Team</th>${qh}<th class="n" scope="col">Final</th></tr></thead><tbody>
        ${g.home ? row(g.opp.name, x.lines.them, g.score.them) + row("Raiders", x.lines.us, g.score.us) : row("Raiders", x.lines.us, g.score.us) + row(g.opp.name, x.lines.them, g.score.them)}</tbody></table></div>
      <div class="grid-2">
        <div><h3 class="panel-title">Team stats</h3><div class="table-wrap"><table><thead><tr><th scope="col">Stat</th><th class="n" scope="col">Raiders</th><th class="n" scope="col">${esc(g.opp.name)}</th></tr></thead><tbody>
          ${x.box.map(b => `<tr><td>${esc(BOX_LABELS[b.key] || b.key)}</td><td class="n">${esc(b.us ?? "-")}</td><td class="n">${esc(b.them ?? "-")}</td></tr>`).join("")}</tbody></table></div></div>
        <div style="display:grid;gap:20px">${leaders(x.leaders.us, "Raiders")}${leaders(x.leaders.them, g.opp.name)}</div>
      </div>
      ${x.recap ? `<div><h3 class="panel-title">Recap</h3><p style="margin-top:10px"><a class="ext" href="${esc(x.recap.link)}" target="_blank" rel="noopener">${esc(x.recap.title)}</a> <span class="muted">· ESPN</span></p>${x.recap.desc ? `<p class="muted" style="margin-top:6px">${esc(x.recap.desc)}</p>` : ""}</div>` : ""}
    </div></details>`;
  }).join("") : A.empty("No games played yet.");

  // Open a result when arriving from a schedule card link (#g-<id>)
  const openHash = () => { const el = location.hash.startsWith("#g-") && document.getElementById(location.hash.slice(1)); if (el) { el.open = true; el.scrollIntoView(); } };
  openHash(); addEventListener("hashchange", openHash);
});
