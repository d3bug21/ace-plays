import type { Input } from '../core/Input';
import { icon } from './icons';

/** Same pixel-to-look scale as the right-side drag-look zone. */
const LOOK_SCALE = 1.7;
/** Fire-stick ring radius (px). Past the rim the view keeps turning. */
const FIRE_R = 58;
/** Max continuous edge-turn speed in look pixels per second. */
const EDGE_TURN = 1150;

/**
 * On-screen controls for touch screens (tablets / phones playing the web build).
 *
 * - Left half: a floating move stick (up = forward, right = step right - the same
 *   Ace-relative frame as W/A/S/D).
 * - Right half: drag to look.
 * - Fire-stick: hold the bubble button to fire and slide the same thumb to aim.
 *   Pushing past the ring keeps turning in that direction, faster the further out,
 *   so kids can spin around without lifting their thumb.
 * - Buttons: jump (swim up), swim down, swap blaster, pause.
 *
 * Every finger is tracked by its own touch identifier, so moving, looking and
 * firing all work at the same time (true multi-touch). Everything feeds Input's
 * semantic actions, so sensitivity and invert-look settings apply as usual.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private fireId: number | null = null;
  private fireOrigin = { x: 0, y: 0 };
  private fireLast = { x: 0, y: 0 };
  private firePos = { x: 0, y: 0 };
  private fireBtn: HTMLElement;
  private fireRing: HTMLElement;
  private downBtn: HTMLElement;
  onPause: (() => void) | null = null;
  onBlasterCycle: (() => void) | null = null;

  constructor(parent: HTMLElement, private input: Input) {
    const r = document.createElement('div');
    r.className = 'touch-ui';
    r.innerHTML = `
      <div class="touch-zone left"></div><div class="touch-zone right"></div>
      <div class="stick"><div class="knob"></div></div>
      <div class="fs-ring" aria-hidden="true"></div>
      <button class="tbtn fire" aria-label="Hold to blow bubbles, slide to aim">${icon('bubble')}</button>
      <button class="tbtn jump" aria-label="Jump">${icon('updown')}<span>Jump</span></button>
      <button class="tbtn down" aria-label="Swim down"><span>Down</span></button>
      <button class="tbtn swap" aria-label="Swap blaster">${icon('swap')}<span>Swap</span></button>
      <button class="tbtn tpause" aria-label="Pause">${icon('pause')}</button>`;
    parent.appendChild(r);
    this.root = r;
    this.stick = r.querySelector('.stick') as HTMLElement;
    this.knob = r.querySelector('.knob') as HTMLElement;
    this.downBtn = r.querySelector('.down') as HTMLElement;
    this.fireBtn = r.querySelector('.fire') as HTMLElement;
    this.fireRing = r.querySelector('.fs-ring') as HTMLElement;
    const left = r.querySelector('.touch-zone.left') as HTMLElement;
    const right = r.querySelector('.touch-zone.right') as HTMLElement;
    left.addEventListener('touchstart', (e) => this.joyStart(e), { passive: false });
    right.addEventListener('touchstart', (e) => this.lookStart(e), { passive: false });
    this.fireBtn.addEventListener('touchstart', (e) => this.fireStart(e), { passive: false });
    window.addEventListener('touchmove', (e) => this.move(e), { passive: false });
    window.addEventListener('touchend', (e) => this.end(e));
    window.addEventListener('touchcancel', (e) => this.end(e));
    const hold = (sel: string, on: () => void, off: () => void) => {
      const b = r.querySelector(sel) as HTMLElement;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        b.classList.add('on');
        on();
      }, { passive: false });
      const up = (e: Event) => {
        e.preventDefault();
        b.classList.remove('on');
        off();
      };
      b.addEventListener('touchend', up);
      b.addEventListener('touchcancel', up);
    };
    hold('.jump', () => input.setVirtual('jump', true), () => input.setVirtual('jump', false));
    hold('.down', () => input.setVirtual('down', true), () => input.setVirtual('down', false));
    hold('.swap', () => this.onBlasterCycle?.(), () => undefined);
    hold('.tpause', () => this.onPause?.(), () => undefined);
    this.setVisible(false);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? '' : 'none';
    if (!v) this.reset();
  }

  setSwimming(on: boolean): void {
    this.downBtn.style.display = on ? '' : 'none';
    const j = this.root.querySelector('.jump span');
    if (j) j.textContent = on ? 'Up' : 'Jump';
  }

  /** True while the fire-stick is held (for tests / HUD). */
  get firing(): boolean {
    return this.fireId !== null;
  }

  private reset(): void {
    this.joyId = null;
    this.lookId = null;
    this.input.joyX = 0;
    this.input.joyY = 0;
    this.stick.classList.remove('show');
    this.releaseFire();
  }

  private joyStart(e: TouchEvent): void {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (this.joyId !== null) return;
    this.joyId = t.identifier;
    this.joyOrigin = { x: t.clientX, y: t.clientY };
    const box = this.root.getBoundingClientRect();
    this.stick.style.left = `${t.clientX - box.left}px`;
    this.stick.style.top = `${t.clientY - box.top}px`;
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.stick.classList.add('show');
  }

  private lookStart(e: TouchEvent): void {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (this.lookId !== null) return;
    this.lookId = t.identifier;
    this.lookLast = { x: t.clientX, y: t.clientY };
  }

  private fireStart(e: TouchEvent): void {
    e.preventDefault();
    if (this.fireId !== null) return;
    const t = e.changedTouches[0];
    this.fireId = t.identifier;
    const b = this.fireBtn.getBoundingClientRect();
    this.fireOrigin = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    this.fireLast = { x: t.clientX, y: t.clientY };
    this.firePos = { x: t.clientX, y: t.clientY };
    const box = this.root.getBoundingClientRect();
    this.fireRing.style.left = `${this.fireOrigin.x - box.left}px`;
    this.fireRing.style.top = `${this.fireOrigin.y - box.top}px`;
    this.fireRing.classList.add('show');
    this.fireBtn.classList.add('on');
    this.input.setTouchFire(true);
  }

  private releaseFire(): void {
    if (this.fireId !== null) this.input.setTouchFire(false);
    this.fireId = null;
    this.fireBtn.classList.remove('on');
    this.fireBtn.style.transform = '';
    this.fireRing.classList.remove('show', 'edge');
  }

  private move(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) {
        e.preventDefault();
        const R = 56;
        let dx = t.clientX - this.joyOrigin.x;
        let dy = t.clientY - this.joyOrigin.y;
        const d = Math.hypot(dx, dy);
        if (d > R) {
          dx = (dx / d) * R;
          dy = (dy / d) * R;
        }
        this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        const dead = 0.15;
        const nx = dx / R;
        const ny = -dy / R; // screen up = forward
        this.input.joyX = Math.abs(nx) > dead ? nx : 0;
        this.input.joyY = Math.abs(ny) > dead ? ny : 0;
      } else if (t.identifier === this.lookId) {
        e.preventDefault();
        this.input.addTouchLook((t.clientX - this.lookLast.x) * LOOK_SCALE, (t.clientY - this.lookLast.y) * LOOK_SCALE);
        this.lookLast = { x: t.clientX, y: t.clientY };
      } else if (t.identifier === this.fireId) {
        e.preventDefault();
        // Aim with the same thumb that is firing: drag right/left/up/down turns the view that way.
        this.input.addTouchLook((t.clientX - this.fireLast.x) * LOOK_SCALE, (t.clientY - this.fireLast.y) * LOOK_SCALE);
        this.fireLast = { x: t.clientX, y: t.clientY };
        this.firePos = { x: t.clientX, y: t.clientY };
        let dx = t.clientX - this.fireOrigin.x;
        let dy = t.clientY - this.fireOrigin.y;
        const d = Math.hypot(dx, dy);
        if (d > FIRE_R) {
          dx = (dx / d) * FIRE_R;
          dy = (dy / d) * FIRE_R;
        }
        this.fireBtn.style.transform = `translate(${dx}px, ${dy}px) scale(0.94)`;
        this.fireRing.classList.toggle('edge', d > FIRE_R);
      }
    }
  }

  private end(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.joyId) {
        this.joyId = null;
        this.input.joyX = 0;
        this.input.joyY = 0;
        this.stick.classList.remove('show');
      } else if (t.identifier === this.lookId) this.lookId = null;
      else if (t.identifier === this.fireId) this.releaseFire();
    }
  }

  /** Per-frame: continuous turning while the fire-stick is pushed past its rim. */
  update(dt: number): void {
    if (this.fireId === null) return;
    const dx = this.firePos.x - this.fireOrigin.x;
    const dy = this.firePos.y - this.fireOrigin.y;
    const d = Math.hypot(dx, dy);
    if (d <= FIRE_R) return;
    const past = Math.min(1, (d - FIRE_R) / 60);
    const speed = EDGE_TURN * (0.25 + 0.75 * past) * dt;
    // Mostly horizontal spinning; vertical edge-turn is gentler so the view doesn't flip.
    this.input.addTouchLook((dx / d) * speed, (dy / d) * speed * 0.45);
  }
}
