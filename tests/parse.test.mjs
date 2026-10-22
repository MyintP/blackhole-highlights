import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../scripts/lib/parse.mjs";

test("parseFeed reads RSS items with CDATA and entities", () => {
  const xml = `<rss><channel><title>News</title>
    <item><title><![CDATA[Raiders &amp; Rams: Week 7 Injury Report]]></title><link>https://www.raiders.com/news/a</link>
    <pubDate>Wed, 21 Oct 2026 23:36:41 GMT</pubDate><description><![CDATA[<p>Take a look</p>]]></description></item>
    <item><title>No link</title></item></channel></rss>`;
  const items = P.parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Raiders & Rams: Week 7 Injury Report");
  assert.equal(items[0].link, "https://www.raiders.com/news/a");
  assert.equal(items[0].desc, "Take a look");
});

test("parseFeed reads Atom entries with href links", () => {
  const xml = `<feed><entry><author><name>Bill</name></author><title type="html"><![CDATA[Hemingway is still out]]></title>
    <link rel="alternate" type="text/html" href="https://sbp.example/x" /><published>2026-10-21T19:33:07-04:00</published></entry></feed>`;
  const [i] = P.parseFeed(xml);
  assert.equal(i.title, "Hemingway is still out");
  assert.equal(i.link, "https://sbp.example/x");
  assert.equal(i.author, "Bill");
});

test("kindFor labels sources and flags rumors", () => {
  assert.equal(P.kindFor("Game Preview: Raiders vs Rams", "Raiders.com"), "Official");
  assert.equal(P.kindFor("Raiders lose close one", "ESPN"), "Reporting");
  assert.equal(P.kindFor("5 things about the Rams", "Silver & Black Pride"), "Opinion");
  assert.equal(P.kindFor("The Raiders should trade for Quenton Nelson", "Silver & Black Pride"), "Rumor");
  assert.equal(P.kindFor("Raiders reportedly interested in a pass rusher", "ESPN"), "Rumor");
});

test("categoryFor picks a topic and avoids partial-word matches", () => {
  assert.equal(P.categoryFor("Raiders-Rams Week 7 Injury Report"), "Injuries");
  assert.equal(P.categoryFor("Raiders sign veteran guard to practice squad"), "Roster");
  assert.equal(P.categoryFor("Game Preview: Raiders must slow another top offense"), "Games");
  assert.equal(P.categoryFor("Raiders' new design for the stadium"), "Team"); // "design" is not "sign"
  assert.equal(P.categoryFor("Film breakdown of the pass rush"), "Analysis");
});

test("mergeNews dedupes by link, groups similar stories and prefers the official source", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  const mk = (src, title, link, date) => P.toItem({ title, link, date }, src);
  const a = mk("Silver & Black Pride", "Raiders injury report: Tonka Hemingway still out with concussion", "https://sbp/1", "2026-10-21T20:00:00Z");
  const b = mk("Raiders.com", "Injury report: Tonka Hemingway still out with a concussion", "https://raiders/1", "2026-10-21T18:00:00Z");
  const c = mk("ESPN", "Bills suspend second player for spitting", "https://espn/1", "2026-10-21T10:00:00Z");
  const out = P.mergeNews([], [a, b, c, { ...a }], { now });
  assert.equal(out.length, 2);
  const hem = out.find(i => /Hemingway/.test(i.title));
  assert.equal(hem.src, "Raiders.com");
  assert.deepEqual(hem.also.map(x => x.src), ["Silver & Black Pride"]);
  // merging again with the archive keeps the result stable
  assert.deepEqual(P.mergeNews(out, [a, b, c], { now }).map(i => i.id), out.map(i => i.id));
});

test("mergeNews drops stories older than the archive window", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  const old = P.toItem({ title: "Old story about training camp", link: "https://x/old", date: "2026-01-01T00:00:00Z" }, "ESPN");
  assert.equal(P.mergeNews([], [old], { now, maxDays: 180 }).length, 0);
});

const event = (us, them, { completed = true, state = "post", week = 6, homeAway = "home", winner = false } = {}) => ({
  id: "1", date: "2026-10-18T20:25Z", week: { number: week },
  competitions: [{ status: { type: { completed, state } }, broadcasts: [{ media: { shortName: "CBS" } }], competitors: [
    { homeAway, team: { id: "13", shortDisplayName: "Raiders", location: "Las Vegas", abbreviation: "LV" }, score: { value: us }, winner },
    { homeAway: homeAway === "home" ? "away" : "home", team: { id: "2", shortDisplayName: "Bills", location: "Buffalo", abbreviation: "BUF" }, score: { value: them }, winner: !winner },
  ] }],
});

test("mapEvent maps a final game from the Raiders' side", () => {
  const g = P.mapEvent(event(30, 33));
  assert.deepEqual([g.home, g.opp.abbr, g.final, g.win, g.score.us, g.score.them, g.tv], [true, "BUF", true, false, 30, 33, "CBS"]);
});

