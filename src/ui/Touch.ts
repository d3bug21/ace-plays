import type { Input } from '../core/Input';
import { icon } from './icons';

/**
 * On-screen controls for touch screens (tablets / phones playing the web build).
 * Left half: a floating joystick (up = forward, right = step right - the same
 * Ace-relative frame as W/A/S/D). Right half: drag to look. Buttons: blow/launch,
 * jump (swim up) and swim down. Everything feeds Input's semantic actions.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private downBtn: HTMLElement;
  onPause: (() => void) | null = null;
  onBlasterCycle: (() => void) | null = null;

  constructor(parent: HTMLElement, private input: Input) {
    const r = document.createElement('div');
    r.className = 'touch-ui';
    r.innerHTML = `
      <div class="touch-zone left"></div><div class="touch-zone right"></div>
      <div class="stick"><div class="knob"></div></div>
      <button class="tbtn fire" aria-label="Blow bubbles">${icon('bubble')}</button>
      <button class="tbtn jump" aria-label="Jump">${icon('updown')}<span>Jump</span></button>
      <button class="tbtn down" aria-label="Swim down"><span>Down</span></button>
      <button class="tbtn swap" aria-label="Switch blaster">${icon('retry')}</button>
      <button class="tbtn tpause" aria-label="Pause">${icon('pause')}</button>`;
    parent.appendChild(r);
    this.root = r;
    this.stick = r.querySelector('.stick') as HTMLElement;
    this.knob = r.querySelector('.knob') as HTMLElement;
    this.downBtn = r.querySelector('.down') as HTMLElement;
    const left = r.querySelector('.touch-zone.left') as HTMLElement;
    const right = r.querySelector('.touch-zone.right') as HTMLElement;
    left.addEventListener('touchstart', (e) => this.joyStart(e), { passive: false });
    right.addEventListener('touchstart', (e) => this.lookStart(e), { passive: false });
    window.addEventListener('touchmove', (e) => this.move(e), { passive: false });
    window.addEventListener('touchend', (e) => this.end(e));
    window.addEventListener('touchcancel', (e) => this.end(e));
    const hold = (sel: string, on: () => void, off: () => void) => {
      const b = r.querySelector(sel) as HTMLElement;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
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
    hold('.fire', () => input.setTouchFire(true), () => input.setTouchFire(false));
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

  private reset(): void {
    this.joyId = null;
    this.lookId = null;
    this.input.joyX = 0;
    this.input.joyY = 0;
    this.stick.classList.remove('show');
  }

  private joyStart(e: TouchEvent): void {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (this.joyId !== null) return;
    this.joyId = t.identifier;
    this.joyOrigin = { x: t.clientX, y: t.clientY };
    this.stick.style.left = `${t.clientX}px`;
    this.stick.style.top = `${t.clientY}px`;
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
        this.input.addTouchLook((t.clientX - this.lookLast.x) * 1.7, (t.clientY - this.lookLast.y) * 1.7);
        this.lookLast = { x: t.clientX, y: t.clientY };
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
    }
  }
}
