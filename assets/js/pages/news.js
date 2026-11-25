import * as L from "../lib.js";
import * as A from "../app.js";
const { $ } = A, { esc } = L;
const PAGE = 25;

A.initChrome();
A.runPage($("page-error"), async () => {
  const [news, site, desk] = await Promise.all([A.loadJSON("news"), A.loadJSON("site").catch(() => null), A.loadJSON("desk").catch(() => null)]);
  A.dataNotice(site);
  const all = news.items || [];
  const params0 = new URLSearchParams(location.search);
  let showNoise = params0.get("all") === "1";
  // Promotions and Spanish-language duplicates are hidden unless asked for
  const noiseCount = all.filter(L.isNoise).length;
  let items = showNoise ? all : all.filter(i => !L.isNoise(i));

  // From the desk: the latest original articles above the feed
  const dk = L.deskArticles(desk).slice(0, 3);
  if (dk.length) { $("desk-strip").innerHTML = `<h2 class="panel-title">From the Black Hole Desk</h2><div class="desk-row">${dk.map(A.deskCardHTML).join("")}</div>`; $("desk-strip").hidden = false; }

  // Filters come from (and are written back to) the URL, so filtered views can be shared and survive refresh.
  const params = params0;
  const state = { cat: params.get("cat") || "", kind: params.get("kind") || "", src: params.get("src") || "", q: params.get("q") || "" };
  let shown = PAGE;

  const cats = L.countBy(items, "cat");
  $("cats").innerHTML = [["", "All", items.length], ...L.CATS.filter(c => cats[c]).map(c => [c, c, cats[c]])]
    .map(([v, label, n]) => `<button type="button" class="chip" data-cat="${esc(v)}" aria-pressed="${state.cat === v}">${esc(label)}<span class="c">${n}</span></button>`).join("");
  const srcs = [...new Set(items.flatMap(i => [i.src, ...(i.also || []).map(a => a.src)]))].sort();
  $("f-src").insertAdjacentHTML("beforeend", srcs.map(s => `<option>${esc(s)}</option>`).join(""));
  $("f-q").value = state.q; $("f-kind").value = state.kind; $("f-src").value = state.src;

  const render = () => {
    const list = L.filterNews(items, state);
    $("count").textContent = `${list.length} ${list.length === 1 ? "story" : "stories"}${state.cat || state.kind || state.src || state.q ? " match your filters" : ""}`;
    $("feed").innerHTML = list.length
      ? L.groupByDay(list.slice(0, shown)).map(g => `<h2 class="day-label">${esc(g.label)}</h2><ul class="stories">${g.items.map(i => A.storyHTML(i)).join("")}</ul>`).join("")
      : A.empty("No stories match. Try a different topic or clear the search.", '<button type="button" class="btn sm ghost" id="clear">Clear filters</button>');
    $("clear")?.addEventListener("click", () => { Object.assign(state, { cat: "", kind: "", src: "", q: "" }); $("f-q").value = ""; $("f-kind").value = ""; $("f-src").value = ""; update(); });
    $("more").hidden = list.length <= shown;
    const nt = $("noise-toggle");
    nt.hidden = !noiseCount; nt.textContent = showNoise ? "Hide promotions and Spanish-language posts" : `Show ${noiseCount} hidden promotions and Spanish-language posts`;
    document.querySelectorAll("#cats .chip").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.cat === state.cat)));
  };
  const update = () => {
    shown = PAGE;
    const p = new URLSearchParams();
    for (const k of ["cat", "kind", "src", "q"]) if (state[k]) p.set(k, state[k]);
    if (showNoise) p.set("all", "1");
    history.replaceState(null, "", p.toString() ? "?" + p : location.pathname);
    render();
  };

  $("cats").addEventListener("click", e => { const b = e.target.closest(".chip"); if (b) { state.cat = b.dataset.cat; update(); } });
  let t;
  $("f-q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { state.q = $("f-q").value.trim(); update(); }, 200); });
  $("f-kind").addEventListener("change", () => { state.kind = $("f-kind").value; update(); });
  $("f-src").addEventListener("change", () => { state.src = $("f-src").value; update(); });
  $("filters").addEventListener("submit", e => { e.preventDefault(); state.q = $("f-q").value.trim(); update(); });
  $("noise-toggle").addEventListener("click", () => { showNoise = !showNoise; items = showNoise ? all : all.filter(i => !L.isNoise(i)); update(); });
  $("more").addEventListener("click", () => { shown += PAGE; render(); });
  render();
});
