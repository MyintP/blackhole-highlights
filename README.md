# Black Hole Highlights

Fan site and brand assets for the Black Hole Highlights YouTube channel (@BlackHoleHighlights).
Not affiliated with the NFL or the Las Vegas Raiders.

## Files
- `index.html`: the site (single static page, no build step). Open it in a browser or deploy as-is.
- `assets/logo.svg`: channel profile picture (800×800).
- `assets/banner.svg`: channel banner (2560×1440, text inside YouTube's 1546×423 safe area).

## Updating each week
Edit `index.html`:
- Hero: opponent, records, kickoff date/time (also update `kick` in the script for the countdown).
- Odds panel (`#odds`): spread, moneyline, total, open vs. latest line, ATS and over/under records, plus the "as of" date and source. Look up current lines on every update.
- Pundit's Pick (`#pick`): score call and three keys for the next game.
- Schedule (`#schedule`): move the played game to a result and refresh opponent records.
- Season Leaders (`#leaders`): Cousins, Jeanty, Bowers and Crosby season totals.
- News list, AFC West table, injury reports, milestones.
- Countdown: also update "ON FOX" in the script if the next game is on another network.

## Sharing
- `assets/og-image.png` is the link-preview card (source: `assets/og-image.html`, render command inside).
- Live site: https://myintp.github.io/blackhole-highlights/ (GitHub Pages, `main` branch, root folder).
- `og:url` and `og:image` in `index.html` use full URLs. Update them if the site address changes.
- Tale of the Tape: the `rows` array in the script.
- Clips: the four `.clip` cards.
