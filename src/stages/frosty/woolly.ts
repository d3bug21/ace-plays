import * as THREE from 'three';
import { Creature } from '../../kit/Creature';
import { geo, mat, part } from '../../kit/kit';
import { clamp, damp, dampAngle, Rng } from '../../core/math';
import type { StageContext } from '../types';
import type { Hittable, HitInfo, HitResponse, ProjectileKind } from '../../gameplay/Hit';
import type { SphereCollider } from '../../core/Physics';
import { Shape } from '../../fx/Particles';
import { bake, CuteEyes } from './bake';
import { gradient, height, project, pointAt, valleyLine, WOOLLY, BOUNDS } from './layout';

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

// ===================================================================== Woolly

type WoollyState = 'idle' | 'catch' | 'juggle' | 'toss' | 'celebrate';

/**
 * Woolly the mammoth: huge, fluffy and friendly, with a long curling trunk and
 * small cute eyes. He trumpets cheerfully, flaps his ears and plays catch.
 */
export class Woolly extends Creature {
  state: WoollyState = 'idle';
  private head = new THREE.Group();
  private trunk: THREE.Group[] = [];
  private trunkTipObj = new THREE.Object3D();
  private ears: THREE.Group[] = [];
  private legs: THREE.Group[] = [];
  private tail = new THREE.Group();
  private eyes: CuteEyes;
  private breathe = 0;
  private trumpetT = 6;
  private raise = 0;
  private raiseTarget = 0;
  private earFlap = 0;
  private stomp = 0;
  private stateT = 0;
  private lastBoop = -10;
  /** Point Woolly is watching (null = Ace). */
  watch: THREE.Vector3 | null = null;
  /** Excited while waiting for the snowball. */
  eager = false;
  private juggle = 0;
  private turning = false;
  private turnAmt = 0;

