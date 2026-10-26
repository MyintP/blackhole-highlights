// Advanced stats from nflverse play-by-play (CC-BY 4.0, https://github.com/nflverse/nflverse-data).
// Pure functions, unit-tested: parseCSV turns the release CSV into rows, advanced() ranks all 32 teams.
// Plays counted: regular season, pass or rush, EPA present (the usual nflverse/rbsdm filter).

// RFC 4180 CSV: quoted fields may hold commas, doubled quotes and newlines. Rows with the wrong field count are
// dropped. `columns` (a Set) keeps only those fields: play-by-play has 372 columns and ~50k rows by season's end,
// and each row becomes an object as soon as it's read, so only the kept fields stay in memory.
export function parseCSV(text, columns = null) {
  const out = [];
  let head = null, keep = null, row = [], f = "", q = false;
  const end = () => {
    row.push(f); f = "";
    if (!head) { head = row; keep = head.map((h, i) => [h, i]).filter(([h]) => !columns || columns.has(h)); }
    else if (row.length === head.length) { const o = {}; for (const [h, i] of keep) o[h] = row[i]; out.push(o); }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      end();
    } else f += c;
  }
  if (f || row.length) end();
  return out;
}

// Every play-by-play field the functions below read.
export const PBP_COLUMNS = new Set([
  "game_id", "play_id", "season_type", "week", "home_team", "away_team", "posteam", "defteam", "qtr", "time", "down", "desc",
  "pass", "rush", "qb_dropback", "pass_attempt", "sack", "qb_hit", "no_huddle", "air_yards", "yards_gained", "first_down", "touchdown",
  "epa", "success", "wpa", "qb_epa", "cpoe", "passer_player_name", "passer_player_id",
  "sp", "td_team", "safety", "total_home_score", "total_away_score",
  "extra_point_attempt", "extra_point_result", "two_point_attempt", "two_point_conv_result",
  "field_goal_attempt", "field_goal_result", "kick_distance", "kicker_player_name",
  "fixed_drive", "fixed_drive_result", "drive_quarter_start", "drive_start_yard_line", "drive_play_count", "drive_time_of_possession",
]);

const num = v => (v === "" || v === "NA" || v == null ? null : Number(v));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const r3 = v => (v == null ? null : Math.round(v * 1000) / 1000);

// Rank 1 = best. Ties share the better rank.
function rankOf(values, team, higherIsBetter) {
  const v = values[team];
  if (v == null) return null;
  return 1 + Object.values(values).filter(x => x != null && (higherIsBetter ? x > v : x < v)).length;
}

const METRICS = [
  // key, label, side, filter, value, higher is better
  ["epa", "EPA per play", "off", () => true, p => p.epa, true],
  ["sr", "Success rate", "off", () => true, p => p.success, true],
  ["pass", "EPA per dropback", "off", p => p.pass, p => p.epa, true],
  ["rush", "EPA per rush", "off", p => p.rush, p => p.epa, true],
  ["epa", "EPA per play allowed", "def", () => true, p => p.epa, false],
  ["sr", "Success rate allowed", "def", () => true, p => p.success, false],
  ["pass", "EPA per dropback allowed", "def", p => p.pass, p => p.epa, false],
  ["rush", "EPA per rush allowed", "def", p => p.rush, p => p.epa, false],
];

