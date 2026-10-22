# Black Hole Highlights

Fan site and brand assets for the Black Hole Highlights YouTube channel (@BlackHoleHighlights).
Not affiliated with the NFL or the Las Vegas Raiders. Never use official team logos or NFL marks
(the data feeds include logo URLs; the page deliberately doesn't render them).

Live site: https://myintp.github.io/blackhole-highlights/ (GitHub Pages, `main` branch, root folder).

## How it works
- `index.html`: the page (static HTML/CSS/JS, no build step). It renders everything from `data/*.json`.
- `data/site.json`: schedule, results, standings, team stats, injuries, season leaders, news, videos. **Generated.**
- `data/odds.json`: current lines, opening line, closing lines and the Raiders' ATS / over-under record. **Generated.**
- `data/editorial.json`: hand-written content (hero headline, Pundit's Pick, keys to the game, milestones).
- `scripts/update.mjs`: pulls the data (Node 20+, no dependencies). Each source fails on its own and keeps its last good data.
- `.github/workflows/update.yml`: runs the updater every hour at :07 and commits only when data changed.

## Data sources
- ESPN public JSON feeds: schedule, scores, standings, team stats and ranks, injuries, leaders, DraftKings odds.
- News: Raiders.com RSS, Silver & Black Pride RSS, ESPN Raiders stories.
- Videos: the channel's YouTube RSS feed (channel id `UC24qVyqQyKXDeXLFqBF6F_Q`). New uploads appear on their own.

## Odds timing
Lines are captured every hour from **12 hours before kickoff to 1 hour before**. The last capture is the closing line,
used to grade the Raiders against the spread and the total after the game. Weeks 1-6 records come from public reports
(the `baseline` in `odds.json`).

## Each week (by hand)
Update `data/editorial.json` for the next game: set `gameId` to `next.id` from `data/site.json`, then write the
headline, lede, pick and keys. Until you do, the page shows an automatic headline and "pick drops before kickoff".

## Run locally
- Refresh data: `node scripts/update.mjs` (add `--force-odds` to test an odds snapshot outside the window).
- Preview: `python -m http.server 8765`, then open http://127.0.0.1:8765/ (the page can't load data from `file://`).
- Run the GitHub job on demand: Actions tab > Update data > Run workflow.

## Sharing
- `assets/og-image.png` is the link-preview card (source: `assets/og-image.html`, render command inside).
- `og:url` and `og:image` in `index.html` use full URLs. Update them if the site address changes.
