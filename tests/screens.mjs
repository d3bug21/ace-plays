// Every menu/overlay screen fits the visible viewport with its primary button
// fully on-screen (incl. simulated browser toolbars). Local verification only.
//   node tests/screens.mjs --url http://localhost:5173 --out <dir>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('url', 'http://localhost:5173');
const OUT = arg('out', 'shots/screens');
fs.mkdirSync(OUT, { recursive: true });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal'] });
const sizes = [[360, 640, 0], [390, 844, 0], [844, 390, 0], [640, 360, 0], [874, 350, 0], [874, 380, 0], [402, 760, 0], [640, 360, 56], [844, 390, 80], [390, 844, 110]];
const rows = [];
for (const [w, h, tb] of sizes) {
  const ctx = await b.newContext({ userAgent: UA, viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => {
    localStorage.setItem('acePlays.homeTip', '1');
    if (!t) return;
    const et = new EventTarget();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { get width() { return innerWidth; }, get height() { return innerHeight - t; }, offsetTop: 0, offsetLeft: 0, scale: 1, addEventListener: et.addEventListener.bind(et), removeEventListener: et.removeEventListener.bind(et) } });
  }, tb);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const check = async (name, sel, shot) => {
    const r = await p.evaluate((s) => {
      const vh = window.visualViewport ? window.visualViewport.height : innerHeight;
      const els = [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().width > 0);
      const el = els[els.length - 1];
      if (!el) return { found: false };
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { found: true, inside: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= vh + 1, tappable: !!top && (top === el || el.contains(top)), box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], vh };
    }, sel);
    rows.push({ size: `${w}x${h}${tb ? '-tb' + tb : ''}`, screen: name, ...r });
    if (shot) await p.screenshot({ path: `${OUT}/${name}-${w}x${h}-tb${tb}.png` });
  };
  await p.goto(`${BASE}/`);
  await p.waitForTimeout(1500);
  const portrait = w < h;
  if (portrait) {
    await check('rotate-prompt', '.rotate-prompt.show [data-a=anyway]', true);
    await p.click('.rotate-prompt [data-a=anyway]');
  }
  await check('boot', '.boot .tap', false);
  await p.evaluate(() => window.__acePlays.showTitle());
  await p.waitForTimeout(800);
  await check('title', '.title [data-a=play]', true);
  await p.evaluate(() => window.__acePlays.showMap());
  await p.waitForTimeout(900);
  await check('map', '.stage-card.show [data-a=go]', true);
  await p.evaluate(() => window.__acePlays.enterStage('meadow'));
  await p.waitForTimeout(5000);
  await check('intro', '.intro [data-a=go]', true);
  await p.evaluate(() => window.__acePlays.beginPlay());
  await p.waitForTimeout(1800);
  if (await p.evaluate(() => !!document.querySelector('.rotate-prompt.show'))) await p.click('.rotate-prompt [data-a=anyway]');
  await p.evaluate(() => { const G = window.__acePlays; if (G.state === 'paused') G.resume(); G.pause(); return G.state; });
  await p.waitForTimeout(500);
  await check('pause', '.modal [data-a=resume]', true);
  await p.click('.modal [data-a=settings]');
  await p.waitForTimeout(500);
  await check('settings', '.modal [data-a=done]', true);
  await p.click('.modal [data-a=done]');
  await p.click('.modal [data-a=controls]');
  await p.waitForTimeout(400);
  await check('how-to-play', '.modal [data-a=ok]', true);
  await p.click('.modal [data-a=ok]');
  await p.evaluate(() => { const G = window.__acePlays; G.resume(); for (const o of G.objectives.list) if (o.def.kind !== 'challenge') G.objectives.complete(o.def.id); G.finishStage(); return 1; });
  await p.waitForTimeout(4200);
  await check('results', '.res-actions [data-a=next], .res-actions [data-a=map]', true);
  await p.evaluate(() => window.__acePlays.ui.showEnding(() => undefined));
  await p.waitForTimeout(800);
  await check('ending', '.ending button', false);
  rows.push({ size: `${w}x${h}${tb ? '-tb' + tb : ''}`, screen: 'errors', errs });
  await ctx.close();
}
await b.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(rows, null, 1));
const bad = rows.filter((r) => (r.screen !== 'errors' && (!r.found || !r.inside || !r.tappable)) || (r.errs && r.errs.length));
console.log(JSON.stringify({ checked: rows.length, bad }, null, 1));