export function advanced(rows, team = "LV", { minDropbacks = 100 } = {}) {
  const plays = rows.filter(r => r.season_type === "REG" && (r.pass === "1" || r.rush === "1") && num(r.epa) != null && r.posteam && r.defteam)
    .map(r => ({
      off: r.posteam, def: r.defteam, week: num(r.week), epa: num(r.epa), success: num(r.success) ?? 0,
      pass: r.pass === "1", rush: r.rush === "1", dropback: r.qb_dropback === "1",
      qb: r.passer_player_name || null, qbId: r.passer_player_id || null, qbEpa: num(r.qb_epa), cpoe: num(r.cpoe),
    }));
  if (!plays.length) return null;
  const teams = [...new Set(plays.map(p => p.off))];
  const metrics = METRICS.map(([key, label, side, keep, val, higher]) => {
    const per = {};
    for (const t of teams) per[t] = mean(plays.filter(p => p[side] === t && keep(p)).map(val));
    return {
      key, label, side, higher,
      v: r3(per[team]), rank: rankOf(per, team, higher),
      nfl: r3(mean(plays.filter(keep).map(val))),
    };
  });

  // Quarterbacks: EPA per dropback and CPOE, ranked among passers with enough dropbacks.
  const byQb = {};
  for (const p of plays) {
    if (!p.dropback || !p.qbId) continue;
    const q = (byQb[p.qbId] ||= { name: p.qb, team: p.off, epa: [], cpoe: [] });
    q.team = p.off;
    if (p.qbEpa != null) q.epa.push(p.qbEpa);
    if (p.cpoe != null) q.cpoe.push(p.cpoe);
  }
  const qbs = Object.values(byQb).map(q => ({ name: q.name, team: q.team, dropbacks: q.epa.length, epa: mean(q.epa), cpoe: mean(q.cpoe) }));
  const qualified = qbs.filter(q => q.dropbacks >= minDropbacks);
  const rank = (q, k) => (q.dropbacks >= minDropbacks && q[k] != null ? 1 + qualified.filter(x => x[k] != null && x[k] > q[k]).length : null);
  const passers = qbs.filter(q => q.team === team && q.dropbacks >= 20).sort((a, b) => b.dropbacks - a.dropbacks)
    .map(q => ({ name: q.name, dropbacks: q.dropbacks, epa: r3(q.epa), epaRank: rank(q, "epa"), cpoe: q.cpoe == null ? null : Math.round(q.cpoe * 10) / 10, cpoeRank: rank(q, "cpoe") }));

  return {
    throughWeek: Math.max(...plays.map(p => p.week).filter(w => w != null)),
    teams: teams.length, qualifiedQbs: qualified.length, minDropbacks,
    metrics, passers,
  };
}

// ---------- scheme tendencies (pbp + FTN charting) ----------
// FTN charting (via nflverse) has no coverage shells (Cover 2, Cover 3...), and no free 2026 source does, so the
// defensive side shows what is charted: blitzers, pass rushers and box count, plus sacks and QB hits from pbp.
const yes = v => v === "TRUE" || v === "1";
const TENDENCIES = [
  // key, label, side, plays kept, value (true/false or a count), format
  ["passRate", "Pass rate", "off", () => true, p => p.pass, "pct"],
  ["earlyPass", "Early-down pass rate", "off", p => p.down === 1 || p.down === 2, p => p.pass, "pct"],
  ["shotgun", "Shotgun or pistol", "off", p => p.f, p => p.f.qb === "S" || p.f.qb === "P", "pct"],
  ["motion", "Motion at the snap", "off", p => p.f, p => p.f.motion, "pct"],
  ["playAction", "Play action (of dropbacks)", "off", p => p.f && p.dropback, p => p.f.pa, "pct"],
  ["screen", "Screens (of passes)", "off", p => p.f && p.pass, p => p.f.screen, "pct"],
  ["rpo", "RPOs", "off", p => p.f, p => p.f.rpo, "pct"],
  ["noHuddle", "No huddle", "off", () => true, p => p.noHuddle, "pct"],
  ["adot", "Average depth of target (yds)", "off", p => p.airYards != null, p => p.airYards, "num"],
  ["blitz", "Blitz rate (of dropbacks)", "def", p => p.f && p.dropback, p => p.f.blitzers > 0, "pct"],
  ["rushers", "Pass rushers per dropback", "def", p => p.f && p.dropback && p.f.rushers > 0, p => p.f.rushers, "num"],
  ["box8", "8+ in the box (of runs)", "def", p => p.f && p.rush && p.f.box > 0, p => p.f.box >= 8, "pct"],
  ["box", "Defenders in the box", "def", p => p.f && p.f.box > 0, p => p.f.box, "num"],
  ["sackRate", "Sack rate", "def", p => p.dropback, p => p.sack, "pct"],
  ["hitRate", "QB hit rate", "def", p => p.dropback, p => p.qbHit, "pct"],
];

