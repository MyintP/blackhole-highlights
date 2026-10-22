// Static checks for the built site (run in CI and before deploying):
// internal links and #anchors resolve, pages have title/description/canonical/one h1, JS imports resolve,
// data files parse and have the expected shape, and no secrets or placeholder text are committed.
import { readFile, readdir, stat } from "node:fs/promises";
import { execSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const read = p => readFile(new URL(p, root), "utf8");
const exists = p => stat(new URL(p, root)).then(() => true, () => false);
const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

const pages = (await readdir(root)).filter(f => f.endsWith(".html"));
const html = Object.fromEntries(await Promise.all(pages.map(async p => [p, await read(p)])));
const ids = p => new Set([...html[p].matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

for (const p of pages) {
  const h = html[p];
  if (!/<html lang="en">/.test(h)) fail(p, "missing lang");
  if (!/<title>[^<]{10,}<\/title>/.test(h)) fail(p, "missing or short <title>");
  if (!/<meta name="description" content="[^"]{40,}">/.test(h)) fail(p, "missing or short meta description");
  if (p !== "404.html" && !/<link rel="canonical" href="https:\/\/myintp\.github\.io\/blackhole-highlights\//.test(h)) fail(p, "missing canonical");
  if ((h.match(/<h1[\s>]/g) || []).length !== 1) fail(p, "should have exactly one <h1>");
  for (const m of h.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (/^(https?:|mailto:|data:|\/\/)/.test(url) || url.startsWith("/blackhole-highlights/")) continue;
    const [file, hash] = url.split("#");
    const target = file === "" ? p : file === "./" ? "index.html" : file.split("?")[0];
    if (!(await exists(target))) { fail(p, `broken link ${url}`); continue; }
    if (hash && target.endsWith(".html") && !ids(target).has(hash)) fail(p, `missing anchor ${url}`);
  }
}

// JS: relative imports resolve, no placeholder markers
const jsFiles = ["assets/js/lib.js", "assets/js/app.js", ...(await readdir(new URL("assets/js/pages/", root))).map(f => "assets/js/pages/" + f)];
for (const f of jsFiles) {
  const src = await read(f);
  for (const m of src.matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
    const target = new URL(m[1], new URL(f, root));
    if (!(await stat(target).then(() => true, () => false))) fail(f, `import not found ${m[1]}`);
  }
  // links rendered by JS must also point at real pages and anchors
  for (const m of src.matchAll(/href="((?:[a-z]+\.html|\.\/))(#[a-z][\w-]*)?"/g)) {
    const target = m[1] === "./" ? "index.html" : m[1];
    if (!html[target]) fail(f, `links to missing page ${m[1]}`);
    else if (m[2] && !ids(target).has(m[2].slice(1))) fail(f, `links to missing anchor ${m[1]}${m[2]}`);
  }
}

// Every primary nav link resolves
for (const m of html["index.html"].matchAll(/<nav class="primary"[\s\S]*?<\/nav>/g)) for (const a of m[0].matchAll(/href="([^"]+)"/g))
  if (!(await exists(a[1] === "./" ? "index.html" : a[1]))) fail("nav", `dead link ${a[1]}`);

// Data shape
const data = async n => JSON.parse(await read(`data/${n}.json`));
try {
  const site = await data("site");
  if (!Array.isArray(site.schedule?.games) || !site.schedule.games.length) fail("data/site.json", "no schedule");
  if (!site.standings?.west?.length) fail("data/site.json", "no standings");
  const news = await data("news");
  if (!news.items?.length) fail("data/news.json", "no stories");
  for (const i of news.items) if (!i.title || !/^https?:\/\//.test(i.link) || isNaN(new Date(i.date)) || !i.src || !i.kind) { fail("data/news.json", `bad item ${i.id}`); break; }
  for (const n of ["odds", "stats", "games", "media", "history", "editorial"]) await data(n);
} catch (e) { fail("data", e.message); }

// Secrets and placeholders in tracked files
const tracked = execSync("git ls-files", { cwd: root }).toString().split("\n").filter(f => /\.(html|js|mjs|json|md|yml|css|txt|xml)$/.test(f));
for (const f of tracked) {
  const src = await read(f).catch(() => "");
  if (/AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{20,}|xox[bap]-/.test(src)) fail(f, "possible secret");
  if (f !== "scripts/check-site.mjs" && /lorem ipsum|\bTODO\b|\bFIXME\b/i.test(src)) fail(f, "placeholder text");
}

if (errors.length) { console.error(errors.map(e => "  x " + e).join("\n")); console.error(`${errors.length} problem(s)`); process.exit(1); }
console.log(`site check passed: ${pages.length} pages, ${jsFiles.length} scripts, ${tracked.length} tracked files`);
