// Local check of the directional-control adapter against a built static folder.
// Mirrors the coordinator procedure: paused clock, fresh context per key,
// reset(), browser-level key hold advanced in 16 ms steps, sample(), project
// the position change onto the reset-state right vector.
//
// Usage: node tests/probe.mjs --url http://127.0.0.1:5199/index.html [--hold 400]
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const base = arg('url', 'http://127.0.0.1:5199/index.html');
const hold = Number(arg('hold', 400));
const keys = (arg('keys', 'KeyA,ArrowLeft,KeyD,ArrowRight,KeyW,ArrowUp,KeyS,ArrowDown')).split(',');
const exe = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

async function advance(page, ms) {
  for (let t = 0; t < ms; t += 16) await page.clock.runFor(16);
}

const out = [];
for (const key of keys) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: new Date('2000-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2000-01-01T00:00:00Z'));
  const url = base + (base.includes('?') ? '&' : '?') + 'oneshot-directional-probe=1';
  await page.goto(url, { waitUntil: 'load' });
  await advance(page, 200);
  const has = await page.evaluate(() => typeof window.__ONESHOT_DIRECTIONAL_CONTROL_PROBE__ === 'object');
  if (!has) {
    out.push({ key, error: 'no probe', errors });
    await context.close();
    continue;
  }
  await page.evaluate(() => {
    window.__resetDone = false;
    Promise.resolve(window.__ONESHOT_DIRECTIONAL_CONTROL_PROBE__.reset()).then(() => (window.__resetDone = true));
  });
  for (let i = 0; i < 200; i++) {
    if (await page.evaluate(() => window.__resetDone)) break;
    await page.clock.runFor(16);
  }
  const before = await page.evaluate(() => window.__ONESHOT_DIRECTIONAL_CONTROL_PROBE__.sample());
  const cdp = await context.newCDPSession(page);
  const codeMap = { KeyA: ['a', 65], KeyD: ['d', 68], KeyW: ['w', 87], KeyS: ['s', 83], ArrowLeft: ['ArrowLeft', 37], ArrowRight: ['ArrowRight', 39], ArrowUp: ['ArrowUp', 38], ArrowDown: ['ArrowDown', 40] };
  const [k, vk] = codeMap[key];
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: key, key: k, windowsVirtualKeyCode: vk });
  await advance(page, hold);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', code: key, key: k, windowsVirtualKeyCode: vk });
  await advance(page, 32);
  const after = await page.evaluate(() => window.__ONESHOT_DIRECTIONAL_CONTROL_PROBE__.sample());
  const d = after.position.map((v, i) => v - before.position[i]);
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  out.push({ key, frame: before.frame, right: +dot(d, before.right).toFixed(3), forward: +dot(d, before.forward).toFixed(3), errors });
  await context.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
