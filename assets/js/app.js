// Shared page chrome (menu, search, back-to-top, stale-data notice), the data loader and renderers used by several pages.
import * as L from "./lib.js";
const { esc } = L;

const REPO = "MyintP/blackhole-highlights";
export const $ = id => document.getElementById(id);

// ---------- data ----------
// Fetch data/<name>.json with a timeout and retries; never served from browser cache.
export async function loadJSON(name, { timeout = 10000, tries = 3 } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(`data/${name}.json?t=${Date.now()}`, { cache: "no-store", signal: ctl.signal });
      if (!r.ok) { err = new Error(`${name}.json: HTTP ${r.status}`); if (r.status < 500) break; } // a 404 won't fix itself
      else return await r.json();
    } catch (e) { err = e; } finally { clearTimeout(t); }
    if (i < tries - 1) await new Promise(r => setTimeout(r, 500 * 2 ** i));
  }
  throw err;
}
// Load several files; a failed optional file comes back as null instead of failing the page.
export async function loadAll(required, optional = []) {
  const names = [...required, ...optional];
  const res = await Promise.allSettled(names.map(n => loadJSON(n)));
  const out = {};
  res.forEach((r, i) => {
    if (r.status === "rejected" && i < required.length) throw r.reason;
    out[names[i]] = r.status === "fulfilled" ? r.value : null;
  });
  return out;
}
export function showError(el, msg, retry) {
  el.innerHTML = `<div class="error" role="alert"><span>${esc(msg)}</span>${retry ? '<button type="button" class="btn sm ghost">Try again</button>' : ""}</div>`;
  if (retry) el.querySelector("button").addEventListener("click", retry);
}
export const empty = (msg, action = "") => `<div class="empty"><span>${msg}</span>${action}</div>`;

// Run a page: render skeletons are already in the HTML; on failure show a retry box in `errorEl`.
export async function runPage(errorEl, fn) {
  const go = async () => {
    document.body.classList.remove("load-failed");
    try {
      await fn(); errorEl.innerHTML = "";
      // Content above the target grew while loading (and it may sit in a tab that only exists now), so re-apply a #link
      const target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) { showSection(target); target.scrollIntoView(); }
    }
    catch (e) {
      console.error(e);
      document.body.classList.add("load-failed"); // stops the skeleton shimmer so nothing looks like it's still loading
      showError(errorEl, "Couldn't load the latest Raiders data. Check your connection and try again.", go);
    }
  };
  await go();
}

// ---------- chrome ----------
// Anchors from before the section redesign (Oct 2026) that now live elsewhere, so old links and bookmarks still land
const MOVED = {
  "index.html": { schedule: "games.html#schedule", milestones: "games.html#milestones", matchup: "games.html#matchup", videos: "media.html#videos", clips: "media.html#videos" },
  "stats.html": { roster: "players.html#roster", players: "#leaders" },
};
function redirectMoved() {
  const page = location.pathname.split("/").pop() || "index.html", to = MOVED[page]?.[decodeURIComponent(location.hash.slice(1))];
  if (to) location.replace(to);
  return !!to;
}

export function initChrome() {
  if (redirectMoved()) return;
  initTheme();
  // The drawer opens from the header menu button or the bottom bar's More button
  const btns = [$("menu-btn"), document.querySelector(".tabbar .more-btn")].filter(Boolean), drawer = $("drawer");
  if (btns.length && drawer) {
    let opener = btns[0];
    const isOpen = () => drawer.dataset.open === "true";
    const set = open => { drawer.dataset.open = String(open); btns.forEach(b => b.setAttribute("aria-expanded", String(open))); $("menu-btn")?.setAttribute("aria-label", open ? "Close menu" : "Open menu"); };
    btns.forEach(b => b.addEventListener("click", () => { opener = b; set(!isOpen()); if (isOpen()) drawer.querySelector("a")?.focus(); }));
    document.addEventListener("keydown", e => { if (e.key === "Escape" && isOpen()) { set(false); opener.focus(); } });
    drawer.addEventListener("click", e => { if (e.target.closest("a")) set(false); });
    matchMedia("(min-width: 901px)").addEventListener("change", e => { if (e.matches) set(false); });
  }
  initSections();
  const top = $("totop");
  if (top) {
    addEventListener("scroll", () => top.classList.toggle("on", scrollY > 900), { passive: true });
    top.addEventListener("click", () => { scrollTo({ top: 0 }); document.querySelector("main")?.focus({ preventScroll: true }); });
  }
}