test("seasonRecord counts wins, losses and points", () => {
  const r = P.seasonRecord([event(27, 13, { winner: true }), event(17, 45), event(0, 0, { completed: false, state: "pre" })]);
  assert.deepEqual([r.record, r.pf, r.pa], ["1-1", 44, 58]);
});

test("mapInjuries drops active players and orders by severity", () => {
  const list = P.mapInjuries([
    { status: "Questionable", athlete: { displayName: "A", position: { abbreviation: "TE" } }, details: { type: "Hamstring" } },
    { status: "Active", athlete: { displayName: "B" } },
    { status: "Injured Reserve", athlete: { displayName: "C", position: { abbreviation: "WR" } } },
  ]);
  assert.deepEqual(list.map(i => i.name), ["C", "A"]);
});

test("snapshot reads both sides of the line from the Raiders' perspective", () => {
  const summ = { pickcenter: [{ provider: { name: "Draft Kings" }, overUnder: 48.5,
    pointSpread: { home: { open: { line: "+7.5" }, close: { line: "+4.5", odds: "-115" } }, away: { open: { line: "-7.5" }, close: { line: "-4.5", odds: "-105" } } },
    moneyline: { home: { open: { odds: "+285" }, close: { odds: "+180" } }, away: { open: { odds: "-360" }, close: { odds: "-218" } } },
    total: { over: { open: { line: "o46.5" }, close: { line: "o48.5", odds: "-108" } }, under: { close: { line: "u48.5", odds: "-112" } } } }] };
  const s = P.snapshot(summ, { id: "9", week: 7, home: true, opp: { abbr: "LAR" } }, new Date("2026-10-25T10:00:00Z"));
  assert.equal(s.us.spread, "+4.5");
  assert.equal(s.them.ml, "-218");
  assert.equal(s.total.line, 48.5);
  assert.equal(s.total.open, 46.5);
  assert.equal(P.snapshot({}, { id: "9" }), null);
});

test("grade scores closing lines and adds them to the baseline", () => {
  const odds = { baseline: { throughWeek: 6, ats: [5, 1, 0], ou: [4, 2, 0] }, closing: {
    a: { week: 7, spread: "+4.5", total: 48.5 },  // lose by 3 -> cover; 24+27=51 -> over
    b: { week: 8, spread: "-3", total: 44 },      // win by 3 -> push; 20+17=37 -> under
    c: { week: 5, spread: "+1", total: 40 },      // before the baseline cut-off: ignored in totals
  } };
  const games = [
    { id: "a", final: true, score: { us: 24, them: 27 } },
    { id: "b", final: true, score: { us: 20, them: 17 } },
    { id: "c", final: true, score: { us: 10, them: 30 } },
  ];
  P.grade(odds, games);
  assert.deepEqual(odds.closing.a.result, { ats: "W", ou: "O" });
  assert.deepEqual(odds.closing.b.result, { ats: "P", ou: "U" });
  assert.deepEqual(odds.record, { ats: [6, 1, 1], ou: [5, 3, 0] });
});

test("mapStandings ranks points allowed with ties", () => {
  const entry = (id, w, l, pa) => ({ team: { id, location: id === "24" ? "Los Angeles" : "Town" + id, name: "T" + id, abbreviation: "T" }, stats: [
    { name: "wins", value: w }, { name: "losses", value: l }, { name: "ties", value: 0 }, { name: "pointsAgainst", value: pa }, { name: "winPercent", value: w / (w + l), displayValue: "x" }] });
  const rows = P.mapStandings({ children: [{ abbreviation: "AFC", standings: { entries: [entry("1", 3, 3, 120), entry("2", 3, 3, 120), entry("24", 0, 6, 60)] } }] });
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.equal(by["24"].paRank, "1st");
  assert.equal(by["1"].paRank, "T-2nd");
  assert.equal(by["24"].name, "LA T24");
});

test("ordinal and rankText", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 30].map(P.ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "30th"]);
  assert.equal(P.rankText("Tied-12th"), "T-12th");
});

test("toItem rejects non-web links from feeds", () => {
  const base = { title: "A real headline here", date: "2026-10-21T10:00:00Z" };
  assert.equal(P.toItem({ ...base, link: "javascript:alert(1)" }, "ESPN"), null);
  assert.equal(P.toItem({ ...base, link: "data:text/html,x" }, "ESPN"), null);
  assert.ok(P.toItem({ ...base, link: "https://www.espn.com/x" }, "ESPN"));
});

test("redact strips query strings (API keys) from error messages", async () => {
  const { redact } = await import("../scripts/lib/fetch.mjs");
  assert.equal(redact("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&key=SECRET"), "https://www.googleapis.com/youtube/v3/playlistItems?…");
});
