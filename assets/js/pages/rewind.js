import * as L from "../lib.js";
import * as A from "../app.js";
const { $ } = A, { esc } = L;

A.initChrome();
A.runPage($("page-error"), async () => {
  const d = await A.loadAll(["site"], ["rewind", "games", "breakdown", "stats"]);
  A.dataNotice(d.site);
  const rw = L.rewind({ games: d.games, breakdown: d.breakdown, advanced: d.stats?.advanced }), rep = d.rewind;
  const wk = ([a, b]) => (a === b ? `Week ${a}` : `Weeks ${a}-${b}`);

  $("rv-scorecard").innerHTML = rw ? A.scorecardHTML(rw) : A.empty("The scorecard needs at least two games.");
  if (rw) $("rv-sc-sub").textContent = `${wk(rw.weeks)} · ${rw.record} · computed from the data`;
  if (!rep?.findings?.length) {
    ["summary", "findings", "context", "watch"].forEach(id => ($(id).hidden = true));
    $("rv-verdict").textContent = "The written breakdown isn't ready yet. The scorecard below is computed from the latest data.";
    return;
  }
  // A report written before the latest game is still shown, but says what it covers
  const last = d.site.last, stale = last && rep.after !== last.id;
  const covered = rw?.games.find(g => g.id === rep.after);
  $("rv-eyebrow").textContent = `The Rewind · ${wk(rep.weeks)}${covered ? ` · after ${covered.home ? "vs" : "at"} ${covered.opp}` : ""}`;
  $("rv-title").textContent = rep.headline;
  $("rv-verdict").textContent = rep.verdict;
  $("rv-byline").innerHTML = `<span class="badge opinion">AI analysis</span> Written with AI from nflverse play-by-play and charting data. Published ${esc(L.short(rep.published + "T12:00:00Z"))}.` +
    (stale ? ` <strong class="rv-stale">This breakdown runs through ${wk(rep.weeks)} and doesn't include Week ${esc(last.week)} yet.</strong>` : "");
  document.title = `The Rewind: ${rep.headline} · Black Hole Highlights`;
  $("rv-short").innerHTML = rep.short.map(s => `<li>${esc(s)}</li>`).join("");
  $("rv-toc").innerHTML = rep.findings.map((f, i) => `<li><a href="#f-${i + 1}"><b>${esc(f.title)}</b><span class="badge rv-lv ${f.level === "Critical" ? "crit" : ""}">${esc(f.level)}</span></a></li>`).join("")
    + `<li class="rv-toc-more"><a href="#context">Schedule and what's working</a></li><li class="rv-toc-more"><a href="#watch">What to watch next</a></li><li class="rv-toc-more"><a href="#scorecard">The scorecard</a></li>`;
  if (rw) $("rv-results").innerHTML = A.rewindResultsHTML(rw);
  $("rv-findings").innerHTML = A.rewindReportHTML(rep);
  $("rv-context").textContent = rep.context || "";
  $("rv-working").innerHTML = (rep.working || []).map(s => `<li>${esc(s)}</li>`).join("");
  $("rv-watch-h").textContent = rep.watch?.opp ? `What to watch against the ${rep.watch.opp}` : "What to watch next";
  $("rv-watch").innerHTML = (rep.watch?.items || []).map(s => `<li>${esc(s)}</li>`).join("");
  $("rv-method").textContent = rep.method || "";
});
