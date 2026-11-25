import * as L from "../lib.js";
import * as A from "../app.js";
const { $ } = A, { esc } = L;

A.initChrome();
A.runPage($("page-error"), async () => {
  const desk = L.deskArticles(await A.loadJSON("desk"));
  const id = new URLSearchParams(location.search).get("id");
  const a = id && desk.find(x => x.id === id);
  const others = desk.filter(x => x !== a);
  if (a) {
    document.title = `${a.headline} · Black Hole Highlights`;
    $("a-kicker").textContent = [a.section, a.kicker].filter(Boolean).join(" · ");
    $("a-h1").textContent = a.headline;
    $("a-deck").textContent = a.deck || "";
    $("a-byline").innerHTML = A.bylineHTML(a);
    $("a-body").innerHTML = A.deskBodyHTML(a);
    if (a.sources?.length) {
      $("a-src-list").innerHTML = a.sources.map(s => `<li><a class="ext" href="${L.url(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join("");
      $("a-sources").hidden = false;
    }
    $("a-disclose").hidden = !a.ai;
  } else {
    if (id) $("a-deck").textContent = "That article isn't available. Here's everything the desk has published.";
    $("a-body").innerHTML = "";
    $("more-h").textContent = "All articles";
  }
  $("a-more").innerHTML = (a ? others.slice(0, 5) : desk).map(x =>
    `<li class="story"><div class="story-meta"><span>${esc(x.section)}</span><span>${esc(x.kicker || "")}</span><time datetime="${esc(x.date)}">${esc(L.short(x.date))}</time></div>` +
    `<h3><a href="${A.deskHref(x)}">${esc(x.headline)}</a></h3>${x.deck ? `<p>${esc(x.deck)}</p>` : ""}</li>`).join("") || `<li>${A.empty("Nothing else yet.")}</li>`;
});
