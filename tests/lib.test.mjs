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
