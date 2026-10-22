import * as L from "../lib.js";
import * as A from "../app.js";
const { $ } = A, { esc } = L;

const PAGES = [
  { title: "Home", href: "./", text: "top stories game week dashboard schedule media" },
  { title: "News", href: "news.html", text: "latest stories injuries roster moves analysis rumors official" },
  { title: "Game Center", href: "games.html", text: "next game schedule results box scores odds betting lines injury report tale of the tape" },
  { title: "Stats", href: "stats.html", text: "standings team stats player leaders roster history seasons" },
  { title: "Media", href: "media.html", text: "videos podcasts youtube highlights" },
  { title: "About", href: "about.html", text: "sources editorial approach contact corrections disclaimer" },
];

A.initChrome();
A.runPage($("page-error"), async () => {
  const d = await A.loadAll(["news"], ["stats", "site"]);
  const data = { news: d.news.items || [], roster: d.stats?.roster || [], games: d.site?.schedule?.games || [], pages: PAGES };
  A.dataNotice(d.site);

  const run = q => {
    $("s-q").value = q;
    if (!L.tokenize(q).length) { $("s-count").textContent = ""; $("s-results").innerHTML = A.empty("Type a player, opponent or topic to search stories, players and games."); return; }
    const r = L.search(q, data);
    document.title = `${q} · Search · Black Hole Highlights`;
    $("s-count").textContent = r.total ? `${r.total} result${r.total === 1 ? "" : "s"} for "${q}"` : `No results for "${q}"`;
    const block = (title, html) => `<div class="sub-head"><h2 class="panel-title" style="border:0;margin:0">${esc(title)}</h2></div>${html}`;
    let html = "";
    if (r.players.length) html += block(`Players (${r.players.length})`, `<div class="table-wrap"><table><thead><tr><th scope="col">Player</th><th scope="col">Pos</th><th scope="col">Group</th></tr></thead><tbody>${r.players.slice(0, 10).map(p =>
      `<tr><td>${p.link ? `<a class="ext" href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}${p.jersey ? ` <small>#${esc(p.jersey)}</small>` : ""}</td><td>${esc(p.pos)}</td><td><small>${esc(p.group)}</small></td></tr>`).join("")}</tbody></table></div>`);
    if (r.games.length) html += block(`Games (${r.games.length})`, `<ul class="stories compact">${r.games.map(g =>
      `<li class="story"><div class="story-meta"><span>Week ${esc(g.week)}</span><span>${esc(L.short(g.date))}</span></div><h3><a href="games.html${g.final ? "#g-" + esc(g.id) : "#schedule"}">${esc(L.gameLabel(g))}${g.final ? " · " + esc(L.resultText(g)) : ""}</a></h3></li>`).join("")}</ul>`);
    if (r.stories.length) html += block(`Stories (${r.stories.length})`, `<ul class="stories">${r.stories.slice(0, 30).map(i => A.storyHTML(i)).join("")}</ul>${r.stories.length > 30 ? `<p class="note"><a href="news.html?q=${encodeURIComponent(q)}">See all ${r.stories.length} stories in News</a></p>` : ""}`);
    if (r.pages.length) html += block("Pages", `<ul class="stories compact">${r.pages.map(p => `<li class="story"><h3><a href="${esc(p.href)}">${esc(p.title)}</a></h3></li>`).join("")}</ul>`);
    $("s-results").innerHTML = html || A.empty("Nothing matched. Try fewer or different words.");
  };

  $("s-form").addEventListener("submit", e => {
    e.preventDefault();
    const q = $("s-q").value.trim();
    history.replaceState(null, "", q ? "?q=" + encodeURIComponent(q) : location.pathname);
    run(q);
  });
  run(new URLSearchParams(location.search).get("q") || "");
  if (!$("s-q").value) $("s-q").focus();
});
