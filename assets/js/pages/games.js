import * as L from "../lib.js";
import * as A from "../app.js";
const { $ } = A, { esc } = L;

const BOX_LABELS = {
  totalYards: "Total yards", netPassingYards: "Passing yards", rushingYards: "Rushing yards", firstDowns: "First downs",
  thirdDownEff: "3rd down", turnovers: "Turnovers", totalPenaltiesYards: "Penalties-yards", possessionTime: "Possession",
};

A.initChrome();
A.runPage($("page-error"), async () => {
  const d = await A.loadAll(["site"], ["odds", "editorial", "games", "breakdown"]);
  const site = d.site, n = site.next, ed = d.editorial || {};
  A.dataNotice(site);
  $("gc-season").textContent = `${site.season} season · ${site.record || ""}${site.divisionPlace ? " · " + site.divisionPlace : ""}`;

  if (n) {
    $("next-sub").textContent = `Week ${n.week} · ${L.gameLabel(n)}`;
    A.liveBoard($("board"), site, ed);
  } else $("board").innerHTML = A.empty("No upcoming game. The season is complete.");
  $("pick").innerHTML = A.pickHTML(n, ed);
  if (n && ed.gameId === n.id && ed.milestones?.length) {
    $("miles").innerHTML = ed.milestones.map(m => `<div class="tile"><b>${esc(m.num)}<small>${esc(m.unit)}</small></b><h4>${esc(m.name)}</h4><p>${esc(m.text)}</p></div>`).join("");
    $("milestones").hidden = false;
  }
  if (n) A.secNote("next", (n.home ? "v " : "@ ") + n.opp.abbr);
  $("odds").innerHTML = A.oddsHTML(n, d.odds) + A.lineHistoryHTML(d.odds, n);
  $("ats").innerHTML = A.atsLogHTML(d.odds, site);

  const inj = site.injuries && n && site.injuries.gameId === n.id ? site.injuries : null;
  $("inj-us").innerHTML = inj ? A.injuriesHTML(inj.us) : A.empty("No report yet.");
  $("inj-them-h").textContent = inj ? inj.opp : n ? n.opp.name : "Opponent";
  $("inj-them").innerHTML = inj ? A.injuriesHTML(inj.them) : A.empty("No report yet.");
  if (inj) A.secNote("injuries", `${inj.us.filter(i => L.injuryClass(i.status) === "q").length} Q`);
  $("tape").innerHTML = A.tapeHTML(site.matchup, n);

  $("sched").innerHTML = A.scheduleHTML(site, n, { link: "games.html" });

  // Results, newest first; each opens to line score, team stats, leaders and the recap link.
  const details = d.games?.games || {}, plays = d.breakdown?.games || {};
  const finals = (site.schedule?.games || []).filter(g => g.final).reverse();
  A.secNote("results", site.record);
  $("res").innerHTML = finals.length ? finals.map((g, idx) => {
    const x = details[g.id];
    const head = `<summary><span class="wkl">Week ${esc(g.week)}</span><span class="who">${esc(L.gameLabel(g))}</span><span class="fs ${g.win ? "is-win" : g.tie ? "" : "is-loss"}">${esc(L.resultText(g))}</span></summary>`;
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
      ${breakdownHTML(plays[g.id], g)}
      ${x.recap ? `<div><h3 class="panel-title">Recap</h3><p style="margin-top:10px"><a class="ext" href="${L.url(x.recap.link)}" target="_blank" rel="noopener">${esc(x.recap.title)}</a> <span class="muted">· ESPN</span></p>${x.recap.desc ? `<p class="muted" style="margin-top:6px">${esc(x.recap.desc)}</p>` : ""}</div>` : ""}
    </div></details>`;
  }).join("") : A.empty("No games played yet.");

  // Open a result when arriving from a schedule card link (#g-<id>)
  const openHash = () => { const el = location.hash.startsWith("#g-") && document.getElementById(location.hash.slice(1)); if (el) { el.open = true; el.scrollIntoView(); } };
  openHash(); addEventListener("hashchange", openHash);
});

// Play-level breakdown from nflverse play-by-play: efficiency, scoring plays, biggest swings, drives, field goals.
function breakdownHTML(b, g) {
  if (!b) return "";
  const opp = g.opp.name, us = "LV";
  const eff = (u, title) => `<div><h3 class="panel-title">${title}</h3><dl class="statline">
    <div><dt>EPA / play</dt><dd>${esc(L.epaText(u.epa))}</dd></div><div><dt>Success</dt><dd>${esc(L.pctText(u.sr))}</dd></div>
    <div><dt>Explosive</dt><dd>${esc(u.explosive)}<small>20+ pass, 10+ run</small></dd></div><div><dt>3rd down</dt><dd>${esc(u.third[0])}/${esc(u.third[1])}</dd></div></dl></div>`;
  // The play text starts with the clock, which is already in its own column
  const text = p => p.desc.replace(/^\(\s*[\d:]+\)\s*/, "");
  const when = p => `Q${p.qtr > 4 ? "OT" : p.qtr} ${p.time || ""}`.replace("QOT", "OT");
  const scoring = b.scoring.length ? `<ol class="plays">${b.scoring.map(p => `<li class="${p.team === us ? "us" : ""}"><span class="when">${esc(when(p))}</span>
    <span>${esc(text(p))}${p.pat ? ` <small class="muted">(${esc(p.pat)})</small>` : ""}</span><span class="sc">${p.score ? `LV ${esc(p.score.us)} · ${esc(g.opp.abbr)} ${esc(p.score.them)}` : ""}</span></li>`).join("")}</ol>` : A.empty("No scoring plays.");
  const swings = `<ol class="plays">${b.swings.map(p => `<li><span class="when">${esc(when(p))}</span><span>${esc(text(p))}</span>
    <span class="sc ${p.wpa > 0 ? "is-win" : "is-loss"}">${p.wpa > 0 ? "+" : "−"}${esc(Math.round(Math.abs(p.wpa) * 100))}%</span></li>`).join("")}</ol>`;
  const drives = `<div class="table-wrap"><table><caption class="vh">Drives</caption><thead><tr><th scope="col">Team</th><th scope="col" class="n">Qtr</th><th scope="col">Start</th><th scope="col" class="n">Plays</th><th scope="col" class="n">Time</th><th scope="col">Result</th></tr></thead><tbody>${
    b.drives.map(r => `<tr${r.team === us ? ' class="us"' : ""}><td>${r.team === us ? "Raiders" : esc(opp)}</td><td class="n">${esc(r.qtr ?? "")}</td><td>${esc(r.start ?? "")}</td><td class="n">${esc(r.plays ?? "")}</td><td class="n">${esc(r.top ?? "")}</td><td>${esc(r.result ?? "")}</td></tr>`).join("")}</tbody></table></div>`;
  const kicks = b.kicks.length ? `<p class="muted" style="margin-top:10px">Raiders field goals: ${b.kicks.map(k => `${esc(k.dist)} yds ${k.result === "made" ? "good" : esc(k.result)}`).join(", ")}</p>` : "";
  return `<div class="breakdown"><h3 class="pl-sec">Play-by-play breakdown</h3>
    <div class="grid-2">${eff(b.offense, "Raiders offense")}${eff(b.defense, "Raiders defense (allowed)")}</div>
    <div class="grid-2" style="margin-top:20px"><div><h3 class="panel-title">Scoring plays</h3>${scoring}${kicks}</div>
      <div><h3 class="panel-title">Biggest swings <small class="muted">Raiders win probability</small></h3>${swings}</div></div>
    <details class="drives" style="margin-top:20px"><summary class="panel-title">All drives (${b.drives.length})</summary>${drives}</details>
    <p class="note">Source: nflverse play-by-play. EPA and win probability from the nflfastR models.</p></div>`;
}

