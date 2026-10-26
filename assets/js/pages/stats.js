import * as L from "../lib.js";
import * as A from "../app.js";
const { $ } = A, { esc } = L;

A.initChrome();
A.runPage($("page-error"), async () => {
  const d = await A.loadAll(["site", "stats"], ["history", "players"]);
  const site = d.site, stats = d.stats;
  // Names that have a profile on the Players page link there; everyone else links to ESPN.
  const profiles = new Set((d.players?.players || []).map(p => p.id));
  A.dataNotice(site);
  $("st-season").textContent = `${site.season} season · ${site.record || ""}`;
  A.secNote("standings", site.divisionPlace?.split(" ")[0]);

  const standings = (rows, seed) => `<table><thead><tr>${seed ? '<th scope="col" class="n">Seed</th>' : ""}<th scope="col">Team</th><th scope="col" class="n">W</th><th scope="col" class="n">L</th><th scope="col" class="n">Pct</th><th scope="col" class="n">Diff</th></tr></thead><tbody>${rows.map(r =>
    `<tr${r.us ? ' class="us"' : ""}>${seed ? `<td class="n">${esc(r.seed ?? "")}</td>` : ""}<td>${esc(r.name)}</td><td class="n">${r.w}</td><td class="n">${r.l}${r.t ? "-" + r.t : ""}</td><td class="n">${esc(r.pct)}</td><td class="n">${esc(r.diff ?? "")}</td></tr>`).join("")}</tbody></table>`;
  $("afc").innerHTML = site.standings?.afc?.length ? standings(site.standings.afc, true) : A.empty("Standings unavailable.");
  $("west").innerHTML = site.standings?.west?.length ? standings(site.standings.west, false) : A.empty("Standings unavailable.");

  $("team-stats").innerHTML = (stats.team || []).map(s => `<div class="kpi"><b>${esc(L.statValue(s))}</b><span>${esc(s.label.replace(/ %$/, ""))}${s.rank ? " · " + esc(s.rank) : ""}</span></div>`).join("") || A.empty("Team stats unavailable.");

  // Advanced: offense and defense efficiency with NFL ranks, then the quarterback
  const adv = stats.advanced;
  if (adv?.metrics?.length) {
    $("adv-sub").textContent = `Through Week ${adv.throughWeek} · NFL rank of ${adv.teams}`;
    const epa = adv.metrics.find(m => m.side === "off" && m.key === "epa");
    if (epa?.rank) A.secNote("advanced", `EPA ${L.ordinal(epa.rank)}`);
    const fmt = m => (m.key === "sr" ? L.pctText(m.v) : L.epaText(m.v)), avg = m => (m.key === "sr" ? L.pctText(m.nfl) : L.epaText(m.nfl));
    const tone = (r, n) => (r == null ? "" : r <= Math.ceil(n / 3) ? " is-win" : r > n - Math.ceil(n / 3) ? " is-loss" : "");
    const table = (side, title) => `<div><h3 class="panel-title">${title}</h3><table><caption class="vh">Raiders ${title.toLowerCase()} efficiency</caption>
      <thead><tr><th scope="col">Stat</th><th scope="col" class="n">Raiders</th><th scope="col" class="n">NFL avg</th><th scope="col" class="n">Rank</th></tr></thead><tbody>${
      adv.metrics.filter(m => m.side === side).map(m => `<tr><td>${esc(m.label)}</td><td class="n">${esc(fmt(m))}</td><td class="n muted">${esc(avg(m))}</td><td class="n${tone(m.rank, adv.teams)}">${m.rank ? esc(L.ordinal(m.rank)) : "-"}</td></tr>`).join("")}</tbody></table></div>`;
    const qbs = (adv.passers || []).map(q => `<tr><td>${esc(q.name)}</td><td class="n">${esc(q.dropbacks)}</td><td class="n">${esc(L.epaText(q.epa))}${q.epaRank ? ` <small>${esc(L.ordinal(q.epaRank))}</small>` : ""}</td><td class="n">${q.cpoe == null ? "-" : esc((q.cpoe > 0 ? "+" : "") + q.cpoe)}${q.cpoeRank ? ` <small>${esc(L.ordinal(q.cpoeRank))}</small>` : ""}</td></tr>`).join("");
    $("adv").innerHTML = table("off", "Offense") + table("def", "Defense") + (qbs ? `<div class="span-all"><h3 class="panel-title">Quarterback</h3><table><caption class="vh">Raiders quarterbacks, EPA per dropback and CPOE</caption>
      <thead><tr><th scope="col">Passer</th><th scope="col" class="n">Dropbacks</th><th scope="col" class="n">EPA / dropback</th><th scope="col" class="n">CPOE</th></tr></thead><tbody>${qbs}</tbody></table>
      <p class="note">Ranks among the ${esc(adv.qualifiedQbs)} passers with ${esc(adv.minDropbacks)}+ dropbacks.</p></div>` : "");
  } else $("adv").innerHTML = A.empty("Advanced stats are unavailable right now.");

  // Tendencies: how often the Raiders do things, ranked 1 = most in the NFL (not good or bad on their own)
  const tend = stats.tendencies;
  if (tend?.rows?.length) {
    const tv = (r, v) => (v == null ? "-" : r.fmt === "pct" ? L.pctText(v) : v.toFixed(1));
    const table = (side, title) => `<div><h3 class="panel-title">${title}</h3><table><caption class="vh">Raiders ${title.toLowerCase()}</caption>
      <thead><tr><th scope="col">How often</th><th scope="col" class="n">Raiders</th><th scope="col" class="n">NFL avg</th><th scope="col" class="n">Rank</th></tr></thead><tbody>${
      tend.rows.filter(r => r.side === side).map(r => `<tr><td>${esc(r.label)}</td><td class="n">${esc(tv(r, r.v))}</td><td class="n muted">${esc(tv(r, r.nfl))}</td><td class="n">${r.rank ? esc(L.ordinal(r.rank)) : "-"}</td></tr>`).join("")}</tbody></table></div>`;
    $("tend").innerHTML = table("off", "Offense tendencies") + table("def", "Defense tendencies");
  } else $("tend").innerHTML = A.empty("Tendencies are unavailable right now.");

  $("player-tables").innerHTML = (stats.players || []).map(c => `<div><h3 class="panel-title">${esc(c.label)}</h3><table><thead><tr><th scope="col">Player</th><th scope="col" class="n">${esc(c.label === "Passing" || c.label === "Rushing" || c.label === "Receiving" ? "Yds" : "Total")}</th></tr></thead><tbody>${
    c.rows.map(r => `<tr><td>${profiles.has(L.slug(r.name)) ? `<a href="players.html?p=${encodeURIComponent(L.slug(r.name))}">${esc(r.name)}</a>` : r.link ? `<a class="ext" href="${L.url(r.link)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)} <small>${esc(r.pos)}</small>${r.line && String(r.line).replace(/,/g, "") !== String(r.value) ? `<br><small>${esc(r.line)}</small>` : ""}</td><td class="n">${esc(Number(r.value).toLocaleString("en-US"))}</td></tr>`).join("")}</tbody></table></div>`).join("") || A.empty("Player stats unavailable.");

  // History: completed seasons plus this season so far
  const seasons = [{ year: site.season, record: (site.record || "") + " (in progress)", current: true }, ...(d.history?.seasons || [])];
  $("hist").innerHTML = `<table><thead><tr><th scope="col">Season</th><th scope="col">Record</th><th scope="col" class="n">Points for</th><th scope="col" class="n">Points against</th></tr></thead><tbody>${
    seasons.map(s => `<tr${s.current ? ' class="us"' : ""}><td>${esc(s.year)}</td><td>${esc(s.record)}</td><td class="n">${esc(s.pf ?? "")}</td><td class="n">${esc(s.pa ?? "")}</td></tr>`).join("")}</tbody></table>`;
});
