// Builds the site's HTML pages from src/layout.html + src/pages/*.html, plus sitemap.xml.
// Each page file starts with a JSON comment: <!-- {"title","description","file","nav","script","head"?} -->
//   node scripts/build-pages.mjs          write pages
//   node scripts/build-pages.mjs --check  exit 1 if any committed page is out of date (used in CI)
import { readFile, writeFile, readdir } from "node:fs/promises";

export const BASE = "https://myintp.github.io/blackhole-highlights/";
export const NAV = [
  ["home", "./", "Home"], ["news", "news.html", "News"], ["games", "games.html", "Game Center"],
  ["stats", "stats.html", "Stats"], ["players", "players.html", "Players"], ["media", "media.html", "Media"], ["about", "about.html", "About"],
];
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
  const nav = NAV.map(([key, href, label]) => `        <a href="${href}"${key === meta.nav ? ' aria-current="page"' : ""}>${label}</a>`).join("\n");
  const url = BASE + (meta.file === "index.html" ? "" : meta.file);
  const head = (meta.head || "") + (meta.script ? `<script type="module" src="assets/js/pages/${meta.script}.js"></script>\n` : "");
  // Function replacers: page content may contain "$&" or "$1", which string replacements would expand.
  const vals = { title: meta.title, description: meta.description, url, page: meta.nav || "none", nav, head, main: src.slice(m[0].length).trim() };
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
