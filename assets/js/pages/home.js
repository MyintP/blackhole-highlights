import * as L from "../lib.js";
import * as A from "../app.js";
const { $ } = A, { esc } = L;

A.initChrome();
A.runPage($("page-error"), async () => {
  const d = await A.loadAll(["site", "news"], ["odds", "editorial", "stats", "players", "history", "games", "breakdown"]);
  const site = d.site, n = site.next, ed = d.editorial || {}, on = !!(n && ed.gameId === n.id);
  A.dataNotice(site);

  // Hero: this week's headline (hand-written when it matches the next game, automatic otherwise) + scoreboard
  if (n) {
    $("h-eyebrow").textContent = `Week ${n.week} · Game week`;
    $("h-title").innerHTML = on && ed.headline ? ed.headline
      : n.home ? `${esc(n.opp.location + " " + n.opp.name)} come to <b>Allegiant</b>.` : `Raiders head to <b>${esc(n.opp.location)}</b>.`;
    $("h-lede").textContent = on && ed.lede ? ed.lede
      : `The Raiders are ${site.record}, ${site.divisionPlace || ""}. The ${n.opp.name} are ${n.oppRecord || "-"}. Kickoff is ${L.day(n.date)}${n.timeTBD ? ", time to be announced" : " at " + L.time(n.date) + " PT"}${n.tv ? " on " + n.tv : ""}.`;
    A.liveBoard($("h-board"), site, ed);
  } else {
    $("h-title").innerHTML = `${site.season} season <b>complete</b>.`;
    $("h-lede").textContent = `The Raiders finished ${site.record}.`;
    $("h-board").innerHTML = "";
  }

  // News: lead = newest official or reported story from the last 2 days, else newest overall
  const items = d.news.items || [];
  const fresh = items.filter(i => Date.now() - new Date(i.date).getTime() < 2 * 864e5);
  const lead = fresh.find(i => i.kind === "Official" || i.kind === "Reporting") || items[0];
  const rest = items.filter(i => i !== lead);
  $("lead").innerHTML = lead ? A.storyHTML(lead, { lead: true }) : A.empty("No stories right now.");
  const top = rest.filter(i => i.kind !== "Rumor").slice(0, 3);
  $("top-stories").innerHTML = top.map(i => A.storyHTML(i)).join("");
  $("latest").innerHTML = rest.filter(i => !top.includes(i)).slice(0, 5).map(i => `<li class="story"><div class="story-meta"><span class="badge ${i.kind.toLowerCase()}">${esc(i.kind)}</span><span>${esc(i.src)}</span><time datetime="${esc(i.date)}">${esc(L.ago(i.date))}</time></div><h3><a class="ext" href="${L.url(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3></li>`).join("");

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

  // Dashboard
  const ts = d.stats?.team || [], stat = k => ts.find(t => t.key === k);
  const kpi = (v, label) => `<div class="kpi"><b>${esc(v ?? "-")}</b><span>${esc(label)}</span></div>`;
  $("kpis").innerHTML = kpi(site.record, "Record") + kpi(site.divisionPlace?.split(" ")[0], "In AFC West") +
    [["totalPointsPerGame", "Points / game"], ["yardsPerGame", "Yards / game"], ["turnOverDifferential", "Turnover diff."]]
      .map(([k, l]) => { const s = stat(k); return s ? kpi(s.value, `${l}${s.rank ? " · " + s.rank : ""}`) : ""; }).join("");
  // Stat of the day: one verified stat per Pacific day from the published datasets
  A.mountStatOfDay($("sotd"), { players: d.players, stats: d.stats, history: d.history, site });

  // The Rewind: report card on the last four games. The take is hand-written when it matches the latest game and the
  // EPA grades it quotes are present; otherwise it is written from the grades.
  const rw = L.rewind({ games: d.games, breakdown: d.breakdown, advanced: d.stats?.advanced });
  if (rw) { $("rw-body").innerHTML = rewindHTML(rw, ed.rewind?.after === rw.lastId && rw.subjects.some(s => s.fmt === "epa") ? ed.rewind : null); $("rewind").hidden = false; }
  else $("jump-rewind")?.remove();
});

