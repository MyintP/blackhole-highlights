// HTTP for the updater: honest user-agent, timeout, and retries with backoff.
// ESPN and YouTube reject user-agents containing "bot", so keep this one as is.
export const UA = "BlackHoleHighlights/1.0 (+https://myintp.github.io/blackhole-highlights/)";

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function get(url, { type = "json", tries = 3, timeout = 20000 } = {}) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeout) });
      // 4xx other than 429 won't fix itself on retry
      if (!r.ok) { err = new Error(`${r.status} ${url}`); if (r.status < 500 && r.status !== 429) break; }
      else return type === "json" ? await r.json() : await r.text();
    } catch (e) { err = e; }
    if (i < tries - 1) await sleep(1000 * 2 ** i);
  }
  throw err;
}
