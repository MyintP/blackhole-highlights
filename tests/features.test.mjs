import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../assets/js/lib.js";
import * as P from "../scripts/lib/parse.mjs";

const H = 36e5, KICK = Date.parse("2026-10-25T20:25:00Z");
const game = (o = {}) => ({ id: "7", week: 7, date: new Date(KICK).toISOString(), home: true, opp: { abbr: "LAR", name: "Rams" }, state: "pre", final: false, score: null, ...o });
const last = { id: "6", week: 6, date: new Date(KICK - 7 * 864e5).toISOString(), home: true, opp: { abbr: "BUF", name: "Bills" }, state: "post", final: true, win: false, tie: false, score: { us: 30, them: 33 } };
const site = (o = {}) => ({ updated: new Date(KICK).toISOString(), season: 2026, next: game(), last, ...o });

test("stripState: pre, recent result, live, stale live, kickoff without live data, awaiting final", () => {
  assert.equal(L.stripState(site(), KICK - 2 * 864e5).kind, "pre");
  assert.equal(L.stripState(site(), last && Date.parse(last.date) + 20 * H).kind, "post"); // day after the last game
  assert.equal(L.stripState(site(), KICK - 12 * H).kind, "pre"); // under a day to the next game: preview wins
  const live = site({ next: game({ state: "in", score: { us: 17, them: 10 }, detail: "3rd 4:12" }), updated: new Date(KICK + H).toISOString() });
  assert.deepEqual([L.stripState(live, KICK + H + 5 * 6e4).kind, L.stripState(live, KICK + H + 5 * 6e4).stale], ["live", false]);
  assert.equal(L.stripState(live, KICK + H + 40 * 6e4).stale, true); // no update for 40 min: flagged, never silently "live"
  assert.equal(L.stripState(site(), KICK + 30 * 6e4).kind, "kickoff"); // past kickoff but the feed hasn't gone live
  assert.equal(L.stripState(site(), KICK + 5 * H).kind, "awaiting");
});

test("stripState: bye, postponed, season complete, nothing", () => {
  const bye = site({ next: game({ week: 9, date: new Date(KICK + 14 * 864e5).toISOString() }), last: { ...last, week: 7, date: new Date(KICK - 5 * 864e5).toISOString() } });
  assert.deepEqual([L.stripState(bye, KICK).kind, L.stripState(bye, KICK).week], ["bye", 8]);
  assert.equal(L.stripState(site({ next: game({ postponed: true }) }), KICK - H).kind, "postponed");
  assert.equal(L.stripState(site({ next: null }), KICK).kind, "done");
  assert.equal(L.stripState({ next: null, last: null }, KICK).kind, "none");
});

test("ptDate uses Pacific time, including across the DST change", () => {
  assert.equal(L.ptDate(Date.parse("2026-10-23T05:00:00Z")), "2026-10-22"); // 10 pm PDT
  assert.equal(L.ptDate(Date.parse("2026-10-23T08:00:00Z")), "2026-10-23"); // 1 am PDT
  assert.equal(L.ptDate(Date.parse("2026-11-02T07:30:00Z")), "2026-11-01"); // 11:30 pm PST after DST ends
  assert.equal(L.time("2026-11-08T21:05:00Z"), "1:05 PM"); // a PST kickoff
});

const players = {
  throughWeek: 6, players: [
    { id: "hezekiah-masses", name: "Hezekiah Masses", stats: { Defense: [{ k: "def_interceptions", label: "INT", v: 3, rank: 1, tied: 6 }] } },
    { id: "treydan-stukes", name: "Treydan Stukes", stats: { Defense: [{ k: "def_interceptions", label: "INT", v: 1, rank: 40, tied: 90 }] } },
    { id: "maxx-crosby", name: "Maxx Crosby", stats: { Defense: [{ k: "def_qb_hits", label: "QB hits", v: 15, rank: 2, tied: 2 }, { k: "fumble_recovery_opp", label: "Fum rec", v: 1, rank: 6, tied: 97 }] } },
  ],
};

test("statCandidates: only verified, sourced facts; big ties are never headlines", () => {
  const c = L.statCandidates({ players, site: { season: 2026 } });
  const texts = c.player.map(x => x.text);
  assert.ok(texts.includes("Hezekiah Masses has 3 interceptions, tied for 1st in the NFL."));
  assert.ok(texts.includes("Maxx Crosby has 15 QB hits, tied for 2nd in the NFL."));
  assert.ok(!texts.some(t => /fumble recoveries/.test(t))); // 1 recovery shared by 97 players
  for (const x of [...c.player, ...c.quiz]) assert.match(x.source, /2026 regular season through Week 6/);
  const q = c.quiz.find(x => x.id === "q:def_interceptions");
  assert.equal(q.who, "Hezekiah Masses");
  assert.equal(c.quiz.find(x => x.id === "q:def_qb_hits").question, "Who leads the Raiders in QB hits?");
});

test("statCandidates: history compares this season's scoring with past full seasons", () => {
  const history = { seasons: [{ year: 2025, w: 3, l: 14, t: 0, pf: 241 }, { year: 2020, w: 8, l: 8, t: 0, pf: 434 }, { year: 2019, w: 7, l: 9, t: 0, pf: 313 }] };
  const h = L.statCandidates({ stats: { season: 2026, team: [{ key: "totalPointsPerGame", v: 27 }] }, history, site: { season: 2026 } }).history[0];
  assert.equal(h.text, "The Raiders are scoring 27.0 points a game, their most since 2020 (27.1).");
  const top = L.statCandidates({ stats: { season: 2026, team: [{ key: "totalPointsPerGame", v: 30 }] }, history, site: { season: 2026 } }).history[0];
  assert.match(top.text, /more than in any full season since at least 2019/);
});