  constructor(ctx: StageContext, pos: THREE.Vector3, heading: number) {
    super(ctx, { name: 'Woolly', size: 'huge', radius: 3.3, centerY: 3.2, grounded: true, label: 'Woolly the mammoth' });
    const fur = mat(0xbf957a, { rough: 1 });
    const furL = mat(0xd2ae95, { rough: 1 });
    const furD = mat(0xa98269, { rough: 1 });
    const snow = mat(0xf8f5f7, { rough: 0.9 });
    const pad = mat(0xe2cdbd, { rough: 0.9 });
    const tusk = mat(0xf6efe2, { rough: 0.45 });
    const pink = mat(0xf2ada6, { rough: 0.9 });
    const rng = new Rng(55);
    /** A hanging shaggy tuft (rounded, pointing down). */
    const tuft = (g: THREE.Group, x: number, y: number, z: number, w: number, h: number, m: THREE.Material, yaw = 0, tilt = 0) => {
      g.add(part(geo.sphere(12), m, [x, y, z], [w, h, w * 0.7], [tilt, yaw, 0]));
    };
    // --- Body (one baked mesh): smooth round forms + a shaggy skirt and snow on the back.
    const bg = new THREE.Group();
    bg.add(part(geo.sphere(32), fur, [0, 3.05, -0.1], [1.9, 1.72, 2.35]));
    bg.add(part(geo.sphere(28), fur, [0, 3.7, 0.85], [1.7, 1.55, 1.55]));
    bg.add(part(geo.sphere(28), fur, [0, 3.0, -1.35], [1.65, 1.5, 1.45]));
    // Two rows of shaggy fringe around the belly line.
    for (let row = 0; row < 2; row++) {
      const n = 30 - row * 4;
      for (let i = 0; i < n; i++) {
        const a = ((i + row * 0.5) / n) * Math.PI * 2;
        const rx = 1.82 - row * 0.12;
        const rz = 2.25 - row * 0.12;
        const y = 2.0 + row * 0.55 + Math.sin(a * 5 + row) * 0.05;
        tuft(bg, Math.sin(a) * rx, y, -0.1 + Math.cos(a) * rz, 0.34, 0.62, row ? furL : i % 3 ? fur : furD, a, Math.cos(a) * 0.12);
      }
    }
    // Soft mane over the shoulders.
    for (let i = 0; i < 12; i++) {
      const a = (i / 11 - 0.5) * 2.6;
      tuft(bg, Math.sin(a) * 1.55, 4.55 + Math.cos(a) * 0.3, 1.55 + Math.cos(a) * 0.15, 0.36, 0.5, furL, a, -0.4);
    }
    // Snow resting on his back (he's been waiting outside a while!).
    for (let i = 0; i < 7; i++) {
      const a = rng.range(-0.8, 0.8);
      const z = rng.range(-1.8, 0.6);
      bg.add(part(geo.sphere(14), snow, [Math.sin(a) * 1.0, 4.62 - Math.abs(a) * 0.5 - Math.abs(z + 0.5) * 0.12, z], [rng.range(0.4, 0.6), 0.16, rng.range(0.45, 0.7)], [0, rng.range(0, 3), a * 0.4]));
    }
    this.body.add(bake(bg, { rough: 1, shadow: true }));
    // --- Legs (pivot at the hip): smooth pillars in shaggy boots.
    const legPos: [number, number][] = [[-1.05, 1.25], [1.05, 1.25], [-1.05, -1.4], [1.05, -1.4]];
    for (const [x, z] of legPos) {
      const l = new THREE.Group();
      l.position.set(x, 2.1, z);
      const lg = new THREE.Group();
      lg.add(part(geo.capsule(1.6, 16), fur, [0, -1.0, 0], [0.6, 0.5, 0.6]));
      lg.add(part(geo.cyl(1, 1.04, 20), pad, [0, -2.02, 0], [0.6, 0.16, 0.6]));
      for (let k = -1; k <= 1; k++) lg.add(part(geo.sphere(10), tusk, [k * 0.27, -1.98, 0.52], [0.15, 0.12, 0.1]));
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        tuft(lg, Math.sin(a) * 0.6, -1.45, Math.cos(a) * 0.6, 0.24, 0.42, k % 2 ? furL : fur, a);
      }
      l.add(bake(lg, { rough: 1, shadow: true }));
      this.body.add(l);
      this.legs.push(l);
    }
    // --- Head
    this.head.position.set(0, 4.15, 1.85);
    const hg = new THREE.Group();
    hg.add(part(geo.sphere(32), fur, [0, 0.25, 0.55], [1.25, 1.2, 1.15]));
    hg.add(part(geo.sphere(28), fur, [0, 1.05, 0.3], [0.92, 0.85, 0.85]));
    // Little topknot of hair.
    for (let i = 0; i < 5; i++) tuft(hg, (i - 2) * 0.16, 1.88 - Math.abs(i - 2) * 0.05, 0.35, 0.16, 0.34, furL, 0, -0.5 + (i - 2) * 0.1);
    // Fluffy fringe over the forehead.
    for (let i = 0; i < 7; i++) tuft(hg, (i - 3) * 0.23, 0.98 - Math.abs(i - 3) * 0.05, 1.3 - Math.abs(i - 3) * 0.08, 0.2, 0.3, furL, 0, 0.5);
    for (const s of [-1, 1]) {
      hg.add(part(geo.sphere(16), furL, [s * 0.78, -0.18, 1.0], [0.42, 0.44, 0.36]));
      hg.add(part(geo.sphere(12), pink, [s * 0.68, 0.1, 1.42], [0.17, 0.1, 0.05], [0, s * 0.45, 0]));
      hg.add(part(geo.capsule(1, 8), furD, [s * 0.47, 0.86, 1.47], [0.055, 0.075, 0.055], [0, 0, s * 1.2]));
    }
    hg.add(part(geo.sphere(18), furL, [0, -0.3, 1.25], [0.62, 0.48, 0.5]));
    // Friendly curved tusks with soft round tips (smooth chain of spheres).
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(s * 0.48, -0.45, 1.3),
        new THREE.Vector3(s * 0.78, -1.15, 1.85),
        new THREE.Vector3(s * 0.62, -1.15, 2.55),
        new THREE.Vector3(s * 0.32, -0.62, 2.85),
      ]);
      for (let k = 0; k <= 22; k++) {
        const u = k / 22;
        const p = curve.getPoint(u);
        hg.add(part(geo.sphere(12), tusk, [p.x, p.y, p.z], 0.17 - u * 0.065));
      }
    }
    this.head.add(bake(hg, { rough: 1, shadow: true }));
    this.eyes = new CuteEyes({ size: 0.17, spacing: 1.0, y: 0.5, z: 1.48, side: 0.38, lashes: 1.1 });
    this.head.add(this.eyes.mesh);
    for (const s of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(s * 1.1, 0.45, 0.35);
      const eg = new THREE.Group();
      eg.add(part(geo.sphere(16), fur, [s * 0.1, -0.1, 0], [0.16, 0.55, 0.45]));
      eg.add(part(geo.sphere(12), pad, [s * 0.16, -0.1, 0.03], [0.06, 0.38, 0.3]));
      e.add(bake(eg, { rough: 1, shadow: true }));
      e.rotation.y = s * 0.3;
      this.head.add(e);
      this.ears.push(e);
    }
    // Trunk: a chain of overlapping soft segments with gentle wrinkle bands.
    let parent: THREE.Object3D = this.head;
    const segs = 10;
    for (let i = 0; i < segs; i++) {
      const g = new THREE.Group();
      const r = 0.42 - i * 0.022;
      const len = 0.42;
      g.position.set(0, i === 0 ? -0.15 : -len, i === 0 ? 1.55 : 0);
      const sg = new THREE.Group();
      sg.add(part(geo.capsule(1, 16), fur, [0, -len * 0.5, 0], [r, (len * 1.5) / 3, r]));
      if (i > 1) sg.add(part(geo.torus(0.07, Math.PI, 14), furD, [0, -len * 0.45, 0.02], [r * 0.99, r * 0.99, r * 0.99], [Math.PI / 2, 0, Math.PI]));
      if (i === segs - 1) {
        sg.add(part(geo.sphere(14), furL, [0, -len, 0.04], [r * 1.12, r * 0.62, r * 1.12]));
        sg.add(part(geo.sphere(10), pink, [0, -len - r * 0.45, 0.04], [r * 0.5, r * 0.16, r * 0.5]));
      }
      g.add(bake(sg, { rough: 1, shadow: true }));
      parent.add(g);
      this.trunk.push(g);
      parent = g;
    }
    this.trunkTipObj.position.set(0, -0.6, 0.1);
    parent.add(this.trunkTipObj);
    this.body.add(this.head);
    // Tail with a tuft.
    this.tail.position.set(0, 3.6, -2.4);
    const tg = new THREE.Group();
    tg.add(part(geo.capsule(1, 8), fur, [0, -0.45, -0.05], [0.12, 0.25, 0.12]));
    tg.add(part(geo.sphere(10), furD, [0, -0.95, -0.08], [0.22, 0.3, 0.22]));
    this.tail.add(bake(tg, { rough: 1, shadow: true }));
    this.body.add(this.tail);
    this.root.position.copy(pos);
    this.heading = heading;
    this.root.rotation.y = heading;
  }

  trunkTip(out: THREE.Vector3): THREE.Vector3 {
    return this.trunkTipObj.getWorldPosition(out);
  }

  override accepts(_kind: ProjectileKind): boolean {
    return this.active;
  }

  override canBubble(): boolean {
    return false;
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    const ctx = this.ctx;
    const t = ctx.time;
    if (info.kind === 'fizz') {
      // Tickly fizz: ears flap and the trunk wiggles with giggles.
      this.earFlap = Math.min(1.4, this.earFlap + 0.05);
      if (Math.random() < 0.02) ctx.sfx('sfx_giggle', { pos: this.root.position, rate: 0.7 });
      return 'consume';
    }
    this.earFlap = 1.2;
    this.eyes.beam(1);
    if (info.kind === 'bubble' || info.kind === 'bigBubble') {
      ctx.fx.sparkle(info.point, 6, [0xe9f6f8, 0xfff6e0], 0.7);
      if (t - this.lastBoop > 3) {
        this.lastBoop = t;
        ctx.fx.hearts(this.head.getWorldPosition(tmp).add(new THREE.Vector3(0, 2, 0)), 2);
      }
      return 'consume';
    }
    // Boing! A friendly boop on the fluff.
    ctx.fx.puff(info.point, 0xe9dccd, 4, 0.6);
    if (t - this.lastBoop > 2.5) {
      this.lastBoop = t;
      this.trumpet(0.55);
    }
    return 'bounce';
  }

  /** Cheerful trumpet: trunk up, notes in the air. */
  trumpet(volume = 1): void {
    this.raiseTarget = 1;
    this.stateT = 0;
    this.trumpetT = 0;
    this.ctx.sfx('sfx_mammoth_trumpet', { pos: this.root.position, volume, range: 70, jitter: 0.04 });
    this.ctx.fx.notes(this.trunkTip(tmp).add(new THREE.Vector3(0, 0.6, 0)), 4);
  }

  startCatch(): void {
    this.state = 'catch';
    this.stateT = 0;
    this.eyes.beam(1.5);
  }

  startJuggle(): void {
    this.state = 'juggle';
    this.stateT = 0;
  }

  startToss(): void {
    this.state = 'toss';
    this.stateT = 0;
  }

  celebrate(): void {
    this.state = 'celebrate';
    this.stateT = 0;
    this.eyes.beam(4);
    this.trumpet(1);
  }

  protected behave(dt: number, t: number): void {
    const ctx = this.ctx;
    this.settleToGround(dt);
    this.stateT += dt;
    this.trumpetT += dt;
    const focus = this.watch ?? ctx.player.position;
    // Slowly shuffle round to face what he's watching (the head does the rest).
    const want = this.angleTo(focus.x, focus.z);
    const diff = ((want - this.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (Math.abs(diff) > 0.55 && this.distanceToPlayer() > 2) this.turning = true;
    if (Math.abs(diff) < 0.06) this.turning = false;
    if (this.turning) this.heading += Math.sign(diff) * Math.min(Math.abs(diff), 0.32 * dt);
    this.turnAmt = damp(this.turnAmt, this.turning ? 1 : 0, 4, dt);
    this.root.rotation.y = this.heading;
    if (this.state === 'idle') {
      if (this.raiseTarget > 0 && this.stateT > 1.6) this.raiseTarget = 0;
      // Occasional happy trumpet when Ace is around.
      if (this.trumpetT > (this.eager ? 9 : 16) && this.distanceToPlayer() < 32) this.trumpet(this.eager ? 0.75 : 0.55);
      if (this.eager && Math.sin(t * 2.2) > 0.96) this.stomp = 1;
    } else if (this.state === 'catch') {
      this.raiseTarget = 0.65;
    } else if (this.state === 'juggle') {
      this.raiseTarget = 0.75;
      this.juggle = this.stateT;
    } else if (this.state === 'toss') {
      this.raiseTarget = 1.25;
    } else if (this.state === 'celebrate') {
      this.raiseTarget = Math.sin(this.stateT * 2.5) > 0 ? 1 : 0.3;
      if (Math.sin(this.stateT * 5) > 0.9) this.stomp = 1;
      if (Math.random() < dt * 3) ctx.fx.hearts(this.head.getWorldPosition(tmp).add(new THREE.Vector3(0, 2.6, 0)), 1);
      if (this.stateT > 6) {
        this.state = 'idle';
        this.stateT = 0;
        this.raiseTarget = 0;
      }
    }
  }

  protected animate(dt: number, t: number): void {
    this.eyes.update(dt);
    this.breathe += dt;
    const br = Math.sin(this.breathe * 1.1);
    this.body.position.y = br * 0.03;
    this.raise = damp(this.raise, this.raiseTarget, 3, dt);
    const r = this.raise;
    // Trunk: idle sway & curl, raised into a trumpet "S", or bobbing while juggling.
    const n = this.trunk.length;
    const jug = this.state === 'juggle' ? Math.sin(this.juggle * 7.2) : 0;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const idle = 0.05 + u * 0.12 + Math.sin(t * 1.3 - i * 0.55) * 0.09;
      const up = -0.33 + (u > 0.75 ? 0.25 : 0);
      this.trunk[i].rotation.x = idle * (1 - r) + up * r + jug * 0.06 * u;
      this.trunk[i].rotation.z = Math.sin(t * 0.8 - i * 0.4) * 0.05 * (1 - r);
    }
    // Head watches the focus point.
    const focus = this.watch ?? this.ctx.player.position;
    const hp = this.head.getWorldPosition(tmp);
    const a = Math.atan2(focus.x - hp.x, focus.z - hp.z);
    const yaw = clamp(((a - this.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -0.55, 0.55);
    this.head.rotation.y = dampAngle(this.head.rotation.y, yaw, 2.5, dt);
    const pitchWant = clamp(Math.atan2(focus.y + 1 - hp.y, Math.hypot(focus.x - hp.x, focus.z - hp.z)), -0.35, 0.35);
    this.head.rotation.x = damp(this.head.rotation.x, -pitchWant * 0.6 - r * 0.25 + br * 0.02, 2.5, dt);
    this.head.rotation.z = Math.sin(t * 0.6) * 0.04;
    // Ears flap (more when happy), tail swishes.
    this.earFlap = damp(this.earFlap, this.state === 'celebrate' || this.eager ? 0.6 : 0.15, 1.5, dt);
    this.ears.forEach((e, i) => {
      const s = i === 0 ? -1 : 1;
      e.rotation.y = s * (0.3 + Math.max(0, Math.sin(t * (2 + this.earFlap * 6) + i)) * 0.5 * this.earFlap);
    });
    this.tail.rotation.z = Math.sin(t * 2.4) * 0.35;
    this.tail.rotation.x = 0.3;
    // Happy stomps (front legs lift in turn).
    this.stomp = damp(this.stomp, 0, 2.2, dt);
    this.legs.forEach((l, i) => {
      const st = i < 2 ? -Math.max(0, Math.sin(t * 6 + i * Math.PI)) * 0.25 * this.stomp : 0;
      const walk = Math.sin(t * 3.2 + [0, Math.PI, Math.PI, 0][i]) * 0.16 * this.turnAmt;
      l.rotation.x = st + walk;
    });
  }
}

// =================================================================== Snowball

type BallState = 'rest' | 'roll' | 'reform' | 'caught' | 'juggle' | 'toss' | 'gone';

/**
 * The giant snowball Woolly wants to play catch with. Boing Balls (and the
 * fizz stream) push it; it rolls down the valley with simple rolling-ball
 * physics on the terrain, grows a little, and puffs snow. If it ever wanders
 * out of the valley it rolls back to the last checkpoint.
 */
export class Snowball implements Hittable {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  hitRadius = 2;
  active = true;
  aimAssist = 1.3;
  label = 'Giant snowball';
  state: BallState = 'rest';
  R = 1.6;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  private collider: SphereCollider;
  private ctx: StageContext;
  private travelled = 0;
  private puffT = 0;
  private offT = 0;
  private stateT = 0;
  private checkpoint = 0;
  private reformTo = new THREE.Vector3();
  private grad = { x: 0, z: 0 };
  private spinAxis = new THREE.Vector3();
  private wobble = 0;
  progress = 0;
  /** Pushing only counts while the Woolly objective is current. */
  enabled = false;
  onArrive: (() => void) | null = null;
  onCheckpoint: ((n: number) => void) | null = null;
  onReform: (() => void) | null = null;
  onNudgeDisabled: (() => void) | null = null;
  onFirstPush: (() => void) | null = null;
  private pushed = false;
  private tossV = new THREE.Vector3();

  constructor(ctx: StageContext) {
    this.ctx = ctx;
    // Lumpy snow sphere with soft lilac shading in the creases.
    const g = new THREE.SphereGeometry(1, 40, 28);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const cA = new THREE.Color(0xfbfafc);
    const cB = new THREE.Color(0xe6e3f0);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const n = Math.sin(x * 5.1 + y * 2.3) * Math.sin(y * 4.7 - z * 3.1) * Math.sin(z * 5.9 + x * 1.7);
      const k = 1 + n * 0.045;
      pos.setXYZ(i, x * k, y * k, z * k);
      c.copy(cA).lerp(cB, Math.min(1, Math.max(0, -n) * 1.2));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, mat(0xffffff, { vertexColors: true, rough: 0.92 }));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    ctx.root.add(this.group);
    ctx.hits.add(this);
    const start = pointAt(valleyLine, 0.0, new THREE.Vector3());
    this.pos.set(start.x, height(start.x, start.z) + this.R, start.z);
    this.collider = ctx.physics.add({ kind: 'sphere', center: this.pos.clone(), r: this.R, tag: 'snowball', bounciness: 0.6 });
    this.sync();
  }

  hitCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos);
  }

  accepts(_k: ProjectileKind): boolean {
    return this.active && (this.state === 'rest' || this.state === 'roll');
  }

  /** Downhill direction of the valley at the ball. */
  private tangent(out: THREE.Vector3): THREE.Vector3 {
    const p = project(this.pos.x, this.pos.z, valleyLine);
    return out.set(p.tx, 0, p.tz);
  }

  onHit(info: HitInfo): HitResponse {
    const ctx = this.ctx;
    const ball = info.kind === 'ball' || info.kind === 'glow';
    if (!this.enabled) {
      this.wobble = 1;
      if (info.kind !== 'fizz') {
        ctx.fx.puff(info.point, 0xf6f3f6, 4, 0.6);
        this.onNudgeDisabled?.();
      }
      return ball ? 'bounce' : 'consume';
    }
    const dirH = tmp.set(info.dir.x, 0, info.dir.z);
    if (dirH.lengthSq() < 1e-4) dirH.set(0, 0, 1);
    dirH.normalize();
    const tan = this.tangent(tmp2);
    let a = 0;
    let b = 0;
    if (ball) {
      a = 1.2;
      b = 1.6;
    } else if (info.kind === 'fizz') {
      a = 0.035;
      b = 0.045;
    } else if (info.kind === 'bigBubble') {
      a = 1.0;
      b = 1.4;
    } else {
      a = 0.3;
      b = 0.4;
    }
    // Pushes add up, but only to a gentle top speed (it's a big, heavy snowball).
    const before = Math.hypot(this.vel.x, this.vel.z);
    this.vel.addScaledVector(dirH, a).addScaledVector(tan, b);
    const after = Math.hypot(this.vel.x, this.vel.z);
    const cap = Math.max(before, 3.6);
    if (after > cap) {
      this.vel.x *= cap / after;
      this.vel.z *= cap / after;
    }
    this.clampSpeed();
    this.state = 'roll';
    this.wobble = Math.min(1, this.wobble + (ball ? 0.6 : 0.05));
    if (info.kind !== 'fizz') {
      ctx.fx.puff(info.point, 0xf6f3f6, 6, 0.8);
      ctx.sfx('sfx_snow_poof', { pos: this.pos, volume: 0.7, jitter: 0.1 });
    }
    if (!this.pushed) {
      this.pushed = true;
      this.onFirstPush?.();
    }
    return ball ? 'bounce' : 'consume';
  }

  /** Gentle shove when Ace walks into it. */
  nudge(dir: THREE.Vector3, dt: number): void {
    if (!this.enabled || (this.state !== 'rest' && this.state !== 'roll')) return;
    const along = this.vel.dot(dir);
    if (along < 1.9) this.vel.addScaledVector(dir, 6.5 * dt);
    const tan = this.tangent(tmp2);
    this.vel.addScaledVector(tan, 1.5 * dt);
    this.state = 'roll';
    if (!this.pushed) {
      this.pushed = true;
      this.onFirstPush?.();
    }
  }

  private clampSpeed(): void {
    const s = Math.hypot(this.vel.x, this.vel.z);
    const max = 4.6;
    if (s > max) {
      this.vel.x *= max / s;
      this.vel.z *= max / s;
    }
    this.vel.y = 0;
  }

  private sync(): void {
    this.group.position.copy(this.pos);
    this.mesh.scale.setScalar(this.R * (1 + Math.sin(this.ctx.time * 20) * 0.02 * this.wobble));
    this.hitRadius = this.R + 0.45;
    this.collider.center.copy(this.pos);
    this.collider.r = this.R * 0.98;
  }

  private sit(): void {
    this.pos.y = height(this.pos.x, this.pos.z) + this.R * 0.96;
  }

  /** Where the ball sits right now on its way down (0 = top, 1 = bottom). */
  private updateProgress(dt: number): void {
    const p = project(this.pos.x, this.pos.z, valleyLine);
    this.progress = p.s;
    const cps = [0.32, 0.62];
    for (let i = 0; i < cps.length; i++) {
      if (this.progress > cps[i] && this.checkpoint < i + 1) {
        this.checkpoint = i + 1;
        this.onCheckpoint?.(this.checkpoint);
      }
    }
    // Out of the valley? Roll back to the last checkpoint (never a dead end).
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (p.d > 5.4 || r > BOUNDS - 2) this.offT += dt;
    else this.offT = 0;
  }

  update(dt: number, t: number): void {
    const ctx = this.ctx;
    this.stateT += dt;
    this.wobble = damp(this.wobble, 0, 3, dt);
    switch (this.state) {
      case 'rest':
        this.vel.set(0, 0, 0);
        this.sit();
        break;
      case 'roll': {
        const sub = 3;
        const h = dt / sub;
        for (let k = 0; k < sub; k++) {
          gradient(this.pos.x, this.pos.z, this.grad);
          // Rolling sphere on a slope: a = -(5/7) g grad h, with sticky snow drag.
          const gx = -7.0 * this.grad.x;
          const gz = -7.0 * this.grad.z;
          this.vel.x += gx * h;
          this.vel.z += gz * h;
          const sp = Math.hypot(this.vel.x, this.vel.z);
          const fr = 3.4;
          if (sp > 1e-4) {
            const ns = Math.max(0, sp - fr * h);
            this.vel.x *= ns / sp;
            this.vel.z *= ns / sp;
          }
          this.pos.x += this.vel.x * h;
          this.pos.z += this.vel.z * h;
        }
        this.clampSpeed();
        const sp = Math.hypot(this.vel.x, this.vel.z);
        this.sit();
        // Roll the mesh to match the motion, and grow a little as it gathers snow.
        if (sp > 1e-3) {
          this.spinAxis.set(this.vel.z, 0, -this.vel.x).normalize();
          this.mesh.rotateOnWorldAxis(this.spinAxis, (sp * dt) / this.R);
          this.travelled += sp * dt;
          this.R = Math.min(2.0, 1.6 + this.travelled * 0.012);
        }
        this.puffT -= dt;
        if (sp > 0.7 && this.puffT <= 0) {
          this.puffT = 0.09;
          const back = tmp.set(-this.vel.x / sp, 0, -this.vel.z / sp);
          const at = tmp2.copy(this.pos).addScaledVector(back, this.R * 0.55);
          at.y = height(at.x, at.z) + 0.15;
          ctx.fx.puff(at, 0xf6f3f6, 2, 0.5 + sp * 0.08);
          if (Math.random() < 0.15) ctx.fx.soft.emit(at, { count: 3, shape: Shape.Dot, size: 0.12, sizeEnd: 0.05, speed: 2.2, life: 0.8, gravity: 6, color: 0xffffff, dir: UP, spread: 0.7 });
        }
        this.updateProgress(dt);
        if (this.offT > 1.2) {
          this.startReform();
          break;
        }
        const dw = Math.hypot(this.pos.x - WOOLLY.x, this.pos.z - WOOLLY.z);
        if (dw < 8.8 || this.progress > 0.96) {
          this.state = 'caught';
          this.stateT = 0;
          this.vel.set(0, 0, 0);
          this.onArrive?.();
        }
        break;
      }
      case 'reform': {
        const k = this.stateT;
        if (k < 0.45) {
          this.mesh.scale.setScalar(this.R * Math.max(0.01, 1 - k / 0.45));
          this.group.position.copy(this.pos);
          if (Math.random() < 0.5) ctx.fx.puff(this.pos, 0xf6f3f6, 3, 1.4);
          return;
        }
        if (k < 0.5) {
          this.pos.copy(this.reformTo);
          this.sit();
          ctx.fx.puff(this.pos, 0xf6f3f6, 12, 1.6);
          ctx.fx.sparkle(this.pos, 12, [0xffffff, 0xd6eef3], 1.4);
          ctx.sfx('sfx_snow_poof', { pos: this.pos });
        }
        const g = Math.min(1, (k - 0.5) / 0.5);
        this.mesh.scale.setScalar(this.R * Math.max(0.01, g));
        this.group.position.copy(this.pos);
        this.collider.center.copy(this.pos);
        if (g >= 1) {
          this.state = 'rest';
          this.offT = 0;
        }
        return;
      }
      case 'caught':
      case 'juggle':
      case 'toss':
        // Driven by the stage (Woolly's trunk).
        break;
      case 'gone':
        return;
    }
    this.sync();
    void t;
  }

  private startReform(): void {
    this.state = 'reform';
    this.stateT = 0;
    this.vel.set(0, 0, 0);
    this.offT = 0;
    const s = [0, 0.32, 0.62][this.checkpoint];
    pointAt(valleyLine, s, this.reformTo);
    this.reformTo.y = 0;
    this.ctx.sfx('sfx_snow_poof', { pos: this.pos });
    this.onReform?.();
  }

  /** Woolly takes over: place the ball (used for catch / juggle / toss). */
  placeAt(p: THREE.Vector3, spin: number, dt: number): void {
    this.pos.copy(p);
    this.mesh.rotateOnWorldAxis(UP, spin * dt);
    this.sync();
  }

  launch(v: THREE.Vector3): void {
    this.state = 'toss';
    this.stateT = 0;
    this.tossV.copy(v);
  }

  /** Simple ballistic flight after the toss; returns true at the apex. */
  flight(dt: number): boolean {
    this.tossV.y -= 11 * dt;
    this.pos.addScaledVector(this.tossV, dt);
    this.mesh.rotateOnWorldAxis(tmp.set(1, 0, 0.3).normalize(), dt * 3);
    this.sync();
    return this.tossV.y <= 0;
  }

  /** Burst into a shower of snowflake sparkles. */
  burst(): void {
    const ctx = this.ctx;
    this.state = 'gone';
    this.active = false;
    this.group.visible = false;
    this.collider.enabled = false;
    ctx.hits.remove(this);
    const c = this.pos;
    ctx.fx.glow.emit(c, { count: 160, shape: Shape.Sparkle, size: 0.55, sizeEnd: 0.12, speed: 9, speedJitter: 0.6, life: 3.4, lifeJitter: 0.4, drag: 1.6, gravity: 0.5, color: [0xffffff, 0xdff2fb, 0xe8dcf6, 0xfff1dc], alpha: 0.85, spinSpeed: 1.5, radius: 1.2, wobble: 1.2 });
    ctx.fx.soft.emit(c, { count: 140, shape: Shape.Dot, size: 0.22, sizeEnd: 0.14, speed: 7, speedJitter: 0.7, life: 4.5, lifeJitter: 0.4, drag: 1.4, gravity: 0.6, color: [0xffffff, 0xf2f6fb], alpha: 0.9, radius: 1.4, wobble: 1.5 });
    ctx.fx.soft.emit(c, { count: 1, shape: Shape.Ring, size: 3, sizeEnd: 14, speed: 0, life: 0.6, lifeJitter: 0, color: 0xffffff, alpha: 0.6, fadeIn: 0 });
    ctx.fx.celebrate(c, 2.2);
    ctx.sfx('sfx_snow_poof', { volume: 1 });
    ctx.sfx('sfx_big_pop', { volume: 0.9 });
  }

  /** Shrink the collider/visual while Woolly holds it (still fun-sized). */
  setRadius(r: number): void {
    this.R = r;
  }
}
