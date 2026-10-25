import * as THREE from 'three';
import { easeOutBack } from '../core/math';
import type { StageContext } from '../stages/types';
import { geo, mat, part } from '../kit/kit';
import type { Hittable, HitInfo, HitResponse, ProjectileKind } from './Hit';

// ---------------------------------------------------------------------------
// Collectible: bobbing, glinting pickup. Collected by walking/swimming close,
// or by tapping it with any projectile (kind to small hands).

export interface CollectibleOptions {
  objective: string;
  radius?: number;
  sfx?: string;
  /** Ace voice line on pickup (chance-based to avoid chatter). */
  say?: string;
  cheer?: string;
  glint?: number;
  onCollect?: (c: Collectible) => void;
  spin?: boolean;
  /** Sparkle colour. */
  color?: THREE.ColorRepresentation;
}

export class Collectible implements Hittable {
  readonly group = new THREE.Group();
  hitRadius: number;
  active = true;
  aimAssist = 0; // never steal aim from creatures
  collected = false;
  private base: THREE.Vector3;
  private ctx: StageContext;
  private o: CollectibleOptions;
  private t0 = Math.random() * 10;
  private glintT = Math.random() * 2;
  private out = 0;

  constructor(ctx: StageContext, pos: THREE.Vector3, model: THREE.Object3D, o: CollectibleOptions) {
    this.ctx = ctx;
    this.o = o;
    this.base = pos.clone();
    this.hitRadius = 0.5;
    this.group.position.copy(pos);
    this.group.add(model);
    ctx.root.add(this.group);
    ctx.hits.add(this);
  }

  hitCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.group.position);
  }

  accepts(_k: ProjectileKind): boolean {
    return this.active;
  }

  onHit(_info: HitInfo): HitResponse {
    this.collect();
    return 'pass';
  }

  collect(): void {
    if (this.collected) return;
    this.collected = true;
    this.active = false;
    const c = this.ctx;
    c.objectives.add(this.o.objective, 1);
    c.sfx(this.o.sfx ?? 'sfx_collect', { volume: 0.9 });
    c.fx.sparkle(this.group.position, 18, [this.o.color ?? 0xffe7a8, 0xfff8e8], 1.1);
    if (this.o.cheer) c.cheer(this.o.cheer);
    if (this.o.say && Math.random() < 0.7) c.say(this.o.say, 0);
    this.o.onCollect?.(this);
  }

  update(dt: number, t: number): void {
    if (this.collected) {
      this.out += dt;
      const k = Math.min(1, this.out / 0.35);
      this.group.scale.setScalar(Math.max(0.001, 1 + k * 0.6) * (1 - k));
      this.group.position.y += dt * 3;
      if (k >= 1) {
        this.group.removeFromParent();
        this.ctx.hits.remove(this);
      }
      return;
    }
    const tt = t + this.t0;
    this.group.position.y = this.base.y + Math.sin(tt * 2) * 0.12;
    if (this.o.spin !== false) this.group.rotation.y = tt * 1.4;
    this.glintT -= dt;
    if (this.glintT <= 0) {
      this.glintT = this.o.glint ?? 1.6;
      this.ctx.fx.glow.emit(this.group.position, { count: 1, shape: 1, size: 0.7, sizeEnd: 0.05, speed: 0, life: 0.6, color: this.o.color ?? 0xfff1c8, alpha: 0.55, fadeIn: 0.3 });
    }
    // Generous pickup radius around Ace's body.
    const p = this.ctx.player.position;
    const dx = p.x - this.group.position.x;
    const dz = p.z - this.group.position.z;
    const dy = p.y + 0.7 - this.group.position.y;
    const r = this.o.radius ?? 1.4;
    if (dx * dx + dz * dz + dy * dy * 0.5 < r * r) this.collect();
  }
}

// ---------------------------------------------------------------------------
// PopTarget: a friendly target (balloon, fruit pod, snowman hat...) that pops
// into soft sparkles. Used by tutorials and timed courses.

export interface PopTargetOptions {
  kinds?: ProjectileKind[];
  radius?: number;
  onPop?: (t: PopTarget, info: HitInfo | null) => void;
  sparkle?: THREE.ColorRepresentation[];
  sfx?: string;
  /** Gentle sway animation. */
  sway?: number;
  /** Proximity pop (swim rings): pop when Ace passes through within this radius. */
  touchRadius?: number;
}

