import * as THREE from 'three';
import { Creature, Wander } from '../../kit/Creature';
import { geo, mat, part } from '../../kit/kit';
import { clamp, damp, dampAngle } from '../../core/math';
import type { StageContext } from '../types';
import type { HitInfo, HitResponse, ProjectileKind } from '../../gameplay/Hit';
import type { Ball } from '../../gameplay/Projectiles';
import { bake, CuteEyes } from './bake';
import { onPond, slideLine, pointAt, project, slideFloor } from './layout';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

// =================================================================== Penguin

type PenguinState = 'wander' | 'glide' | 'climb' | 'ready' | 'slide' | 'enterHome' | 'home' | 'party';

export interface PenguinOptions {
  chick?: boolean;
  slider?: boolean;
  region: THREE.Vector3;
  regionR: number;
  scarf: number;
  /** Float target in front of the cosy igloo door. */
  door: THREE.Vector3;
  /** A point inside the igloo tunnel where penguins disappear. */
  inside: THREE.Vector3;
}

/**
 * Penguins waddle with a side-to-side rock, toboggan on their bellies across
 * the ice and ride the slide. Too heavy for little bubbles (they giggle and
 * wobble), but a big charged bubble floats them home to the cosy igloo.
 */
export class Penguin extends Creature {
  state: PenguinState = 'wander';
  readonly o: PenguinOptions;
  private rig = new THREE.Group();
  private head = new THREE.Group();
  private eyes: CuteEyes;
  private flippers: THREE.Group[] = [];
  private feet: THREE.Group[] = [];
  private scarf: THREE.Mesh;
  private wander: Wander;
  private stepPhase = Math.random() * 6;
  private walkAmt = 0;
  private slideAmt = 0;
  private stateT = 0;
  private glideV = new THREE.Vector3();
  private slideS = 0;
  private slideSpeed = 0;
  private climbIdx = 0;
  private climbPts: THREE.Vector3[] = [];
  private wobble = 0;
  private lookT = 0;
  private lookYaw = 0;
  private squeakT = 3 + Math.random() * 6;
  private flap = 0;
  private partyAngle = 0;
  /** Counted as home (inside the igloo, or partying after). */
  isHome = false;
  onHome: ((p: Penguin) => void) | null = null;
  onTooHeavy: ((p: Penguin) => void) | null = null;
  onLifted: ((p: Penguin) => void) | null = null;