function rewindHTML(rw, take) {
  const w = ([a, b]) => (a === b ? `Week ${a}` : `Weeks ${a}-${b}`);
  const one = v => v.toFixed(1), sg = (v, dp) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(dp);
  const val = (s, v) => v == null ? "-" : s.fmt === "epa" ? L.epaText(v) : s.fmt === "pts" ? sg(v * 100, 1) + " pts" : s.fmt === "signed0" ? sg(v, 0) + " yds" : sg(v, 1);
  // Trend against the earlier games: arrow and colour on the recent value
  const trend = s => s.before == null || s.v === s.before ? "" : (s.better === "lower" ? s.v < s.before : s.v > s.before)
    ? ` class="is-win"><span class="vh">up from earlier, </span><i aria-hidden="true">▲</i` : ` class="is-loss"><span class="vh">down from earlier, </span><i aria-hidden="true">▼</i`;
  const auto = rw.worst.length
    ? { title: `${rw.record} in the last ${rw.n}. Start with the ${rw.worst[0].label.toLowerCase()}.`,
        text: `The Raiders scored ${one(rw.pf)} and allowed ${one(rw.pa)} points a game over ${w(rw.weeks)}${rw.paBefore != null ? ` (${one(rw.pfBefore)} and ${one(rw.paBefore)} in ${w(rw.beforeWeeks)})` : ""}. ` +
          rw.worst.map(s => `${s.label}: ${s.what.toLowerCase()} ${val(s, s.v)}${s.bench != null ? ` (NFL average ${val(s, s.bench)})` : ""}.`).join(" ") }
    : { title: `${rw.record} in the last ${rw.n}.`, text: `The Raiders scored ${one(rw.pf)} and allowed ${one(rw.pa)} points a game over ${w(rw.weeks)}.` };
  const t = take || auto;
  const max = Math.max(1, ...rw.quarters.us, ...rw.quarters.them);
  const bar = (v, cls) => `<span class="rw-bar ${cls}" style="--w:${(v / max * 100).toFixed(1)}%"><b>${v}</b></span>`;
  return `<div class="rw-top">
    <div class="rw-take"><span class="eyebrow">${w(rw.weeks)} · ${esc(rw.record)} · Hot take</span>
      <h3 class="rw-title">${esc(t.title)}</h3><p>${esc(t.text)}</p>
      <div class="rw-games tnum">${rw.games.map(g => `<a href="games.html#g-${esc(g.id)}" class="${g.win ? "is-win" : g.tie ? "" : "is-loss"}"><span>Wk ${g.week} ${g.home ? "vs" : "at"} ${esc(g.opp)}</span><b>${g.win ? "W" : g.tie ? "T" : "L"} ${g.us}-${g.them}</b></a>`).join("")}</div>
    </div>
    <div class="rw-gpa"><span class="eyebrow">Report card</span><b class="rw-letter g-${L.gpaGrade(rw.gpa)}">${L.gpaGrade(rw.gpa)}</b><span class="muted tnum">GPA ${rw.gpa == null ? "-" : rw.gpa.toFixed(2)} across ${rw.subjects.length} subjects</span></div>
  </div>
  <div class="split">
    <table class="rw-card tnum"><caption class="vh">Report card, ${w(rw.weeks)}</caption>
      <thead><tr><th scope="col">Subject</th><th scope="col">Grade</th><th scope="col">${w(rw.weeks)}</th><th scope="col">${rw.beforeWeeks ? w(rw.beforeWeeks) : "Before"}</th><th scope="col">NFL avg</th></tr></thead>
      <tbody>${rw.subjects.map(s => `<tr><th scope="row">${esc(s.label)}<small>${esc(s.what)}</small></th><td><b class="rw-g g-${s.grade}">${s.grade}</b></td><td${trend(s)}>${val(s, s.v)}</td><td class="muted">${val(s, s.before)}</td><td class="muted">${s.bench != null ? val(s, s.bench) : "-"}</td></tr>`).join("")}</tbody>
    </table>
    <div class="card"><h3 class="panel-title">Points by quarter, ${w(rw.weeks)}</h3>
      <div class="rw-q tnum">${["1st", "2nd", "3rd", "4th"].map((q, i) => `<div><span>${q}</span><div>${bar(rw.quarters.us[i], "us")}${bar(rw.quarters.them[i], "them")}</div></div>`).join("")}</div>
      <p class="muted rw-key"><span class="rw-sw us"></span>Raiders <span class="rw-sw them"></span>Opponents. Overtime counts in the 4th.</p>
    </div>
  </div>
  <details class="rw-how"><summary>How the grades work</summary>
    <p>Every number comes from the site's data and updates after each game. The four unit grades compare EPA (expected points added, from nflverse play-by-play) per play over the last ${rw.n} games with the NFL average for the season so far: A is 0.10 or more better than average, B 0.04, C within 0.04, D 0.04 worse, F 0.10 or more worse. Ball security, discipline and third downs are graded on the margin against the opponents in those games. A needs at least +1 turnover, 20 fewer penalty yards or a third-down rate 15 points higher, per game; B needs +0.5, 8 yards or 5 points; D and F are the same amounts the other way. The overall grade is the average of the subjects, A = 4 to F = 0.</p>
  </details>`;
}

// Ambient accretion disk behind the hero (paused off screen and for reduced motion)
const c = $("disk");
if (c && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const x = c.getContext("2d"), dpr = Math.min(devicePixelRatio || 1, 2), pts = [];
  let W, H, raf, on = true;
  const size = () => { W = c.clientWidth; H = c.clientHeight; c.width = W * dpr; c.height = H * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0); };
  size(); addEventListener("resize", size);
  for (let i = 0; i < 360; i++) pts.push({ a: Math.random() * Math.PI * 2, r: .35 + Math.random() * .75, s: .0008 + Math.random() * .0022, o: .15 + Math.random() * .55 });
  const frame = () => {
    x.clearRect(0, 0, W, H);
    const cx = W * .5, cy = H * .45, R = Math.min(W, H) * .6;
    const g = x.createRadialGradient(cx, cy, R * .18, cx, cy, R * .42);
    g.addColorStop(0, "#000"); g.addColorStop(.6, "rgba(201,205,210,.28)"); g.addColorStop(1, "rgba(201,205,210,0)");
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R * .42, 0, 7); x.fill();
    for (const p of pts) {
      p.a += p.s / p.r;
      x.fillStyle = `rgba(230,232,235,${p.o * (Math.sin(p.a) > 0 ? 1 : .45)})`;
      x.fillRect(cx + Math.cos(p.a) * R * p.r, cy + Math.sin(p.a) * R * p.r * .16, 1.6, 1.6);
    }
    x.fillStyle = "#000"; x.beginPath(); x.arc(cx, cy, R * .2, 0, 7); x.fill();
    raf = requestAnimationFrame(frame);
  };
  frame();
  new IntersectionObserver(e => {
    if (e[0].isIntersecting && !on) { on = true; frame(); }
    else if (!e[0].isIntersecting && on) { on = false; cancelAnimationFrame(raf); }
  }).observe(c);
}