export class PopTarget implements Hittable {
  readonly group = new THREE.Group();
  hitRadius: number;
  active = true;
  aimAssist = 1.2;
  label?: string;
  popped = false;
  private ctx: StageContext;
  private o: PopTargetOptions;
  private base: THREE.Vector3;
  private appear = 0;
  private popT = 0;
  private phase = Math.random() * 6;

  constructor(ctx: StageContext, pos: THREE.Vector3, model: THREE.Object3D, o: PopTargetOptions = {}) {
    this.ctx = ctx;
    this.o = o;
    this.base = pos.clone();
    this.hitRadius = o.radius ?? 0.7;
    this.group.position.copy(pos);
    this.group.add(model);
    this.group.scale.setScalar(0.001);
    ctx.root.add(this.group);
    ctx.hits.add(this);
  }

  hitCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.group.position);
  }

  accepts(k: ProjectileKind): boolean {
    if (!this.active || this.o.touchRadius) return false;
    return !this.o.kinds || this.o.kinds.includes(k);
  }

  onHit(info: HitInfo): HitResponse {
    this.pop(info);
    return info.kind === 'ball' ? 'bounce' : 'consume';
  }

  pop(info: HitInfo | null = null): void {
    if (this.popped) return;
    this.popped = true;
    this.active = false;
    this.ctx.fx.sparkle(this.group.position, 16, this.o.sparkle ?? [0xffe3a3, 0xfff8e8, 0xd6eef3], 1.1);
    this.ctx.fx.pop(this.group.position, 1.6);
    this.ctx.sfx(this.o.sfx ?? 'sfx_target_pop', { pos: this.group.position });
    this.o.onPop?.(this, info);
  }

  /** Bring a popped target back (for retries). */
  reset(): void {
    this.popped = false;
    this.active = true;
    this.appear = 0;
    this.popT = 0;
    this.group.visible = true;
    this.group.scale.setScalar(0.001);
    if (!this.group.parent) this.ctx.root.add(this.group);
  }

  hide(): void {
    this.active = false;
    this.group.visible = false;
  }

  update(dt: number, t: number): void {
    if (this.popped) {
      this.popT += dt;
      const k = Math.min(1, this.popT / 0.18);
      this.group.scale.setScalar(Math.max(0.001, 1 + k * 0.4) * (1 - k) + 0.001);
      if (k >= 1) this.group.visible = false;
      return;
    }
    if (!this.group.visible) return;
    this.appear = Math.min(1, this.appear + dt / 0.4);
    this.group.scale.setScalar(Math.max(0.001, easeOutBack(this.appear)));
    const sw = this.o.sway ?? 0.15;
    this.group.position.set(this.base.x + Math.sin(t * 0.9 + this.phase) * sw, this.base.y + Math.sin(t * 1.6 + this.phase) * sw, this.base.z);
    this.group.rotation.z = Math.sin(t * 1.3 + this.phase) * 0.12;
    if (this.o.touchRadius && this.active) {
      const eye = this.ctx.player.eyePosition(new THREE.Vector3());
      if (eye.distanceTo(this.group.position) < this.o.touchRadius) this.pop(null);
    }
  }
}

/** A soft balloon target (shared default look). */
export function balloonModel(color: THREE.ColorRepresentation = 0xe9a593): THREE.Group {
  const g = new THREE.Group();
  const m = mat(color, { rough: 0.35 });
  g.add(part(geo.sphere(24), m, [0, 0, 0], [0.45, 0.55, 0.45]));
  g.add(part(geo.cone(10), m, [0, -0.58, 0], [0.08, 0.1, 0.08], [Math.PI, 0, 0]));
  g.add(part(geo.cyl(1, 1, 6), mat(0xf6efe4), [0, -0.95, 0], [0.008, 0.7, 0.008]));
  g.add(part(geo.sphere(10), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.5 }), [-0.17, 0.22, 0.34], [0.07, 0.1, 0.04], [0, 0, 0], false));
  return g;
}

/** A floating ring (swim courses). */
export function ringModel(color: THREE.ColorRepresentation = 0xbfe6e6): THREE.Group {
  const g = new THREE.Group();
  const m = mat(color, { rough: 0.3, emissive: color, emissiveIntensity: 0.35 });
  g.add(part(geo.torus(0.09, Math.PI * 2, 40), m, [0, 0, 0], 1.3));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(part(geo.sphere(10), mat(0xf6fbfb, { emissive: 0xffffff, emissiveIntensity: 0.4 }), [Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0], 0.09, [0, 0, 0], false));
  }
  return g;
}