  constructor(ctx: StageContext, pos: THREE.Vector3, o: PenguinOptions) {
    super(ctx, { name: 'Penguin', size: 'medium', radius: o.chick ? 0.5 : 0.6, centerY: o.chick ? 0.4 : 0.5, grounded: true, shadow: o.chick ? 0.45 : 0.6, giggleSfx: 'sfx_penguin_squeak', label: o.chick ? 'Penguin chick' : 'Penguin' });
    this.o = o;
    const chick = !!o.chick;
    const dark = mat(chick ? 0xb7bccb : 0x3f4a5f, { rough: 0.8 });
    const darkSoft = mat(chick ? 0xc8ccd8 : 0x4b5770, { rough: 0.85 });
    const cream = mat(0xf8f5ef, { rough: 0.85 });
    const peach = mat(0xf0b27a, { rough: 0.6 });
    const pink = mat(0xf1b6b2, { rough: 0.9 });
    this.body.add(this.rig);
    const torso = new THREE.Group();
    torso.add(part(geo.sphere(24), dark, [0, 0.42, 0], [0.3, 0.38, 0.28]));
    torso.add(part(geo.sphere(20), cream, [0, 0.39, 0.13], [0.235, 0.31, 0.17]));
    torso.add(part(geo.cone(8), dark, [0, 0.13, -0.24], [0.08, 0.14, 0.04], [-2.1, 0, 0]));
    if (chick) for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      torso.add(part(geo.sphere(8), darkSoft, [Math.sin(a) * 0.27, 0.5 + Math.cos(a * 2) * 0.08, Math.cos(a) * 0.2 - 0.04], 0.09));
    }
    this.rig.add(bake(torso, { rough: 0.85 }));
    // Head (separate so it can look around and tilt).
    this.head.position.set(0, 0.62, 0);
    const hg = new THREE.Group();
    hg.add(part(geo.sphere(22), dark, [0, 0.18, 0.02], [0.215, 0.2, 0.2]));
    hg.add(part(geo.sphere(18), cream, [0, 0.16, 0.1], [0.16, 0.13, 0.14]));
    for (const s of [-1, 1]) hg.add(part(geo.sphere(12), cream, [s * 0.065, 0.2, 0.13], [0.09, 0.1, 0.09]));
    hg.add(part(geo.cone(10), peach, [0, 0.14, 0.27], [0.045, 0.11, 0.035], [Math.PI / 2, 0, 0]));
    for (const s of [-1, 1]) hg.add(part(geo.sphere(8), pink, [s * 0.105, 0.12, 0.2], [0.04, 0.025, 0.02], [0, s * 0.5, 0]));
    if (chick) {
      hg.add(part(geo.sphere(8), darkSoft, [0, 0.4, 0], [0.05, 0.07, 0.05], [0.3, 0, 0]));
      hg.add(part(geo.sphere(8), darkSoft, [0.04, 0.39, -0.03], [0.04, 0.06, 0.04], [0.3, 0, -0.5]));
    }
    this.head.add(bake(hg, { rough: 0.8 }));
    this.eyes = new CuteEyes({ size: 0.034, spacing: 0.13, y: 0.21, z: 0.225, side: 0.28 });
    this.head.add(this.eyes.mesh);
    this.rig.add(this.head);
    // Flippers and feet.
    for (const s of [-1, 1]) {
      const f = new THREE.Group();
      f.position.set(s * 0.27, 0.6, 0);
      f.add(bake(new THREE.Group().add(part(geo.sphere(14), dark, [0, -0.17, 0], [0.045, 0.2, 0.11])), { rough: 0.8 }));
      this.rig.add(f);
      this.flippers.push(f);
      const ft = new THREE.Group();
      ft.position.set(s * 0.1, 0, 0.1);
      ft.add(bake(new THREE.Group().add(part(geo.sphere(12), peach, [0, 0.02, 0.04], [0.075, 0.03, 0.11])), { rough: 0.6 }));
      this.rig.add(ft);
      this.feet.push(ft);
    }
    // Knitted scarf: worn once Ace has helped this penguin home.
    const sc = mat(o.scarf, { rough: 0.95 });
    const sg = new THREE.Group();
    sg.add(part(geo.torus(0.4, Math.PI * 2, 20), sc, [0, 0, 0], [0.22, 0.22, 0.22], [Math.PI / 2, 0, 0]));
    sg.add(part(geo.box(0.3), sc, [0.12, -0.12, 0.17], [0.08, 0.2, 0.04], [0.3, 0, 0.3]));
    this.scarf = bake(sg, { rough: 0.95 });
    this.scarf.position.set(0, 0.64, 0.01);
    this.scarf.visible = false;
    this.rig.add(this.scarf);
    if (chick) this.root.scale.setScalar(0.74);
    this.root.position.copy(pos);
    this.heading = ctx.rng.range(0, Math.PI * 2);
    this.root.rotation.y = this.heading;
    this.wander = new Wander(o.region.clone(), o.regionR, 0.9, () => ctx.rng.next(), null, [1, 4]);
    if (o.slider) {
      // Climb path: up the hill beside the chute (east side), bottom to top.
      for (let i = 0; i <= 6; i++) {
        const s = 1 - i / 6;
        const p = pointAt(slideLine, s, new THREE.Vector3());
        const pr = project(p.x, p.z, slideLine);
        // Perpendicular (east side of the chute).
        p.x += pr.tz * 2.9;
        p.z += -pr.tx * 2.9;
        this.climbPts.push(p);
      }
      this.state = 'climb';
      this.climbIdx = 0;
    }
  }

  override canBubble(kind: ProjectileKind): boolean {
    if (this.isHome && this.state !== 'party') return false;
    if (kind === 'bubble') return !this.ctx.hasAbility('bigBubble');
    return kind === 'bigBubble';
  }

  override accepts(kind: ProjectileKind): boolean {
    if (this.state === 'home' || this.state === 'enterHome') return false;
    return super.accepts(kind);
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    if (info.kind === 'bubble' || info.kind === 'bigBubble') {
      if (this.canBubble(info.kind) && !this.isHome) {
        this.floatTarget = this.o.door.clone();
        const d = this.root.position.distanceTo(this.o.door);
        this.slideAmt = 0;
        this.bubbleWrap(clamp(2.8 + d / 6.5, 3.4, 7.5), 1.8);
        this.onLifted?.(this);
        return 'consume';
      }
      if (this.canBubble(info.kind)) {
        this.floatTarget = null;
        this.bubbleWrap(3.2, 1.6);
        return 'consume';
      }
      // Too heavy: the little bubble boops off and the penguin giggles and wobbles.
      this.wobble = 1;
      this.giggleBounce();
      this.face();
      this.onTooHeavy?.(this);
      return 'consume';
    }
    if (info.kind === 'ball' || info.kind === 'glow') {
      // Bonk! A happy belly-flop toboggan.
      this.ctx.sfx('sfx_penguin_squeak', { pos: this.root.position, rate: 1.1 });
      this.ctx.fx.hearts(this.hitCenter(tmpV).add(new THREE.Vector3(0, 0.4, 0)), 2);
      if (this.state === 'wander' || this.state === 'party') this.startGlide(Math.atan2(info.dir.x, info.dir.z), 3.2);
      else this.giggleBounce();
      return 'bounce';
    }
    return super.defaultReaction(info);
  }

  private face(): void {
    this.eyes.beam(0.8);
  }

  private startGlide(dirAngle: number, speed: number): void {
    this.state = 'glide';
    this.stateT = 0;
    this.heading = dirAngle;
    this.root.rotation.y = dirAngle;
    this.glideV.set(Math.sin(dirAngle) * speed, 0, Math.cos(dirAngle) * speed);
    this.ctx.sfx('sfx_penguin_squeak', { pos: this.root.position, volume: 0.7 });
  }

  /** Called by the stage once all penguins are home: out they come, in scarves. */
  party(at: THREE.Vector3, angle: number): void {
    this.state = 'party';
    this.isHome = true;
    this.root.visible = true;
    this.active = true;
    this.scarf.visible = true;
    this.root.position.copy(at);
    this.partyAngle = angle;
    this.eyes.beam(2);
  }

  protected behave(dt: number, t: number): void {
    const ctx = this.ctx;
    const p = this.root.position;
    this.stateT += dt;
    this.squeakT -= dt;
    if (this.squeakT <= 0) {
      this.squeakT = 6 + ctx.rng.range(0, 9);
      if (this.distanceToPlayer() < 18 && this.state !== 'home') ctx.sfx('sfx_penguin_squeak', { pos: p, volume: 0.45, range: 22 });
    }
    // Just popped out of the float bubble near the door?
    if (this.floatTarget && this.reaction === 'none') {
      const near = Math.hypot(p.x - this.o.door.x, p.z - this.o.door.z) < 3.2;
      this.floatTarget = null;
      if (near && !this.isHome) {
        this.state = 'enterHome';
        this.stateT = 0;
      } else if (this.o.slider) this.state = 'climb';
      else this.state = 'wander';
    }
    const gh = ctx.physics.groundHeight(p.x, p.z);
    let want = 0;
    let targetHeading = this.heading;
    switch (this.state) {
      case 'wander': {
        this.settleToGround(dt);
        const v = this.wander.step(p, dt, tmpV);
        want = v.length();
        if (want > 0.05) {
          targetHeading = Math.atan2(v.x, v.z);
          p.addScaledVector(v, dt);
        }
        // Stay in the home region (kind: never wander off for good).
        const dr = Math.hypot(p.x - this.o.region.x, p.z - this.o.region.z);
        if (dr > this.o.regionR + 4) this.wander.target.copy(this.o.region);
        // Sometimes toboggan across the ice just for fun.
        if (onPond(p.x, p.z) && this.stateT > 6 && ctx.rng.next() < dt * 0.05) this.startGlide(this.heading, 2.2 + ctx.rng.range(0, 0.8));
        break;
      }
      case 'glide': {
        this.slideAmt = damp(this.slideAmt, 1, 10, dt);
        const fr = onPond(p.x, p.z) ? 0.9 : 2.6;
        const sp = this.glideV.length();
        if (sp > 0.01) this.glideV.multiplyScalar(Math.max(0, sp - fr * dt) / sp);
        p.addScaledVector(this.glideV, dt);
        p.y = ctx.physics.groundHeight(p.x, p.z);
        if (Math.random() < dt * 8 * Math.min(1, sp)) ctx.fx.trail(tmpV.copy(p).setY(p.y + 0.05), 0xf3f6fb, 0.12, 0.5);
        if (sp < 0.15 && this.stateT > 0.6) {
          this.state = this.o.slider ? 'climb' : 'wander';
          this.stateT = 0;
          this.climbIdx = 0;
        }
        break;
      }
      case 'climb': {
        this.settleToGround(dt);
        if (this.climbIdx === 0) {
          // Start from the nearest climb point.
          let best = 0;
          let bd = Infinity;
          this.climbPts.forEach((c, i) => {
            const d = Math.hypot(c.x - p.x, c.z - p.z);
            if (d < bd) {
              bd = d;
              best = i;
            }
          });
          this.climbIdx = Math.max(1, best);
        }
        const c = this.climbPts[Math.min(this.climbIdx, this.climbPts.length - 1)];
        const dx = c.x - p.x;
        const dz = c.z - p.z;
        const d = Math.hypot(dx, dz);
        want = 1.15;
        targetHeading = Math.atan2(dx, dz);
        p.x += (dx / Math.max(d, 0.001)) * want * dt;
        p.z += (dz / Math.max(d, 0.001)) * want * dt;
        if (d < 0.6) {
          this.climbIdx++;
          if (this.climbIdx >= this.climbPts.length) {
            this.state = 'ready';
            this.stateT = 0;
          }
        }
        break;
      }
      case 'ready': {
        this.settleToGround(dt);
        // Shuffle onto the top of the chute, flap excitedly, then flop!
        const top = pointAt(slideLine, 0.0, tmpV2);
        const dx = top.x - p.x;
        const dz = top.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.3) {
          want = 0.9;
          p.x += (dx / d) * want * dt;
          p.z += (dz / d) * want * dt;
          targetHeading = Math.atan2(dx, dz);
        } else {
          const t2 = pointAt(slideLine, 0.08, tmpV);
          targetHeading = Math.atan2(t2.x - p.x, t2.z - p.z);
          this.flap = 1;
        }
        if (this.stateT > 3.2 && d < 0.6) {
          this.state = 'slide';
          this.stateT = 0;
          this.slideS = 0;
          this.slideSpeed = 0.8;
          ctx.sfx('sfx_penguin_squeak', { pos: p, rate: 1.2 });
          ctx.fx.puff(p, 0xf6f3f6, 5, 0.6);
        }
        break;
      }
      case 'slide': {
        this.slideAmt = damp(this.slideAmt, 1, 12, dt);
        this.slideSpeed = Math.min(6.2, this.slideSpeed + dt * 3.2);
        this.slideS += (this.slideSpeed * dt) / slideLine.len;
        const pt = pointAt(slideLine, this.slideS, tmpV);
        p.x = pt.x;
        p.z = pt.z;
        p.y = slideFloor(this.slideS) + 0.02;
        const ahead = pointAt(slideLine, Math.min(1, this.slideS + 0.02), tmpV2);
        if (this.slideS < 0.99) targetHeading = Math.atan2(ahead.x - p.x, ahead.z - p.z);
        if (Math.random() < dt * 14) ctx.fx.trail(tmpV.copy(p).setY(p.y + 0.08), 0xf6f8fc, 0.16, 0.6);
        if (this.slideS >= 1) {
          this.startGlide(this.heading, this.slideSpeed * 0.8);
          ctx.fx.puff(p, 0xf6f3f6, 8, 0.9);
          ctx.sfx('sfx_snow_poof', { pos: p, volume: 0.6 });
        }
        break;
      }
      case 'enterHome': {
        this.settleToGround(dt);
        const c = this.o.inside;
        const dx = c.x - p.x;
        const dz = c.z - p.z;
        const d = Math.hypot(dx, dz);
        want = 1.1;
        targetHeading = Math.atan2(dx, dz);
        if (d > 0.05) {
          p.x += (dx / d) * want * dt;
          p.z += (dz / d) * want * dt;
        }
        if (d < 0.5 || this.stateT > 6) {
          this.state = 'home';
          this.isHome = true;
          this.root.visible = false;
          this.active = false;
          this.onHome?.(this);
        }
        break;
      }
      case 'home':
        return;
      case 'party': {
        this.settleToGround(dt);
        // Waddle in a happy circle in front of the igloo.
        this.partyAngle += dt * 0.35;
        const cx = this.o.door.x + Math.sin(this.partyAngle) * 2.6;
        const cz = this.o.door.z + 1.8 + Math.cos(this.partyAngle) * 1.8;
        const dx = cx - p.x;
        const dz = cz - p.z;
        const d = Math.hypot(dx, dz);
        want = Math.min(1.1, d * 1.5);
        if (d > 0.05) {
          targetHeading = Math.atan2(dx, dz);
          p.x += (dx / d) * want * dt;
          p.z += (dz / d) * want * dt;
        }
        this.flap = Math.max(this.flap, Math.sin(t * 2 + this.partyAngle * 3) > 0.7 ? 1 : 0);
        if (Math.random() < dt * 0.4) ctx.fx.hearts(this.hitCenter(tmpV).add(new THREE.Vector3(0, 0.5, 0)), 1);
        break;
      }
    }
    if (this.state !== 'glide' && this.state !== 'slide') this.slideAmt = damp(this.slideAmt, 0, 6, dt);
    this.speed = damp(this.speed, want, 6, dt);
    this.turnTowards(targetHeading, this.state === 'slide' ? 8 : 4, dt);
    ctx.physics.clampBounds(p, 2);
    void gh;
  }

  protected animate(dt: number, t: number): void {
    this.eyes.update(dt);
    this.walkAmt = damp(this.walkAmt, this.slideAmt > 0.5 ? 0 : Math.min(1, this.speed / 0.9), 8, dt);
    this.stepPhase += dt * (3 + this.speed * 7.5);
    const w = this.stepPhase;
    const sa = this.slideAmt;
    // Waddle: rock side to side, little bob, alternate feet.
    this.wobble = damp(this.wobble, 0, 2.5, dt);
    const wob = Math.sin(t * 13) * this.wobble * 0.3;
    this.rig.rotation.z = Math.sin(w) * 0.17 * this.walkAmt * (1 - sa) + wob;
    this.rig.rotation.x = sa * Math.PI * 0.5;
    this.rig.position.y = sa * 0.28 + Math.abs(Math.sin(w)) * 0.03 * this.walkAmt;
    this.feet.forEach((f, i) => {
      const ph = w + i * Math.PI;
      f.position.y = Math.max(0, Math.sin(ph)) * 0.05 * this.walkAmt;
      f.position.z = 0.1 + Math.cos(ph) * 0.03 * this.walkAmt - sa * 0.05;
      f.rotation.x = sa * 0.9;
    });
    this.flap = damp(this.flap, 0, 3, dt);
    this.flippers.forEach((f, i) => {
      const s = i === 0 ? -1 : 1;
      const flapping = this.flap * Math.sin(t * 22) * 0.5 + this.flap * 0.6;
      f.rotation.z = s * (0.12 + this.walkAmt * 0.32 + Math.sin(w * 2) * 0.08 * this.walkAmt + sa * 0.9 + flapping);
      f.rotation.x = sa * 0.4;
    });
    // Head: look around when idle, tilt cutely, face forward when sliding.
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 1.5 + Math.random() * 3;
      this.lookYaw = this.distanceToPlayer() < 7 ? 0 : (Math.random() - 0.5) * 1.4;
    }
    let yawWant = this.lookYaw * (1 - this.walkAmt) * (1 - sa);
    if (this.distanceToPlayer() < 7 && sa < 0.5) {
      const pl = this.ctx.player.position;
      const a = Math.atan2(pl.x - this.root.position.x, pl.z - this.root.position.z);
      yawWant = clamp(((a - this.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI, -1.1, 1.1);
    }
    this.head.rotation.y = dampAngle(this.head.rotation.y, yawWant, 5, dt);
    this.head.rotation.z = Math.sin(t * 1.3 + this.stepPhase * 0.1) * 0.1 * (1 - this.walkAmt);
    this.head.rotation.x = damp(this.head.rotation.x, -sa * 0.9, 6, dt);
  }
}