// ---------- colour theme ----------
// System (follow the device), light or dark. The choice is stored per browser; an inline script in <head> applies it
// before first paint, so there is no flash of the wrong theme.
const THEMES = ["system", "light", "dark"];
function initTheme() {
  const btn = $("theme-btn"), root = document.documentElement;
  if (!btn) return;
  const get = () => root.dataset.theme || "system";
  const show = () => {
    const t = get(), next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
    btn.dataset.mode = t;
    btn.querySelector(".theme-name").textContent = t[0].toUpperCase() + t.slice(1);
    btn.setAttribute("aria-label", `Colour theme: ${t}. Switch to ${next}`);
  };
  btn.addEventListener("click", () => {
    const next = THEMES[(THEMES.indexOf(get()) + 1) % THEMES.length];
    if (next === "system") delete root.dataset.theme; else root.dataset.theme = next;
    try { if (next === "system") localStorage.removeItem("bhh-theme"); else localStorage.setItem("bhh-theme", next); } catch { /* private mode: applies to this page only */ }
    show();
  });
  show();
}

// ---------- section tabs ----------
// Pages with a section bar show one section at a time. The URL hash picks it (#advanced, or any element inside a
// section, like #odds or #g-<id>), so links, sharing and Back all work. Hidden sections use hidden="until-found":
// find-in-page still finds them in browsers that support it, and opening a match switches to its tab.
const tabs = () => [...document.querySelectorAll(".secbar a[data-tab]")];
const tabSections = () => tabs().map(a => document.getElementById(a.dataset.tab)).filter(Boolean);
function showSection(el) {
  const secs = tabSections();
  if (secs.length < 2) return;
  const sec = secs.find(x => x === el || x.contains(el)) || secs.find(x => !x.hidden) || secs[0];
  for (const x of secs) { if (x === sec) x.removeAttribute("hidden"); else x.setAttribute("hidden", "until-found"); }
  for (const a of tabs()) { if (a.dataset.tab === sec.id) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); }
  tabs().find(a => a.dataset.tab === sec.id)?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
function initSections() {
  const secs = tabSections();
  if (secs.length < 2) return;
  document.body.classList.add("tabbed");
  const fromHash = () => (location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)))) || secs[0];
  showSection(fromHash());
  addEventListener("hashchange", () => { const t = fromHash(); showSection(t); t.scrollIntoView(); });
  for (const x of secs) x.addEventListener("beforematch", () => { history.replaceState(null, "", "#" + x.id); showSection(x); });
}
// A short preview next to a section's name in the bar, e.g. "Results 3-4"
export function secNote(id, text) {
  const a = document.querySelector(`.secbar a[data-tab="${id}"]`);
  if (!a || !text) return;
  (a.querySelector("small") || a.appendChild(document.createElement("small"))).textContent = text;
}

