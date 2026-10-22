import * as L from "../lib.js";
import * as A from "../app.js";
const { $ } = A, { esc } = L;

A.initChrome();
A.runPage($("src-status"), async () => {
  const site = await A.loadJSON("site");
  const rows = Object.entries(site.sources || {}).sort(([a], [b]) => a.localeCompare(b));
  $("src-status").innerHTML = `<table><thead><tr><th scope="col">Feed</th><th scope="col">Last result</th></tr></thead><tbody>${rows.map(([k, s]) =>
    `<tr><td>${esc(k)}</td><td>${s.ok ? '<span class="w">OK</span>' : '<span class="l">Failed</span> <small>(showing last good data)</small>'}</td></tr>`).join("")}</tbody></table>
    <p class="note">Status as of the last data change, ${esc(L.dateTime(site.updated))}. Last hourly check: <span data-checked>loading</span>.</p>`;
  A.dataNotice(site); // after render so it can fill the data-checked span above
});