// ====================================================================== Seal

type SealState = 'lounge' | 'catch' | 'balance' | 'clap' | 'cool';

/**
 * Seals lounge on ice floes, arf, and balance any bouncy ball that lands near
 * them on their nose: catch, balance and spin, clap, then toss it back to Ace.
 */
export class Seal extends Creature {
  state: SealState = 'lounge';
  private rig = new THREE.Group();
  private head = new THREE.Group();
  private tail = new THREE.Group();
  private flippers: THREE.Group[] = [];
  private eyes: CuteEyes;
  readonly nose = new THREE.Object3D();
  private stateT = 0;
  private pose = 0;
  private ball: Ball | null = null;
  private catchFrom = new THREE.Vector3();
  private arfT = 2 + Math.random() * 5;
  private flipT = 0;
  private cool = 0;
  private rollPh = Math.random() * 6;
  private baseHeading: number;
  /** Has this seal balanced a ball yet? */
  played = false;
  onBalanced: ((s: Seal) => void) | null = null;
  onCatch: ((s: Seal) => void) | null = null;

  constructor(ctx: StageContext, pos: THREE.Vector3, heading: number, tint: number, pup = false) {
    super(ctx, { name: 'Seal', size: 'medium', radius: 0.85, centerY: 0.45, grounded: true, shadow: 1.0, giggleSfx: 'sfx_seal_arf', label: pup ? 'Seal pup' : 'Seal' });
    const fur = mat(tint, { rough: 0.55 });
    const belly = mat(new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.45).getHex(), { rough: 0.6 });
    const spot = mat(new THREE.Color(tint).multiplyScalar(0.82).getHex(), { rough: 0.6 });
    const dark = mat(0x3a3a46, { rough: 0.4 });
    const pink = mat(0xf0b4b0, { rough: 0.9 });
    this.body.add(this.rig);
    this.rig.position.set(0, 0, -0.3);
    const torso = new THREE.Group();
    torso.add(part(geo.sphere(24), fur, [0, 0.33, 0.35], [0.42, 0.33, 0.62]));
    torso.add(part(geo.sphere(20), belly, [0, 0.2, 0.42], [0.36, 0.2, 0.52]));
    torso.add(part(geo.sphere(20), fur, [0, 0.25, -0.12], [0.31, 0.25, 0.42]));
    if (!pup) for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      torso.add(part(geo.sphere(6), spot, [Math.sin(a) * 0.28, 0.5 + Math.cos(a * 3) * 0.05, 0.3 + Math.cos(a) * 0.32], [0.05, 0.03, 0.05]));
    }
    this.rig.add(bake(torso, { rough: 0.55 }));
    // Tail flippers.
    this.tail.position.set(0, 0.18, -0.5);
    const tg = new THREE.Group();
    for (const s of [-1, 1]) tg.add(part(geo.sphere(12), spot, [s * 0.1, 0, -0.14], [0.13, 0.035, 0.17], [0, s * 0.5, 0]));
    this.tail.add(bake(tg, { rough: 0.55 }));
    this.rig.add(this.tail);
    // Front flippers (pivot at shoulder).
    for (const s of [-1, 1]) {
      const f = new THREE.Group();
      f.position.set(s * 0.36, 0.2, 0.62);
      f.add(bake(new THREE.Group().add(part(geo.sphere(12), spot, [s * 0.08, -0.04, 0.06], [0.08, 0.035, 0.19], [0, s * 0.5, -s * 0.3])), { rough: 0.55 }));
      this.rig.add(f);
      this.flippers.push(f);
    }
    // Head.
    this.head.position.set(0, 0.48, 0.78);
    const hg = new THREE.Group();
    hg.add(part(geo.sphere(24), fur, [0, 0.12, 0.06], [0.27, 0.25, 0.27]));
    hg.add(part(geo.sphere(16), belly, [0, 0.03, 0.28], [0.16, 0.11, 0.13]));
    for (const s of [-1, 1]) hg.add(part(geo.sphere(12), belly, [s * 0.06, 0.02, 0.33], [0.075, 0.07, 0.07]));
    hg.add(part(geo.sphere(12), dark, [0, 0.09, 0.4], [0.05, 0.035, 0.03]));
    for (const s of [-1, 1]) {
      hg.add(part(geo.sphere(8), pink, [s * 0.15, 0.03, 0.26], [0.04, 0.025, 0.02], [0, s * 0.6, 0]));
      for (let k = 0; k < 3; k++) {
        const w = part(geo.cyl(1, 1, 4), mat(0xf6f2ea), [s * 0.17, 0.04 - k * 0.025, 0.33], [0.004, 0.16, 0.004]);
        w.rotation.set(0, 0, s * (1.35 + k * 0.15));
        w.rotation.y = s * 0.35;
        hg.add(w);
      }
    }
    this.head.add(bake(hg, { rough: 0.5 }));
    this.eyes = new CuteEyes({ size: pup ? 0.075 : 0.066, spacing: 0.25, y: 0.17, z: 0.27, side: 0.32 });
    this.head.add(this.eyes.mesh);
    this.nose.position.set(0, 0.18, 0.4);
    this.head.add(this.nose);
    this.rig.add(this.head);
    if (pup) this.root.scale.setScalar(0.8);
    this.root.position.copy(pos);
    this.heading = heading;
    this.baseHeading = heading;
    this.root.rotation.y = heading;
  }

  override onHit(info: HitInfo): HitResponse {
    if ((info.kind === 'ball' || info.kind === 'glow') && this.canCatch()) {
      const b = this.nearestBall(info.point, 1.6);
      if (b) {
        this.hits++;
        this.catchBall(b);
        return 'pass';
      }
    }
    if ((info.kind === 'bubble' || info.kind === 'bigBubble') && this.canCatch() && !this.ctx.hasBlaster('boing') && !this.ctx.hasBlaster('glow')) {
      // Kind fallback (no ball blasters yet): the seal plays with a ball of its own.
      const n = this.nose.getWorldPosition(new THREE.Vector3());
      const b = this.ctx.projectiles.fireBall(n.clone().add(new THREE.Vector3(0, 0.6, 0)), UP, false, 0.01);
      this.catchBall(b);
      return 'consume';
    }
    return super.onHit(info);
  }

  canCatch(): boolean {
    return this.state === 'lounge' && this.cool <= 0 && this.reaction !== 'bubbled';
  }

  private nearestBall(p: THREE.Vector3, maxD: number): Ball | null {
    let best: Ball | null = null;
    let bd = maxD;
    for (const b of this.ctx.projectiles.balls) {
      if (!b.alive || b.heldBy) continue;
      const d = b.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  catchBall(b: Ball): void {
    this.ball = b;
    b.heldBy = this;
    b.stuck = false;
    b.vel.set(0, 0, 0);
    b.life = 30;
    this.catchFrom.copy(b.pos);
    this.state = 'catch';
    this.stateT = 0;
    this.ctx.sfx('sfx_seal_arf', { pos: this.root.position });
    this.ctx.fx.sparkle(b.pos, 6, [0xfff3d6, 0xe3f4f8], 0.6);
    this.eyes.beam(0.6);
    this.onCatch?.(this);
  }

  private releaseBall(): void {
    if (this.ball) this.ball.heldBy = null;
    this.ball = null;
  }

  protected behave(dt: number, t: number): void {
    const ctx = this.ctx;
    this.settleToGround(dt);
    this.stateT += dt;
    this.cool -= dt;
    const p = this.root.position;
    const b = this.ball;
    if (b && (!b.alive || b.heldBy !== this)) this.ball = null;
    // Turn gently towards Ace when they are near; otherwise settle back.
    const dpl = this.distanceToPlayer();
    const pl = ctx.player.position;
    const wantH = dpl < 16 ? this.angleTo(pl.x, pl.z) : this.baseHeading;
    if (this.state === 'lounge' || this.state === 'cool') this.turnTowards(wantH, 0.6, dt);
    switch (this.state) {
      case 'lounge':
      case 'cool': {
        this.pose = damp(this.pose, 0, 4, dt);
        if (this.state === 'cool' && this.stateT > 1.6) this.state = 'lounge';
        if (this.canCatch()) {
          const n = this.nose.getWorldPosition(tmpV);
          for (const ball of ctx.projectiles.balls) {
            if (!ball.alive || ball.heldBy || ball.age < 0.12) continue;
            const dx = ball.pos.x - n.x;
            const dz = ball.pos.z - n.z;
            const dy = ball.pos.y - n.y;
            const hd = Math.hypot(dx, dz);
            if ((hd < 2.4 && dy > -1.2 && dy < 3.5) || hd * hd + dy * dy < 2.9 * 2.9) {
              this.catchBall(ball);
              break;
            }
          }
        }
        this.arfT -= dt;
        if (this.arfT <= 0) {
          this.arfT = 5 + ctx.rng.range(0, 7);
          if (dpl < 22) {
            ctx.sfx('sfx_seal_arf', { pos: p, volume: 0.6, range: 26 });
            this.flipT = 1;
          }
        }
        break;
      }
      case 'catch': {
        this.pose = damp(this.pose, 1, 10, dt);
        if (b) {
          const n = this.nose.getWorldPosition(tmpV).addScaledVector(UP, b.radius + 0.02);
          b.pos.lerpVectors(this.catchFrom, n, Math.min(1, this.stateT / 0.3));
          b.pos.y += Math.sin(Math.min(1, this.stateT / 0.3) * Math.PI) * 0.4;
        }
        if (this.stateT > 0.3) {
          this.state = 'balance';
          this.stateT = 0;
        }
        break;
      }
      case 'balance': {
        this.pose = damp(this.pose, 1, 10, dt);
        if (b) {
          const n = this.nose.getWorldPosition(tmpV);
          // Little bounces and sways as it balances the ball.
          const hop = Math.abs(Math.sin(this.stateT * 5)) * 0.12 * (this.stateT < 1.2 ? 1 : 0.3);
          b.pos.copy(n).addScaledVector(UP, b.radius + 0.02 + hop);
          b.pos.x += Math.sin(this.stateT * 4) * 0.03;
          b.mesh.rotateY(dt * 9);
        }
        if (this.stateT > 2.3) {
          this.state = 'clap';
          this.stateT = 0;
          ctx.sfx('sfx_seal_clap', { pos: p });
          ctx.fx.hearts(this.hitCenter(tmpV2).add(new THREE.Vector3(0, 1, 0)), 4);
          this.eyes.beam(1.4);
          const first = !this.played;
          this.played = true;
          if (first) this.onBalanced?.(this);
        }
        break;
      }
      case 'clap': {
        this.pose = damp(this.pose, 0.85, 8, dt);
        if (b) {
          const n = this.nose.getWorldPosition(tmpV);
          b.pos.copy(n).addScaledVector(UP, b.radius + 0.02);
          b.mesh.rotateY(dt * 12);
        }
        if (this.stateT > 1.1) {
          // Toss it back to Ace in a soft arc.
          if (b) {
            const target = tmpV2.copy(pl);
            const dx0 = target.x - b.pos.x;
            const dz0 = target.z - b.pos.z;
            let D = Math.hypot(dx0, dz0);
            const maxD = 14;
            const k = D > maxD ? maxD / D : 1;
            const dx = dx0 * k;
            const dz = dz0 * k;
            D *= k;
            const T = clamp(D / 7, 0.6, 1.4);
            const g = 15.5;
            const dy = target.y + 1 - b.pos.y;
            b.heldBy = null;
            b.vel.set(dx / T, (dy + 0.5 * g * T * T) / T, dz / T);
            b.life = 6;
            b.bounces = 0;
            b.lastTarget = this;
            b.lastTargetT = 0.8;
            ctx.sfx('sfx_ball_boing', { pos: b.pos, rate: 1.15 });
            ctx.sfx('sfx_seal_arf', { pos: p, rate: 1.1 });
          }
          this.ball = null;
          this.state = 'cool';
          this.stateT = 0;
          this.cool = 1.6;
        }
        break;
      }
    }
    void t;
  }

  protected animate(dt: number, t: number): void {
    this.eyes.update(dt);
    // Floating off in a big bubble? Let go of the ball first.
    if (this.reaction === 'bubbled' && this.ball) {
      this.releaseBall();
      this.state = 'cool';
      this.stateT = 0;
      this.cool = 1.6;
    }
    const pz = this.pose;
    this.rollPh += dt;
    // Lounging: slow breathing roll; balancing: rear up, nose to the sky.
    this.rig.rotation.x = -0.5 * pz;
    this.rig.rotation.z = Math.sin(this.rollPh * 0.6) * 0.05 * (1 - pz) + (this.state === 'balance' ? Math.sin(t * 4) * 0.06 : 0);
    this.rig.position.y = pz * 0.06;
    const lookUp = this.state === 'balance' || this.state === 'catch' || this.state === 'clap' ? -0.28 * pz : 0;
    const idleNod = Math.sin(t * 0.9 + this.rollPh * 0.2) * 0.12;
    this.head.rotation.x = damp(this.head.rotation.x, lookUp + idleNod * (1 - pz) - 0.15 * (1 - pz), 8, dt);
    this.head.rotation.z = this.state === 'balance' ? Math.sin(t * 4.3) * 0.12 : Math.sin(t * 0.7) * 0.08;
    // Tail flips when arfing or happy.
    this.flipT = damp(this.flipT, 0, 2, dt);
    this.tail.rotation.x = 0.25 + Math.sin(t * 9) * 0.35 * this.flipT + Math.sin(t * 1.2) * 0.08;
    // Flippers: rest at the sides; clap together in front.
    const clapping = this.state === 'clap';
    this.flippers.forEach((f, i) => {
      const s = i === 0 ? -1 : 1;
      if (clapping) {
        const c = Math.abs(Math.sin(this.stateT * 11));
        f.rotation.set(-0.9, s * (0.3 + c * 0.9), s * 0.6);
      } else {
        f.rotation.x = damp(f.rotation.x, -0.25 * pz, 6, dt);
        f.rotation.y = damp(f.rotation.y, s * (0.15 + Math.sin(t * 1.4 + s) * 0.06), 6, dt);
        f.rotation.z = damp(f.rotation.z, s * (0.25 + this.flipT * 0.4), 6, dt);
      }
    });
  }
}

// ====================================================================== Hare

/** Snow hares: long hops, sit up tall to look around, shy but curious. */
export class Hare extends Creature {
  private wander: Wander;
  private hopT = Math.random();
  private ears: THREE.Group[] = [];
  private eyes: CuteEyes;
  private rig = new THREE.Group();
  private head = new THREE.Group();
  private moveDir = new THREE.Vector3();
  private sitT = 0;
  private sitAmt = 0;
  private nextSit = 3 + Math.random() * 5;

  constructor(ctx: StageContext, pos: THREE.Vector3, radius = 9) {
    super(ctx, { name: 'Snow hare', size: 'small', radius: 0.45, centerY: 0.3, grounded: true, shadow: 0.42, label: 'Snow hare' });
    const fur = mat(0xf7f6f9, { rough: 0.95 });
    const shade = mat(0xe4e1ec, { rough: 0.95 });
    const tip = mat(0x6d7286, { rough: 0.8 });
    const pink = mat(0xeab4ae, { rough: 0.8 });
    this.body.add(this.rig);
    const tg = new THREE.Group();
    tg.add(part(geo.sphere(20), fur, [0, 0.27, -0.02], [0.2, 0.2, 0.28]));
    tg.add(part(geo.sphere(16), shade, [0, 0.33, -0.08], [0.17, 0.14, 0.22]));
    tg.add(part(geo.sphere(14), fur, [0, 0.28, 0.14], [0.15, 0.16, 0.13]));
    for (const s of [-1, 1]) {
      tg.add(part(geo.sphere(12), fur, [s * 0.13, 0.13, -0.1], [0.08, 0.1, 0.15]));
      tg.add(part(geo.sphere(10), fur, [s * 0.11, 0.03, 0.0], [0.06, 0.035, 0.16]));
      tg.add(part(geo.sphere(8), fur, [s * 0.07, 0.06, 0.17], [0.04, 0.05, 0.06]));
    }
    tg.add(part(geo.sphere(10), fur, [0, 0.3, -0.3], 0.08));
    this.rig.add(bake(tg));
    this.head.position.set(0, 0.42, 0.18);
    const hg = new THREE.Group();
    hg.add(part(geo.sphere(18), fur, [0, 0.04, 0.02], [0.14, 0.13, 0.15]));
    hg.add(part(geo.sphere(10), fur, [0, -0.01, 0.13], [0.07, 0.055, 0.06]));
    hg.add(part(geo.sphere(8), pink, [0, 0.025, 0.17], [0.022, 0.016, 0.014]));
    for (const s of [-1, 1]) hg.add(part(geo.sphere(8), pink, [s * 0.085, -0.01, 0.1], [0.026, 0.016, 0.012], [0, s * 0.6, 0]));
    this.head.add(bake(hg));
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(s * 0.055, 0.13, -0.02);
      const eg = new THREE.Group();
      eg.add(part(geo.capsule(1.6), fur, [0, 0.15, 0], [0.046, 0.046, 0.026]));
      eg.add(part(geo.capsule(1.6), pink, [0, 0.14, 0.013], [0.028, 0.036, 0.016]));
      eg.add(part(geo.sphere(8), tip, [0, 0.245, -0.002], [0.04, 0.035, 0.024]));
      ear.add(bake(eg));
      ear.rotation.z = -s * 0.18;
      this.head.add(ear);
      this.ears.push(ear);
    }
    this.eyes = new CuteEyes({ size: 0.03, spacing: 0.15, y: 0.06, z: 0.1, side: 0.55 });
    this.head.add(this.eyes.mesh);
    this.rig.add(this.head);
    this.root.position.copy(pos);
    this.wander = new Wander(pos.clone(), radius, 2.4, () => ctx.rng.next(), null, [0.8, 3]);
    this.heading = ctx.rng.range(0, Math.PI * 2);
  }

  protected behave(dt: number): void {
    this.settleToGround(dt);
    this.sitT -= dt;
    this.nextSit -= dt;
    if (this.nextSit <= 0 && this.sitT <= 0) {
      this.sitT = 1.8 + Math.random() * 1.5;
      this.nextSit = 5 + Math.random() * 6;
    }
    let v = this.wander.step(this.root.position, dt, this.moveDir);
    const d = this.distanceToPlayer();
    if (d < 2.6) {
      v = tmpV.copy(this.root.position).sub(this.ctx.player.position).setY(0).normalize().multiplyScalar(2.6);
      this.sitT = 0;
    }
    const sitting = this.sitT > 0;
    if (sitting) v.set(0, 0, 0);
    this.sitAmt = damp(this.sitAmt, sitting ? 1 : 0, 6, dt);
    const sp = v.length();
    this.speed = damp(this.speed, sp, 6, dt);
    if (sp > 0.05) {
      this.turnTowards(Math.atan2(v.x, v.z), 7, dt);
      this.hopT += dt * 2.1;
    }
    const phase = this.hopT % 1;
    const airborne = this.speed > 0.1 && phase < 0.6;
    if (airborne) {
      this.root.position.x += Math.sin(this.heading) * this.speed * dt * 1.9;
      this.root.position.z += Math.cos(this.heading) * this.speed * dt * 1.9;
    }
    this.ctx.physics.clampBounds(this.root.position, 3);
    this.rig.position.y = airborne ? Math.sin((phase / 0.6) * Math.PI) * 0.32 : 0;
    this.rig.rotation.x = airborne ? Math.sin((phase / 0.6) * Math.PI * 2) * -0.25 : -0.55 * this.sitAmt;
  }

  protected animate(dt: number, t: number): void {
    this.eyes.update(dt);
    const perk = this.distanceToPlayer() < 7 || this.sitAmt > 0.5 ? -0.15 : 0.35;
    this.ears.forEach((e, i) => {
      e.rotation.x = damp(e.rotation.x, perk + Math.sin(t * 2.5 + i * 1.3) * 0.08 + (Math.sin(t * 7 + i) > 0.97 ? 0.3 : 0), 6, dt);
    });
    this.head.rotation.x = -this.rig.rotation.x * 0.7;
    this.head.rotation.y = this.sitAmt * Math.sin(t * 0.9) * 0.5;
  }
}

