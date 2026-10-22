# Game-day runbook

How the site behaves around a game, what to check on the first real game day (Week 7, LAR at LV, Sunday 25 October 2026),
and how to recover when something goes wrong. None of the game-day path had run against a real game when this was written.
The checks below are how we find out.

## How game day works

| Phase | Window (Week 7) | What runs | Where it's decided |
|---|---|---|---|
| Normal | any time | Hourly cron at :07 (GitHub runs it every 3-6 h in practice) | `.github/workflows/update.yml` |
| Chain starts | from kickoff -18 h (02:25 UTC Sun) | The first run in the window dispatches its own next run | `nextWait` in `scripts/lib/parse.mjs` |
| Before the odds window | until kickoff -12 h | Hourly, landing 2 min after the window opens | `nextWait` |
| Odds window | kickoff -12 h to -1 h (08:25 to 19:25 UTC) | Hourly snapshot; the last run is aimed about 7 min before the close | `nextWait`, odds block in `scripts/update.mjs` |
| Game | from the close until kickoff +4.5 h (00:55 UTC Mon) | Every 10 min: live score and clock from the ESPN summary | `nextWait`, `liveFrom` |
| Other AFC West games | each kickoff to +4.5 h | Every 10 min for the scores strip (KC at SEA keeps it going to about 04:50 UTC Mon) | `nextWait(..., others)` |
| After | | Back to the cron. The Raiders' game goes final, `next` moves on, and the strip shows the final for 3.5 days | `stripState` in `assets/js/lib.js` |

Times are computed in UTC from ESPN's kickoff time. Pacific time is only used for display (`TZ` in `assets/js/lib.js`), so the
daylight-saving change on 1 November doesn't affect scheduling.

| Week 7 times | UTC | Pacific (PDT) | Brisbane (AEST) |
|---|---|---|---|
| Chain can start | Sun 02:25 | Sat 7:25 PM | Sun 12:25 PM |
| Odds window opens | Sun 08:25 | Sun 1:25 AM | Sun 6:25 PM |
| Odds window closes (closing line) | Sun 19:25 | Sun 12:25 PM | Mon 5:25 AM |
| Kickoff | Sun 20:25 | Sun 1:25 PM | Mon 6:25 AM |
| 10-min updates stop for the Raiders game | Mon 00:55 | Sun 5:55 PM | Mon 10:55 AM |
| KC at SEA kickoff / updates stop | Mon 00:20 / 04:50 | Sun 5:20 PM / 9:50 PM | Mon 10:20 AM / 2:50 PM |

Overlap: the workflow's concurrency group allows one running and one waiting run. A run sleeping until its next slot holds
the group. Before dispatching, it checks for a waiting run (cron or otherwise) and lets that one carry the chain instead.

Safety: feeds that come back empty, or with less than half their last good record count, keep their last good data.
The `Validate data` step (`scripts/check-site.mjs`) runs before every commit, so a bad run publishes nothing and shows as a
failed run in Actions. The scheduling step runs even when an earlier step failed, so one bad run doesn't end the chain.

## Useful commands

```sh
# Update data runs, newest first (event: schedule = cron, workflow_dispatch = chain or manual)
gh run list -R MyintP/blackhole-highlights -w update.yml -L 60 --json databaseId,event,status,conclusion,createdAt \
  -q '.[]|[.databaseId,.event,.status,.conclusion,.createdAt]|@tsv'
# One run's updater log
gh run view <id> -R MyintP/blackhole-highlights --log | grep -E "\[update\]|Next run|Dispatched|queued"
# Published data, as the public sees it
curl -s "https://myintp.github.io/blackhole-highlights/data/odds.json?t=$(date +%s)" | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s),id="401873021";console.log((o.history?.[id]||[]).map(c=>c.asOf+" "+c.spread+" "+c.total).join("\n"));console.log("closing",JSON.stringify(o.closing?.[id]));console.log("record",JSON.stringify(o.record))})'
curl -s "https://myintp.github.io/blackhole-highlights/data/site.json?t=$(date +%s)" | node -e \
  'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.updated,JSON.stringify({next:{id:j.next?.id,state:j.next?.state,detail:j.next?.detail,score:j.next?.score},last:{id:j.last?.id,score:j.last?.score},week:j.week?.games?.map(g=>g.away.abbr+" "+g.away.score+" "+g.home.abbr+" "+g.home.score+" "+g.state+" "+g.detail)}))})'
```

## Checklist

Record the evidence (run URLs, timestamps, values) in the dated WORKLOG as you go. The Week 7 game id is `401873021`.

### A. Before kickoff
| # | Check | Expected evidence |
|---|---|---|
| A1 | The chain started | A `workflow_dispatch` Update data run created by the bot, after 02:25 UTC Sun, and later runs about an hour apart. Logs say `Next run in ...` and `Dispatched the next run` |
| A2 | Upcoming game data is valid | `site.json` `next.id` = 401873021, `next.date` = 2026-10-25T20:25Z, `state` = pre, `updated` within the last hour |
| A3 | Odds captures are accumulating | `odds.json` `history["401873021"]`: the first `asOf` soon after 08:25 UTC, then about one an hour (about 11 by the close) |
| A4 | The closing line was captured | `closing["401873021"].asOf` between about 19:10 and 19:25 UTC; `spread` and `total` match the last history entry |
| A5 | The pages show it | https://myintp.github.io/blackhole-highlights/games.html#odds shows the current line, "Line history" with the captures, and the strip says "Week 7 · Rams at Raiders" |
| A6 | No failed runs | No `failure` conclusions since the chain started (`cancelled` on a waiting run is normal) |

