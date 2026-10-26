// Multi-touch checks for the touch controls (fire-stick aim, fire + move,
// edge-turn, invert-look, blaster-slot taps) using CDP touch events, plus
// on-screen layout checks with a reduced visual viewport (simulated toolbar).
// Local verification only. Usage:
//   node tests/multitouch.mjs --url http://localhost:5173 --out <dir>
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const BASE = arg('url', 'http://localhost:5173');
const OUT = arg('out', 'shots/multitouch');
fs.mkdirSync(OUT, { recursive: true });
const exe = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
};
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

/** Fake a smaller visual viewport (browser toolbar showing) before the page loads. */
async function newCtx(ua, w, h, toolbar) {
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  if (toolbar) {
    await ctx.addInitScript((tb) => {
      const et = new EventTarget();
      const fake = {
        get width() { return innerWidth; },
        get height() { return innerHeight - tb; },
        offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
        addEventListener: et.addEventListener.bind(et), removeEventListener: et.removeEventListener.bind(et), dispatchEvent: et.dispatchEvent.bind(et),
      };
      Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
    }, toolbar);
  }
  return ctx;
}

async function center(page, sel) {
  return page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
}

const results = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- behaviour
const ONLY_LAYOUT = process.argv.includes('--layout-only');
for (const [dev, ua, w, h] of ONLY_LAYOUT ? [] : [['iphone', UA.iphone, 844, 390], ['android', UA.android, 915, 412]]) {
  const ctx = await newCtx(ua, w, h, 0);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}/?stage=meadow`);
  await page.waitForTimeout(3500);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const g = (fn) => page.evaluate(fn);
  await g(() => { const G = window.__acePlays; G.player.yaw = 0; G.player.pitch = 0; G.save.settings.invertLook = false; G.save.unlockBlaster('boing'); G.ui.renderBlasters(G.save.progress.blasters, G.rig.current); return 1; });
  const fire = await center(page, '.tbtn.fire');
  const r = { dev, w, h, errs };

  // 1) Fire + aim with the same thumb: drag right -> view turns right (yaw decreases), drag up -> look up.
  const b0 = await g(() => window.__acePlays.projectiles.bubbles.length);
  const y0 = await g(() => window.__acePlays.player.yaw);
  await touch('touchStart', [{ x: fire.x, y: fire.y, id: 1 }]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: fire.x + i * 5, y: fire.y, id: 1 }]); await wait(30); }
  await wait(150);
  r.fireAimRight = { dYaw: +(await g(() => window.__acePlays.player.yaw) - y0).toFixed(3), firing: await g(() => window.__acePlays.input.mouseDown) };
  const p0 = await g(() => window.__acePlays.player.pitch);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: fire.x + 40, y: fire.y - i * 5, id: 1 }]); await wait(30); }
  r.fireAimUp = { dPitch: +(await g(() => window.__acePlays.player.pitch) - p0).toFixed(3) };
  await page.screenshot({ path: `${OUT}/${dev}-fire-aim.png` });
  // 2) Second finger on the right look zone while still firing.
  const y1 = await g(() => window.__acePlays.player.yaw);
  const lz = { x: w * 0.6, y: h * 0.35 };
  await touch('touchStart', [{ x: fire.x + 40, y: fire.y - 30, id: 1 }, { x: lz.x, y: lz.y, id: 2 }]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: fire.x + 40, y: fire.y - 30, id: 1 }, { x: lz.x - i * 6, y: lz.y, id: 2 }]); await wait(30); }
  r.fireAndLookZone = { dYaw: +(await g(() => window.__acePlays.player.yaw) - y1).toFixed(3), stillFiring: await g(() => window.__acePlays.input.mouseDown) };
  // lift finger 2 only
  await touch('touchEnd', [{ x: fire.x + 40, y: fire.y - 30, id: 1 }]);
  // 3) Fire + move: thumb 3 on the left move stick pushes up (forward) while firing.
  const pos0 = await g(() => window.__acePlays.player.position.toArray());
  const yawNow = await g(() => window.__acePlays.player.yaw);
  const js = { x: w * 0.15, y: h * 0.7 };
  await touch('touchStart', [{ x: fire.x + 40, y: fire.y - 30, id: 1 }, { x: js.x, y: js.y, id: 3 }]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: fire.x + 40, y: fire.y - 30, id: 1 }, { x: js.x, y: js.y - i * 10, id: 3 }]); await wait(20); }
  await wait(700);
  const pos1 = await g(() => window.__acePlays.player.position.toArray());
  const fwd = [-Math.sin(yawNow), 0, -Math.cos(yawNow)];
  const d = pos1.map((v, i) => v - pos0[i]);
  r.fireAndMove = { forward: +(d[0] * fwd[0] + d[2] * fwd[2]).toFixed(2), stillFiring: await g(() => window.__acePlays.input.mouseDown), bubblesFired: (await g(() => window.__acePlays.projectiles.bubbles.length)) - b0 };
  await page.screenshot({ path: `${OUT}/${dev}-fire-move.png` });
  await touch('touchEnd', [{ x: fire.x + 40, y: fire.y - 30, id: 1 }]);
  // 4) Edge-turn: thumb held still past the rim keeps turning right; further out = faster.
  await touch('touchEnd', []);
  await wait(200);
  await touch('touchStart', [{ x: fire.x, y: fire.y, id: 4 }]);
  await touch('touchMove', [{ x: fire.x - 90, y: fire.y, id: 4 }]);
  await wait(120);
  const e0 = await g(() => window.__acePlays.player.yaw);
  await wait(600);
  const e1 = await g(() => window.__acePlays.player.yaw);
  await touch('touchMove', [{ x: fire.x - 150, y: fire.y, id: 4 }]);
  await wait(120);
  const e2 = await g(() => window.__acePlays.player.yaw);
  await wait(600);
  const e3 = await g(() => window.__acePlays.player.yaw);
  r.edgeTurnLeft = { holdNear: +(e1 - e0).toFixed(3), holdFar: +(e3 - e2).toFixed(3), ring: await g(() => document.querySelector('.fs-ring').className) };
  await page.screenshot({ path: `${OUT}/${dev}-edge-turn.png` });
  await touch('touchEnd', []);
  await wait(150);
  r.afterRelease = { firing: await g(() => window.__acePlays.input.mouseDown), knob: await g(() => document.querySelector('.tbtn.fire').style.transform || 'none'), ring: await g(() => document.querySelector('.fs-ring').className) };
  // 5) Invert look: drag up looks down.
  await g(() => { window.__acePlays.save.settings.invertLook = true; return 1; });
  const q0 = await g(() => window.__acePlays.player.pitch);
  await touch('touchStart', [{ x: fire.x, y: fire.y, id: 5 }]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: fire.x, y: fire.y - i * 5, id: 5 }]); await wait(30); }
  r.invertUp = { dPitch: +(await g(() => window.__acePlays.player.pitch) - q0).toFixed(3) };
  await touch('touchEnd', []);
  await g(() => { window.__acePlays.save.settings.invertLook = false; return 1; });
  // 6) Slot taps: unlocked slot 2 switches; locked slot 4 nudges without switching.
  await wait(400);
  const s2 = await center(page, '.bslot[data-id="boing"]');
  await touch('touchStart', [{ x: s2.x, y: s2.y, id: 6 }]);
  await touch('touchEnd', []);
  await wait(400);
  r.slotBoing = await g(() => window.__acePlays.rig.current);
  const s4 = await center(page, '.bslot[data-id="glow"]');
  await touch('touchStart', [{ x: s4.x, y: s4.y, id: 7 }]);
  await touch('touchEnd', []);
  await wait(150);
  r.slotLocked = { current: await g(() => window.__acePlays.rig.current), nudged: await g(() => document.querySelector('.bslot[data-id="glow"]').classList.contains('nudge')), name: await g(() => document.querySelector('.blaster-name').textContent) };
  r.slotSize = await g(() => { const b = document.querySelector('.bslot').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; });
  const s1 = await center(page, '.bslot[data-id="bubble"]');
  await touch('touchStart', [{ x: s1.x, y: s1.y, id: 8 }]);
  await touch('touchEnd', []);
  await wait(300);
  r.slotBubble = await g(() => window.__acePlays.rig.current);
  r.mouseDownAfterSlots = await g(() => window.__acePlays.input.mouseDown);
  await page.screenshot({ path: `${OUT}/${dev}-slots.png` });
  results.push(r);
  await ctx.close();
}

// ---------------------------------------------------------------- layout
// Every HUD element on-screen, nothing overlapping (incl. the crosshair), both
// with a quiet HUD and with banner + caption + hint + timer requested at once.
const cases = [];
for (const [w, h] of [[360, 640], [390, 844], [844, 390], [640, 360]]) for (const tb of [0, 56, 110]) cases.push([w, h, tb]);
for (const [w, h] of [[874, 350], [874, 380], [402, 760]]) cases.push([w, h, 0]);
const layout = [];
for (const [w, h, toolbar] of cases) {
  for (const stage of ['meadow', 'coral']) {
    const ctx = await newCtx(UA.iphone, w, h, toolbar);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?stage=${stage}`);
    await page.waitForTimeout(2800);
    if (await page.evaluate(() => !!document.querySelector('.rotate-prompt.show'))) await page.click('.rotate-prompt [data-a=anyway]');
    for (const busy of [false, true]) {
      await page.evaluate((b) => {
        const G = window.__acePlays;
        if (G.state === 'paused') G.resume();
        G.audio.clearVoices();
        if (b) {
          G.ui.hint('[Click] to blow bubbles - pop the balloons!');
          G.ui.caption('ace', 'Bubble Park! My favourite place in the whole wide world!', 6);
          G.ui.banner('Pop the balloons with bubbles', 'Click to blow bubbles', 6);
          G.ui.setTimer(42.5, 'Balloon Dash · 3/10');
        } else {
          G.ui.hint(null);
          G.ui.setTimer(null);
          // expire banner/caption immediately
          G.ui.banner('x', '', 0.01); G.ui.caption('ace', 'x', 0);
        }
        return 1;
      }, busy);
      await page.waitForTimeout(busy ? 400 : 1900);
      const res = await page.evaluate(() => {
        const vh = window.visualViewport ? window.visualViewport.height : innerHeight;
        const vw = innerWidth;
        const sels = ['.objectives', '.stars-hud', '.blaster-bar', '.tbtn.fire', '.tbtn.jump', '.tbtn.swap', '.tbtn.tpause', '.tbtn.down', '.msg', '.timer', '.crosshair', '.hint', '.caption', '.banner'];
        const boxes = {};
        const off = [];
        for (const s of sels) {
          const el = document.querySelector(s);
          if (!el) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          boxes[s] = [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
          if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) off.push(s);
        }
        const hit = (a, b) => a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] - 1 && b[1] < a[3] - 1;
        const overlaps = [];
        const ks = Object.keys(boxes);
        for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) if (hit(boxes[ks[i]], boxes[ks[j]])) overlaps.push(`${ks[i]}~${ks[j]}`);
        return { vw, vh, msgKind: document.querySelector('.msg')?.className.replace('panel msg', '').trim(), shown: ks, off, overlaps, scrollW: document.documentElement.scrollWidth - innerWidth };
      });
      layout.push({ w, h, toolbar, stage, busy, ...res });
      if (busy && (toolbar === 0 || toolbar === 110)) await page.screenshot({ path: `${OUT}/layout-${stage}-${w}x${h}-tb${toolbar}-busy.png` });
    }
    await ctx.close();
  }
}
// Message priority / sequencing: banner > caption > hint, one at a time.
{
  const ctx = await newCtx(UA.iphone, 874, 350, 0);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?stage=meadow`);
  await page.waitForTimeout(2800);
  const seq = await page.evaluate(async () => {
    const G = window.__acePlays;
    G.audio.clearVoices();
    const kind = () => document.querySelector('.msg').className.match(/kind-(\w+)/)?.[1] ?? 'none';
    G.ui.hint('Hold the bubble button and slide to aim');
    G.ui.caption('ace', 'Woo-hoo!', 1.0);
    G.ui.banner('Big friend!', 'Here comes Biscuit', 1.0);
    const out = [kind()];
    await new Promise((r) => setTimeout(r, 1150));
    out.push(kind());
    await new Promise((r) => setTimeout(r, 600));
    out.push(kind());
    return out;
  });
  layout.push({ sequence: seq });
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, layout }, null, 1));
console.log(JSON.stringify({ results, layout: layout.map((l) => (l.sequence ? `sequence ${l.sequence.join(' > ')}` : `${l.stage} ${l.w}x${l.h} tb${l.toolbar} ${l.busy ? 'busy' : 'quiet'} msg=${l.msgKind || '-'}: off=[${l.off}] overlaps=[${l.overlaps}] sw=${l.scrollW}`)) }, null, 1));
