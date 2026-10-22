import * as A from "../app.js";
const { $ } = A;

A.initChrome();
A.runPage($("page-error"), async () => {
  const [media, site] = await Promise.all([A.loadJSON("media"), A.loadJSON("site").catch(() => null)]);
  A.dataNotice(site);
  $("yt").innerHTML = A.videosHTML(media.youtube);
  $("pods").innerHTML = A.linkListHTML(media.podcasts);
  $("espn-v").innerHTML = A.linkListHTML(media.espn);
});
