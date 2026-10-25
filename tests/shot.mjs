// Browser harness: open a URL in Chrome, optionally run scripted steps, capture
// screenshots and console errors. Used for local verification only.
//
// Usage: node tests/shot.mjs --url <url> --out <dir> [--steps steps.json] [--w 1280 --h 800] [--mobile]
// Steps JSON: [{ "wait": ms } | { "key": "KeyW", "hold": ms } | { "click": [x, y] } |
//   { "shot": "name" } | { "eval": "js" } | { "mouse": [dx, dy] } | { "down": "KeyW" } | { "up": "KeyW" }]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);
const url = args.url;
const out = args.out || 'shots';
const w = Number(args.w || 1280);
const h = Number(args.h || 800);
const mobile = args.mobile === 'true';
fs.mkdirSync(out, { recursive: true });
const steps = args.steps ? JSON.parse(fs.readFileSync(args.steps, 'utf8')) : [{ wait: 3000 }, { shot: 'page' }];

const exe = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({
  executablePath: exe,
  headless: args.headed !== 'true',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({
  viewport: { width: w, height: h },
  deviceScaleFactor: mobile ? 2 : 1,
  isMobile: mobile,
  hasTouch: mobile,
});
const page = await context.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
await page.goto(url, { waitUntil: 'load' });
const results = [];
for (const s of steps) {
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.key) {
    await page.keyboard.down(s.key);
    await page.waitForTimeout(s.hold || 100);
    await page.keyboard.up(s.key);
  }
  if (s.down) await page.keyboard.down(s.down);
  if (s.up) await page.keyboard.up(s.up);
  if (s.press) await page.keyboard.press(s.press);
  if (s.click) await page.mouse.click(s.click[0], s.click[1]);
  if (s.clickSel) await page.click(s.clickSel, { timeout: 5000 }).catch((e) => logs.push('[click-fail] ' + s.clickSel + ' ' + e.message));
  if (s.mousedown) {
    await page.mouse.move(s.mousedown[0], s.mousedown[1]);
    await page.mouse.down();
  }
  if (s.mouseup) await page.mouse.up();
  if (s.mouse) {
    const [dx, dy] = s.mouse;
    await page.mouse.move(w / 2, h / 2);
    await page.mouse.down();
    await page.mouse.move(w / 2 + dx, h / 2 + dy, { steps: 8 });
    await page.mouse.up();
  }
  if (s.eval) {
    try {
      const r = await page.evaluate(s.eval);
      results.push({ eval: s.eval.slice(0, 80), r });
    } catch (e) {
      results.push({ eval: s.eval.slice(0, 80), error: String(e) });
    }
  }
  if (s.shot) await page.screenshot({ path: path.join(out, `${s.shot}.png`) });
}
fs.writeFileSync(path.join(out, 'log.txt'), logs.join('\n'));
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ logs: logs.slice(-40), results }, null, 1));
await browser.close();