// ---------------------------------------------------------------------------
// Timed challenge: step on the start pad, 3-2-1-go, pop everything before the
// timer ends. Never punishing: time-out just says "so close" and resets.

export interface CourseOptions {
  objective: string;
  pad: THREE.Vector3;
  par: number;
  targets: { pos: THREE.Vector3; model: () => THREE.Object3D; facing?: number }[];
  kinds?: ProjectileKind[];
  title: string;
  intro?: string; // narrator line when first started
  /** Swim-ring mode: targets are popped by passing through them. */
  rings?: boolean;
  padColor?: THREE.ColorRepresentation;
}

export class TargetCourse {
  private ctx: StageContext;
  private o: CourseOptions;
  readonly pad = new THREE.Group();
  readonly targets: PopTarget[] = [];
  state: 'idle' | 'countdown' | 'running' | 'cooldown' = 'idle';
  private t = 0;
  private count = 0;
  private lastTick = -1;
  private announced = false;
  private padRing: THREE.Mesh;
  private padIcon: THREE.Group;
  won = false;

  constructor(ctx: StageContext, o: CourseOptions) {
    this.ctx = ctx;
    this.o = o;
    const col = o.padColor ?? 0xf2cf72;
    this.padRing = part(geo.torus(0.12, Math.PI * 2, 40), mat(col, { emissive: col, emissiveIntensity: 0.45, rough: 0.4 }), [0, 0.08, 0], [1.1, 1.1, 1.1], [Math.PI / 2, 0, 0], false);
    const disc = part(geo.cyl(1, 1, 36), mat(0xfaf3e2, { rough: 0.6, emissive: col, emissiveIntensity: 0.12 }), [0, 0.03, 0], [1.05, 0.05, 1.05], [0, 0, 0], false);
    this.pad.add(disc, this.padRing);
    // Floating stopwatch icon so kids can spot the challenge.
    this.padIcon = new THREE.Group();
    const face = part(geo.cyl(1, 1, 28), mat(0xfbf7ee, { rough: 0.5 }), [0, 0, 0], [0.32, 0.08, 0.32], [Math.PI / 2, 0, 0], false);
    const rim = part(geo.torus(0.14, Math.PI * 2, 28), mat(col, { rough: 0.4, emissive: col, emissiveIntensity: 0.3 }), [0, 0, 0], 0.33, [0, 0, 0], false);
    const knob = part(geo.cyl(1, 1, 10), mat(col), [0, 0.4, 0], [0.06, 0.1, 0.06], [0, 0, 0], false);
    const hand = part(geo.box(0.3), mat(0x45535e), [0, 0.1, 0.05], [0.03, 0.2, 0.02], [0, 0, 0], false);
    this.padIcon.add(face, rim, knob, hand);
    this.padIcon.position.y = 1.7;
    this.pad.add(this.padIcon);
    this.pad.position.copy(o.pad);
    if (!o.rings) this.pad.position.y = ctx.physics.groundHeight(o.pad.x, o.pad.z);
    ctx.root.add(this.pad);
    for (const td of o.targets) {
      const pt = new PopTarget(ctx, td.pos, td.model(), {
        kinds: o.kinds,
        touchRadius: o.rings ? 1.5 : undefined,
        sway: o.rings ? 0.05 : 0.15,
        sfx: o.rings ? 'sfx_ring_through' : 'sfx_target_pop',
        onPop: () => this.onPop(),
      });
      if (td.facing !== undefined) pt.group.rotation.y = td.facing;
      pt.hide();
      this.targets.push(pt);
    }
  }

  private onPop(): void {
    if (this.state !== 'running') return;
    this.count++;
    const left = this.targets.length - this.count;
    this.ctx.setTimer(Math.max(0, this.o.par - this.t), `${this.o.title} · ${this.count}/${this.targets.length}`);
    if (left === 0) this.finish(true);
    else if (left === 1) this.ctx.say('ace_one_more', 0);
  }

  private start(): void {
    this.state = 'countdown';
    this.t = 0;
    this.count = 0;
    this.lastTick = -1;
    this.ctx.banner(this.o.title, this.o.rings ? 'Swim through every ring!' : 'Pop them all before time runs out!', 2.4);
    if (!this.announced && this.o.intro) {
      this.ctx.narrate(this.o.intro);
      this.announced = true;
    }
  }

