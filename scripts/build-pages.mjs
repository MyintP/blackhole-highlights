// Builds the site's HTML pages from src/layout.html + src/pages/*.html, plus sitemap.xml.
// Each page file starts with a JSON comment: <!-- {"title","description","file","nav","script","head"?} -->
// "nav" is the page's area (home, games, news, team, about). Areas with SECTIONS get a sticky section bar where the page
// has <!--sections-->; links into the same page become in-page tabs (see initSections in assets/js/app.js).
//   node scripts/build-pages.mjs          write pages
//   node scripts/build-pages.mjs --check  exit 1 if any committed page is out of date (used in CI)
import { readFile, writeFile, readdir } from "node:fs/promises";

export const BASE = "https://myintp.github.io/blackhole-highlights/";
export const NAV = [
  ["home", "./", "Home"], ["games", "games.html", "Game Center"], ["news", "news.html", "News"], ["team", "stats.html", "Team"], ["about", "about.html", "About"],
];
export const SECTIONS = {
  games: [["games.html#next", "Next game"], ["games.html#injuries", "Injuries"], ["games.html#matchup", "Matchup"], ["games.html#schedule", "Schedule"], ["games.html#results", "Results"], ["rewind.html", "The Rewind"]],
  news: [["news.html", "Stories"], ["media.html#videos", "Our videos"], ["media.html#podcasts", "Podcasts"], ["media.html#espn", "ESPN video"]],
  team: [["stats.html#standings", "Standings"], ["stats.html#team", "Team stats"], ["stats.html#advanced", "Advanced"], ["stats.html#leaders", "Team leaders"], ["stats.html#history", "History"],
    ["players.html#profiles", "Player profiles"], ["players.html#roster", "Roster"]],
};
// Mobile bottom bar: the four areas plus More (opens the menu drawer with About, search and subscribe)
const ICONS = {
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  games: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M12 5v14M3 12h4M17 12h4"/>',
  news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5"/>',
  team: '<path d="M12 3 4 6v6c0 4.5 3.4 7.7 8 9 4.6-1.3 8-4.5 8-9V6z"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
};
const icon = k => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">${ICONS[k]}</svg>`;
// aria-current="page" only on the page itself; elsewhere in the same area (Players under Team) the link marks the area
const current = (href, file) => (href === file || (href === "./" && file === "index.html") ? "page" : "true");
const tabbar = (area, file) => `<nav class="tabbar" aria-label="Sections">
${NAV.filter(([k]) => k !== "about").map(([k, href, label]) => `  <a href="${href}"${k === area ? ` aria-current="${current(href, file)}"` : ""}>${icon(k)}<span>${k === "games" ? "Games" : label}</span></a>`).join("\n")}
  <button type="button" class="more-btn" aria-expanded="false" aria-controls="drawer">${icon("more")}<span>More</span></button>
</nav>`;
const secbar = (area, file) => !SECTIONS[area] ? "" : `<nav class="secbar" aria-label="${area === "games" ? "Game Center" : area === "news" ? "News" : "Team"} sections"><div class="wrap">${
  SECTIONS[area].map(([href, label]) => { const [f, h] = href.split("#"), here = f === file; return `<a href="${here ? (h ? "#" + h : f) : href}"${here && !h ? ' aria-current="page"' : ""}${here && h ? ` data-tab="${h}"` : ""}>${label}</a>`; }).join("")}</div></nav>`;
const root = new URL("../", import.meta.url);
const check = process.argv.includes("--check");

const layout = await readFile(new URL("src/layout.html", root), "utf8");
const files = (await readdir(new URL("src/pages/", root))).filter(f => f.endsWith(".html")).sort();
const stale = [], urls = [];

for (const f of files) {
  const src = await readFile(new URL(`src/pages/${f}`, root), "utf8");
  const m = src.match(/^<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
  if (!m) throw new Error(`${f}: missing JSON header comment`);
  const meta = JSON.parse(m[1]);
  const nav = NAV.map(([key, href, label]) => `        <a href="${href}"${key === meta.nav ? ` aria-current="${current(href, meta.file)}"` : ""}>${label}</a>`).join("\n");
  const url = BASE + (meta.file === "index.html" ? "" : meta.file);
  const head = (meta.head || "") + (meta.script ? `<script type="module" src="assets/js/pages/${meta.script}.js"></script>\n` : "");
  // Function replacers: page content may contain "$&" or "$1", which string replacements would expand.
  const main = src.slice(m[0].length).trim().replace("<!--sections-->", () => secbar(meta.nav, meta.file));
  // The menu drawer (More on phones) also lists the second-level pages the bottom bar has no room for
  const drawernav = nav + "\n" + [["players.html", "Players and roster"], ["media.html", "Videos and podcasts"], ["search.html", "Search"]]
    .map(([href, label]) => `        <a class="sub" href="${href}"${href === meta.file ? ' aria-current="page"' : ""}>${label}</a>`).join("\n");
  const vals = { title: meta.title, description: meta.description, url, page: meta.nav || "none", nav, head, main, tabbar: tabbar(meta.nav, meta.file), drawernav };
  const html = layout.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in vals ? vals[k] : all));
  if (meta.sitemap !== false) urls.push(url);
  const out = new URL(meta.file, root);
  const cur = await readFile(out, "utf8").catch(() => null);
  if (cur !== html) { if (check) stale.push(meta.file); else await writeFile(out, html); }
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc><changefreq>hourly</changefreq></url>`).join("\n")}\n</urlset>\n`;
const curMap = await readFile(new URL("sitemap.xml", root), "utf8").catch(() => null);
if (curMap !== sitemap) { if (check) stale.push("sitemap.xml"); else await writeFile(new URL("sitemap.xml", root), sitemap); }

if (check && stale.length) { console.error("Out of date (run node scripts/build-pages.mjs):", stale.join(", ")); process.exit(1); }
console.log(check ? "pages up to date" : `built ${files.length} pages + sitemap.xml`);