// Notice bar: failed sources, or the update job hasn't succeeded for a while (2 hours around a game, 8 otherwise;
// checked via the public GitHub API).
export async function dataNotice(site) {
  if (site) initStrip(site);
  const el = $("notice");
  if (!el) return;
  const msgs = [];
  // Videos are excluded: YouTube blocks its feed for GitHub's servers until a YT_API_KEY secret exists (README).
  // That known limit is listed on the About page's source status rather than warned about on every page.
  const bad = Object.entries(site?.sources || {}).filter(([k, s]) => !s.ok && k !== "videos").map(([k]) => k);
  if (bad.length) msgs.push(`Some feeds didn't respond on the last check (${bad.join(", ")}). Showing the last good data for those.`);
  try {
    let run = JSON.parse(sessionStorage.getItem("bhh-run") || "null");
    if (!run || Date.now() - run.t > 10 * 60e3) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update.yml/runs?per_page=1&status=success`, { cache: "no-store" });
      if (r.ok) {
        const j = await r.json(), ok = (j.workflow_runs || [])[0];
        run = { t: Date.now(), at: ok?.updated_at || null };
        try { sessionStorage.setItem("bhh-run", JSON.stringify(run)); } catch {}
      }
    }
    if (run?.at) {
      document.querySelectorAll("[data-checked]").forEach(n => { n.textContent = L.ago(run.at); n.title = L.dateTime(run.at); });
      if (L.isStale(run.at, L.staleHours(site?.next))) msgs.push(`Data was last checked ${L.ago(run.at)}. Scores and news may be out of date.`);
    }
  } catch { /* GitHub API unavailable or rate-limited: no notice */ }
  if (msgs.length) { el.querySelector(".wrap").textContent = msgs.join(" "); el.hidden = false; }
}

// ---------- shared renderers ----------
export function storyHTML(i, { lead = false } = {}) {
  const meta = `<div class="story-meta"><span class="badge ${i.kind.toLowerCase()}" title="${esc(L.KINDS[i.kind] || "")}">${esc(i.kind)}</span>` +
    `<span>${esc(i.cat)}</span><span>${esc(i.src)}</span><time datetime="${esc(i.date)}" title="${esc(L.dateTime(i.date))}">${esc(L.ago(i.date))}</time></div>`;
  const also = i.also?.length ? `<p class="also">Also covered by ${i.also.slice(0, 3).map(a => `<a class="ext" href="${L.url(a.link)}" target="_blank" rel="noopener">${esc(a.src)}</a>`).join(", ")}</p>` : "";
  const h = `<a class="ext" href="${L.url(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a>`;
  return lead
    ? `<article class="lead">${meta}<h3>${h}</h3>${i.desc ? `<p>${esc(i.desc)}</p>` : ""}${also}</article>`
    : `<li class="story">${meta}<h3>${h}</h3>${i.desc ? `<p>${esc(i.desc)}</p>` : ""}${also}</li>`;
}

export function sides(site, n) {
  const us = { abbr: "LV", rec: site.record, name: "Raiders" }, them = { abbr: n.opp.abbr, rec: n.oppRecord, name: n.opp.name };
  return n.home ? { away: them, home: us } : { away: us, home: them };
}

export function boardHTML(site, n, ed) {
  const { away, home } = sides(site, n), on = ed && ed.gameId === n.id;
  const meta = [`<span><strong>${esc(L.day(n.date))}</strong> · ${n.timeTBD ? "Time TBD" : esc(L.time(n.date)) + " PT"}</span>`];
  if (n.venue) meta.push(`<span><strong>${esc(n.venue.name)}</strong> · ${esc(n.venue.city || "")}</span>`);
  if (n.tv) meta.push(`<span><strong>${esc(n.tv)}</strong>${on && ed.crew ? " · " + esc(ed.crew) : ""}</span>`);
  if (ed?.radio) meta.push(`<span>Radio <strong>${esc(ed.radio)}</strong></span>`);
  return `<div class="board" role="group" aria-label="${esc(away.name + " at " + home.name + ", " + L.day(n.date))}">
    <div class="eyebrow">Week ${esc(n.week)} · Next game</div>
    <div class="teams">
      <div class="team"><span class="abbr">${esc(away.abbr)}</span><span class="rec tnum">${esc(away.rec || "")} · AWAY</span></div>
      <div class="vs"><span class="at" data-cd-label>KICKOFF IN</span>
        <div class="count tnum" data-cd role="timer" aria-live="off"><div><span data-d>--</span><small>DAYS</small></div><div><span data-h>--</span><small>HRS</small></div><div><span data-m>--</span><small>MIN</small></div></div></div>
      <div class="team r"><span class="abbr">${esc(home.abbr)}</span><span class="rec tnum">${esc(home.rec || "")} · HOME</span></div>
    </div>
    <div class="meta">${meta.join("")}</div></div>`;
}

// Countdown -> live score (polled every 2 minutes during the game) -> FINAL
export function countdown(root, n) {
  const box = root.querySelector("[data-cd]"), label = root.querySelector("[data-cd-label]");
  if (!box) return;
  clearInterval(root._tick);
  if (n.timeTBD) { label.textContent = "KICKOFF"; box.innerHTML = "<div><span>TBD</span><small>TIME</small></div>"; return; }
  const kick = new Date(n.date).getTime();
  const tick = () => {
    const ms = kick - Date.now();
    if (n.score && n.state !== "pre") {
      const away = n.home ? n.score.them : n.score.us, home = n.home ? n.score.us : n.score.them;
      label.textContent = n.state === "post" ? "FINAL" : "LIVE" + (n.detail ? " · " + n.detail.toUpperCase() : "");
      box.innerHTML = `<div><span>${esc(away)}</span><small>AWAY</small></div><div class="dash" aria-hidden="true"><span>–</span></div><div><span>${esc(home)}</span><small>HOME</small></div>`;
      box.setAttribute("aria-label", `${n.state === "post" ? "Final" : "Live"} score: away ${away}, home ${home}${n.detail ? ", " + n.detail : ""}`);
      return;
    }
    if (ms <= 0) {
      const live = ms > -4.5 * 36e5;
      label.textContent = live ? "KICKED OFF" : "FULL TIME";
      box.innerHTML = live ? `<div><span>LIVE</span><small>${esc(("on " + (n.tv || "TV")).toUpperCase())}</small></div>` : "<div><span>FINAL</span><small>RESULT SOON</small></div>";
      return;
    }
    const pad = v => String(v).padStart(2, "0");
    box.querySelector("[data-d]").textContent = pad(Math.floor(ms / 864e5));
    box.querySelector("[data-h]").textContent = pad(Math.floor(ms % 864e5 / 36e5));
    box.querySelector("[data-m]").textContent = pad(Math.floor(ms % 36e5 / 6e4));
  };
  tick(); root._tick = setInterval(tick, 30000);
}

// Scoreboard for the next game. During the game it re-reads site.json every 2 minutes and redraws the score.
export function liveBoard(root, site, ed) {
  const draw = s => { root.innerHTML = boardHTML(s, s.next, ed); countdown(root, s.next); };
  draw(site);
  clearInterval(root._poll);
  if (!L.isLive(site.next)) return;
  const id = site.next.id;
  root._poll = setInterval(async () => {
    if (document.hidden) return;
    try {
      const s = await loadJSON("site", { tries: 1 });
      // Game over and the job has moved on to next week: keep showing this game's final score until reload.
      if (s.next?.id === id) draw(s);
      else if (s.last?.id === id) { draw({ ...s, next: { ...site.next, ...s.last, state: "post" } }); clearInterval(root._poll); }
      if (!L.isLive(s.next?.id === id ? s.next : null)) clearInterval(root._poll);
    } catch { /* keep the last score; try again next time */ }
  }, 120000);
}

export function pickHTML(n, ed, { keys = true } = {}) {
  if (!(ed && n && ed.gameId === n.id && ed.pick)) {
    return `<div class="card"><h3 class="panel-title">Pundit's Pick</h3><p class="muted">The pick for ${n ? esc(n.opp.location + " " + n.opp.name) + " week" : "the next game"} drops before kickoff.</p></div>`;
  }
  const p = ed.pick;
  return `<div class="card"><h3 class="panel-title">Pundit's Pick</h3>
    <div class="score tnum"><span>${esc(n.opp.name.toUpperCase())}</span><span>${esc(p.them)}</span><span>RAIDERS</span><span>${esc(p.us)}</span></div>
    <p class="muted">${esc(p.text)}</p>
    ${!keys ? `<a class="more" href="games.html#pick">Three keys to the game</a>` : p.keys?.length ? `<ol class="keys">${p.keys.map(k => `<li><div><h4>${esc(k.title)}</h4><p>${esc(k.text)}</p></div></li>`).join("")}</ol>` : ""}</div>`;
}

const GAMBLING = "For entertainment only. 21+. Gambling problem? Call 1-800-GAMBLER.";
export function oddsHTML(n, odds, { full = true } = {}) {
  if (!n) return `<div class="card"><h3 class="panel-title">Odds</h3>${empty("No upcoming game.")}</div>`;
  const title = `<h3 class="panel-title">${esc(n.opp.name)} ${n.home ? "at" : "vs"} Raiders odds</h3>`;
  const c = odds?.current?.gameId === n.id ? odds.current : null, rec = odds?.record;
  const recRows = rec ? `<tr><td>Raiders vs. the spread</td><td class="n" colspan="2">${L.recordText(rec.ats)}</td></tr><tr><td>Raiders over/under</td><td class="n" colspan="2">${rec.ou[0]} over, ${rec.ou[1]} under${rec.ou[2] ? ", " + rec.ou[2] + " push" : ""}</td></tr>` : "";
  if (!c) {
    const w = odds?.window?.gameId === n.id ? odds.window : null;
    return `<div class="card">${title}<div class="odds-wait">${w ? `Lines load <strong>${esc(L.dateTime(w.opens))}</strong>, 12 hours before kickoff,` : "Lines load <strong>12 hours before kickoff</strong>"} and refresh every hour until 1 hour before.</div>
      ${recRows ? `<table><tbody>${recRows}</tbody></table>` : ""}<p class="note">Lines: DraftKings via ESPN. ${GAMBLING}</p></div>`;
  }
  const t = esc(c.them.abbr), closed = odds.window && Date.now() > new Date(odds.window.closes).getTime();
  return `<div class="card">${title}
    <table><thead><tr><th>Line</th><th class="n">${t}</th><th class="n">LV</th></tr></thead><tbody>
      <tr><td>Spread</td><td class="n">${esc(c.them.spread)} <small>(${esc(c.them.spreadOdds)})</small></td><td class="n">${esc(c.us.spread)} <small>(${esc(c.us.spreadOdds)})</small></td></tr>
      <tr><td>Moneyline</td><td class="n">${esc(c.them.ml)}</td><td class="n">${esc(c.us.ml)}</td></tr>
      <tr><td>Total</td><td class="n">O ${esc(c.total.line)} <small>(${esc(c.total.over)})</small></td><td class="n">U ${esc(c.total.line)} <small>(${esc(c.total.under)})</small></td></tr></tbody></table>
    ${full ? `<table><thead><tr><th>Movement</th><th class="n">Spread</th><th class="n">Total</th></tr></thead><tbody>
      <tr><td>Open</td><td class="n">${t} ${esc(c.them.openSpread)}</td><td class="n">${esc(c.total.open)}</td></tr>
      <tr><td>Now</td><td class="n">${t} ${esc(c.them.spread)}</td><td class="n">${esc(c.total.line)}</td></tr>${recRows}</tbody></table>` : ""}
    <p class="note">${esc(c.book)} via ESPN, as of ${esc(L.dateTime(c.asOf))}. ${closed ? "Final line, taken 1 hour before kickoff." : "Refreshes hourly until 1 hour before kickoff."} ${GAMBLING}</p></div>`;
}

export function injuriesHTML(list) {
  if (!list?.length) return `<ul class="inj"><li><span class="muted">No injuries listed.</span></li></ul>`;
  return `<ul class="inj">${list.map(i => `<li><span>${esc(i.name)} <small>· ${esc(i.pos)}${i.injury ? " · " + esc(i.injury) : ""}</small></span><span class="st ${L.injuryClass(i.status)}">${esc(L.injuryLabel(i.status))}</span></li>`).join("")}</ul>`;
}

export function tapeHTML(m, n) {
  if (!m || !n || m.gameId !== n.id) return empty("Matchup stats load once the next opponent is set.");
  return `<div class="tape-key" aria-hidden="true"><div>RAIDERS</div><div></div><div>${esc(m.opp.toUpperCase())}</div></div>
    <div class="tape tnum" role="table" aria-label="Raiders vs ${esc(m.opp)} season stats">${m.rows.map(r => {
      const a = r.us.v, b = r.them.v, max = Math.max(a, b) || 1, usBetter = r.higher ? a >= b : a <= b;
      const side = (cls, v, rank, better, who) => `<div class="side ${cls}" role="cell"><div class="v"><span class="vh">${who} </span>${Number(v).toFixed(1)}<small>${esc(rank || "")}</small></div><div class="meter" aria-hidden="true"><i${better ? "" : ' class="dim"'} style="width:${(v / max) * 100}%"></i></div></div>`;
      return `<div class="tape-row" role="row">${side("lft", a, r.us.rank, usBetter, "Raiders")}<div class="k" role="rowheader">${esc(r.label)}</div>${side("rgt", b, r.them.rank, !usBetter, esc(m.opp))}</div>`;
    }).join("")}</div>`;
}

export function scheduleHTML(site, n, { games = site.schedule?.games || [], link = "" } = {}) {
  const s = site.schedule, cards = [];
  games.forEach(g => {
    if (s?.bye && g.week === s.bye + 1 && games[0].week <= s.bye) cards.push(`<div class="g bye"><div class="wk"><span>Week ${s.bye}</span></div><div class="opp">Bye</div></div>`);
    const isNext = n && g.id === n.id;
    const body = g.final ? `<div class="res ${g.win ? "is-win" : g.tie ? "" : "is-loss"}">${esc(L.resultText(g))}</div>`
      : `<div class="when">${g.timeTBD ? "Date &amp; time TBD" : esc(L.short(g.date)) + " · " + esc(L.time(g.date))}${g.tv ? " · " + esc(g.tv) : ""}</div>`;
    const tag = link ? "a" : "div", href = link ? ` href="${esc(link)}${g.final ? "#g-" + esc(g.id) : isNext ? "#next" : "#schedule"}"` : "";
    cards.push(`<${tag} class="g${isNext ? " next" : ""}"${href}><div class="wk"><span>Week ${esc(g.week)}</span>${isNext ? '<span class="tag">Next</span>' : ""}</div><div class="opp">${esc(L.gameLabel(g))}${g.opp.record ? `<small>${esc(g.opp.record)}</small>` : ""}</div>${body}</${tag}>`);
  });
  return `<div class="sched tnum">${cards.join("")}</div>`;
}

export function tilesHTML(list) {
  return (list || []).map(x => `<div class="tile"><span class="cat">${esc(x.cat)}</span><b>${esc(x.value)}<small>${esc(x.unit)}</small></b><h4>${esc(x.name)}</h4>${x.line && x.line !== x.value ? `<p>${esc(x.line)}</p>` : ""}</div>`).join("");
}

export function videosHTML(v) {
  if (!v?.length) return empty("New uploads from the channel show up here automatically. Nothing is posted yet.", '<a class="btn" href="https://www.youtube.com/@BlackHoleHighlights" target="_blank" rel="noopener">Go to the channel</a>');
  return `<div class="vids">${v.map(x => `<a class="vid" href="${L.url(x.url)}" target="_blank" rel="noopener"><img src="${L.url(x.thumb)}" alt="" loading="lazy" width="480" height="270"><h3>${esc(x.title)}</h3><span class="eyebrow">${esc(L.short(x.date))}</span></a>`).join("")}</div>`;
}

export function linkListHTML(items) {
  if (!items?.length) return empty("Nothing new right now.");
  return `<ul class="stories compact">${items.map(i => `<li class="story"><div class="story-meta"><span>${esc(i.src)}</span><time datetime="${esc(i.date)}">${esc(L.ago(i.date))}</time></div><h3><a class="ext" href="${L.url(i.link)}" target="_blank" rel="noopener">${esc(i.title)}</a></h3>${i.desc ? `<p>${esc(i.desc)}</p>` : ""}</li>`).join("")}</ul>`;
}

// ---------- game-week strip + AFC West scores (under the header on every page) ----------
const teamLine = (g, us = "LV") => {
  const a = g.home ? g.opp.abbr : us, h = g.home ? us : g.opp.abbr;
  if (!g.score) return `${esc(a)} at ${esc(h)}`;
  const sa = g.home ? g.score.them : g.score.us, sh = g.home ? g.score.us : g.score.them;
  return `${esc(a)} <b>${esc(sa)}</b> · ${esc(h)} <b>${esc(sh)}</b>`;
};
const link = (href, label) => `<a href="${esc(href)}">${esc(label)}</a>`;

export function stripHTML(site, now = Date.now()) {
  const s = L.stripState(site, now), g = s.game;
  const when = x => (x.timeTBD ? "Time TBD" : `${L.day(x.date)} · ${L.time(x.date)} PT`) + (x.tv ? ` · ${x.tv}` : "");
  let tag = "", main = "", links = [];
  switch (s.kind) {
    case "pre":
      tag = `Week ${g.week}`;
      main = `${g.home ? esc(g.opp.name) + " at Raiders" : "Raiders at " + esc(g.opp.name)}${g.oppRecord ? ` <small>(${esc(g.oppRecord)})</small>` : ""} · ${esc(when(g))}`;
      links = [link("games.html#odds", "Odds"), link("games.html#injuries", "Injuries"), link("games.html#matchup", "Matchup"), link("games.html#pick", "Pick")];
      break;
    case "live":
      tag = `<span class="dot" aria-hidden="true"></span>Live`;
      main = `${teamLine(g)}${g.detail ? ` · ${esc(g.detail)}` : ""}${s.stale ? ` <small>(as of ${esc(L.time(site.updated))} PT)</small>` : ""}`;
      links = [link("games.html#next", "Game Center")];
      break;
    case "kickoff":
      tag = `Week ${g.week}`;
      main = `${teamLine({ ...g, score: null })} · kicked off ${esc(L.time(g.date))} PT <small>(score updating)</small>`;
      links = [link("games.html#next", "Game Center")];
      break;
    case "awaiting":
      tag = `Week ${g.week}`;
      main = `${teamLine({ ...g, score: null })} · awaiting the final score`;
      links = [link("games.html#results", "Results")];
      break;
    case "post": {
      const res = g.tie ? "T" : g.win ? "W" : "L";
      tag = "Final";
      main = `${teamLine(g)} <span class="${g.tie ? "" : g.win ? "is-win" : "is-loss"}">${res}</span> <small>· Next: ${s.next.home ? "vs" : "at"} ${esc(s.next.opp.name)}, ${esc(L.day(s.next.date))}</small>`;
      links = [link(`games.html#g-${g.id}`, "Box score"), link(`games.html#g-${g.id}`, "Drives & swings")];
      if (site.last?.recap?.link) links.push(`<a class="ext" href="${L.url(site.last.recap.link)}" target="_blank" rel="noopener">Recap</a>`);
      break;
    }
    case "bye":
      tag = `Week ${s.week}`;
      main = `Bye week <small>· Next: ${g.home ? "vs" : "at"} ${esc(g.opp.name)}, ${esc(when(g))}</small>`;
      links = [link("games.html#next", "Next game")];
      break;
    case "postponed":
      tag = `Week ${g.week}`;
      main = `${teamLine({ ...g, score: null })} · postponed`;
      links = [link("news.html?cat=Games", "Latest news")];
      break;
    case "done":
      tag = `${site.season}`;
      main = `Season complete · ${esc(site.record || "")}`;
      links = [link("stats.html#history", "Season history")];
      break;
    default: return "";
  }
  // Head: what the game is. Rail: its links, then the AFC West scores (one swipeable row on phones).
  return `<div class="gs-head"><span class="gs-tag${s.kind === "live" ? " live" : ""}">${tag}</span><span class="gs-main">${main}</span></div>
    <div class="gs-rail"><nav class="gs-links" aria-label="This game">${links.join("")}</nav>${scoresHTML(site, now)}</div>`;
}

// This week's AFC West games. Only scores from the feed; "Live" needs a live status, and a stale live score says so.
export function scoresHTML(site, now = Date.now()) {
  const w = site?.week, games = w?.games || [];
  const place = site?.divisionPlace ? `<span class="gs-place">LV ${esc(site.divisionPlace)}</span>` : "";
  if (!games.length && !w?.byes?.length) return place ? `<div class="gs-scores">${place}</div>` : "";
  const stale = now - new Date(site.updated).getTime() > 25 * 6e4;
  const item = g => {
    const st = g.postponed ? "Postponed" : g.state === "in" ? (g.detail || "Live") + (stale ? " · as of " + L.time(site.updated) : "") : g.final ? "Final" : `${L.fmt(g.date, { weekday: "short" })} ${L.time(g.date)}`;
    const side = x => `<span class="${g.final && x.winner ? "w" : ""}">${esc(x.abbr)}${x.score != null && g.state !== "pre" ? " " + esc(x.score) : ""}</span>`;
    const ours = g.away.abbr === "LV" || g.home.abbr === "LV";
    const attrs = ours ? `href="${g.final ? `games.html#g-${esc(g.id)}` : "games.html#next"}"` : `href="${L.url(g.link)}" target="_blank" rel="noopener"`;
    return `<a class="gs-score${g.state === "in" ? " live" : ""}" ${attrs}>${side(g.away)}${side(g.home)}<small>${esc(st)}</small></a>`;
  };
  return `<div class="gs-scores" role="group" aria-label="AFC West this week${w.week ? ", week " + esc(w.week) : ""}">${games.map(item).join("")}${(w.byes || []).map(b => `<span class="gs-score bye"><span>${esc(b)}</span><small>Bye</small></span>`).join("")}${place}</div>`;
}

function initStrip(site) {
  const el = $("gamestrip");
  if (!el) return;
  const draw = s => { const html = stripHTML(s); el.innerHTML = html ? `<div class="wrap">${html}</div>` : ""; el.hidden = !html; };
  draw(site);
  // Poll while a Raiders or AFC West game is on, so the strip doesn't sit on an old score
  const busy = s => L.stripState(s).kind === "live" || (s.week?.games || []).some(g => g.state === "in");
  if (!busy(site) || el._poll) return;
  el._poll = setInterval(async () => {
    if (document.hidden) return;
    try { const s = await loadJSON("site", { tries: 1 }); draw(s); if (!busy(s)) clearInterval(el._poll); } catch { /* keep what's shown */ }
  }, 120000);
}

// ---------- stat of the day ----------
export function statCardHTML(st) {
  if (!st) return `<div class="sotd">${empty("Today's stat appears once this season's player data has loaded.")}</div>`;
  const body = st.question
    ? `<p class="sotd-q">${esc(st.question)}</p><details class="sotd-a"><summary>Show the answer</summary><div class="sotd-big"><b>${esc(st.big)}</b><span>${esc(st.unit)}</span></div><p>${esc(st.text)}</p></details>`
    : `<div class="sotd-big"><b>${esc(st.big)}</b><span>${esc(st.unit)}</span></div><p class="sotd-who">${esc(st.who)}</p><p>${esc(st.text)}</p>`;
  return `<article class="sotd" aria-labelledby="sotd-h">
    <div class="sotd-head"><h3 id="sotd-h" class="panel-title">Stat of the day</h3><span class="eyebrow">${esc(st.kind)} · ${esc(L.short(st.date + "T12:00:00Z"))}</span></div>
    ${body}
    <p class="note">Source: ${esc(st.source)}.</p>
    <div class="sotd-actions"><a class="btn sm ghost" href="${esc(st.link)}">More</a><button type="button" class="btn sm ghost" data-sotd-save>Save as image</button></div>
  </article>`;
}

// 1080x1350 card (a 4:5 social post) drawn on a canvas, so it can be saved without a server.
export async function statCardImage(st) {
  await Promise.all(["400 120px Anton", "600 40px 'Barlow Condensed'", "400 36px Barlow"].map(f => document.fonts?.load(f).catch(() => null)));
  const c = document.createElement("canvas"); c.width = 1080; c.height = 1350;
  const x = c.getContext("2d"), pad = 90;
  x.fillStyle = "#09090b"; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = "#34373d"; x.lineWidth = 4; x.strokeRect(40, 40, c.width - 80, c.height - 80);
  const wrap = (text, font, color, y, lh, max = c.width - pad * 2) => {
    x.font = font; x.fillStyle = color;
    let line = "";
    for (const w of String(text).split(" ")) { const t = line ? line + " " + w : w; if (x.measureText(t).width > max && line) { x.fillText(line, pad, y); y += lh; line = w; } else line = t; }
    if (line) { x.fillText(line, pad, y); y += lh; }
    return y;
  };
  let y = 170;
  y = wrap(`STAT OF THE DAY · ${L.short(st.date + "T12:00:00Z").toUpperCase()}`, "600 40px 'Barlow Condensed', sans-serif", "#9aa1aa", y, 56);
  if (st.question) y = wrap(st.question, "400 64px Anton, Impact, sans-serif", "#c9cdd2", y + 30, 80);
  // shrink the big number until it fits the card
  let size = 300;
  do { x.font = `400 ${size}px Anton, Impact, sans-serif`; size -= 20; } while (x.measureText(st.big).width > c.width - pad * 2 && size > 100);
  x.fillStyle = "#f1f2f4"; x.fillText(st.big, pad - 8, y + size); y += size + 60;
  y = wrap(st.unit.toUpperCase(), "600 54px 'Barlow Condensed', sans-serif", "#c9cdd2", y, 64);
  y = wrap(st.text, "400 42px Barlow, sans-serif", "#f1f2f4", y + 40, 58);
  wrap(`Source: ${st.source}`, "400 28px Barlow, sans-serif", "#9aa1aa", c.height - 190, 38);
  x.font = "400 44px Anton, Impact, sans-serif"; x.fillStyle = "#f1f2f4"; x.fillText("BLACK HOLE HIGHLIGHTS", pad, c.height - 90);
  return new Promise(r => c.toBlob(r, "image/png"));
}

export function mountStatOfDay(el, data) {
  const st = L.statOfDay(L.statCandidates(data));
  el.innerHTML = statCardHTML(st);
  el.querySelector("[data-sotd-save]")?.addEventListener("click", async () => {
    const blob = await statCardImage(st);
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `raiders-stat-${st.date}.png`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}

// ---------- odds history and grading ----------
// Every hourly capture for this game, oldest first, so the line's movement is visible and the closing line auditable.
export function lineHistoryHTML(odds, n) {
  const h = n && odds?.history?.[n.id];
  if (!h?.length) return "";
  const signed = L.signed;
  return `<div class="card"><h3 class="panel-title">Line history <small class="muted">${h.length} capture${h.length === 1 ? "" : "s"}</small></h3>
    <div class="table-wrap"><table><thead><tr><th scope="col">Captured (PT)</th><th scope="col" class="n">LV spread</th><th scope="col" class="n">LV ML</th><th scope="col" class="n">${esc(n.opp.abbr)} ML</th><th scope="col" class="n">Total</th></tr></thead><tbody>${
    h.map((c, i) => `<tr${i === h.length - 1 ? ' class="us"' : ""}><td>${esc(L.dateTime(c.asOf))}</td><td class="n">${esc(signed(c.spread))}</td><td class="n">${esc(signed(c.ml))}</td><td class="n">${esc(signed(c.oppMl))}</td><td class="n">${esc(c.total ?? "-")}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">${esc(h[h.length - 1].book || "Sportsbook")} via ESPN. The last capture before the window closes is the closing line used for grading.</p></div>`;
}

// Against the spread and over/under, game by game. Weeks before this site captured lines come from public reports.
export function atsLogHTML(odds, site) {
  if (!odds) return "";
  const games = (site?.schedule?.games || []).filter(g => odds.closing?.[g.id]);
  const b = odds.baseline;
  const cls = v => (v === "W" ? "is-win" : v === "L" ? "is-loss" : "");
  const rows = games.map(g => {
    const c = odds.closing[g.id], r = c.result;
    return `<tr><td>Week ${esc(g.week)}</td><td>${esc(L.gameLabel(g))}</td><td class="n">${esc(L.signed(c.spread))}${c.asOf ? `<br><small>${esc(L.dateTime(c.asOf))}</small>` : ""}</td><td class="n">${esc(c.total ?? "-")}</td>
      <td class="n">${c.final ? `${esc(c.final.us)}-${esc(c.final.them)}` : g.postponed ? "Postponed" : "-"}</td>
      <td class="n ${cls(r?.ats)}">${r?.ats ? { W: "Covered", L: "Didn't cover", P: "Push" }[r.ats] : g.final ? "No line" : "Pending"}</td><td class="n">${r?.ou ? { O: "Over", U: "Under", P: "Push" }[r.ou] : g.final ? "No line" : "Pending"}</td></tr>`;
  }).join("");
  return `<div class="card"><h3 class="panel-title">Against the spread, game by game</h3>
    <div class="table-wrap"><table><thead><tr><th scope="col">Week</th><th scope="col">Game</th><th scope="col" class="n">LV close</th><th scope="col" class="n">Total</th><th scope="col" class="n">Final</th><th scope="col" class="n">ATS</th><th scope="col" class="n">O/U</th></tr></thead><tbody>
      ${b ? `<tr><td>Weeks 1-${esc(b.throughWeek)}</td><td colspan="4" class="muted">From public reports; lines weren't captured by this site</td><td class="n">${esc(L.recordText(b.ats))}</td><td class="n">${esc(b.ou[0])}-${esc(b.ou[1])}${b.ou[2] ? "-" + esc(b.ou[2]) : ""}</td></tr>` : ""}
      ${rows || `<tr><td colspan="7" class="muted">No closing lines captured yet. The first is taken 1 hour before the next kickoff.</td></tr>`}</tbody></table></div>
    <p class="note">Graded automatically from the captured closing line and ESPN's final score, and regraded if a score is corrected. A push counts as neither. Games without a captured line aren't graded. ${GAMBLING}</p></div>`;
}
