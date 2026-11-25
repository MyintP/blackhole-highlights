import * as L from "../lib.js";
import * as A from "../app.js";
const { $ } = A, { esc } = L;

A.initChrome();
A.runPage($("page-error"), async () => {
  const d = await A.loadAll(["site", "news"], ["desk", "odds", "editorial", "stats", "players", "history", "games", "breakdown", "rewind"]);
  const site = d.site, n = site.next, ed = d.editorial || {}, now = Date.now();
  A.dataNotice(site);

  // Masthead: dateline and where the season stands
  $("mh-date").textContent = L.fmt(now, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  $("mh-record").textContent = [n ? `Week ${n.week}` : `${site.season} season`, site.record, site.divisionPlace].filter(Boolean).join(" · ");

  // The lead: the newest desk article from the last 4 days; otherwise the top-ranked wire story.
  const desk = L.deskArticles(d.desk, now);
  const fresh = desk.filter(a => now - new Date(a.date).getTime() < 4 * 864e5);
  const wire = L.rankWire(d.news.items, { now, days: 4 });
  const leadA = fresh.find(a => a.section === "The Lead") || fresh[0];
  if (leadA) {
    $("fp-kicker").textContent = leadA.kicker || leadA.section || "The Lead";
    $("fp-h1").innerHTML = `<a href="${A.deskHref(leadA)}">${esc(leadA.headline)}</a>`;
    $("fp-deck").textContent = leadA.deck || "";
    $("fp-byline").innerHTML = A.bylineHTML(leadA);
    $("fp-body").innerHTML = A.deskBodyHTML(leadA, 2) + `<a class="btn" href="${A.deskHref(leadA)}">Read the full story</a>`;
  } else if (wire[0]) {
    const w = wire[0];
    $("fp-kicker").textContent = `${w.cat} · ${w.src}`;
    $("fp-h1").innerHTML = `<a class="ext" href="${L.url(w.link)}" target="_blank" rel="noopener">${esc(w.title)}</a>`;
    $("fp-deck").textContent = w.desc || "";
    $("fp-byline").innerHTML = `<span class="badge ${w.kind.toLowerCase()}">${esc(w.kind)}</span> ${esc(L.ago(w.date))}${w.also?.length ? ` · covered by ${w.also.length + 1} outlets` : ""}`;
    $("fp-body").innerHTML = "";
  } else $("fp-deck").textContent = "No new stories in the last few days.";

  // One slot per topic across the whole front page: the lead, the second tier and the wire share `seen`.
  const seen = new Set();
  const deskSeconds = fresh.filter(a => a !== leadA);
  for (const a of [leadA, ...deskSeconds].filter(Boolean)) L.topicKeys(a).forEach(k => seen.add(k));
  const wirePool = leadA ? wire : wire.slice(1);
  if (!leadA && wire[0]) L.topicKeys(wire[0]).forEach(k => seen.add(k));

  // Second tier: other fresh desk pieces, topped up with the best wire stories, three in all
  const known = L.knownNames([...wire, ...fresh]);
  const wireSeconds = L.pickByTopic(wirePool, Math.max(0, 3 - deskSeconds.length), seen, known);
  $("fp-seconds").innerHTML = [...deskSeconds.slice(0, 3).map(A.deskCardHTML), ...wireSeconds.map(A.wireCardHTML)].join("");

  // The wire: next stories by importance, each on a topic not already on the page
  const wireList = L.pickByTopic(wirePool.filter(i => !wireSeconds.includes(i)), 7, seen, known);
  $("wire").innerHTML = wireList.map(i => `<li><span class="w-meta"><span class="badge ${i.kind.toLowerCase()}">${esc(i.kind)}</span>${esc(i.src)}${i.also?.length ? ` +${i.also.length}` : ""} · ${esc(L.ago(i.date))}</span>` +
    `<a class="ext" href="${L.url(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a></li>`).join("") || `<li>${A.empty("Quiet on the wire.")}</li>`;

  // Scoreboard for the next game (or the last result)
  if (n) A.liveBoard($("h-board"), site, ed); else $("h-board").innerHTML = "";

  // Game week
  $("pick").innerHTML = A.pickHTML(n, ed, { keys: false });
  $("odds").innerHTML = A.oddsHTML(n, d.odds, { full: false });
  if (site.injuries && n && site.injuries.gameId === n.id) {
    const us = site.injuries.us || [];
    const c = s => us.filter(i => L.injuryClass(i.status) === s).length;
    $("injuries").innerHTML = `<div class="card"><h3 class="panel-title">Raiders injuries</h3>
      <div class="inj-sum"><span><b>${c("out")}</b>Out / IR</span><span><b>${c("q")}</b>Questionable</span></div>
      ${A.injuriesHTML(us.filter(i => L.injuryClass(i.status) === "q").slice(0, 4))}
      <a class="more" href="games.html#injuries">Both teams' full reports</a></div>`;
  } else $("injuries").innerHTML = `<div class="card"><h3 class="panel-title">Raiders injuries</h3>${A.empty("No report yet for the next game.")}</div>`;

  // Numbers
  const ts = d.stats?.team || [], stat = k => ts.find(t => t.key === k);
  const kpi = (v, label) => `<div class="kpi"><b>${esc(v ?? "-")}</b><span>${esc(label)}</span></div>`;
  $("kpis").innerHTML = kpi(site.record, "Record") + kpi(site.divisionPlace?.split(" ")[0], "In AFC West") +
    [["totalPointsPerGame", "Points / game"], ["yardsPerGame", "Yards / game"], ["turnOverDifferential", "Turnover diff."]]
      .map(([k, l]) => { const s = stat(k); return s ? kpi(s.value, `${l}${s.rank ? " · " + s.rank : ""}`) : ""; }).join("");
  A.mountStatOfDay($("sotd"), { players: d.players, stats: d.stats, history: d.history, site });

  // The Rewind: the written breakdown when it covers the latest game, otherwise the automatic scorecard summary
  const rw = L.rewind({ games: d.games, breakdown: d.breakdown, advanced: d.stats?.advanced });
  const rep = d.rewind?.after && rw && d.rewind.after === rw.lastId ? d.rewind : null;
  if (rw) { $("rw-body").innerHTML = rep ? A.rewindTeaserHTML(rep, rw) : A.rewindAutoHTML(rw); $("rewind").hidden = false; }
  else $("jump-rewind")?.remove();
});
