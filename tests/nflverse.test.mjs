import { test } from "node:test";
import assert from "node:assert/strict";
import * as NV from "../scripts/lib/nflverse.mjs";
import * as P from "../scripts/lib/parse.mjs";
import * as L from "../assets/js/lib.js";

const csv = rows => [Object.keys(rows[0]).join(","), ...rows.map(r => Object.values(r).map(v => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(","))].join("\n") + "\n";

test("parseCSV handles quotes, commas, doubled quotes, newlines and CRLF", () => {
  const rows = NV.parseCSV('a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"two\nlines",\r\n3,short\r\n');
  assert.equal(rows.length, 2); // the short row is dropped
  assert.deepEqual(rows[0], { a: "1", b: "x, y", c: 'say "hi"' });
  assert.equal(rows[1].b, "two\nlines");
  assert.equal(rows[1].c, "");
  assert.deepEqual(NV.parseCSV('a,b,c\n1,"x\ny",3\n', new Set(["a", "c"])), [{ a: "1", c: "3" }]); // keeps only chosen columns
});

const play = (o = {}) => ({
  season_type: "REG", game_id: "2026_01_MIA_LV", play_id: "1", week: "1", posteam: "LV", defteam: "MIA", home_team: "LV", away_team: "MIA",
  pass: "1", rush: "0", qb_dropback: "1", pass_attempt: "1", sack: "0", qb_hit: "0", no_huddle: "0", down: "1", air_yards: "8",
  epa: "0.5", success: "1", passer_player_name: "K.Cousins", passer_player_id: "QB1", qb_epa: "0.5", cpoe: "5", ...o,
});

test("advanced ranks offense high-is-good and defense low-is-good", () => {
  const rows = [
    play({ epa: "0.4" }), play({ posteam: "MIA", defteam: "LV", epa: "-0.2", success: "0", passer_player_id: "QB2" }),
    play({ posteam: "KC", defteam: "DEN", epa: "0.9", passer_player_id: "QB3" }), play({ posteam: "DEN", defteam: "KC", epa: "0.1", passer_player_id: "QB4" }),
    play({ season_type: "POST", epa: "9" }), play({ epa: "NA" }),
  ];
  const a = NV.advanced(rows, "LV", { minDropbacks: 1 });
  const off = a.metrics.find(m => m.label === "EPA per play"), def = a.metrics.find(m => m.label === "EPA per play allowed");
  assert.equal(off.v, 0.4);
  assert.equal(off.rank, 2); // KC 0.9 is better
  assert.equal(def.v, -0.2);
  assert.equal(def.rank, 1); // allowed the least
  assert.equal(a.passers.length, 0); // only passers with 20+ dropbacks are listed
  const many = NV.advanced(Array.from({ length: 25 }, () => play()), "LV", { minDropbacks: 1 });
  assert.equal(many.passers[0].name, "K.Cousins");
  assert.equal(many.passers[0].epaRank, 1);
});

test("tendencies join FTN charting by game and play id", () => {
  const pbp = [play({ play_id: "1" }), play({ play_id: "2", pass: "0", rush: "1", qb_dropback: "0", pass_attempt: "0" }), play({ posteam: "KC", defteam: "LV", play_id: "3" })];
  const ftn = [
    { nflverse_game_id: "2026_01_MIA_LV", nflverse_play_id: "1", qb_location: "S", is_motion: "TRUE", is_play_action: "TRUE", is_screen_pass: "FALSE", is_rpo: "FALSE", n_blitzers: "0", n_pass_rushers: "4", n_defense_box: "6" },
    { nflverse_game_id: "2026_01_MIA_LV", nflverse_play_id: "2", qb_location: "U", is_motion: "FALSE", is_play_action: "FALSE", is_screen_pass: "FALSE", is_rpo: "FALSE", n_blitzers: "0", n_pass_rushers: "0", n_defense_box: "8" },
    { nflverse_game_id: "2026_01_MIA_LV", nflverse_play_id: "3", qb_location: "S", is_motion: "FALSE", is_play_action: "FALSE", is_screen_pass: "FALSE", is_rpo: "FALSE", n_blitzers: "2", n_pass_rushers: "6", n_defense_box: "7" },
  ];
  const t = NV.tendencies(pbp, ftn, "LV");
  const r = k => t.rows.find(x => x.key === k);
  assert.equal(r("passRate").v, 0.5);
  assert.equal(r("shotgun").v, 0.5);
  assert.equal(r("playAction").v, 1);
  assert.equal(r("blitz").v, 1); // LV on defense blitzed on its only charted dropback
  assert.equal(r("rushers").v, 6);
  assert.equal(t.charted, 1);
});

test("players merges box score, snaps and charting, ranks league-wide, matches PFR name variants", () => {
  const base = { season_type: "REG", position_group: "DB", games: "6" };
  const statsReg = [
    { ...base, player_display_name: "Hezekiah Masses", position: "CB", recent_team: "LV", def_interceptions: "3", def_tackles_solo: "12" },
    { ...base, player_display_name: "Other Guy", position: "CB", recent_team: "KC", def_interceptions: "2", def_tackles_solo: "40" },
    { ...base, player_display_name: "DJ Glaze", position: "OT", position_group: "OL", recent_team: "LV", penalties: "1" },
  ];
  const snaps = [{ team: "LV", game_type: "REG", pfr_player_id: "GlazDe00", player: "Delmar Glaze", position: "T", offense_snaps: "68", offense_pct: "1", defense_snaps: "0", defense_pct: "0", st_snaps: "6", st_pct: "0.23" }];
  const pfrDef = [{ team: "LV", game_type: "REG", pfr_player_id: "MassHe00", pfr_player_name: "Hezekiah Masses", def_targets: "10", def_completions_allowed: "4", def_yards_allowed: "50", def_receiving_td_allowed: "0", def_ints: "3", def_tackles_combined: "18", def_missed_tackles: "2", def_pressures: "0", def_times_blitzed: "0", def_times_hurried: "0", def_times_hitqb: "0", def_sacks: "0" }];
  const list = NV.players({ statsReg, snaps, pfrDef }, "LV");
  assert.equal(list.length, 2); // KC player excluded; Delmar Glaze merged into DJ Glaze
  const m = list.find(p => p.id === "hezekiah-masses");
  assert.equal(m.stats.Defense.find(s => s.k === "def_interceptions").rank, 1);
  assert.equal(m.stats.Defense.find(s => s.k === "def_tackles_solo").rank, 2);
  assert.equal(m.coverage.cmpPct, 0.4);
  assert.equal(m.tackling.missedPct, 0.1);
  assert.equal(m.passRush, undefined);
  const g = list.find(p => p.id === "dj-glaze");
  assert.equal(g.snaps.off, 68);
});

test("passerRating matches the NFL formula", () => {
  assert.equal(NV.passerRating(10, 4, 50, 0, 3), 16.7); // (0.5 + 0.5 + 0 + 0) / 6 * 100
  assert.equal(NV.passerRating(20, 20, 400, 5, 0), 158.3); // capped at perfect
  assert.equal(NV.passerRating(0, 0, 0, 0, 0), null);
});

test("gameBreakdowns folds extra points into touchdowns and flips win probability to the Raiders", () => {
  const g = { game_id: "2026_01_MIA_LV", season_type: "REG", week: "1", home_team: "LV", away_team: "MIA", qtr: "1", time: "05:00" };
  const rows = NV.parseCSV(csv([
    { ...g, play_id: "1", posteam: "LV", defteam: "MIA", sp: "1", td_team: "LV", desc: "TD pass", total_home_score: "6", total_away_score: "0", wpa: "0.10", pass: "1", rush: "0", epa: "3", success: "1", down: "3", first_down: "0", touchdown: "1", yards_gained: "25", extra_point_attempt: "0", two_point_attempt: "0", field_goal_attempt: "0", fixed_drive: "1", drive_play_count: "5", fixed_drive_result: "Touchdown" },
    { ...g, play_id: "2", posteam: "LV", defteam: "MIA", sp: "1", td_team: "", desc: "XP good", total_home_score: "7", total_away_score: "0", wpa: "0.01", pass: "0", rush: "0", epa: "0.1", success: "0", down: "", first_down: "0", touchdown: "0", yards_gained: "0", extra_point_attempt: "1", extra_point_result: "good", two_point_attempt: "0", field_goal_attempt: "0", fixed_drive: "1", drive_play_count: "5", fixed_drive_result: "Touchdown" },
    { ...g, play_id: "3", posteam: "MIA", defteam: "LV", sp: "0", td_team: "", desc: "INT thrown", total_home_score: "7", total_away_score: "0", wpa: "-0.20", pass: "1", rush: "0", epa: "-4", success: "0", down: "2", first_down: "0", touchdown: "0", yards_gained: "0", extra_point_attempt: "0", two_point_attempt: "0", field_goal_attempt: "0", fixed_drive: "2", drive_play_count: "3", fixed_drive_result: "Turnover" },
  ].map(r => ({ extra_point_result: "", ...r }))));
  const b = NV.gameBreakdowns(rows, "LV")["2026_01_MIA_LV"];
  assert.equal(b.scoring.length, 1);
  assert.deepEqual(b.scoring[0].score, { us: 7, them: 0 });
  assert.equal(b.scoring[0].pat, "XP good");
  assert.equal(b.swings[0].wpa, 0.2); // MIA's interception was +20% for the Raiders
  assert.equal(b.drives.length, 2);
  assert.deepEqual(b.offense.third, [1, 1]);
  assert.equal(b.offense.explosive, 1);
});

test("nextWait chains around game time and leaves the rest to cron", () => {
  const kick = new Date("2026-10-25T20:25:00Z"), g = { date: kick.toISOString(), final: false };
  const at = h => new Date(kick.getTime() + h * 36e5);
  assert.equal(P.nextWait(g, at(-30)), null); // far out
  assert.equal(P.nextWait(g, at(-17)), 3600); // chain starts, hourly
  assert.equal(P.nextWait(g, at(-12.5)), 32 * 60); // lands just after the odds window opens
  assert.equal(P.nextWait(g, at(-6)), 3600);
  assert.equal(P.nextWait(g, at(-1.5)), 27 * 60); // last capture just before the window closes
  assert.equal(P.nextWait(g, at(1)), 600); // live scores
  assert.equal(P.nextWait(g, at(5)), null);
  assert.equal(P.nextWait({ ...g, timeTBD: true }, at(-6)), null);
  assert.equal(P.nextWait(null), null);
});

test("liveFrom reads score and clock from a game summary", () => {
  const s = { header: { competitions: [{ status: { type: { state: "in", shortDetail: "3rd 4:12" } }, competitors: [{ team: { id: "13" }, score: "17" }, { team: { id: "14" }, score: "10" }] }] } };
  assert.deepEqual(P.liveFrom(s), { state: "in", detail: "3rd 4:12", score: { us: 17, them: 10 } });
  s.header.competitions[0].status.type.state = "pre";
  assert.equal(P.liveFrom(s), null);
  assert.equal(P.liveFrom(null), null);
});

test("client helpers: live window, stale threshold, ordinals, slugs match the updater", () => {
  const kick = Date.parse("2026-10-25T20:25:00Z"), g = { date: new Date(kick).toISOString() };
  assert.equal(L.isLive(g, kick + 36e5), true);
  assert.equal(L.isLive(g, kick - 60e3), false);
  assert.equal(L.isLive({ ...g, state: "in" }, kick - 60e3), true);
  assert.equal(L.staleHours(g, kick - 6 * 36e5), 2);
  assert.equal(L.staleHours(g, kick - 48 * 36e5), 8);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(L.ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  for (const n of ["Mike Washington Jr.", "Jackson Powers-Johnson", "José Ramírez III", "William Fuller"]) assert.equal(L.slug(n), NV.slug(n));
  assert.equal(L.slug("William Fuller"), "william-fuller");
  assert.equal(L.epaText(-0.2431), "−0.243");
  assert.equal(L.pctText(0.4401), "44.0%");
});
