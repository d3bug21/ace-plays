// Full overlay / occlusion audit (local verification only).
//
// For every screen and state, every visible interactive element must receive
// the hit test (elementFromPoint) at its centre and at 4 inset points, inside
// the visible viewport. Visible text must not be clipped. Map nodes are tapped
// for real via CDP touch and must select that stage.
//
// Note: Ace Plays! has no canvas-picked targets: the world is interacted with
// through projectiles (physics), and the Adventure Map's stage nodes are DOM
// buttons, so they are covered by the DOM checks plus real taps.
//
//   node tests/occlusion.mjs --url http://localhost:5181 --ua ios|android|fb [--sizes all|quick] --out <dir>
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const BASE = arg('url', 'http://localhost:5181');
const OUT = arg('out', 'shots/occlusion');
const UA_NAME = arg('ua', 'ios');
fs.mkdirSync(OUT, { recursive: true });
const UAS = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  fb: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/512.0.0.41.104;FBSN/iOS;FBSV/18.5]',
};
const ALL = [];
for (const [w, h] of [[360, 640], [390, 844], [844, 390], [640, 360]]) for (const tb of [0, 56, 110]) ALL.push([w, h, tb]);
ALL.push([874, 350, 0], [874, 380, 0], [402, 760, 0]);
const SIZES = arg('sizes', 'all') === 'quick' ? [[874, 350, 0], [402, 760, 0], [640, 360, 110]] : ALL;
const STAGE_IDS = ['meadow', 'dino', 'coral', 'trench', 'frosty'];
const NAMES = { meadow: 'Bubble Park', dino: 'Dino Valley', coral: 'Coral Cove', trench: 'Twilight Trench', frosty: 'Frosty Peaks' };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

/** In-page audit of the current screen. */
function auditInPage(opts) {
  const vv = window.visualViewport;
  const VW = innerWidth;
  const VH = vv ? vv.height : innerHeight;
  const sel = 'button, a[href], [role=button], input, select, textarea, .bslot, .map-node, .seg button';
  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
    for (let e = el; e; e = e.parentElement) {
      const c = getComputedStyle(e);
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const describe = (e) => (e ? `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}${e.dataset && e.dataset.a ? '[' + e.dataset.a + ']' : ''}${e.dataset && e.dataset.id ? '#' + e.dataset.id : ''}` : 'null');
  const scrollParent = (el) => {
    for (let e = el.parentElement; e; e = e.parentElement) {
      const c = getComputedStyle(e);
      if (/(auto|scroll)/.test(c.overflowY + c.overflowX) && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)) return e;
    }
    return null;
  };
  const failures = [];
  let checked = 0;
  // Only the top interaction layer counts: an open rotate prompt or modal is
  // supposed to cover what is underneath it.
  const layer = document.querySelector('.rotate-prompt.show') || [...document.querySelectorAll('.modal-bg')].pop() || document.body;
  const els = [...document.querySelectorAll(sel)].filter((e) => layer.contains(e) && isVisible(e));
  for (const el of els) {
    // Reachable by scrolling? bring it into its scroll container's view first.
    const sp = scrollParent(el);
    if (sp) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    checked++;
    const pts = [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
    for (const [fx, fy] of pts) {
      const x = r.left + r.width * fx;
      const y = r.top + r.height * fy;
      if (x < 0 || y < 0 || x > VW || y > VH) {
        failures.push({ el: describe(el), point: [Math.round(x), Math.round(y)], hit: 'outside-viewport' });
        break;
      }
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === el || el.contains(hit))) {
        failures.push({ el: describe(el), text: (el.textContent || '').trim().slice(0, 24), point: [Math.round(x), Math.round(y)], hit: describe(hit) });
        break;
      }
    }
  }
  // Text clipping / truncation that hides meaning.
  const textSel = 'h1, h2, h3, p, li, .label, .btn, .goal, .obj span, .msg span, .map-title, .star-total, .res-reward b, .res-reward span, .lock-note span, .setting label, .desc, .what, .rp-card p, .blaster-name, .timer .lbl, .inapp-tip span, .caption .text, .cheer';
  const clipped = [];
  for (const el of document.querySelectorAll(textSel)) {
    if (!isVisible(el) && getComputedStyle(el).pointerEvents !== 'none') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    let hidden = false;
    for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) { hidden = true; break; } }
    if (hidden) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // Intentional, expandable ellipsis on the compact goals card.
    if (el.closest('.objectives:not(.expanded)') && el.closest('.obj.main')) continue;
    const inScroll = scrollParent(el);
    const clips = /(hidden|clip)/.test(cs.overflowX + cs.overflowY) || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== undefined && cs.webkitLineClamp !== '';
    if (clips && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2)) clipped.push({ el: describe(el), text: el.textContent.trim().slice(0, 40), why: 'overflow-clipped' });
    if (!inScroll && (r.left < -1 || r.right > VW + 1 || r.top < -1 || r.bottom > VH + 1)) clipped.push({ el: describe(el), text: el.textContent.trim().slice(0, 40), why: 'off-screen' });
  }
  return { checked, failures, clipped, scrollW: document.documentElement.scrollWidth - innerWidth };
}

