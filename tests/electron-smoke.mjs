// Launch a packaged/unpackaged Electron build and check the title screen loads (local only).
// node tests/electron-smoke.mjs <electron-executable> <screenshot.png> [appDir]
import { _electron } from 'playwright-core';
const [exe, shot, appDir] = process.argv.slice(2);
const app = await _electron.launch({ executablePath: exe, args: appDir ? [appDir] : [] });
const win = await app.firstWindow();
const errs = [];
win.on('pageerror', (e) => errs.push(e.message));
await win.waitForTimeout(2500);
await win.mouse.click(640, 400);
await win.waitForTimeout(3000);
const info = await win.evaluate(() => ({
  title: document.title,
  desktop: !!window.acePlaysDesktop,
  version: document.querySelector('.app-version')?.textContent ?? null,
  hasPlay: !!document.querySelector('[data-a=play]'),
  hasQuit: !!document.querySelector('[data-a=quit]'),
  touch: document.body.classList.contains('touch'),
  rotatePrompt: !!document.querySelector('.rotate-prompt'),
  sw: navigator.serviceWorker ? !!navigator.serviceWorker.controller : false,
  protocol: location.protocol,
}));
await win.screenshot({ path: shot });
console.log(JSON.stringify({ info, errs }));
await app.close();