export function tendencies(pbpRows, ftnRows, team = "LV") {
  const ftn = new Map(ftnRows.map(r => [`${r.nflverse_game_id}:${r.nflverse_play_id}`, {
    qb: r.qb_location, motion: yes(r.is_motion), pa: yes(r.is_play_action), screen: yes(r.is_screen_pass), rpo: yes(r.is_rpo),
    blitzers: num(r.n_blitzers) ?? 0, rushers: num(r.n_pass_rushers) ?? 0, box: num(r.n_defense_box) ?? 0,
  }]));
  const plays = pbpRows.filter(r => r.season_type === "REG" && (r.pass === "1" || r.rush === "1") && r.posteam && r.defteam)
    .map(r => ({
      off: r.posteam, def: r.defteam, down: num(r.down), pass: r.pass === "1", rush: r.rush === "1", dropback: r.qb_dropback === "1",
      noHuddle: r.no_huddle === "1", sack: r.sack === "1", qbHit: r.qb_hit === "1",
      airYards: r.pass_attempt === "1" && r.sack !== "1" ? num(r.air_yards) : null,
      f: ftn.get(`${r.game_id}:${r.play_id}`) || null,
    }));
  if (!plays.length) return null;
  const teams = [...new Set(plays.map(p => p.off))];
  return {
    charted: r3(plays.filter(p => p.f).length / plays.length),
    rows: TENDENCIES.map(([key, label, side, keep, val, fmt]) => {
      const per = {};
      for (const t of teams) per[t] = mean(plays.filter(p => p[side] === t && keep(p)).map(p => Number(val(p))));
      // Rank 1 = does it most. Tendencies aren't good or bad on their own.
      return { key, label, side, fmt, v: r3(per[team]), rank: rankOf(per, team, true), nfl: r3(mean(plays.filter(keep).map(p => Number(val(p))))) };
    }),
  };
}

// ---------- players: season stats, snaps and charting for everyone who has played for the team ----------
export const slug = name => String(name).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const nameParts = name => { const p = slug(name).split("-"); return { last: p[p.length - 1], first: p[0] || "" }; };

// Profile stat groups: [stats_player field, label, 1 = rank league-wide (more is better)]
export const PLAYER_STATS = {
  Passing: [["attempts", "Att"], ["completions", "Cmp"], ["passing_yards", "Yds", 1], ["passing_tds", "TD", 1], ["passing_interceptions", "INT"],
    ["sacks_suffered", "Sacked"], ["passing_first_downs", "1st downs", 1], ["passing_epa", "EPA", 1], ["passing_cpoe", "CPOE"]],
  Rushing: [["carries", "Att"], ["rushing_yards", "Yds", 1], ["rushing_tds", "TD", 1], ["rushing_first_downs", "1st downs", 1],
    ["rushing_fumbles_lost", "Fum lost"], ["rushing_epa", "EPA", 1]],
  Receiving: [["targets", "Tgt", 1], ["receptions", "Rec", 1], ["receiving_yards", "Yds", 1], ["receiving_tds", "TD", 1],
    ["receiving_yards_after_catch", "YAC", 1], ["receiving_first_downs", "1st downs", 1], ["target_share", "Tgt share"], ["receiving_epa", "EPA", 1]],
  Defense: [["def_tackles_solo", "Solo tkl", 1], ["def_tackle_assists", "Ast tkl"], ["def_tackles_for_loss", "TFL", 1], ["def_sacks", "Sacks", 1],
    ["def_qb_hits", "QB hits", 1], ["def_interceptions", "INT", 1], ["def_interception_yards", "INT yds"], ["def_pass_defended", "PD", 1],
    ["def_fumbles_forced", "FF", 1], ["fumble_recovery_opp", "Fum rec", 1], ["fumble_recovery_yards_opp", "Fum ret yds"], ["def_tds", "TD", 1], ["def_safeties", "Safety", 1]],
  Returns: [["kickoff_returns", "KR"], ["kickoff_return_yards", "KR yds", 1], ["punt_returns", "PR"], ["punt_return_yards", "PR yds", 1], ["special_teams_tds", "TD", 1]],
  Kicking: [["fg_made", "FG", 1], ["fg_att", "FGA"], ["fg_pct", "FG %"], ["fg_long", "Long", 1], ["fg_made_50_59", "50-59", 1], ["pat_made", "XP"], ["pat_att", "XPA"]],
  Punting: [["pt_att", "Punts"], ["pt_yards", "Yds"], ["pt_net_yards", "Net yds"], ["pt_long", "Long"], ["pt_inside_20", "Inside 20", 1], ["pt_touchback", "TB"]],
  Discipline: [["penalties", "Penalties"], ["penalty_yards", "Pen yds"], ["fumbles_total", "Fumbles"], ["fumbles_lost_total", "Fum lost"]],
};
// Rate fields don't make a group worth showing on their own (a 0.0 CPOE is still "no passing").
const RATE_FIELDS = new Set(["fg_pct", "target_share", "passing_cpoe", "passing_epa", "rushing_epa", "receiving_epa"]);