const report = [];
for (const [w, h, tb] of SIZES) {
  const size = `${w}x${h}${tb ? '-tb' + tb : ''}`;
  const ctx = await b.newContext({ userAgent: UAS[UA_NAME], viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript((t) => {
    if (!t) return;
    const et = new EventTarget();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { get width() { return innerWidth; }, get height() { return innerHeight - t; }, offsetTop: 0, offsetLeft: 0, scale: 1, addEventListener: et.addEventListener.bind(et), removeEventListener: et.removeEventListener.bind(et) } });
  }, tb);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const wait = (ms) => p.waitForTimeout(ms);
  const audit = async (state, extra = {}) => {
    // Let bubble-wipe transitions finish first.
    for (let i = 0; i < 40 && (await p.evaluate(() => !!document.querySelector('.wipe'))); i++) await p.waitForTimeout(100);
    await p.waitForTimeout(150);
    const r = await p.evaluate(auditInPage, {});
    report.push({ ua: UA_NAME, size, state, ...r, ...extra });
    if (r.failures.length || r.clipped.length) await p.screenshot({ path: `${OUT}/${UA_NAME}-${size}-${state.replace(/[^a-z0-9]+/gi, '_')}.png` });
    return r;
  };
  const G = (fn, a) => p.evaluate(fn, a);
  const tapSel = async (s) => {
    const c = await p.evaluate((q) => { const els = [...document.querySelectorAll(q)].filter((e) => e.getBoundingClientRect().width > 0); const e = els[els.length - 1]; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, s);
    if (!c) throw new Error('no element ' + s);
    await p.touchscreen.tap(c.x, c.y);
  };
  try {
    await p.goto(`${BASE}/`);
    await wait(1500);
    const portrait = w < h;
    if (portrait) {
      await audit('rotate-prompt');
      await tapSel('.rotate-prompt [data-a=anyway]');
      await wait(300);
    }
    await audit('boot');
    await p.touchscreen.tap(w / 2, Math.min(h - tb, h) / 2);
    await wait(2600);
    await audit('title-with-tips', { tips: await G(() => document.querySelectorAll('.inapp-tip').length) });
    // Tips stay put: they must not cover anything on later screens either.
    await audit('title');
    await tapSel('.title [data-a=controls]');
    await wait(500);
    await audit('how-to-play');
    await tapSel('.modal [data-a=ok]');
    await wait(300);
    await tapSel('.title [data-a=settings]');
    await wait(500);
    await G(() => { const m = document.querySelector('.modal'); m.scrollTop = 0; });
    await audit('settings-top');
    await G(() => { const m = document.querySelector('.modal'); m.scrollTop = m.scrollHeight; });
    await wait(200);
    await audit('settings-bottom');
    await tapSel('.modal [data-a=done]');
    await wait(300);
    // ---- map at 3 unlock states, every stage selected via a real tap on its node
    const progress = {
      fresh: { stages: {}, blasters: ['bubble'], abilities: [], tutorialSeen: true, lastStage: null },
      partial: { stages: { meadow: { completed: true, stars: [true, false, false], bestTime: null, plays: 1 }, dino: { completed: true, stars: [true, true, false], bestTime: null, plays: 1 } }, blasters: ['bubble', 'boing', 'fizz'], abilities: [], tutorialSeen: true, lastStage: 'dino' },
      all: { stages: Object.fromEntries(STAGE_IDS.map((id) => [id, { completed: true, stars: [true, true, true], bestTime: 30, plays: 2 }])), blasters: ['bubble', 'boing', 'fizz', 'glow'], abilities: ['bigBubble'], tutorialSeen: true, lastStage: 'frosty' },
    };
    for (const [k, prog] of Object.entries(progress)) {
      await G((pg) => { const g = window.__acePlays; g.save.progress = JSON.parse(JSON.stringify(pg)); g.showMap(); }, prog);
      await wait(900);
      for (const id of STAGE_IDS) {
        const nodeHit = await p.evaluate((sid) => {
          const n = document.querySelector(`.map-node[data-id="${sid}"]`);
          const r = n.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + (n.querySelector('.disc').getBoundingClientRect().height / 2) };
        }, id);
        await p.touchscreen.tap(nodeHit.x, nodeHit.y);
        await wait(250);
        const selected = await G(() => document.querySelector('.stage-card h2')?.textContent.trim());
        const cardCheck = await G(() => {
          const body = document.querySelector('.stage-card .card-body');
          const note = document.querySelector('.stage-card .lock-note');
          const br = body.getBoundingClientRect();
          const out = { overflow: body.scrollHeight - body.clientHeight };
          if (note) { const nr = note.getBoundingClientRect(); out.noteVisible = nr.top >= br.top - 1 && nr.bottom <= br.bottom + 1; }
          return out;
        });
        const cardOk = cardCheck.overflow <= 1 && cardCheck.noteVisible !== false;
        await audit(`map-${k}-${id}`, { tapSelected: selected === NAMES[id], selected, cardOk, cardCheck });
      }
      // card arrows reach every stage too
      const seen = [];
      for (let i = 0; i < 5; i++) {
        await tapSel('.stage-card [data-a=next]');
        await wait(120);
        seen.push(await G(() => document.querySelector('.stage-card h2')?.textContent.trim()));
      }
      report.push({ ua: UA_NAME, size, state: `map-${k}-arrows`, arrowsReachAll: new Set(seen).size === 5, checked: 0, failures: [], clipped: [] });
    }
    // ---- stage intros for all 5 stages
    await G(() => { const g = window.__acePlays; g.save.progress = { stages: Object.fromEntries(['meadow', 'dino', 'coral', 'trench', 'frosty'].map((id) => [id, { completed: true, stars: [true, false, false], bestTime: null, plays: 1 }])), blasters: ['bubble', 'boing', 'fizz', 'glow'], abilities: ['bigBubble'], tutorialSeen: true, lastStage: 'meadow' }; });
    for (const id of STAGE_IDS) {
      await G((sid) => window.__acePlays.enterStage(sid), id);
      await p.waitForFunction(() => document.querySelectorAll('.screen.intro').length === 1 && !!document.querySelector('.intro [data-a=go]') && !document.querySelector('.wipe'), null, { timeout: 20000 });
      await wait(400);
      await audit(`intro-${id}`);
    }
    // ---- play Bubble Park: HUD quiet/busy, unlock popup, pause, results 1-3 stars + retry
    await G(() => window.__acePlays.enterStage('meadow'));
    await p.waitForFunction(() => document.querySelectorAll('.screen.intro').length === 1 && !!document.querySelector('.intro [data-a=go]') && !document.querySelector('.wipe'), null, { timeout: 20000 });
    await tapSel('.intro [data-a=go]');
    await wait(1800);
    if (await G(() => !!document.querySelector('.rotate-prompt.show'))) { await audit('rotate-prompt-midstage'); await tapSel('.rotate-prompt [data-a=anyway]'); await wait(300); }
    await G(() => { const g = window.__acePlays; if (g.state === 'paused') g.resume(); g.audio.clearVoices(); g.ui.hint(null); return 1; });
    await wait(300);
    await audit('hud-quiet');
    await G(() => { const g = window.__acePlays; g.ui.hint('[Click] to blow bubbles - pop the balloons!'); g.ui.caption('ace', 'Bubble Park! My favourite place in the whole wide world!', 5); g.ui.banner('Pop the balloons with bubbles', 'Click to blow bubbles', 5); g.ui.setTimer(40, 'Balloon Dash · 2/10'); g.ui.unlockToast('New blaster: Boing Ball!', 'Bouncy balls boing off walls.', 'ball'); return 1; });
    await wait(400);
    const toastCheck = await G(() => {
      const t = document.querySelector('.toast-unlock');
      const c = document.querySelector('.crosshair');
      if (!t || !c) return { ok: true, none: true };
      const a = t.getBoundingClientRect(); const b2 = c.getBoundingClientRect();
      const hit = a.left < b2.right && b2.left < a.right && a.top < b2.bottom && b2.top < a.bottom;
      const ic = t.querySelector('svg').getBoundingClientRect();
      return { ok: !hit && ic.width >= 30, iconW: Math.round(ic.width), hit };
    });
    await audit('hud-busy', { toastOk: toastCheck.ok, toastCheck });
    await G(() => { const g = window.__acePlays; g.ui.setTimer(null); const o = document.querySelector('.objectives'); o && o.classList.add('expanded'); return 1; });
    await audit('hud-goals-expanded');
    await G(() => { document.querySelector('.objectives')?.classList.remove('expanded'); return 1; });
    await tapSel('.tbtn.tpause');
    await wait(500);
    await audit('pause');
    await tapSel('.modal [data-a=resume]');
    await wait(300);
    for (const stars of [1, 2, 3]) {
      await G((n) => { const g = window.__acePlays; if (g.state !== 'playing') return 0; for (const o of g.objectives.list) { if (o.def.kind === 'main') g.objectives.complete(o.def.id); if (o.def.kind === 'treasure' && n >= 2) g.objectives.complete(o.def.id); if (o.def.kind === 'challenge' && n >= 3) g.objectives.complete(o.def.id); } g.finishStage(); return 1; }, stars);
      await p.waitForSelector('.res-actions', { timeout: 15000 });
      await wait(3000);
      const resCheck = await G(() => {
        const panel = document.querySelector('.res-panel');
        const pr = panel.getBoundingClientRect();
        const inside = (e) => { const r = e.getBoundingClientRect(); return r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1; };
        return { h2: inside(panel.querySelector('h2')), stars: [...panel.querySelectorAll('.res-stars .rs')].every(inside), scrollTop: panel.scrollTop };
      });
      await audit(`results-${stars}star`, { resultsOk: resCheck.h2 && resCheck.stars, resCheck });
      // retry -> intro -> play again
      await tapSel('.res-actions [data-a=replay]');
      await p.waitForFunction(() => document.querySelectorAll('.screen.intro').length === 1 && !!document.querySelector('.intro [data-a=go]') && !document.querySelector('.wipe'), null, { timeout: 20000 });
      await audit(`retry-intro-${stars}`);
      await tapSel('.intro [data-a=go]');
      await wait(1800);
      if (await G(() => !!document.querySelector('.rotate-prompt.show'))) { await tapSel('.rotate-prompt [data-a=anyway]'); await wait(300); }
      await G(() => { const g = window.__acePlays; if (g.state === 'paused') g.resume(); return g.state; });
    }
    // Ending is reached from results (HUD already gone), like the real flow.
    await G(() => { const g = window.__acePlays; for (const o of g.objectives.list) g.objectives.complete(o.def.id); g.finishStage(); return 1; });
    await p.waitForSelector('.res-actions', { timeout: 15000 });
    await wait(1500);
    await G(() => window.__acePlays.ui.showEnding(() => undefined));
    await wait(700);
    await audit('ending');
  } catch (e) {
    report.push({ ua: UA_NAME, size, state: 'ERROR', error: String(e).slice(0, 300), checked: 0, failures: [], clipped: [] });
    await p.screenshot({ path: `${OUT}/${UA_NAME}-${size}-ERROR.png` }).catch(() => {});
  }
  report.push({ ua: UA_NAME, size, state: 'page-errors', errs, checked: 0, failures: errs.map((m) => ({ el: 'pageerror', hit: m })), clipped: [] });
  await ctx.close();
}
await b.close();
fs.writeFileSync(`${OUT}/report-${UA_NAME}.json`, JSON.stringify(report, null, 1));
const bad = report.filter((r) => r.failures.length || r.clipped.length || r.tapSelected === false || r.arrowsReachAll === false || r.cardOk === false || r.resultsOk === false || r.toastOk === false || r.state === 'ERROR' || (r.scrollW && r.scrollW > 0));
console.log(JSON.stringify({ ua: UA_NAME, states: report.length, interactiveChecks: report.reduce((s, r) => s + (r.checked || 0), 0), bad: bad.map((r) => ({ size: r.size, state: r.state, failures: r.failures.slice(0, 4), clipped: r.clipped.slice(0, 4), tapSelected: r.tapSelected, card: r.cardCheck, res: r.resCheck, toast: r.toastCheck, error: r.error, scrollW: r.scrollW })) }, null, 1));
