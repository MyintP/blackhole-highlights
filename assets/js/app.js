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
      // Content above the target grew while loading, so re-apply a #section link once rendered
      const target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) target.scrollIntoView();
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
export function initChrome() {
  const btn = $("menu-btn"), drawer = $("drawer");
  if (btn && drawer) {
    const set = open => { btn.setAttribute("aria-expanded", String(open)); drawer.dataset.open = String(open); btn.setAttribute("aria-label", open ? "Close menu" : "Open menu"); };
    btn.addEventListener("click", () => set(btn.getAttribute("aria-expanded") !== "true"));
    document.addEventListener("keydown", e => { if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") { set(false); btn.focus(); } });
    drawer.addEventListener("click", e => { if (e.target.closest("a")) set(false); });
    matchMedia("(min-width: 901px)").addEventListener("change", e => { if (e.matches) set(false); });
  }
  const top = $("totop");
  if (top) {
    addEventListener("scroll", () => top.classList.toggle("on", scrollY > 900), { passive: true });
    top.addEventListener("click", () => { scrollTo({ top: 0 }); document.querySelector("main")?.focus({ preventScroll: true }); });
  }
}

// Notice bar: failed sources, or the hourly job hasn't succeeded for 3+ hours (checked via the public GitHub API).
export async function dataNotice(site) {
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
      if (L.isStale(run.at, 3)) msgs.push(`Data was last checked ${L.ago(run.at)}. Scores and news may be out of date.`);
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
        <div class="count tnum" data-cd><div><span data-d>--</span><small>DAYS</small></div><div><span data-h>--</span><small>HRS</small></div><div><span data-m>--</span><small>MIN</small></div></div></div>
      <div class="team r"><span class="abbr">${esc(home.abbr)}</span><span class="rec tnum">${esc(home.rec || "")} · HOME</span></div>
    </div>
    <div class="meta">${meta.join("")}</div></div>`;
}

// Countdown -> LIVE for 4 hours after kickoff -> FINAL
export function countdown(root, n) {
  const box = root.querySelector("[data-cd]"), label = root.querySelector("[data-cd-label]");
  if (!box) return;
  if (n.timeTBD) { label.textContent = "KICKOFF"; box.innerHTML = "<div><span>TBD</span><small>TIME</small></div>"; return; }
  const kick = new Date(n.date).getTime();
  const tick = () => {
    const ms = kick - Date.now();
    if (ms <= 0) {
      const live = ms > -4 * 36e5;
      label.textContent = live ? "KICKED OFF" : "FULL TIME";
      box.innerHTML = live ? `<div><span>LIVE</span><small>${esc(("on " + (n.tv || "TV")).toUpperCase())}</small></div>` : "<div><span>FINAL</span><small>RESULT SOON</small></div>";
      return;
    }
    const pad = v => String(v).padStart(2, "0");
    box.querySelector("[data-d]").textContent = pad(Math.floor(ms / 864e5));
    box.querySelector("[data-h]").textContent = pad(Math.floor(ms % 864e5 / 36e5));
    box.querySelector("[data-m]").textContent = pad(Math.floor(ms % 36e5 / 6e4));
  };
  tick(); setInterval(tick, 30000);
}

export function pickHTML(n, ed) {
  if (!(ed && n && ed.gameId === n.id && ed.pick)) {
    return `<div class="card"><h3 class="panel-title">Pundit's Pick</h3><p class="muted">The pick for ${n ? esc(n.opp.location + " " + n.opp.name) + " week" : "the next game"} drops before kickoff.</p></div>`;
  }
  const p = ed.pick;
  return `<div class="card"><h3 class="panel-title">Pundit's Pick</h3>
    <div class="score tnum"><span>${esc(n.opp.name.toUpperCase())}</span><span>${esc(p.them)}</span><span>RAIDERS</span><span>${esc(p.us)}</span></div>
    <p class="muted">${esc(p.text)}</p>
    ${p.keys?.length ? `<ol class="keys">${p.keys.map(k => `<li><div><h4>${esc(k.title)}</h4><p>${esc(k.text)}</p></div></li>`).join("")}</ol>` : ""}</div>`;
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
