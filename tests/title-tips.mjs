// Title-screen tips (in-app / Add to Home Screen) never overlap the logo, Ace
// or the title buttons; plus caption-queue behaviour. Local verification only.
//   node tests/title-tips.mjs --url http://localhost:5173 --out <dir>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('url', 'http://localhost:5173');
const OUT = arg('out', 'shots/title-tips');
fs.mkdirSync(OUT, { recursive: true });
const UAS = {
  'ios-chrome': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
  'fb-ios': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/512.0.0.41.104;FBSN/iOS;FBSV/18.5]',
};
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal'] });
const rows = [];
for (const [uaName, ua] of Object.entries(UAS)) {
  for (const [w, h] of [[874, 350], [874, 380], [844, 390], [402, 760]]) {
    const ctx = await b.newContext({ userAgent: ua, viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}/`);
    await p.waitForTimeout(1500);
    if (await p.evaluate(() => !!document.querySelector('.rotate-prompt.show'))) await p.click('.rotate-prompt [data-a=anyway]');
    await p.touchscreen.tap(w / 2, h / 2);
    await p.waitForTimeout(3000);
    const r = await p.evaluate(() => {
      const box = (el) => { const q = el.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom].map(Math.round); };
      const tip = document.querySelector('.inapp-tip');
      const targets = {};
      const logo = document.querySelector('.logo');
      if (logo) {
        // The visible logo text (not the full-width block).
        const range = document.createRange();
        range.selectNodeContents(logo);
        const rr = range.getBoundingClientRect();
        targets.logo = [rr.left, rr.top, rr.right, rr.bottom].map(Math.round);
      }
      document.querySelectorAll('.title-buttons .btn, .title .corner .btn, .app-version').forEach((el, i) => (targets[`btn${i}:${el.textContent.trim().slice(0, 12)}`] = box(el)));
      // Ace's on-screen box from the 3D title scene.
      const G = window.__acePlays;
      const root = G.menu.ace.root;
      const V = root.position.constructor;
      const pts = [];
      for (const dx of [-0.55, 0.55]) for (const dy of [0, 2.5]) for (const dz of [-0.4, 0.4]) {
        const v = new V(root.position.x + dx, root.position.y + dy, root.position.z + dz).project(G.menu.camera);
        pts.push([(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * (window.visualViewport?.height ?? innerHeight)]);
      }
      targets.ace = [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))].map(Math.round);
      const hit = (a, c) => a[0] < c[2] && c[0] < a[2] && a[1] < c[3] && c[1] < a[3];
      const t = tip ? box(tip) : null;
      return { tip: t, inside: t ? t[0] >= 0 && t[1] >= 0 && t[2] <= innerWidth && t[3] <= innerHeight : null, overlaps: t ? Object.entries(targets).filter(([, v]) => hit(t, v)).map(([k]) => k) : [], targets };
    });
    rows.push({ ua: uaName, size: `${w}x${h}`, errs, ...r });
    await p.screenshot({ path: `${OUT}/${uaName}-${w}x${h}.png` });
    await ctx.close();
  }
}
// Caption queued behind a banner (touch message slot).
{
  const ctx = await b.newContext({ userAgent: UAS['ios-chrome'], viewport: { width: 874, height: 350 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?stage=meadow`);
  await p.waitForTimeout(3000);
  const seq = await p.evaluate(async () => {
    const G = window.__acePlays;
    G.audio.clearVoices();
    const kind = () => (document.querySelector('.msg').className.match(/kind-(\w+)/) || [])[1] || 'none';
    const text = () => document.querySelector('.msg').textContent;
    G.ui.hint('Hold the bubble button and slide to aim');
    G.ui.banner('Big friend!', 'Here comes Biscuit', 1.0);
    G.ui.caption('ace', 'Biscuit! Wanna play fetch, boy?', 1.0);
    const out = [kind()];
    await new Promise((r) => setTimeout(r, 1200));
    out.push(kind() + ':' + text().slice(0, 12));
    await new Promise((r) => setTimeout(r, 1800));
    out.push(kind());
    return out;
  });
  rows.push({ captionQueue: seq });
  await ctx.close();
}
await b.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(rows, null, 1));
console.log(JSON.stringify(rows.map((r) => (r.captionQueue ? { captionQueue: r.captionQueue } : { ua: r.ua, size: r.size, tip: r.tip, inside: r.inside, overlaps: r.overlaps, errs: r.errs.length })), null, 1));