  private finish(win: boolean): void {
    this.state = 'cooldown';
    this.t = 0;
    this.ctx.setTimer(null);
    for (const tg of this.targets) if (!tg.popped) tg.hide();
    if (win) {
      const time = this.lastRunTime;
      this.ctx.recordChallengeTime(time);
      this.ctx.fx.celebrate(this.ctx.player.eyePosition(new THREE.Vector3()).add(this.ctx.player.viewForward(new THREE.Vector3()).multiplyScalar(3)), 1);
      this.ctx.sfx('sfx_objective');
      if (!this.won) {
        this.won = true;
        this.ctx.objectives.complete(this.o.objective);
        this.ctx.banner('Challenge complete!', `${time.toFixed(1)} seconds - super speedy!`, 3);
        this.ctx.say('ace_speedy', 1);
      } else {
        this.ctx.banner('Speedy again!', `${time.toFixed(1)} seconds`, 2.5);
        this.ctx.say('ace_woohoo', 0);
      }
    } else {
      this.ctx.banner('So close!', 'Hop on the pad to try again', 3);
      this.ctx.say('ace_almost', 1);
    }
  }

  private lastRunTime = 0;

  update(dt: number, t: number): void {
    for (const tg of this.targets) tg.update(dt, t);
    this.padRing.rotation.z += dt * 0.8;
    this.padIcon.rotation.y += dt * 1.2;
    this.padIcon.position.y = 1.7 + Math.sin(t * 2) * 0.1;
    this.padIcon.visible = this.state === 'idle';
    const p = this.ctx.player.position;
    const onPad = Math.hypot(p.x - this.pad.position.x, p.z - this.pad.position.z) < 1.3 && Math.abs(p.y - this.pad.position.y) < 2.2;
    if (this.state === 'idle') {
      if (onPad) this.start();
      return;
    }
    this.t += dt;
    if (this.state === 'countdown') {
      const n = 3 - Math.floor(this.t);
      if (n !== this.lastTick && n > 0) {
        this.lastTick = n;
        this.ctx.sfx('sfx_countdown');
        this.ctx.setTimer(this.o.par, `${n}...`);
      }
      if (this.t >= 3) {
        this.state = 'running';
        this.t = 0;
        this.ctx.sfx('sfx_go');
        this.ctx.say('ace_ready_set_go', 0);
        for (const tg of this.targets) tg.reset();
        this.ctx.setTimer(this.o.par, `${this.o.title} · 0/${this.targets.length}`);
      }
      return;
    }
    if (this.state === 'running') {
      const left = this.o.par - this.t;
      this.lastRunTime = this.t;
      this.ctx.setTimer(Math.max(0, left), `${this.o.title} · ${this.count}/${this.targets.length}`);
      if (left <= 5 && Math.ceil(left) !== this.lastTick) {
        this.lastTick = Math.ceil(left);
        this.ctx.sfx('sfx_tick');
      }
      if (left <= 0) this.finish(false);
      return;
    }
    if (this.state === 'cooldown') {
      // Wait until Ace steps off the pad before allowing a retry.
      if (this.t > 1.5 && !onPad) this.state = 'idle';
    }
  }
}

// ---------------------------------------------------------------------------
/** Sphere trigger zone. */
export class Zone {
  fired = false;
  constructor(
    private ctx: StageContext,
    public center: THREE.Vector3,
    public radius: number,
    private onEnter: () => void,
    private once = true,
    private use3d = false,
  ) {}

  update(): void {
    if (this.fired && this.once) return;
    const p = this.ctx.player.position;
    const dx = p.x - this.center.x;
    const dz = p.z - this.center.z;
    const dy = this.use3d ? p.y + 0.6 - this.center.y : 0;
    const inside = dx * dx + dz * dz + dy * dy < this.radius * this.radius;
    if (inside && !this.fired) {
      this.fired = true;
      this.onEnter();
    } else if (!inside && !this.once) this.fired = false;
  }
}

/** Golden star-shaped treasure model used as the default collectible look. */
export function starModel(color: THREE.ColorRepresentation = 0xf2cf72): THREE.Mesh {
  const shape = new THREE.Shape();
  const pts = 5;
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 === 0 ? 0.42 : 0.2;
    const a = (i / (pts * 2)) * Math.PI * 2 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3 });
  g.center();
  const m = new THREE.Mesh(g, mat(color, { rough: 0.35, metal: 0.1, emissive: color, emissiveIntensity: 0.25 }));
  m.castShadow = true;
  return m;
}
