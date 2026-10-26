import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../assets/js/lib.js";

const news = [
  { title: "Raiders-Rams Week 7 Injury Report", desc: "Take a look", src: "Raiders.com", cat: "Injuries", kind: "Official", date: "2026-10-21T23:36:00Z" },
  { title: "The Raiders should trade for Quenton Nelson", desc: "", src: "Silver & Black Pride", cat: "Roster", kind: "Rumor", date: "2026-10-21T19:00:00Z",
    also: [{ src: "RaidersBeat", title: "Nelson trade idea" }] },
  { title: "Jeanty at good career scoring pace", desc: "Ashton Jeanty scored again", src: "Silver & Black Pride", cat: "Team", kind: "Opinion", date: "2026-10-20T13:00:00Z" },
];

test("esc escapes HTML", () => {
  assert.equal(L.esc(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(L.esc(null), "");
});

test("filterNews by topic, type, source (including also-covered) and words", () => {
  assert.equal(L.filterNews(news, { cat: "Injuries" }).length, 1);
  assert.equal(L.filterNews(news, { kind: "Rumor" }).length, 1);
  assert.equal(L.filterNews(news, { src: "RaidersBeat" }).length, 1);
  assert.equal(L.filterNews(news, { q: "jeanty scoring" }).length, 1);
  assert.equal(L.filterNews(news, { q: "jean" }).length, 1, "prefix match");
  assert.equal(L.filterNews(news, { q: "eanty" }).length, 0, "no mid-word match");
  assert.equal(L.filterNews(news, {}).length, 3);
});

test("search ranks players, games and stories", () => {
  const r = L.search("jeanty", {
    news, roster: [{ name: "Ashton Jeanty", pos: "RB", posName: "Running Back", college: "Boise State", jersey: "2" }],
    games: [{ week: 9, opp: { location: "San Francisco", name: "49ers", abbr: "SF" } }],
  });
  assert.equal(r.players.length, 1);
  assert.equal(r.stories.length, 1);
  assert.equal(r.games.length, 0);
  assert.equal(L.search("49ers", { games: [{ week: 9, opp: { location: "San Francisco", name: "49ers", abbr: "SF" } }] }).games.length, 1);
  assert.equal(L.search("  ", { news }).total, 0);
});

test("groupByDay labels Today and Yesterday in Pacific time", () => {
  const now = new Date("2026-10-22T03:00:00Z").getTime(); // Oct 21, 8 PM PT
  const g = L.groupByDay(news, now);
  assert.deepEqual(g.map(x => x.label), ["Today", "Yesterday"]);
  assert.equal(g[0].items.length, 2);
});

test("ago formats relative times", () => {
  const now = new Date("2026-10-22T12:00:00Z").getTime();
  assert.equal(L.ago("2026-10-22T11:59:30Z", now), "just now");
  assert.equal(L.ago("2026-10-22T11:30:00Z", now), "30 min ago");
  assert.equal(L.ago("2026-10-22T09:00:00Z", now), "3 hr ago");
  assert.equal(L.ago("2026-10-20T12:00:00Z", now), "2 days ago");
});

test("isStale after the threshold or when missing", () => {
  const now = new Date("2026-10-22T12:00:00Z").getTime();
  assert.equal(L.isStale("2026-10-22T10:00:00Z", 3, now), false);
  assert.equal(L.isStale("2026-10-22T08:00:00Z", 3, now), true);
  assert.equal(L.isStale(null, 3, now), true);
});

test("injury and game helpers", () => {
  assert.equal(L.injuryClass("Injured Reserve"), "out");
  assert.equal(L.injuryClass("Questionable"), "q");
  assert.equal(L.injuryLabel("Injured Reserve"), "IR");
  assert.equal(L.lastName("Mike Washington Jr."), "Washington");
  assert.equal(L.gameLabel({ home: false, opp: { name: "Jets" } }), "at Jets");
  assert.equal(L.resultText({ win: true, score: { us: 27, them: 13 } }), "W 27-13");
  assert.equal(L.recordText([5, 1, 0]), "5-1");
  assert.equal(L.recordText([5, 1, 1]), "5-1-1");
  assert.equal(L.statValue({ label: "3rd-down conversion %", value: "42.31" }), "42.3%");
  assert.equal(L.statValue({ label: "Points per game", value: "27.0" }), "27.0");
});

test("url lets only http(s) links through", () => {
  assert.equal(L.url("https://www.raiders.com/a?b=1&c=2"), "https://www.raiders.com/a?b=1&amp;c=2");
  assert.equal(L.url("javascript:alert(1)"), "#");
  assert.equal(L.url("JaVaScRiPt:alert(1)"), "#");
  assert.equal(L.url(null), "#");
});

test("rewind grades the last four games against the NFL average and the opponents", () => {
  const box = (to, pen, third) => [{ key: "turnovers", us: String(to[0]), them: String(to[1]) },
    { key: "totalPenaltiesYards", us: `5-${pen[0]}`, them: `6-${pen[1]}` }, { key: "thirdDownEff", us: third[0], them: third[1] }];
  const g = (id, week, us, them, b) => ({ id, week, home: true, opp: { abbr: "X" }, score: { us, them }, win: us > them, tie: us === them,
    lines: { us: [us, 0, 0, 0], them: [0, them, 0, 0] }, box: b });
  const games = { games: {
    a: g("a", 1, 30, 10, box([0, 3], [40, 40], ["5-10", "2-10"])),
    b: g("b", 2, 10, 20, box([2, 0], [30, 60], ["2-10", "5-10"])), c: g("c", 3, 10, 20, box([1, 0], [30, 50], ["3-10", "5-10"])),
    d: g("d", 4, 10, 20, box([1, 1], [50, 50], ["4-10", "4-10"])), e: g("e", 5, 10, 20, box([1, 0], [50, 50], ["3-10", "5-10"])),
  } };
  const u = (pe, re) => ({ pass: { plays: 10, epa: pe }, rush: { plays: 10, epa: re } });
  const breakdown = { games: Object.fromEntries(["a", "b", "c", "d", "e"].map(k => [k, { offense: u(0.2, -0.1), defense: u(k === "a" ? -0.2 : 0.3, -0.1) }])) };
  const advanced = { metrics: [["off", "pass", 0.08], ["off", "rush", -0.1], ["def", "pass", 0.08], ["def", "rush", -0.1]].map(([side, key, nfl]) => ({ side, key, nfl })) };
  const r = L.rewind({ games, breakdown, advanced });
  assert.equal(r.n, 4);
  assert.deepEqual(r.weeks, [2, 5]);
  assert.equal(r.record, "0-4");
  assert.equal(r.lastId, "e");
  const by = Object.fromEntries(r.subjects.map(s => [s.key, s]));
  assert.equal(by["offense:pass"].grade, "A"); // +0.12 over average
  assert.equal(by["offense:rush"].grade, "C");
  assert.equal(by["defense:pass"].grade, "F"); // 0.22 worse than average
  assert.equal(by["defense:pass"].before, -0.2);
  assert.equal(by["turnovers"].v, -1);
  assert.equal(by["turnovers"].grade, "F");
  assert.equal(by["penalties"].v, 12.5); // 12.5 fewer penalty yards a game than opponents
  assert.equal(by["penalties"].grade, "B");
  assert.equal(by["third"].grade, "F"); // 12 of 40 vs 19 of 40
  assert.deepEqual(r.quarters, { us: [40, 0, 0, 0], them: [0, 80, 0, 0] });
  assert.equal(r.worst[0].key, "defense:pass");
  assert.equal(L.gpaGrade(r.gpa), "C");
  assert.equal(L.rewind({ games: { games: { a: games.games.a } } }), null, "needs two games");
});
