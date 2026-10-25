// Keyboard + mouse input routed through semantic actions.
// WASD and the arrow keys are aliases of the same four movement actions, so
// they can never disagree. Movement is applied relative to Ace's view by Player.

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump' // jump when walking, swim up when swimming
  | 'down' // swim down
  | 'fire'
  | 'prevBlaster'
  | 'nextBlaster'
  | 'blaster1'
  | 'blaster2'
  | 'blaster3'
  | 'blaster4'
  | 'pause'
  | 'hints';

const KEY_MAP: Record<string, Action> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'down',
  ShiftRight: 'down',
  KeyC: 'down',
  ControlLeft: 'down',
  KeyQ: 'prevBlaster',
  KeyE: 'nextBlaster',
  Digit1: 'blaster1',
  Digit2: 'blaster2',
  Digit3: 'blaster3',
  Digit4: 'blaster4',
  Numpad1: 'blaster1',
  Numpad2: 'blaster2',
  Numpad3: 'blaster3',
  Numpad4: 'blaster4',
  Escape: 'pause',
  KeyP: 'pause',
  KeyH: 'hints',
};

/** Keys whose browser default (scrolling, focus moves) must be suppressed while playing. */
const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

export class Input {
  private down = new Set<Action>();
  /** Actions held by on-screen touch buttons. */
  private virtual = new Set<Action>();
  /** Virtual joystick axes (-1..1), x = right, y = forward. */
  joyX = 0;
  joyY = 0;
  private codesDown = new Set<string>();
  private pressed = new Set<Action>();
  lookDX = 0;
  lookDY = 0;
  wheel = 0;
  mouseDown = false;
  mousePressed = false;
  mouseReleased = false;
  /** When false, game actions are ignored (menus are open). */
  gameActive = false;
  pointerLocked = false;
  private dragging = false;
  private lastDragX = 0;
  private lastDragY = 0;
  private target: HTMLElement;
  onPause: (() => void) | null = null;
  onPointerLockLost: (() => void) | null = null;
  /** True once the player has used the mouse/keyboard to look/move (for hints). */
  usedLook = false;
  usedMove = false;

  constructor(target: HTMLElement) {
    this.target = target;
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
    window.addEventListener('keyup', this.onKeyUp, { capture: true });
    window.addEventListener('blur', this.releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    target.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    target.addEventListener('wheel', this.onWheel, { passive: false });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const action = KEY_MAP[e.code];
    if (!this.gameActive) return;
    // Do not let a focused menu button eat movement keys while playing.
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (!action) return;
    if (e.repeat) return;
    this.codesDown.add(e.code);
    if (action === 'pause') {
      e.preventDefault();
      // With pointer lock, Escape is consumed by the browser to unlock; the
      // pointerlockchange handler opens the pause menu in that case.
      if (this.onPause) this.onPause();
      return;
    }
    if (!this.down.has(action)) this.pressed.add(action);
    this.down.add(action);
    if (action === 'forward' || action === 'back' || action === 'left' || action === 'right') this.usedMove = true;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const action = KEY_MAP[e.code];
    this.codesDown.delete(e.code);
    if (!action) return;
    // Only release the action when no other aliased key still holds it.
    for (const code of this.codesDown) if (KEY_MAP[code] === action) return;
    this.down.delete(action);
  };

  releaseAll = (): void => {
    this.down.clear();
    this.virtual.clear();
    this.joyX = 0;
    this.joyY = 0;
    this.codesDown.clear();
    this.pressed.clear();
    this.mouseDown = false;
    this.dragging = false;
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.gameActive) return;
    if (e.button === 0) {
      this.mouseDown = true;
      this.mousePressed = true;
    }
    if (!this.pointerLocked) {
      this.dragging = true;
      this.lastDragX = e.clientX;
      this.lastDragY = e.clientY;
      this.requestLock();
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) {
      if (this.mouseDown) this.mouseReleased = true;
      this.mouseDown = false;
    }
    this.dragging = false;
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.gameActive) return;
    if (this.pointerLocked) {
      // Guard against occasional giant spikes some platforms report on lock.
      const dx = Math.abs(e.movementX) > 400 ? 0 : e.movementX;
      const dy = Math.abs(e.movementY) > 400 ? 0 : e.movementY;
      this.lookDX += dx;
      this.lookDY += dy;
      if (dx || dy) this.usedLook = true;
    } else if (this.dragging) {
      this.lookDX += e.clientX - this.lastDragX;
      this.lookDY += e.clientY - this.lastDragY;
      this.lastDragX = e.clientX;
      this.lastDragY = e.clientY;
      this.usedLook = true;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.gameActive) return;
    e.preventDefault();
    this.wheel += Math.sign(e.deltaY);
  };

  private onLockChange = (): void => {
    const locked = document.pointerLockElement === this.target;
    const wasLocked = this.pointerLocked;
    this.pointerLocked = locked;
    if (wasLocked && !locked) {
      this.releaseAll();
      if (this.onPointerLockLost) this.onPointerLockLost();
    }
  };

  requestLock(): void {
    if (this.pointerLocked) return;
    try {
      const r = this.target.requestPointerLock() as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
    } catch {
      /* pointer lock unavailable - drag-to-look keeps working */
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(a: Action): boolean {
    return this.gameActive && (this.down.has(a) || this.virtual.has(a));
  }

  /** On-screen touch buttons press/release semantic actions. */
  setVirtual(a: Action, on: boolean): void {
    if (!this.gameActive) return;
    if (on) {
      if (!this.down.has(a) && !this.virtual.has(a)) this.pressed.add(a);
      this.virtual.add(a);
    } else this.virtual.delete(a);
  }

  /** Touch fire button acts like holding the left mouse button. */
  setTouchFire(on: boolean): void {
    if (!this.gameActive) return;
    if (on && !this.mouseDown) this.mousePressed = true;
    if (!on && this.mouseDown) this.mouseReleased = true;
    this.mouseDown = on;
  }

  addTouchLook(dx: number, dy: number): void {
    if (!this.gameActive) return;
    this.lookDX += dx;
    this.lookDY += dy;
    this.usedLook = true;
  }

  wasPressed(a: Action): boolean {
    return this.gameActive && this.pressed.has(a);
  }

  /** Call once per frame after the game consumed input. */
  endFrame(): void {
    this.pressed.clear();
    this.lookDX = 0;
    this.lookDY = 0;
    this.wheel = 0;
    this.mousePressed = false;
    this.mouseReleased = false;
  }

  /** Movement axes in Ace's own frame: x = right(+)/left(-), y = forward(+)/back(-). */
  moveAxes(): { x: number; y: number } {
    let x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    let y = (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0);
    if (this.gameActive && (this.joyX || this.joyY)) {
      x = Math.max(-1, Math.min(1, x + this.joyX));
      y = Math.max(-1, Math.min(1, y + this.joyY));
    }
    return { x, y };
  }
}