// ====================================================================== Fox

type FoxState = 'curl' | 'trot' | 'pounce' | 'stand';

/** Arctic foxes curl up nose-under-tail, peek at Ace, trot off, and mouse-pounce into the snow. */
export class Fox extends Creature {
  state: FoxState = 'curl';
  private rig = new THREE.Group();
  private head = new THREE.Group();
  private tail: THREE.Group[] = [];
  private legs: THREE.Group[] = [];
  private ears: THREE.Group[] = [];
  private eyes: CuteEyes;
  private curl = 1;
  private peek = 0;
  private stateT = 0;
  private gait = 0;
  private target = new THREE.Vector3();
  private home: THREE.Vector3;
  private pounceFrom = new THREE.Vector3();
  private pounceTo = new THREE.Vector3();

  constructor(ctx: StageContext, pos: THREE.Vector3) {
    super(ctx, { name: 'Arctic fox', size: 'small', radius: 0.55, centerY: 0.3, grounded: true, shadow: 0.55, label: 'Arctic fox' });
    this.home = pos.clone();
    const fur = mat(0xf6f3ef, { rough: 0.95 });
    const back = mat(0xc9c4d6, { rough: 0.95 });
    const dark = mat(0x3d3f4c, { rough: 0.5 });
    const pink = mat(0xecb6b0, { rough: 0.8 });
    this.body.add(this.rig);
    const tg = new THREE.Group();
    tg.add(part(geo.sphere(20), fur, [0, 0.32, 0], [0.19, 0.18, 0.34]));
    tg.add(part(geo.sphere(16), back, [0, 0.38, -0.02], [0.175, 0.14, 0.31]));
    tg.add(part(geo.sphere(14), fur, [0, 0.33, 0.24], [0.16, 0.17, 0.14]));
    this.rig.add(bake(tg));
    // Legs.
    const legPos: [number, number][] = [[-0.1, 0.22], [0.1, 0.22], [-0.1, -0.22], [0.1, -0.22]];
    for (const [x, z] of legPos) {
      const l = new THREE.Group();
      l.position.set(x, 0.24, z);
      const lg = new THREE.Group();
      lg.add(part(geo.capsule(1), fur, [0, -0.11, 0], [0.045, 0.055, 0.045]));
      lg.add(part(geo.sphere(8), fur, [0, -0.22, 0.02], [0.05, 0.03, 0.06]));
      l.add(bake(lg));
      this.rig.add(l);
      this.legs.push(l);
    }
    // Head.
    this.head.position.set(0, 0.44, 0.33);
    const hg = new THREE.Group();
    hg.add(part(geo.sphere(18), back, [0, 0.03, -0.01], [0.15, 0.13, 0.14]));
    hg.add(part(geo.sphere(16), fur, [0, -0.02, 0.04], [0.135, 0.1, 0.12]));
    hg.add(part(geo.cone(10), fur, [0, -0.03, 0.15], [0.07, 0.16, 0.06], [Math.PI / 2, 0, 0]));
    hg.add(part(geo.sphere(8), dark, [0, -0.025, 0.23], 0.025));
    for (const s of [-1, 1]) {
      hg.add(part(geo.sphere(10), fur, [s * 0.12, -0.04, 0.02], [0.06, 0.06, 0.06]));
      hg.add(part(geo.sphere(8), pink, [s * 0.09, -0.04, 0.1], [0.025, 0.016, 0.012], [0, s * 0.6, 0]));
    }
    this.head.add(bake(hg));
    for (const s of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(s * 0.08, 0.1, -0.02);
      const eg = new THREE.Group();
      eg.add(part(geo.cone(4), back, [0, 0.07, 0], [0.06, 0.14, 0.03], [0, Math.PI / 4, 0]));
      eg.add(part(geo.cone(4), pink, [0, 0.06, 0.012], [0.035, 0.09, 0.015], [0, Math.PI / 4, 0]));
      e.add(bake(eg));
      e.rotation.z = -s * 0.25;
      this.head.add(e);
      this.ears.push(e);
    }
    this.eyes = new CuteEyes({ size: 0.028, spacing: 0.13, y: 0.04, z: 0.11, side: 0.3 });
    this.head.add(this.eyes.mesh);
    this.rig.add(this.head);
    // Big fluffy tail: a chain so it can sweep around to cover the nose.
    let parent: THREE.Object3D = this.rig;
    const tailR = [0.09, 0.12, 0.13, 0.11];
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.33 : 0, i === 0 ? -0.3 : -0.13);
      seg.add(bake(new THREE.Group().add(part(geo.sphere(12), i === 3 ? fur : back, [0, 0, -0.07], [tailR[i], tailR[i] * 0.95, 0.13]))));
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
    }
    this.root.position.copy(pos);
    this.heading = ctx.rng.range(0, Math.PI * 2);
    this.root.rotation.y = this.heading;
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    if (this.state === 'curl') {
      this.peek = 1;
      this.curl = 0.6;
    }
    return super.defaultReaction(info);
  }

  protected behave(dt: number): void {
    const ctx = this.ctx;
    this.settleToGround(dt);
    this.stateT += dt;
    const p = this.root.position;
    const d = this.distanceToPlayer();
    switch (this.state) {
      case 'curl': {
        this.curl = damp(this.curl, 1, 3, dt);
        this.speed = damp(this.speed, 0, 6, dt);
        this.peek = damp(this.peek, d < 9 ? 1 : 0, 3, dt);
        if (d < 3.4 && this.stateT > 1) {
          // Too close! Trot off to a new cosy spot.
          const away = tmpV.copy(p).sub(ctx.player.position).setY(0).normalize();
          const a = Math.atan2(away.x, away.z) + ctx.rng.range(-0.7, 0.7);
          this.target.set(p.x + Math.sin(a) * 6, 0, p.z + Math.cos(a) * 6);
          if (this.target.distanceTo(this.home) > 9) this.target.lerp(this.home, 0.6);
          this.state = 'trot';
          this.stateT = 0;
        }
        break;
      }
      case 'trot': {
        this.curl = damp(this.curl, 0, 6, dt);
        this.peek = 1;
        const dx = this.target.x - p.x;
        const dz = this.target.z - p.z;
        const dd = Math.hypot(dx, dz);
        this.turnTowards(Math.atan2(dx, dz), 6, dt);
        const want = dd > 0.5 ? 2.6 : 0;
        this.speed = damp(this.speed, want, 5, dt);
        p.x += Math.sin(this.heading) * this.speed * dt;
        p.z += Math.cos(this.heading) * this.speed * dt;
        ctx.physics.clampBounds(p, 3);
        if (dd < 0.6 || this.stateT > 6) {
          this.state = 'stand';
          this.stateT = 0;
        }
        break;
      }
      case 'stand': {
        this.curl = damp(this.curl, 0, 6, dt);
        this.speed = damp(this.speed, 0, 6, dt);
        this.turnTowards(this.angleTo(ctx.player.position.x, ctx.player.position.z), 2, dt);
        if (this.stateT > 1.4) {
          if (ctx.rng.next() < 0.5) {
            // Mouse-pounce into a snowdrift!
            this.state = 'pounce';
            this.stateT = 0;
            this.pounceFrom.copy(p);
            this.pounceTo.set(p.x + Math.sin(this.heading + 2.2) * 1.6, 0, p.z + Math.cos(this.heading + 2.2) * 1.6);
            this.heading += 2.2;
            this.root.rotation.y = this.heading;
          } else {
            this.state = 'curl';
            this.stateT = 0;
          }
        }
        break;
      }
      case 'pounce': {
        const k = Math.min(1, this.stateT / 0.7);
        this.curl = 0;
        if (k < 1) {
          p.x = this.pounceFrom.x + (this.pounceTo.x - this.pounceFrom.x) * k;
          p.z = this.pounceFrom.z + (this.pounceTo.z - this.pounceFrom.z) * k;
          p.y = ctx.physics.groundHeight(p.x, p.z) + Math.sin(k * Math.PI) * 0.9 - (k > 0.85 ? (k - 0.85) * 3 : 0);
          this.rig.rotation.x = -0.6 + k * 1.6;
        } else if (this.stateT < 0.75) {
          ctx.fx.puff(p, 0xf6f3f6, 10, 0.8);
          ctx.sfx('sfx_snow_poof', { pos: p, volume: 0.7 });
        } else {
          // Nose stuck in the snow for a moment, then pop out with a shake.
          const s = this.stateT - 0.75;
          this.rig.rotation.x = s < 0.6 ? 1.0 : damp(this.rig.rotation.x, 0, 8, dt);
          this.rig.position.y = s < 0.6 ? -0.18 : damp(this.rig.position.y, 0, 8, dt);
          this.rig.rotation.z = s > 0.6 && s < 1.2 ? Math.sin(s * 40) * 0.2 : 0;
          if (s > 0.6 && s < 0.65) ctx.fx.puff(p.clone().setY(p.y + 0.3), 0xf6f3f6, 6, 0.5);
          if (s > 1.5) {
            this.rig.rotation.set(0, 0, 0);
            this.rig.position.y = 0;
            this.state = 'curl';
            this.stateT = 0;
          }
        }
        break;
      }
    }
  }

  protected animate(dt: number, t: number): void {
    this.eyes.update(dt);
    const c = this.curl;
    const awake = Math.max(this.peek, 1 - c);
    this.eyes.closed = 1 - awake;
    const run = Math.min(1, this.speed / 2.6);
    this.gait += dt * (3 + this.speed * 4.5);
    this.legs.forEach((l, i) => {
      const ph = i === 0 || i === 3 ? 0 : Math.PI;
      l.rotation.x = Math.sin(this.gait + ph) * 0.7 * run;
      l.scale.y = 1 - c * 0.75;
    });
    if (this.state !== 'pounce') {
      this.rig.position.y = -c * 0.17 + Math.abs(Math.sin(this.gait)) * 0.03 * run;
      this.rig.rotation.x = 0;
    }
    // Curled: head tucked round to the side and down, tail wrapped over the nose.
    const peekLift = this.peek * c;
    this.head.rotation.y = damp(this.head.rotation.y, c * 1.7 * (1 - peekLift * 0.35), 5, dt);
    this.head.rotation.x = damp(this.head.rotation.x, c * 0.5 - peekLift * 0.55 - (1 - c) * Math.sin(t * 2) * 0.05, 5, dt);
    this.head.position.y = 0.44 - c * 0.06 + peekLift * 0.05;
    this.head.position.z = 0.33 - c * 0.05;
    this.head.rotation.z = peekLift * Math.sin(t * 1.2) * 0.2;
    this.tail.forEach((s, i) => {
      const curlY = c * (i === 0 ? 1.2 : 0.55);
      s.rotation.y = damp(s.rotation.y, curlY + (1 - c) * Math.sin(t * 3 + i * 0.6) * 0.15, 5, dt);
      s.rotation.x = damp(s.rotation.x, (1 - c) * (i === 0 ? -0.3 : 0.15) + c * (i === 0 ? 0.9 : 0.1), 5, dt);
    });
    this.ears.forEach((e, i) => (e.rotation.x = damp(e.rotation.x, awake > 0.5 ? -0.1 : 0.5, 6, dt) + (Math.sin(t * 6 + i) > 0.98 ? 0.25 : 0)));
  }
}