### B. During the game
| # | Check | Expected evidence |
|---|---|---|
| B1 | 10-minute updates | Update data runs about 10-12 min apart from about 19:25 UTC; logs say `Next run in 600 s` |
| B2 | Live score and clock | `site.json` `next.state` = in, `next.score` and `next.detail` (for example "2nd 4:12") match ESPN's gamecast |
| B3 | Strip and scoreboard | Every page's strip shows `LIVE`, the score and the clock; the home scoreboard shows the score. Both refresh every 2 min without a reload |
| B4 | Stale indicator | If no update lands for 25+ min, the strip shows "(as of h:mm PT)". Don't force this; only record it if it happens |
| B5 | AFC West scores | DEN at ARI (20:05 UTC) shows a live score; KC at SEA (00:20 UTC Mon) updates while it's on |
| B6 | No overlap or failures | Never two `in_progress` Update data runs at once; no `failure` conclusions |

### C. After the game
| # | Check | Expected evidence |
|---|---|---|
| C1 | Final score | `site.json` `last.id` = 401873021 with `score`; `next` is now Week 8 (at NYJ); the strip shows `Final` with Box score / Drives links |
| C2 | Closing line used for grading | `closing["401873021"]` keeps the same `asOf` as A4 (no capture after the window closed) |
| C3 | ATS and over/under grading | `closing["401873021"].result` = { ats, ou } and `.final` = the final score. Check by hand: LV margin + LV spread > 0 is a cover, < 0 no cover, = 0 push; total points against `total` |
| C4 | Season record | `odds.record.ats` = baseline 5-1-0 plus Week 7's result; Game Center's "Against the spread, game by game" shows the Week 7 row with its capture time |
| C5 | Corrected scores | Only if ESPN changes the final: the next run regrades from the new score (`grade` in `parse.mjs`). Note it if it happens; don't simulate it |
| C6 | Chain returns to cron | After about 04:50 UTC Mon the logs say `next run on cron` and the scheduling step is skipped |

### D. Following the game (Monday to Tuesday)
| # | Check | Expected evidence |
|---|---|---|
| D1 | Snapshots intact | `odds.json` `history["401873021"]` still has every capture from A3 |
| D2 | Box score and recap | `games.json` `games["401873021"]` exists; Game Center results show Week 7 |
| D3 | Breakdown published | After nflverse updates (usually the morning after, US time): `breakdown.json` `games["401873021"]`, `throughWeek` = 7 |
| D4 | Player and advanced data | `players.json` `throughWeek` = 7; Stats > Advanced says "Through Week 7" |
| D5 | All runs succeeded | Every Update data run from A1 to now is `success` (or `cancelled` while waiting) |
| D6 | Public pages | Home, Game Center, Stats, Players show Week 7 with no error boxes and no stale-data notice |

## Failure recovery

Prefer rerunning the existing workflow (Actions > Update data > Run workflow, or
`gh workflow run update.yml -R MyintP/blackhole-highlights --ref main`). Don't hand-edit files in `data/`: the next run would
overwrite them, and history should only ever come from captures.

| Failure | Handled automatically? | Recovery |
|---|---|---|
| One feed fails (timeout, 5xx) | Yes: the feed keeps its last good data, the failure is listed in `site.json` `sources`, and pages show a notice | Nothing, unless it persists over several runs. Then check the URL in the run log |
| Feed returns empty or truncated data | Yes: treated as failed (`nonEmpty` in `update.mjs`), last good data kept | Same as above |
| Malformed data reaches the files | Yes: `Validate data` fails, nothing is committed, the run shows as failed | Read the failing check in the log. Fix the parser in a PR with a test; don't patch data |
| The chain didn't start (no runs near kickoff) | No | Run the workflow manually: if it's inside a game window, it dispatches its own next run. To test dispatch alone: Run workflow with `chain_test` ticked (one follow-up in 60 s) |
| The chain broke mid-window (no run for 70+ min, or 20+ min in-game) | Partly: the cron still fires, late | Run the workflow manually; it picks up the right cadence from the clock |
| Missing odds snapshots | No. A missed hour is gone, but later captures still count | Run the workflow manually while still inside the window. After the close, the last capture before it stays the closing line |
| No closing line at all (no capture in the window) | Yes: the game isn't graded ("No line" in the ATS table) and doesn't count in the record | Never enter a line by hand. Record the gap in the WORKLOG |
| Stale live score | The strip and scores show "as of" after 25 min | Check the runs (B1). Rerun the workflow if the chain broke |
| Wrong game state shown (for example "Live" after the game) | `stripState` only says "live" when ESPN's status is `in`; past kickoff +4.5 h without a final it says "awaiting the final score" | Rerun the workflow. If ESPN still reports the old status, wait; the page follows the feed |
| Grading mismatch | Regraded every run from the current final score | Check C3 by hand. If the code is wrong, fix `grade` with a test reproducing the case, merge, and the next run regrades |
| Publication failed (data committed, page not updated) | The next push rebuilds Pages | Check `pages-build-deployment` runs; rerun the latest one from Actions |
| Postponed game | `next.postponed` stops the chain; the strip says "postponed"; the game isn't graded | Nothing. The schedule feed carries the new date when it's set |
| Game runs long (past kickoff +4.5 h) | No: the 10-min updates stop at +4.5 h; the final arrives with the next cron run | Run the workflow manually once ESPN shows the final |