const sum = (rows, k) => rows.reduce((s, r) => s + (num(r[k]) || 0), 0);
const r1 = v => Math.round(v * 10) / 10;
// NFL passer rating from raw counts (used for "rating allowed" in coverage).
export function passerRating(att, cmp, yds, td, int) {
  if (!att) return null;
  const c = x => Math.max(0, Math.min(2.375, x));
  return r1((c((cmp / att - 0.3) * 5) + c((yds / att - 3) * 0.25) + c(td / att * 20) + c(2.375 - int / att * 25)) / 6 * 100);
}

export function players({ statsReg, pfrDef = [], pfrRec = [], pfrRush = [], pfrPass = [], snaps = [] }, team = "LV") {
  const reg = statsReg.filter(r => r.season_type === "REG");
  // League rank for each "more is better" stat, among all players with a non-zero value.
  const rankers = {};
  for (const fields of Object.values(PLAYER_STATS)) for (const [k, , ranked] of fields) {
    if (!ranked) continue;
    const vals = reg.map(r => num(r[k])).filter(v => v != null && v > 0);
    // rank, plus how many players share it ("T-6th" when more than one)
    rankers[k] = v => (v > 0 ? { rank: 1 + vals.filter(x => x > v).length, tied: vals.filter(x => x === v).length } : null);
  }
  const out = new Map();
  for (const r of reg.filter(r => r.recent_team === team)) {
    const stats = {};
    for (const [group, fields] of Object.entries(PLAYER_STATS)) {
      const row = fields.map(([k, label]) => {
        const rk = rankers[k]?.(num(r[k]));
        return { k, label, v: r3(num(r[k])), rank: rk?.rank ?? null, ...(rk?.tied > 1 ? { tied: rk.tied } : {}) };
      }).filter(x => x.v != null);
      if (row.some(x => x.v !== 0 && !RATE_FIELDS.has(x.k))) stats[group] = row;
    }
    const id = slug(r.player_display_name);
    out.set(id, { id, name: r.player_display_name, pos: r.position, group: r.position_group, games: num(r.games), stats });
  }

  // PFR-sourced files (snaps, charting) spell some names differently ("Delmar Glaze" for DJ Glaze):
  // match on the full name, else on last name + first initial when that's unique.
  const find = name => {
    const s = slug(name);
    if (out.has(s)) return out.get(s);
    const { last, first } = nameParts(name);
    const c = [...out.values()].filter(p => { const n = nameParts(p.name); return n.last === last && n.first[0] === first[0]; });
    return c.length === 1 ? c[0] : null;
  };
  const byPlayer = (rows, fn) => {
    const g = {};
    for (const r of rows) if (r.team === team && (r.game_type || "REG") === "REG") (g[r.pfr_player_id] ||= []).push(r);
    for (const rs of Object.values(g)) {
      const name = rs[0].pfr_player_name || rs[0].player;
      let p = find(name);
      if (!p) { // on the field without a box-score stat yet (most linemen)
        p = { id: slug(name), name, pos: rs[0].position || null, group: null, games: null, stats: {} };
        out.set(p.id, p);
      }
      fn(p, rs);
    }
  };

  byPlayer(snaps, (p, rs) => {
    const played = rs.filter(r => (num(r.offense_snaps) || 0) + (num(r.defense_snaps) || 0) + (num(r.st_snaps) || 0) > 0);
    const avg = k => r3(mean(played.map(r => num(r[k]) || 0)));
    p.snaps = { games: played.length, off: sum(rs, "offense_snaps"), def: sum(rs, "defense_snaps"), st: sum(rs, "st_snaps"), offPct: avg("offense_pct"), defPct: avg("defense_pct"), stPct: avg("st_pct") };
    p.pos ||= rs[0].position;
    p.games ??= played.length;
  });
  byPlayer(pfrDef, (p, rs) => {
    const tgt = sum(rs, "def_targets"), cmp = sum(rs, "def_completions_allowed"), yds = sum(rs, "def_yards_allowed");
    const td = sum(rs, "def_receiving_td_allowed"), int = sum(rs, "def_ints"), tk = sum(rs, "def_tackles_combined"), miss = sum(rs, "def_missed_tackles");
    if (tgt) p.coverage = { targets: tgt, completions: cmp, yards: yds, td, int, cmpPct: r3(cmp / tgt), ydsPerTgt: r1(yds / tgt), rating: passerRating(tgt, cmp, yds, td, int) };
    const rush = { blitzes: sum(rs, "def_times_blitzed"), pressures: sum(rs, "def_pressures"), hurries: sum(rs, "def_times_hurried"), hits: sum(rs, "def_times_hitqb"), sacks: sum(rs, "def_sacks") };
    if (Object.values(rush).some(Boolean)) p.passRush = rush;
    if (tk + miss) p.tackling = { tackles: tk, missed: miss, missedPct: r3(miss / (tk + miss)) };
  });
  byPlayer(pfrRush, (p, rs) => {
    const att = sum(rs, "carries"), ybc = sum(rs, "rushing_yards_before_contact"), yac = sum(rs, "rushing_yards_after_contact");
    if (att) p.contact = { carries: att, ybc, yac, ybcPer: r1(ybc / att), yacPer: r1(yac / att), broken: sum(rs, "rushing_broken_tackles") };
  });
  byPlayer(pfrRec, (p, rs) => {
    const broken = sum(rs, "receiving_broken_tackles"), drops = sum(rs, "receiving_drop");
    if (broken || drops) p.catching = { broken, drops };
  });
  byPlayer(pfrPass, (p, rs) => {
    p.pocket = { badThrows: sum(rs, "passing_bad_throws"), drops: sum(rs, "passing_drops"), pressured: sum(rs, "times_pressured"), blitzed: sum(rs, "times_blitzed"), hurried: sum(rs, "times_hurried"), hit: sum(rs, "times_hit"), sacked: sum(rs, "times_sacked") };
  });

  const order = ["QB", "RB", "FB", "WR", "TE", "T", "OT", "G", "C", "OL", "DE", "DT", "DL", "LB", "OLB", "ILB", "CB", "S", "SAF", "DB", "K", "P", "LS"];
  const snapsOf = p => (p.snaps?.off ?? 0) + (p.snaps?.def ?? 0);
  return [...out.values()].sort((a, b) => ((order.indexOf(a.pos) + 1 || 99) - (order.indexOf(b.pos) + 1 || 99)) || snapsOf(b) - snapsOf(a) || a.name.localeCompare(b.name));
}