test("statOfDay is stable within a day, rotates kinds across days, and handles no data", () => {
  const c = L.statCandidates({ players, site: { season: 2026 } });
  assert.deepEqual(L.statOfDay(c, "2026-10-23"), L.statOfDay(c, "2026-10-23"));
  const kinds = new Set(["2026-10-23", "2026-10-24"].map(d => L.statOfDay(c, d).kind));
  assert.equal(kinds.size, 2); // player and quiz alternate
  assert.equal(L.statOfDay({}, "2026-10-23"), null);
  assert.equal(L.statOfDay(L.statCandidates({}), "2026-10-23"), null);
});

test("mapScoreboard keeps AFC West games, statuses and byes", () => {
  const comp = (state, completed, a, h, name = "STATUS_FINAL") => ({ status: { type: { state, completed, shortDetail: "x", name } }, competitors: [{ homeAway: "away", team: { id: a[0], abbreviation: a[1] }, score: "21", winner: completed }, { homeAway: "home", team: { id: h[0], abbreviation: h[1] }, score: "17" }] });
  const j = {
    week: { number: 7, teamsOnBye: [{ id: "24", abbreviation: "LAC" }, { id: "2", abbreviation: "BUF" }] },
    events: [
      { id: "1", date: "2026-10-25T20:05Z", competitions: [comp("post", true, ["7", "DEN"], ["22", "ARI"])], links: [{ rel: ["summary"], href: "https://espn.example/1" }] },
      { id: "2", date: "2026-10-25T17:00Z", competitions: [comp("pre", false, ["1", "ATL"], ["2", "BUF"], "STATUS_SCHEDULED")] },
      { id: "3", date: "2026-10-25T20:25Z", competitions: [comp("pre", false, ["14", "LAR"], ["13", "LV"], "STATUS_POSTPONED")] },
    ],
  };
  const w = P.mapScoreboard(j, ["13", "12", "7", "24"]);
  assert.equal(w.games.length, 2);
  assert.deepEqual(w.byes, ["LAC"]);
  assert.equal(w.games[0].away.score, 21);
  assert.equal(w.games[0].link, "https://espn.example/1");
  assert.equal(w.games[1].home.score, null); // no scores before kickoff
  assert.equal(w.games[1].postponed, true);
});

test("nextWait covers other AFC West games for the scores strip", () => {
  const other = "2026-10-26T00:20:00Z", t = Date.parse(other);
  assert.equal(P.nextWait(null, new Date(t + H), [other]), 600);
  assert.equal(P.nextWait(null, new Date(t - 30 * 6e4), [other]), 31 * 60); // first check just after kickoff
  assert.equal(P.nextWait(null, new Date(t - 5 * H), [other]), null);
  assert.equal(P.nextWait(null, new Date(t + 5 * H), [other]), null);
});

test("grade: covers, pushes, missing lines, postponed games and score corrections", () => {
  const odds = { baseline: { throughWeek: 6, ats: [5, 1, 0], ou: [4, 2, 0] }, closing: {
    a: { week: 7, spread: 4.5, total: 47.5 }, b: { week: 8, spread: -3, total: 44 }, c: { week: 9, spread: null, total: null }, d: { week: 10, spread: 1, total: 40 } } };
  const games = [
    { id: "a", final: true, score: { us: 20, them: 23 } }, // lost by 3 as a 4.5-pt dog: covered; 43 < 47.5 under
    { id: "b", final: true, score: { us: 24, them: 21 } }, // won by 3 as a 3-pt favorite: push; 45 > 44 over
    { id: "c", final: true, score: { us: 10, them: 0 } }, // no line captured: not graded
    { id: "d", final: false, postponed: true, score: null },
  ];
  P.grade(odds, games);
  assert.deepEqual(odds.closing.a.result, { ats: "W", ou: "U" });
  assert.deepEqual(odds.closing.b.result, { ats: "P", ou: "O" });
  assert.deepEqual(odds.closing.c.result, { ats: null, ou: null });
  assert.equal(odds.closing.d.result, undefined);
  assert.deepEqual(odds.record, { ats: [6, 1, 1], ou: [5, 3, 0] });
  games[0].score = { us: 17, them: 23 }; // corrected: lost by 6, didn't cover
  P.grade(odds, games);
  assert.equal(odds.closing.a.result.ats, "L");
  assert.deepEqual(odds.record.ats, [5, 2, 1]);
});

test("strip and scores markup: no live label without live status, links to the right places", async () => {
  globalThis.document = globalThis.document || { getElementById: () => null }; // app.js reads the DOM only when called
  const A = await import("../assets/js/app.js");
  const s = site({ week: { week: 7, byes: ["LAC"], games: [{ id: "7", date: new Date(KICK).toISOString(), state: "pre", final: false, away: { abbr: "LAR", score: null }, home: { abbr: "LV", score: null }, link: "https://espn.example/7" }] }, divisionPlace: "2nd in AFC West" });
  const pre = A.stripHTML(s, KICK - 2 * 864e5);
  assert.match(pre, /Rams at Raiders/);
  assert.match(pre, /games\.html#odds/);
  assert.doesNotMatch(pre, /Live/);
  assert.match(pre, /LAC<\/span><small>Bye/);
  assert.match(pre, /LV 2nd in AFC West/);
  assert.match(pre, /href="games\.html#next"/); // the Raiders' own game links inside the site, not to ESPN
  const post = A.stripHTML(s, Date.parse(last.date) + 20 * H);
  assert.match(post, /Final/);
  assert.match(post, /games\.html#g-6/);
});