// ---------- per game: scoring plays, biggest win-probability swings, drives, kicks, unit efficiency ----------
const clip = (s, n = 240) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s || "");
export function gameBreakdowns(pbpRows, team = "LV") {
  const games = {};
  for (const r of pbpRows) if (r.season_type === "REG" && (r.home_team === team || r.away_team === team)) (games[r.game_id] ||= []).push(r);
  const out = {};
  for (const [gid, rows] of Object.entries(games)) {
    const home = rows[0].home_team === team;
    // wpa and wp are from the offense's point of view; flip them to the Raiders'
    const ourWpa = r => { const w = num(r.wpa); return w == null || !r.posteam ? null : r.posteam === team ? w : -w; };
    const score = r => {
      const h = num(r.total_home_score), a = num(r.total_away_score);
      return h == null || a == null ? null : { us: home ? h : a, them: home ? a : h };
    };
    // Extra points and two-point tries fold into the touchdown they follow.
    const scoring = [];
    for (const r of rows.filter(r => r.sp === "1" || r.extra_point_attempt === "1" || r.two_point_attempt === "1")) {
      const prev = scoring[scoring.length - 1];
      if ((r.extra_point_attempt === "1" || r.two_point_attempt === "1") && prev) {
        prev.score = score(r) || prev.score;
        prev.pat = r.extra_point_attempt === "1" ? (r.extra_point_result === "good" ? "XP good" : "XP missed")
          : r.two_point_conv_result === "success" ? "2-pt good" : "2-pt failed";
        continue;
      }
      if (r.sp !== "1") continue;
      scoring.push({ qtr: num(r.qtr), time: r.time, team: r.td_team || (r.safety === "1" ? r.defteam : r.posteam), desc: clip(r.desc), score: score(r) });
    }
    const swings = rows.filter(r => ourWpa(r) != null && r.desc).sort((a, b) => Math.abs(ourWpa(b)) - Math.abs(ourWpa(a))).slice(0, 5)
      .map(r => ({ qtr: num(r.qtr), time: r.time, wpa: r3(ourWpa(r)), desc: clip(r.desc) }));
    const drives = [];
    for (const r of rows) {
      const d = num(r.fixed_drive);
      if (d == null || !r.posteam || drives.some(x => x.n === d)) continue;
      drives.push({ n: d, team: r.posteam, qtr: num(r.drive_quarter_start), start: r.drive_start_yard_line || null, plays: num(r.drive_play_count),
        top: r.drive_time_of_possession || null, result: r.fixed_drive_result || null });
    }
    const unit = side => {
      const p = rows.filter(r => (r.pass === "1" || r.rush === "1") && num(r.epa) != null && (side === "off" ? r.posteam === team : r.defteam === team));
      const third = p.filter(r => num(r.down) === 3);
      // Pass and run splits, defined as in advanced(), for the home page's Rewind report card
      const split = k => { const s = p.filter(r => r[k] === "1"); return { plays: s.length, epa: r3(mean(s.map(r => num(r.epa)))) }; };
      return {
        plays: p.length, epa: r3(mean(p.map(r => num(r.epa)))), sr: r3(mean(p.map(r => num(r.success) || 0))),
        pass: split("pass"), rush: split("rush"),
        explosive: p.filter(r => (r.pass === "1" && num(r.yards_gained) >= 20) || (r.rush === "1" && num(r.yards_gained) >= 10)).length,
        third: [third.filter(r => r.first_down === "1" || r.touchdown === "1").length, third.length],
      };
    };
    const kicks = rows.filter(r => r.field_goal_attempt === "1" && r.posteam === team).map(r => ({ kicker: r.kicker_player_name, dist: num(r.kick_distance), result: r.field_goal_result }));
    out[gid] = { week: num(rows[0].week), home, offense: unit("off"), defense: unit("def"), scoring, swings, drives, kicks };
  }
  return out;
}
