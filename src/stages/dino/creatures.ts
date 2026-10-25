import * as THREE from 'three';
import { Creature, Wander } from '../../kit/Creature';
import { Face, geo, mat, part } from '../../kit/kit';
import { clamp, damp, easeInOutSine, wrapAngle } from '../../core/math';
import type { StageContext } from '../types';
import type { Hittable, HitInfo, HitResponse, ProjectileKind } from '../../gameplay/Hit';
import { collapse, slimFace } from './bake';
import { P } from './props';

const WHITE = new THREE.Color(0xffffff);
const tint = (hex: number, toWhite = 0, mul = 1) => new THREE.Color(hex).lerp(WHITE, toWhite).multiplyScalar(mul);
const isBubble = (k: ProjectileKind) => k === 'bubble' || k === 'bigBubble';
const isBall = (k: ProjectileKind) => k === 'ball' || k === 'glow';
const V = () => new THREE.Vector3();
const smoothstep01 = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ================================================================= Chirper
export type ChirperMode = 'lost' | 'home' | 'mama';

/**
 * Chirpers: small feathered raptor-ish babies. They scurry in little bursts,
 * peck at the ground, chirp, and hop away if Ace rushes at them. A bubble
 * wraps one up and (when the stage says so) floats it home to the nest.
 */
export class Chirper extends Creature {
  mode: ChirperMode;
  readonly wander: Wander;
  private face: Face;
  private pose = new THREE.Group();
  private head = new THREE.Group();
  private tail = new THREE.Group();
  private legs: THREE.Group[] = [];
  private gait = Math.random() * 6;
  private peck = 0;
  private nextPeck = 1 + Math.random() * 3;
  private flee = 0;
  private fleeDir = V();
  private hopY = 0;
  private hopV = 0;
  private chirpT = 2 + Math.random() * 6;
  private moveV = V();
  private tmp = V();
  private lookYaw = 0;
  /** Extra height added to the bubble float so it sails over hills. */
  floatArc = 0;
  private floatingHome = false;
  /** Stage hook: return where a bubbled chirper should float (or null to just float up). */
  planFloat: ((c: Chirper) => THREE.Vector3 | null) | null = null;
  /** Stage hook: a homeward float finished (bubble popped over the destination). */
  onArrive: ((c: Chirper) => void) | null = null;
  readonly size: number;
  cheer = 0;

  constructor(ctx: StageContext, pos: THREE.Vector3, o: { tint: number; mode: ChirperMode; scale?: number; crest?: number; area?: number }) {
    const s = o.scale ?? 1;
    super(ctx, { name: 'Chirper', size: 'small', radius: 0.55 * s, centerY: 0.38, grounded: true, shadow: 0.36 * s, giggleSfx: 'sfx_dino_chirp', label: o.mode === 'mama' ? 'Mama Chirp' : o.mode === 'lost' ? 'Lost chirper' : 'Baby chirper' });
    this.size = s;
    this.mode = o.mode;
    const main = mat(o.tint, { rough: 0.9 });
    const belly = mat(tint(0xf6ead2), { rough: 0.95 });
    const crest = mat(o.crest ?? P.terra, { rough: 0.85 });
    const leg = mat(0xe2b978, { rough: 0.8 });
    const snout = mat(tint(o.tint, 0.35), { rough: 0.85 });
    this.body.add(this.pose);
    // Torso.
    const torso = new THREE.Group();
    torso.add(part(geo.sphere(18), main, [0, 0.38, 0], [0.19, 0.18, 0.25]));
    torso.add(part(geo.sphere(14), belly, [0, 0.33, 0.08], [0.14, 0.13, 0.17]));
    for (const sx of [-1, 1]) torso.add(part(geo.sphere(10), main, [sx * 0.14, 0.34, 0.14], [0.04, 0.08, 0.05], [0.6, 0, sx * 0.3]));
    for (let i = 0; i < 3; i++) torso.add(part(geo.sphere(8), crest, [0, 0.55 - i * 0.015, -0.04 - i * 0.09], [0.035, 0.05, 0.07], [-0.4, 0, 0]));
    this.pose.add(torso);
    collapse(torso);
    // Tail with a feather fan.
    this.tail.position.set(0, 0.4, -0.2);
    this.tail.add(part(geo.sphere(12), main, [0, 0, -0.07], [0.1, 0.09, 0.14]));
    this.tail.add(part(geo.sphere(10), main, [0, 0.02, -0.22], [0.065, 0.06, 0.12]));
    for (let i = -1; i <= 1; i++) this.tail.add(part(geo.sphere(8), i === 0 ? crest : main, [i * 0.04, 0.04, -0.34], [0.04, 0.025, 0.11], [0.2, i * 0.4, 0]));
    this.pose.add(this.tail);
    collapse(this.tail);
    // Head.
    this.head.position.set(0, 0.56, 0.2);
    this.head.add(part(geo.capsule(1), main, [0, -0.08, -0.05], [0.075, 0.05, 0.075], [0.5, 0, 0]));
    this.head.add(part(geo.sphere(18), main, [0, 0.02, 0], [0.15, 0.14, 0.155]));
    this.head.add(part(geo.sphere(14), snout, [0, -0.03, 0.13], [0.095, 0.07, 0.1]));
    this.head.add(part(geo.sphere(6), mat(0x5a4a44), [0.03, 0.0, 0.225], 0.012, [0, 0, 0], false));
    this.head.add(part(geo.sphere(6), mat(0x5a4a44), [-0.03, 0.0, 0.225], 0.012, [0, 0, 0], false));
    for (let i = 0; i < 3; i++) this.head.add(part(geo.sphere(8), crest, [(i - 1) * 0.03, 0.15, -0.02 - Math.abs(i - 1) * 0.04], [0.03, 0.08, 0.05], [-0.5, 0, (i - 1) * 0.4]));
    this.face = new Face({ eyeSize: 0.052, spacing: 0.17, eyeY: 0.045, eyeZ: 0.095, sideAngle: 0.42, smile: false, blush: 0xeaa592, blushSize: 0.03 });
    this.head.add(this.face.group);
    this.pose.add(this.head);
    collapse(this.head, { keep: slimFace(this.face) });
    // Legs (pivot at the hip).
    for (const sx of [-1, 1]) {
      const l = new THREE.Group();
      l.position.set(sx * 0.085, 0.3, -0.02);
      l.add(part(geo.sphere(10), main, [0, -0.02, 0], [0.07, 0.1, 0.09]));
      l.add(part(geo.capsule(1), leg, [0, -0.17, 0], [0.024, 0.055, 0.024]));
      l.add(part(geo.sphere(10), leg, [0, -0.29, 0.04], [0.05, 0.02, 0.075]));
      this.pose.add(l);
      collapse(l);
      this.legs.push(l);
    }
    this.root.scale.setScalar(s);
    this.root.position.copy(pos);
    this.heading = ctx.rng.range(0, Math.PI * 2);
    this.root.rotation.y = this.heading;
    const area = o.area ?? (o.mode === 'lost' ? 4.5 : 1.6);
    this.wander = new Wander(pos.clone(), area, o.mode === 'lost' ? 2.0 : 1.1, () => ctx.rng.next(), null, [0.8, 2.6]);
    this.onReactionEnd = (k) => {
      if (k === 'bubbled' && this.floatingHome) {
        this.floatingHome = false;
        this.floatTarget = null;
        this.floatArc = 0;
        this.onArrive?.(this);
      }
    };
  }

  /** Make this chirper live at the nest. */
  goHome(center: THREE.Vector3, radius: number): void {
    this.mode = 'home';
    this.wander.center.copy(center);
    this.wander.radius = radius;
    this.wander.speed = 1.1;
    this.wander.pick();
    this.label = 'Baby chirper';
  }

  /** Little celebratory hop + chirp (used by the stage for happy moments). */
  hop(power = 2.4): void {
    if (this.isBubbled) return;
    this.hopV = power;
    this.face.beam(1);
  }

  chirp(volume = 0.55): void {
    this.ctx.sfx('sfx_dino_chirp', { pos: this.root.position, volume, range: 26, rate: 1.25 / Math.sqrt(this.size), jitter: 0.12 });
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    if (isBubble(info.kind)) {
      const dest = this.planFloat?.(this) ?? null;
      if (dest) {
        const start = this.root.position;
        const d = Math.hypot(dest.x - start.x, dest.z - start.z);
        let maxG = -Infinity;
        for (let k = 1; k < 10; k++) {
          const f = k / 10;
          maxG = Math.max(maxG, this.ctx.physics.groundHeight(start.x + (dest.x - start.x) * f, start.z + (dest.z - start.z) * f));
        }
        const lineY = Math.min(start.y, dest.y);
        this.floatTarget = dest.clone();
        this.floatArc = Math.max(0, maxG + 1.2 - lineY) + Math.min(5, d * 0.07);
        this.floatingHome = true;
        this.bubbleWrap(clamp(2.6 + d / 6.5, 3.4, 9), 1.8);
      } else {
        this.floatTarget = null;
        this.floatArc = 0;
        this.floatingHome = false;
        this.bubbleWrap();
      }
      this.chirp(0.8);
      return 'consume';
    }
    if (isBall(info.kind)) {
      this.happySpin();
      this.chirp(0.8);
      this.hopV = 2.6;
      return 'bounce';
    }
    return super.defaultReaction(info);
  }

  protected behave(dt: number, t: number): void {
    this.settleToGround(dt);
    const pl = this.ctx.player;
    const d = this.distanceToPlayer();
    const v = this.moveV;
    if (this.mode === 'mama') {
      v.set(0, 0, 0);
      if (d < 18) this.turnTowards(this.angleTo(pl.position.x, pl.position.z), 2.5, dt);
    } else {
      this.wander.step(this.root.position, dt, v);
      if (this.mode === 'lost') {
        const plSpeed = Math.hypot(pl.velocity.x, pl.velocity.z);
        if (this.flee <= 0 && ((plSpeed > 2.6 && d < 3.4) || d < 1.6)) {
          this.flee = 0.85;
          this.fleeDir.subVectors(this.root.position, pl.position).setY(0).normalize();
          // Prefer running back towards the middle of its patch.
          this.tmp.subVectors(this.wander.center, this.root.position).setY(0);
          if (this.tmp.length() > this.wander.radius * 0.8) this.fleeDir.addScaledVector(this.tmp.normalize(), 0.8).normalize();
          this.hopV = 2.4;
          this.chirp(0.7);
        }
      }
      if (this.flee > 0) {
        this.flee -= dt;
        v.copy(this.fleeDir).multiplyScalar(3.6);
      }
    }
    const sp = v.length();
    this.speed = damp(this.speed, sp, 8, dt);
    if (sp > 0.05) this.turnTowards(Math.atan2(v.x, v.z), 9, dt);
    const p = this.root.position;
    p.x += Math.sin(this.heading) * this.speed * dt;
    p.z += Math.cos(this.heading) * this.speed * dt;
    this.ctx.physics.clampBounds(p, 1);
    // Pecking while idle.
    if (this.speed < 0.15 && this.mode !== 'mama') {
      this.nextPeck -= dt;
      if (this.nextPeck <= 0) {
        this.peck = 1;
        this.nextPeck = 0.8 + Math.random() * 2.5;
      }
    }
    this.chirpT -= dt;
    if (this.chirpT <= 0) {
      this.chirpT = (this.mode === 'mama' ? 7 : 5) + Math.random() * 9;
      if (d < 26) this.chirp(this.mode === 'mama' ? 0.5 : 0.35);
    }
    void t;
  }

  protected animate(dt: number, t: number): void {
    this.face.update(dt);
    // Hop physics (pose only, so it never fights the base reactions).
    if (this.hopV !== 0 || this.hopY > 0) {
      this.hopV -= 13 * dt;
      this.hopY += this.hopV * dt;
      if (this.hopY <= 0) {
        this.hopY = 0;
        this.hopV = 0;
      }
    }
    const run = clamp(this.speed / 2.5, 0, 1);
    this.gait += dt * (3 + this.speed * 9);
    const bob = Math.abs(Math.sin(this.gait)) * 0.035 * run;
    this.pose.position.y = this.hopY + bob;
    this.pose.rotation.x = run * 0.25 + (this.hopY > 0 ? -0.15 : 0);
    this.legs[0].rotation.x = Math.sin(this.gait) * 0.9 * run + (this.hopY > 0 ? 0.5 : 0);
    this.legs[1].rotation.x = Math.sin(this.gait + Math.PI) * 0.9 * run + (this.hopY > 0 ? 0.5 : 0);
    // Peck: quick dips of the head.
    if (this.peck > 0) this.peck = Math.max(0, this.peck - dt * 1.6);
    const peckDip = this.peck > 0 ? Math.max(0, Math.sin(this.peck * Math.PI * 3)) * 0.9 : 0;
    // Curious look at Ace when close.
    const d = this.distanceToPlayer();
    let want = 0;
    if (d < 7) {
      const a = this.angleTo(this.ctx.player.position.x, this.ctx.player.position.z);
      want = clamp(wrapAngle(a - this.heading), -0.9, 0.9);
    }
    this.lookYaw = damp(this.lookYaw, want, 5, dt);
    this.head.rotation.set(peckDip - run * 0.2 + Math.sin(t * 2.3 + this.size) * 0.04, this.lookYaw, Math.sin(t * 1.7) * 0.12 * (1 - run));
    this.tail.rotation.y = Math.sin(t * (4 + run * 8)) * (0.2 + run * 0.2);
    this.tail.rotation.x = -0.1 + run * 0.15;
    if (this.isBubbled && this.floatArc > 0) {
      const k = clamp(this.reactionT / this.reactionDur, 0, 1);
      this.root.position.y += Math.sin(k * Math.PI) * this.floatArc;
    }
    if (this.cheer > 0) this.cheer -= dt;
  }
}

// =================================================================== Trike
/**
 * Trikes: medium triceratops who graze and stomp gently. A ball boop makes
 * them snort, sit down and wiggle-wag their tail. Bubbles make them giggle
 * and puff dust.
 */
export class Trike extends Creature {
  private pose = new THREE.Group();
  private head = new THREE.Group();
  private tail = new THREE.Group();
  private legs: THREE.Group[] = [];
  private face: Face;
  private wander: Wander;
  private gait = Math.random() * 6;
  private sitT = 0;
  private sitK = 0;
  private stomp = 0;
  private nextStomp = 6 + Math.random() * 8;
  private grazeK = 0;
  private lookYaw = 0;
  private moveV = V();
  onBoop: ((t: Trike) => void) | null = null;

  constructor(ctx: StageContext, pos: THREE.Vector3, o: { body?: number; frill?: number; scale?: number } = {}) {
    super(ctx, { name: 'Trike', size: 'medium', radius: 1.45, centerY: 1.05, grounded: true, giggleSfx: 'sfx_giggle', label: 'Trike' });
    const body = mat(o.body ?? 0xd99c74, { rough: 0.9 });
    const belly = mat(tint(o.body ?? 0xd99c74, 0.5), { rough: 0.95 });
    const dark = mat(tint(o.body ?? 0xd99c74, 0, 0.84), { rough: 0.9 });
    const frill = mat(o.frill ?? P.butter, { rough: 0.85 });
    const horn = mat(0xf3e7cf, { rough: 0.6 });
    const beak = mat(0xa88560, { rough: 0.7 });
    this.body.add(this.pose);
    const torso = new THREE.Group();
    torso.add(part(geo.sphere(24), body, [0, 1.05, 0], [0.8, 0.68, 1.15]));
    torso.add(part(geo.sphere(20), belly, [0, 0.84, 0.05], [0.64, 0.48, 0.95]));
    for (let i = 0; i < 5; i++) torso.add(part(geo.sphere(10), dark, [0, 1.68 - Math.abs(i - 2) * 0.04, -0.6 + i * 0.3], [0.17, 0.09, 0.2]));
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) torso.add(part(geo.sphere(10), dark, [sx * 0.76, 1.15 + i * 0.1, -0.3 + i * 0.35], [0.04, 0.11, 0.13]));
    this.pose.add(torso);
    collapse(torso, { shadow: true });
    // Head with frill, horns and a beaky smile.
    this.head.position.set(0, 1.15, 1.0);
    this.head.add(part(geo.sphere(20), body, [0, 0, 0.28], [0.46, 0.42, 0.55]));
    this.head.add(part(geo.sphere(16), belly, [0, -0.08, 0.6], [0.3, 0.26, 0.3]));
    this.head.add(part(geo.cone(12), beak, [0, -0.14, 0.86], [0.13, 0.26, 0.15], [Math.PI / 2 + 0.25, 0, 0]));
    this.head.add(part(geo.sphere(24), frill, [0, 0.42, -0.12], [0.74, 0.06, 0.62], [1.0, 0, 0]));
    
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.05 + (i / 6) * 0.9);
      const v = new THREE.Vector3(Math.cos(a) * 0.72, 0, -Math.sin(a) * 0.6).applyEuler(new THREE.Euler(1.0, 0, 0));
      this.head.add(part(geo.sphere(8), horn, [v.x, 0.42 + v.y, -0.12 + v.z], 0.09));
    }
    for (const sx of [-1, 1]) this.head.add(part(geo.cone(10), horn, [sx * 0.2, 0.34, 0.5], [0.075, 0.46, 0.075], [1.0, 0, -sx * 0.18]));
    this.head.add(part(geo.cone(10), horn, [0, 0.14, 0.8], [0.06, 0.2, 0.06], [0.55, 0, 0]));
    this.head.add(part(geo.torus(0.25, Math.PI, 12), mat(0x5a4640), [0, -0.2, 0.74], [0.14, 0.1, 0.1], [0.2, 0, Math.PI]));
    this.face = new Face({ eyeSize: 0.13, spacing: 0.56, eyeY: 0.14, eyeZ: 0.52, sideAngle: 0.5, smile: false, blush: 0xe6a08a, blushSize: 0.08 });
    this.head.add(this.face.group);
    this.pose.add(this.head);
    collapse(this.head, { keep: slimFace(this.face), shadow: true });
    // Tail.
    this.tail.position.set(0, 1.0, -1.0);
    this.tail.add(part(geo.sphere(14), body, [0, 0, -0.18], [0.4, 0.36, 0.45]));
    this.tail.add(part(geo.sphere(12), body, [0, -0.1, -0.62], [0.27, 0.24, 0.4]));
    this.tail.add(part(geo.sphere(10), body, [0, -0.22, -1.0], [0.16, 0.14, 0.34]));
    this.tail.add(part(geo.sphere(8), dark, [0, -0.3, -1.3], [0.08, 0.08, 0.18]));
    this.pose.add(this.tail);
    collapse(this.tail, { shadow: true });
    // Stumpy legs.
    const legSpots: [number, number, number][] = [[-0.5, 0.82, 0.58], [0.5, 0.82, 0.58], [-0.55, 0.86, -0.58], [0.55, 0.86, -0.58]];
    for (const [x, y, z] of legSpots) {
      const l = new THREE.Group();
      l.position.set(x, y, z);
      l.add(part(geo.sphere(12), body, [0, -0.05, 0], [0.26, 0.3, 0.3]));
      l.add(part(geo.capsule(1), body, [0, -0.38, 0], [0.2, 0.13, 0.2]));
      l.add(part(geo.sphere(12), dark, [0, -0.74, 0.04], [0.25, 0.13, 0.28]));
      for (let k = -1; k <= 1; k++) l.add(part(geo.sphere(6), horn, [k * 0.12, -0.76, 0.27], [0.06, 0.05, 0.05], [0, 0, 0], false));
      this.pose.add(l);
      collapse(l);
      this.legs.push(l);
    }
    if (o.scale) this.root.scale.setScalar(o.scale);
    this.root.position.copy(pos);
    this.heading = ctx.rng.range(0, Math.PI * 2);
    this.root.rotation.y = this.heading;
    this.wander = new Wander(pos.clone(), 6, 0.9, () => ctx.rng.next(), null, [2, 5]);
  }

  get sitting(): boolean {
    return this.sitT > 0;
  }

  boop(quiet = false): void {
    const c = this.ctx;
    const nose = this.head.localToWorld(new THREE.Vector3(0, -0.1, 1.0));
    c.sfx('sfx_trike_snort', { pos: this.root.position, volume: 0.9 });
    c.fx.puff(nose, 0xf1e6d2, 6, 0.6);
    c.fx.hearts(nose.add(new THREE.Vector3(0, 1.0, 0)), 3);
    this.face.beam(3);
    this.sitT = 3.6;
    this.squash = 0.6;
    if (!quiet) this.onBoop?.(this);
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    if (isBall(info.kind)) {
      this.boop();
      return 'bounce';
    }
    if (isBubble(info.kind)) {
      this.giggleBounce();
      this.face.beam(1.4);
      this.ctx.sfx('sfx_puff_dust', { pos: this.root.position, volume: 0.6 });
      this.ctx.fx.puff(this.root.position.clone().add(new THREE.Vector3(0, 0.2, 0)), 0xe6d3ae, 12, 1.4);
      return 'consume';
    }
    return super.defaultReaction(info);
  }

  protected behave(dt: number): void {
    this.settleToGround(dt);
    const v = this.moveV;
    if (this.sitT > 0) {
      this.sitT -= dt;
      v.set(0, 0, 0);
      const pl = this.ctx.player.position;
      this.turnTowards(this.angleTo(pl.x, pl.z), 1.5, dt);
    } else this.wander.step(this.root.position, dt, v);
    const sp = v.length();
    this.speed = damp(this.speed, sp, 3, dt);
    if (sp > 0.05) this.turnTowards(Math.atan2(v.x, v.z), 1.6, dt);
    const p = this.root.position;
    p.x += Math.sin(this.heading) * this.speed * dt;
    p.z += Math.cos(this.heading) * this.speed * dt;
    this.ctx.physics.clampBounds(p, 2);
    // Gentle stomps while grazing.
    if (this.speed < 0.1 && this.sitT <= 0) {
      this.nextStomp -= dt;
      if (this.nextStomp <= 0) {
        this.nextStomp = 7 + Math.random() * 9;
        this.stomp = 1;
      }
    }
  }

  protected animate(dt: number, t: number): void {
    this.face.update(dt);
    this.sitK = damp(this.sitK, this.sitT > 0 ? 1 : 0, 5, dt);
    const walk = clamp(this.speed / 0.9, 0, 1);
    this.gait += dt * (1.5 + this.speed * 4.5);
    this.grazeK = damp(this.grazeK, walk < 0.2 && this.sitT <= 0 ? 1 : 0, 1.5, dt);
    const sk = this.sitK;
    this.pose.rotation.x = -0.24 * sk;
    this.pose.position.set(0, -0.2 * sk + Math.abs(Math.sin(this.gait)) * 0.03 * walk, -0.15 * sk);
    // Stomp: lift the front-left foot, then plant it with a soft dust puff.
    let stompLift = 0;
    if (this.stomp > 0) {
      const prev = this.stomp;
      this.stomp = Math.max(0, this.stomp - dt * 1.6);
      stompLift = Math.sin((1 - this.stomp) * Math.PI) * 0.8;
      if (prev > 0.35 && this.stomp <= 0.35) {
        const foot = this.legs[0].localToWorld(new THREE.Vector3(0, -0.8, 0.1));
        this.ctx.fx.puff(foot, 0xe6d3ae, 7, 0.9);
        this.ctx.sfx('sfx_puff_dust', { pos: foot, volume: 0.35, range: 25 });
      }
    }
    for (let i = 0; i < 4; i++) {
      const ph = i === 0 || i === 3 ? 0 : Math.PI;
      let r = Math.sin(this.gait + ph) * 0.45 * walk;
      if (i === 0) r -= stompLift;
      if (i >= 2) r += -1.1 * sk;
      else r += 0.15 * sk;
      this.legs[i].rotation.x = r;
    }
    // Head: graze, munch, glance at Ace.
    const d = this.distanceToPlayer();
    let want = 0;
    if (d < 9) want = clamp(wrapAngle(this.angleTo(this.ctx.player.position.x, this.ctx.player.position.z) - this.heading), -0.6, 0.6);
    this.lookYaw = damp(this.lookYaw, want * (1 - this.grazeK * 0.7), 3, dt);
    const munch = this.grazeK * Math.sin(t * 7) * 0.05;
    this.head.rotation.set(this.grazeK * 0.5 + munch - sk * 0.1 + Math.sin(this.gait * 2) * 0.03 * walk, this.lookYaw, sk * Math.sin(t * 3) * 0.12);
    // Tail: lazy sway, frantic happy wag when sitting.
    this.tail.rotation.y = Math.sin(t * (1.4 + sk * 13)) * (0.15 + sk * 0.45);
    this.tail.rotation.x = -0.1 + sk * 0.35;
  }
}

// =================================================================== Stego
/** Stegosaurus: big, slow and gentle grazer with soft peach back plates. */
export class Stego extends Creature {
  private pose = new THREE.Group();
  private head = new THREE.Group();
  private tail = new THREE.Group();
  private legs: THREE.Group[] = [];
  private face: Face;
  private wander: Wander;
  private gait = Math.random() * 6;
  private grazeK = 0;
  private happy = 0;
  private moveV = V();
  private plateTop = V();

  constructor(ctx: StageContext, pos: THREE.Vector3, o: { body?: number; plates?: [number, number] } = {}) {
    super(ctx, { name: 'Stego', size: 'big', radius: 2.0, centerY: 1.7, grounded: true, giggleSfx: 'sfx_giggle', label: 'Stego' });
    const bc = o.body ?? 0x93ab7e;
    const body = mat(bc, { rough: 0.9 });
    const belly = mat(tint(bc, 0.5), { rough: 0.95 });
    const spots = mat(tint(bc, 0, 0.85), { rough: 0.9 });
    const plateA = mat(o.plates?.[0] ?? P.peach, { rough: 0.8 });
    const plateB = mat(o.plates?.[1] ?? P.terra, { rough: 0.8 });
    const cream = mat(0xf3e7cf, { rough: 0.6 });
    this.body.add(this.pose);
    const torso = new THREE.Group();
    torso.add(part(geo.sphere(26), body, [0, 1.8, 0], [1.05, 0.95, 1.75]));
    torso.add(part(geo.sphere(20), belly, [0, 1.48, 0.1], [0.86, 0.7, 1.45]));
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) torso.add(part(geo.sphere(10), spots, [sx * 0.97, 1.95 + (i % 2) * 0.25, -0.9 + i * 0.6], [0.05, 0.2, 0.26]));
    // Two staggered rows of rounded plates along the arched back.
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const z = 1.45 - t * 3.1;
      const y = 1.8 + Math.sqrt(Math.max(0, 1 - (z / 1.85) ** 2)) * 0.95;
      const size = 0.22 + Math.sin(t * Math.PI) * 0.3;
      const sx = i % 2 ? 0.12 : -0.12;
      torso.add(part(geo.sphere(12), i % 2 ? plateA : plateB, [sx, y + size * 0.7, z], [0.05, size, size * 0.85], [-0.2, 0, sx * 0.6]));
    }
    this.pose.add(torso);
    collapse(torso, { shadow: true });
    // Small low head on a short neck.
    this.head.position.set(0, 1.55, 1.6);
    this.head.add(part(geo.capsule(1), body, [0, -0.1, 0.25], [0.32, 0.22, 0.32], [1.2, 0, 0]));
    this.head.add(part(geo.sphere(16), body, [0, -0.25, 0.75], [0.32, 0.3, 0.44]));
    this.head.add(part(geo.sphere(12), belly, [0, -0.33, 1.05], [0.2, 0.16, 0.2]));
    this.head.add(part(geo.torus(0.25, Math.PI, 12), mat(0x4e443f), [0, -0.37, 1.12], [0.09, 0.07, 0.07], [0.3, 0, Math.PI]));
    this.face = new Face({ eyeSize: 0.08, spacing: 0.4, eyeY: -0.12, eyeZ: 0.92, sideAngle: 0.5, smile: false, blush: 0xe6a08a, blushSize: 0.055 });
    this.head.add(this.face.group);
    this.pose.add(this.head);
    collapse(this.head, { keep: slimFace(this.face), shadow: true });
    // Tail with soft rounded spikes.
    this.tail.position.set(0, 1.85, -1.55);
    this.tail.add(part(geo.sphere(14), body, [0, 0, -0.3], [0.5, 0.45, 0.65]));
    this.tail.add(part(geo.sphere(12), body, [0, -0.15, -0.95], [0.32, 0.3, 0.6]));
    this.tail.add(part(geo.sphere(10), body, [0, -0.3, -1.55], [0.2, 0.18, 0.5]));
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        this.tail.add(part(geo.cone(10), cream, [sx * 0.2, -0.12 - k * 0.05, -1.5 - k * 0.35], [0.07, 0.5, 0.07], [-0.5, 0, -sx * 0.9]));
        this.tail.add(part(geo.sphere(8), cream, [sx * 0.39, 0.06 - k * 0.05, -1.62 - k * 0.35], 0.06));
      }
    }
    this.pose.add(this.tail);
    collapse(this.tail, { shadow: true });
    // Legs: short front, long back.
    const legSpots: [number, number, number, number][] = [[-0.6, 1.1, 1.0, 1.0], [0.6, 1.1, 1.0, 1.0], [-0.68, 1.35, -0.85, 1.25], [0.68, 1.35, -0.85, 1.25]];
    for (const [x, y, z, len] of legSpots) {
      const l = new THREE.Group();
      l.position.set(x, y, z);
      l.add(part(geo.sphere(12), body, [0, -0.05, 0], [0.34, 0.42, 0.4]));
      l.add(part(geo.capsule(1), body, [0, -y * 0.5, 0], [0.24, y * 0.2, 0.24]));
      l.add(part(geo.sphere(12), spots, [0, -y + 0.1, 0.04], [0.3, 0.13, 0.33]));
      void len;
      this.pose.add(l);
      collapse(l);
      this.legs.push(l);
    }
    this.root.position.copy(pos);
    this.heading = ctx.rng.range(0, Math.PI * 2);
    this.root.rotation.y = this.heading;
    this.wander = new Wander(pos.clone(), 5, 0.55, () => ctx.rng.next(), null, [3, 7]);
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    const top = this.pose.localToWorld(this.plateTop.set(0, 3.0, 0));
    if (isBall(info.kind)) {
      this.happy = 2.5;
      this.squash = 0.5;
      this.face.beam(2.5);
      this.ctx.sfx('sfx_dino_rumble', { pos: this.root.position, volume: 0.45, rate: 1.35, range: 40 });
      this.ctx.fx.hearts(top, 3);
      this.ctx.fx.sparkle(top, 10, [0xf6c9a8, 0xfff3dc], 1);
      return 'bounce';
    }
    if (isBubble(info.kind)) {
      this.giggleBounce();
      this.face.beam(1.5);
      this.ctx.fx.sparkle(top, 12, [0xf6c9a8, 0xe3f4f8], 1.2);
      return 'consume';
    }
    return super.defaultReaction(info);
  }

  protected behave(dt: number): void {
    this.settleToGround(dt);
    const v = this.wander.step(this.root.position, dt, this.moveV);
    if (this.happy > 0) v.set(0, 0, 0);
    const sp = v.length();
    this.speed = damp(this.speed, sp, 2, dt);
    if (sp > 0.05) this.turnTowards(Math.atan2(v.x, v.z), 0.9, dt);
    const p = this.root.position;
    p.x += Math.sin(this.heading) * this.speed * dt;
    p.z += Math.cos(this.heading) * this.speed * dt;
    this.ctx.physics.clampBounds(p, 3);
  }

  protected animate(dt: number, t: number): void {
    this.face.update(dt);
    if (this.happy > 0) this.happy -= dt;
    const hk = clamp(this.happy, 0, 1);
    const walk = clamp(this.speed / 0.55, 0, 1);
    this.gait += dt * (1 + this.speed * 4);
    this.grazeK = damp(this.grazeK, walk < 0.2 && hk <= 0 ? 1 : 0, 1, dt);
    for (let i = 0; i < 4; i++) {
      const ph = i === 0 || i === 3 ? 0 : Math.PI;
      this.legs[i].rotation.x = Math.sin(this.gait + ph) * 0.35 * walk;
    }
    this.pose.position.y = Math.abs(Math.sin(this.gait)) * 0.04 * walk;
    this.pose.rotation.z = hk * Math.sin(t * 9) * 0.05;
    this.head.rotation.set(this.grazeK * 0.55 + this.grazeK * Math.sin(t * 6) * 0.04 - hk * 0.3, Math.sin(t * 0.4) * 0.15, hk * Math.sin(t * 5) * 0.15);
    this.tail.rotation.y = Math.sin(t * (0.9 + hk * 6)) * (0.2 + hk * 0.3);
    this.tail.rotation.x = -0.05 + hk * 0.2;
  }
}

// =================================================================== Ptero
/** Pterosaurs glide in lazy circles. A bubble sends one into a happy loop-the-loop. */
export class Ptero extends Creature {
  private pose = new THREE.Group();
  private wings: THREE.Group[] = [];
  private face: Face;
  private theta: number;
  private flapT = 0;
  private flapping = 0;
  private loopT = -1;
  private swoopT = -1;
  private nextSwoop = 12 + Math.random() * 14;
  private callT = 6 + Math.random() * 10;
  private prev = V();
  private loopBase = V();
  private loopFwd = V();

  constructor(ctx: StageContext, readonly center: THREE.Vector3, readonly ringR: number, readonly alt: number, readonly dir: number, o: { body?: number; wing?: number; tip?: number; scale?: number } = {}) {
    super(ctx, { name: 'Ptero', size: 'medium', radius: 1.4, centerY: 0, grounded: false, giggleSfx: 'sfx_ptero_call', label: 'Ptero' });
    const body = mat(o.body ?? 0xd4b393, { rough: 0.85 });
    const belly = mat(0xf2e5cf, { rough: 0.9 });
    const crest = mat(P.terra, { rough: 0.8 });
    const beak = mat(P.butter, { rough: 0.6 });
    this.body.add(this.pose);
    const torso = new THREE.Group();
    torso.add(part(geo.capsule(1), body, [0, 0, 0], [0.15, 0.13, 0.15], [Math.PI / 2, 0, 0]));
    torso.add(part(geo.sphere(12), belly, [0, -0.06, 0.05], [0.12, 0.1, 0.25]));
    torso.add(part(geo.cone(8), body, [0, 0, -0.42], [0.05, 0.3, 0.05], [-Math.PI / 2, 0, 0]));
    torso.add(part(geo.sphere(16), body, [0, 0.08, 0.36], [0.14, 0.13, 0.16]));
    torso.add(part(geo.cone(10), beak, [0, 0.04, 0.66], [0.055, 0.42, 0.06], [Math.PI / 2, 0, 0]));
    torso.add(part(geo.cone(10), crest, [0, 0.2, 0.18], [0.04, 0.36, 0.12], [-2.1, 0, 0]));
    for (const sx of [-1, 1]) torso.add(part(geo.sphere(8), body, [sx * 0.07, -0.16, -0.18], [0.04, 0.04, 0.1]));
    this.face = new Face({ eyeSize: 0.048, spacing: 0.17, eyeY: 0.12, eyeZ: 0.42, sideAngle: 0.5, smile: false, blush: 0xe6a08a, blushSize: 0.03 });
    torso.add(this.face.group);
    this.pose.add(torso);
    collapse(torso, { keep: slimFace(this.face) });
    // Wings: soft membranes with a peach tip.
    const wm = mat(o.wing ?? 0xecd9bd, { rough: 0.9, side: THREE.DoubleSide });
    const tm = mat(o.tip ?? P.peach, { rough: 0.9, side: THREE.DoubleSide });
    for (const sx of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(sx * 0.1, 0.04, 0.1);
      const pts: [number, number][] = [[0, 0.14], [0.6, 0.16], [1.25, 0.04], [0.85, -0.16], [0.4, -0.3], [0, -0.34]];
      const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x * sx, y)));
      const g = new THREE.ShapeGeometry(sh);
      g.rotateX(-Math.PI / 2);
      w.add(new THREE.Mesh(g, wm));
      const tipPts: [number, number][] = [[1.0, 0.1], [1.32, 0.03], [1.02, -0.07]];
      const tg = new THREE.ShapeGeometry(new THREE.Shape(tipPts.map(([x, y]) => new THREE.Vector2(x * sx, y))));
      tg.rotateX(-Math.PI / 2);
      tg.translate(0, 0.005, 0);
      w.add(new THREE.Mesh(tg, tm));
      w.add(part(geo.capsule(1), body, [sx * 0.62, 0, -0.13], [0.025, 0.21, 0.025], [0, 0, Math.PI / 2 - sx * 0.12 * 0]));
      this.pose.add(w);
      collapse(w, { doubleSide: true });
      this.wings.push(w);
    }
    this.root.scale.setScalar(o.scale ?? 1.5);
    this.theta = ctx.rng.range(0, Math.PI * 2);
    this.place(0, 0);
    this.prev.copy(this.root.position);
  }

  private place(t: number, dt: number): void {
    this.theta += dt * (6.5 / this.ringR) * this.dir;
    const gh = this.ctx.physics.groundHeight(this.center.x, this.center.z);
    let swoop = 0;
    if (this.swoopT >= 0) swoop = Math.sin(Math.min(1, this.swoopT) * Math.PI) * 4.5;
    this.root.position.set(
      this.center.x + Math.cos(this.theta) * this.ringR,
      gh + this.alt + Math.sin(t * 0.5 + this.ringR) * 1.0 - swoop,
      this.center.z + Math.sin(this.theta) * this.ringR,
    );
  }

  loop(): void {
    if (this.loopT >= 0) return;
    this.loopT = 0;
    this.loopBase.copy(this.root.position);
    this.loopFwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.face.beam(2);
    this.ctx.sfx('sfx_ptero_call', { pos: this.root.position, volume: 0.7, range: 60 });
    this.ctx.fx.hearts(this.root.position, 3);
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    if (info.kind === 'fizz') {
      this.tickle(info);
      if (Math.random() < 0.15) this.loop();
      return 'consume';
    }
    this.loop();
    return isBall(info.kind) ? 'bounce' : 'consume';
  }

  protected behave(dt: number, t: number): void {
    if (this.loopT >= 0) {
      this.loopT += dt / 1.9;
      const k = easeInOutSine(Math.min(1, this.loopT));
      const phi = k * Math.PI * 2;
      const r = 2.2;
      this.root.position.copy(this.loopBase).addScaledVector(this.loopFwd, Math.sin(phi) * r + k * 3).add(new THREE.Vector3(0, (1 - Math.cos(phi)) * r, 0));
      this.pose.rotation.x = -phi;
      this.pose.rotation.z = 0;
      this.flapping = 1;
      if (Math.random() < dt * 5) this.ctx.fx.sparkle(this.root.position, 2, [0xfff1d6, 0xe3f4f8], 0.5);
      if (this.loopT >= 1) {
        this.loopT = -1;
        this.pose.rotation.x = 0;
        // Re-join the circle smoothly from where the loop ended.
        const dx = this.root.position.x - this.center.x;
        const dz = this.root.position.z - this.center.z;
        this.theta = Math.atan2(dz, dx);
      }
      return;
    }
    this.prev.copy(this.root.position);
    this.place(t, dt);
    const dx = this.root.position.x - this.prev.x;
    const dz = this.root.position.z - this.prev.z;
    if (dx * dx + dz * dz > 1e-8) this.turnTowards(Math.atan2(dx, dz), 4, dt);
    this.pose.rotation.z = damp(this.pose.rotation.z, 0.32 * this.dir, 2, dt);
    this.pose.rotation.x = damp(this.pose.rotation.x, this.swoopT >= 0 ? Math.cos(Math.min(1, this.swoopT) * Math.PI) * 0.35 : 0, 2, dt);
    this.nextSwoop -= dt;
    if (this.swoopT >= 0) {
      this.swoopT += dt / 4.5;
      if (this.swoopT >= 1) this.swoopT = -1;
    } else if (this.nextSwoop <= 0) {
      this.nextSwoop = 16 + Math.random() * 16;
      this.swoopT = 0;
    }
    this.callT -= dt;
    if (this.callT <= 0) {
      this.callT = 10 + Math.random() * 16;
      this.ctx.sfx('sfx_ptero_call', { pos: this.root.position, volume: 0.35, range: 70 });
    }
  }

  protected animate(dt: number, t: number): void {
    this.face.update(dt);
    // Mostly glide; flap a few strokes now and then.
    this.flapT += dt;
    if (this.flapping <= 0 && Math.random() < dt * 0.25) this.flapping = 1.6;
    if (this.flapping > 0) this.flapping -= dt;
    const flapAmp = this.flapping > 0 ? 0.6 : 0.06;
    const a = Math.sin(this.flapT * (this.flapping > 0 ? 7 : 1.5)) * flapAmp + 0.08;
    this.wings[0].rotation.z = -a;
    this.wings[1].rotation.z = a;
    void t;
  }
}

// ================================================================== Peeker
/** Pip: a tiny dino who peeks out of a hollow log, and ducks when Ace gets close. */
export class Peeker extends Creature {
  private pose = new THREE.Group();
  private face: Face;
  private up = 0;
  private want = 0;
  private outT = 0;
  private hideT = 0;
  private cycle = 3 + Math.random() * 3;
  private lastIn = true;

  constructor(ctx: StageContext, pos: THREE.Vector3, facing: number) {
    super(ctx, { name: 'Pip', size: 'small', radius: 0.6, centerY: 0.25, grounded: false, giggleSfx: 'sfx_dino_chirp', label: 'Pip' });
    const main = mat(0xb9cf9b, { rough: 0.9 });
    const belly = mat(0xf3ead2, { rough: 0.95 });
    const spot = mat(P.butter, { rough: 0.9 });
    this.body.add(this.pose);
    const m = new THREE.Group();
    m.add(part(geo.sphere(14), main, [0, 0.0, -0.05], [0.16, 0.18, 0.2]));
    m.add(part(geo.sphere(18), main, [0, 0.25, 0.05], [0.17, 0.16, 0.17]));
    m.add(part(geo.sphere(12), belly, [0, 0.19, 0.17], [0.1, 0.07, 0.08]));
    for (let i = 0; i < 3; i++) m.add(part(geo.sphere(8), spot, [0, 0.4 - i * 0.02, -0.02 - i * 0.08], [0.03, 0.04, 0.05]));
    for (const sx of [-1, 1]) m.add(part(geo.sphere(8), main, [sx * 0.14, 0.05, 0.2], [0.05, 0.04, 0.06]));
    this.face = new Face({ eyeSize: 0.06, spacing: 0.17, eyeY: 0.28, eyeZ: 0.14, sideAngle: 0.3, smile: true, smileWidth: 0.05, smileY: 0.18, blush: 0xeaa592, blushSize: 0.03 });
    m.add(this.face.group);
    this.pose.add(m);
    collapse(m, { keep: slimFace(this.face) });
    this.root.position.copy(pos);
    this.root.rotation.y = facing;
    this.heading = facing;
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    this.outT = 2.2;
    this.giggleBounce();
    this.face.beam(2);
    this.ctx.fx.hearts(this.root.position.clone().add(new THREE.Vector3(0, 0.7, 0)), 3);
    return isBall(info.kind) ? 'bounce' : 'consume';
  }

  protected behave(dt: number, t: number): void {
    const d = this.distanceToPlayer();
    this.cycle -= dt;
    if (this.hideT > 0) this.hideT -= dt;
    else if (this.cycle <= 0) {
      // Peekaboo: duck now and then, then pop back up.
      this.cycle = 3 + Math.random() * 4;
      if (d < 14) this.hideT = 0.9;
    }
    if (this.outT > 0) {
      this.outT -= dt;
      this.want = 1.3;
    } else if (d < 2.6) this.want = 0;
    else if (d < 16 && this.hideT <= 0) this.want = 1;
    else this.want = 0;
    const was = this.up > 0.5;
    this.up = damp(this.up, this.want, 9, dt);
    const isUp = this.up > 0.5;
    if (isUp && !was && this.lastIn) {
      this.lastIn = false;
      this.ctx.sfx('sfx_dino_chirp', { pos: this.root.position, volume: 0.5, rate: 1.6, range: 20 });
    }
    if (!isUp) this.lastIn = true;
    // Look at Ace.
    const a = this.angleTo(this.ctx.player.position.x, this.ctx.player.position.z);
    this.pose.rotation.y = clamp(wrapAngle(a - this.heading), -0.8, 0.8);
    void t;
  }

  protected animate(dt: number, t: number): void {
    this.face.update(dt);
    this.pose.position.y = -0.48 + this.up * 0.42;
    this.pose.rotation.z = Math.sin(t * 1.4) * 0.2 * this.up;
    this.pose.visible = this.up > 0.04;
  }
}

// ==================================================================== Lulu
export type LuluState = 'amble' | 'arrive' | 'hiccup' | 'sing' | 'nuzzle' | 'content';

/**
 * A smooth, dynamic tube along a list of points (Lulu's neck and tail).
 * Vertices are rewritten every frame with analytic normals; one draw call.
 */
class Tube {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array;
  private nrm: Float32Array;
  private t = new THREE.Vector3();
  private n = new THREE.Vector3();
  private b = new THREE.Vector3();
  private ref = new THREE.Vector3(1, 0, 0);
  constructor(readonly rings: number, readonly radial: number, color: (ring: number, rad: number, out: THREE.Color) => void) {
    const count = rings * (radial + 1);
    this.pos = new Float32Array(count * 3);
    this.nrm = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    const idx: number[] = [];
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j <= radial; j++) {
        color(i, j / radial, c);
        const k = (i * (radial + 1) + j) * 3;
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
        if (i < rings - 1 && j < radial) {
          const a = i * (radial + 1) + j;
          const b2 = a + radial + 1;
          idx.push(a, b2, a + 1, a + 1, b2, b2 + 1);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
    this.mesh = new THREE.Mesh(g, mat(0xffffff, { vertexColors: true, rough: 0.9 }));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  update(pts: THREE.Vector3[], radii: number[]): void {
    const R = this.radial;
    for (let i = 0; i < this.rings; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(this.rings - 1, i + 1)];
      this.t.subVectors(b, a).normalize();
      this.n.crossVectors(this.t, this.ref);
      if (this.n.lengthSq() < 1e-4) this.n.set(0, 0, 1);
      this.n.normalize();
      this.b.crossVectors(this.t, this.n);
      const p = pts[i];
      const r = radii[i];
      for (let j = 0; j <= R; j++) {
        const th = (j / R) * Math.PI * 2;
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        const nx = this.n.x * cs + this.b.x * sn;
        const ny = this.n.y * cs + this.b.y * sn;
        const nz = this.n.z * cs + this.b.z * sn;
        const k = (i * (R + 1) + j) * 3;
        this.pos[k] = p.x + nx * r;
        this.pos[k + 1] = p.y + ny * r;
        this.pos[k + 2] = p.z + nz * r;
        this.nrm[k] = nx;
        this.nrm[k + 1] = ny;
        this.nrm[k + 2] = nz;
      }
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
  }
}

const NECK_N = 26;
const TAIL_N = 20;

/**
 * Lulu the long-neck. Huge, slow and curious: she ambles behind the trees and
 * peeks her head over them with a tilt. In the big moment she has the
 * hiccups; bubbles on her nose calm them, then she sings and nuzzles Ace.
 */
export class Lulu {
  readonly root = new THREE.Group();
  private bodyG = new THREE.Group();
  private legs: THREE.Group[] = [];
  private neck: Tube;
  private tail: Tube;
  private neckPts: THREE.Vector3[] = [];
  private tailPts: THREE.Vector3[] = [];
  private tailR: number[] = [];
  readonly head = new THREE.Group();
  private face: Face;
  state: LuluState = 'amble';
  heading = Math.PI / 2;
  private speed = 0;
  private gait = 0;
  readonly headLocal = new THREE.Vector3(0, 11, 5);
  private headVel = new THREE.Vector3();
  private headTarget = new THREE.Vector3();
  private neckBase = new THREE.Vector3(0, 6.4, 2.9);
  private tilt = 0;
  private tiltTarget = 0;
  private lookYaw = 0;
  private stateT = 0;
  private hicT = 2;
  private calmCool = 0;
  calms = 0;
  private peekT = 6;
  private peeking = 0;
  private rumbleT = 3;
  private wp = 0;
  private pause = 0;
  private noteT = 0;
  readonly waypoints: THREE.Vector3[];
  readonly glade: THREE.Vector3;
  readonly hittable: Hittable;
  /** Stage hooks. */
  onCalm: ((n: number) => void) | null = null;
  onHiccup: (() => void) | null = null;
  onWrongHit: ((kind: ProjectileKind) => void) | null = null;
  onArrived: (() => void) | null = null;
  private ctx: StageContext;
  private tmp = V();
  private tmp2 = V();
  private dummy = new THREE.Object3D();
  private bez: THREE.Vector3[] = [V(), V(), V(), V()];
  private neckR: number[] = [];
  private nuzzleHearts = 0;

  constructor(ctx: StageContext, waypoints: THREE.Vector3[], glade: THREE.Vector3) {
    this.ctx = ctx;
    this.waypoints = waypoints;
    this.glade = glade;
    const skinC = 0x9fb8ad;
    const skin = mat(skinC, { rough: 0.9 });
    const belly = mat(0xefe3c9, { rough: 0.95 });
    const spot = mat(P.peach, { rough: 0.85 });
    const spot2 = mat(tint(skinC, 0.35), { rough: 0.9 });
    // Body (tilted slightly nose-up like a brachiosaurus).
    this.bodyG.position.set(0, 4.8, 0);
    this.bodyG.rotation.x = -0.1;
    this.bodyG.add(part(geo.sphere(32), skin, [0, 0, 0], [2.6, 2.3, 3.7]));
    this.bodyG.add(part(geo.sphere(24), mat(tint(skinC, 0.3), { rough: 0.95 }), [0, -0.55, 0.3], [2.25, 1.75, 3.35]));
    this.bodyG.add(part(geo.sphere(20), skin, [0, 0.7, 2.4], [1.85, 1.75, 1.8]));
    const rng = ctx.rng;
    for (let i = 0; i < 14; i++) {
      const a = rng.range(-1.2, 1.2);
      const z = rng.range(-2.5, 2.4);
      const k = Math.sqrt(Math.max(0, 1 - (z / 3.7) ** 2));
      const n = new THREE.Vector3(Math.sin(a) * 2.6 * k, Math.cos(a) * 2.3 * k, z);
      const s = rng.range(0.25, 0.5);
      this.bodyG.add(part(geo.sphere(10), i % 3 === 0 ? spot2 : spot, [n.x * 0.99, n.y * 0.99, n.z], [s, s * 0.22, s], [0, 0, -a]));
    }
    this.root.add(this.bodyG);
    collapse(this.bodyG, { shadow: true, receive: true });
    // Pillar legs.
    const legSpots: [number, number, number][] = [[-1.5, 4.7, 2.0], [1.5, 4.7, 2.0], [-1.55, 4.3, -2.2], [1.55, 4.3, -2.2]];
    for (const [x, y, z] of legSpots) {
      const l = new THREE.Group();
      l.position.set(x, y, z);
      l.add(part(geo.sphere(14), skin, [0, -0.2, 0], [1.0, 1.15, 1.1]));
      l.add(part(geo.capsule(1), skin, [0, -y * 0.52, 0], [0.78, y * 0.19, 0.78]));
      l.add(part(geo.sphere(14), spot2, [0, -y + 0.25, 0.08], [0.92, 0.32, 1.0]));
      for (let k = -1; k <= 1; k++) l.add(part(geo.sphere(8), belly, [k * 0.36, -y + 0.15, 0.92], [0.19, 0.15, 0.13]));
      this.root.add(l);
      collapse(l, { shadow: true });
      this.legs.push(l);
    }
    // Neck + tail as smooth dynamic tubes (1 draw call each), with a soft cream throat.
    const skinCol = new THREE.Color(skinC);
    const throat = new THREE.Color(0xe9e0c8);
    this.neck = new Tube(NECK_N, 16, (i, rad, out) => {
      const front = Math.max(0, -Math.cos(rad * Math.PI * 2));
      out.copy(skinCol).lerp(throat, smoothstep01(0.55, 0.95, front) * 0.8 * Math.min(1, i / 4));
    });
    this.tail = new Tube(TAIL_N, 14, (i, rad, out) => {
      const under = Math.max(0, -Math.sin(rad * Math.PI * 2));
      out.copy(skinCol).lerp(throat, smoothstep01(0.6, 1, under) * 0.5).multiplyScalar(i === TAIL_N - 1 ? 0.95 : 1);
    });
    for (let i = 0; i < NECK_N; i++) {
      const t = i / (NECK_N - 1);
      this.neckR.push(THREE.MathUtils.lerp(1.3, 0.5, Math.pow(t, 0.75)));
      this.neckPts.push(new THREE.Vector3());
    }
    for (let i = 0; i < TAIL_N; i++) {
      const k = i / (TAIL_N - 1);
      this.tailR.push(i === TAIL_N - 1 ? 0.04 : THREE.MathUtils.lerp(1.45, 0.16, Math.pow(k, 0.85)));
      this.tailPts.push(new THREE.Vector3());
    }
    this.root.add(this.neck.mesh, this.tail.mesh);
    // Head.
    this.head.rotation.order = 'YXZ';
    const hm = new THREE.Group();
    hm.add(part(geo.sphere(24), skin, [0, 0, 0], [0.62, 0.55, 0.78]));
    hm.add(part(geo.sphere(20), mat(tint(skinC, 0.22)), [0, -0.14, 0.62], [0.5, 0.4, 0.56]));
    hm.add(part(geo.sphere(18), skin, [0, 0.42, 0.1], [0.4, 0.34, 0.42]));
    for (const sx of [-1, 1]) {
      hm.add(part(geo.sphere(8), mat(0x6d7f78), [sx * 0.14, 0.62, 0.18], [0.07, 0.04, 0.07], [0, 0, 0], false));
      hm.add(part(geo.sphere(8), spot, [sx * 0.2, 0.62, -0.18], [0.09, 0.08, 0.09]));
    }
    hm.add(part(geo.torus(0.2, Math.PI, 16), mat(0x6a5a55), [0, -0.26, 1.12], [0.2, 0.13, 0.1], [0.35, 0, Math.PI]));
    this.face = new Face({ eyeSize: 0.21, spacing: 0.78, eyeY: 0.17, eyeZ: 0.45, sideAngle: 0.42, smile: false, blush: 0xeaa592, blushSize: 0.14 });
    hm.add(this.face.group);
    this.head.add(hm);
    collapse(hm, { keep: slimFace(this.face), shadow: true });
    this.root.add(this.head);
    ctx.root.add(this.root);
    // Nose hittable (generous!).
    const self = this;
    this.hittable = {
      hitRadius: 1.6,
      active: true,
      aimAssist: 1.3,
      label: 'Lulu',
      hitCenter: (out: THREE.Vector3) => self.head.localToWorld(out.set(0, -0.05, 0.75)),
      accepts: () => true,
      onHit: (info: HitInfo): HitResponse => self.onNoseHit(info),
    };
    ctx.hits.add(this.hittable);
    for (let i = 0; i < 4; i++) this.legColliders.push(ctx.physics.add({ kind: 'cylinder', x: 0, z: -999, r: 0.95, yMin: -5, yMax: 5 }));
    const w0 = waypoints[0];
    this.root.position.set(w0.x, ctx.physics.groundHeight(w0.x, w0.z), w0.z);
    this.root.rotation.y = this.heading;
    this.headLocal.set(0, 11.5, 5.5);
    this.headTarget.copy(this.headLocal);
  }

  /** Pillar-leg colliders so Ace walks around her feet (kept in sync every frame). */
  readonly legColliders: { kind: 'cylinder'; x: number; z: number; r: number; yMin: number; yMax: number }[] = [];

  /** World position of the nose (for focusOn / effects). */
  nose(out: THREE.Vector3): THREE.Vector3 {
    return this.head.localToWorld(out.set(0, -0.05, 0.8));
  }

  startHiccupMoment(): void {
    if (this.state === 'amble') {
      this.state = 'arrive';
      this.stateT = 0;
      this.pause = 0;
    }
  }

  private onNoseHit(info: HitInfo): HitResponse {
    const c = this.ctx;
    const n = this.nose(this.tmp2);
    if (this.state === 'hiccup' && (isBubble(info.kind) || info.kind === 'fizz')) {
      if (this.calmCool <= 0) {
        this.calmCool = 0.55;
        this.calms++;
        this.hicT = 2.6 + this.calms * 0.5;
        this.headVel.y -= 1.5;
        this.face.beam(1.4);
        c.fx.sparkle(n, 22, [0xe9f6f8, 0xfff1d0, 0xf3d5e2], 1.4);
        c.fx.pop(n, 2.2);
        c.sfx('sfx_big_pop', { pos: n, volume: 0.9 });
        c.sfx('sfx_collect', { volume: 0.5 });
        this.onCalm?.(this.calms);
      } else c.fx.sparkle(n, 4, [0xe9f6f8, 0xfff1d0], 0.6);
      return 'consume';
    }
    if (isBall(info.kind)) {
      this.face.beam(1.2);
      this.headVel.y += 2.5;
      c.fx.hearts(n.clone().add(new THREE.Vector3(0, 1, 0)), 2);
      c.sfx('sfx_boop', { pos: n });
      if (this.state === 'hiccup') this.onWrongHit?.(info.kind);
      return 'bounce';
    }
    this.face.beam(1.5);
    if (info.kind !== 'fizz' || Math.random() < 0.1) c.fx.notes(n.clone().add(new THREE.Vector3(0, 0.8, 0)), 2);
    return 'consume';
  }

  private hiccup(): void {
    const c = this.ctx;
    this.headVel.y += 7.5;
    this.headVel.z -= 1.5;
    this.bodyG.scale.set(1.03, 0.95, 1.03);
    const n = this.nose(this.tmp2);
    c.sfx('sfx_hiccup', { pos: n, volume: 1, range: 90, jitter: 0.1 });
    c.fx.puff(n, 0xf4ecdc, 6, 0.9);
    // Little hiccup bubbles drift up from her mouth.
    c.fx.soft.emit(n, { count: 5, shape: 3, size: 0.42, sizeEnd: 0.6, speed: 1.4, life: 2.0, color: 0xe9f6f8, alpha: 0.75, dir: new THREE.Vector3(0, 1, 0.3), spread: 0.45, gravity: -0.7, wobble: 0.8 });
    c.fx.soft.emit(n, { count: 1, shape: 2, size: 0.8, sizeEnd: 2.4, speed: 0, life: 0.35, lifeJitter: 0, color: 0xffffff, alpha: 0.55, fadeIn: 0 });
    const near = c.player.position.distanceTo(this.root.position) < 34;
    if (near) {
      c.shake(0.02);
      c.cheer('Hic!');
    }
    this.onHiccup?.();
  }

  private local(world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return this.root.worldToLocal(out.copy(world));
  }

  update(dt: number, t: number): void {
    const c = this.ctx;
    this.stateT += dt;
    if (this.calmCool > 0) this.calmCool -= dt;
    const p = this.root.position;
    const pl = c.player.position;
    let walkTo: THREE.Vector3 | null = null;
    // ------------------------------------------------ body movement / state
    if (this.state === 'amble') {
      if (this.pause > 0) this.pause -= dt;
      else {
        const w = this.waypoints[this.wp];
        if (Math.hypot(w.x - p.x, w.z - p.z) < 1.5) {
          this.wp = (this.wp + 1) % this.waypoints.length;
          this.pause = 5 + Math.random() * 4;
          this.peekT = 0.5;
        } else walkTo = w;
      }
    } else if (this.state === 'arrive') {
      if (Math.hypot(this.glade.x - p.x, this.glade.z - p.z) < 1.2) {
        this.state = 'hiccup';
        this.stateT = 0;
        this.hicT = 1.2;
        this.onArrived?.();
      } else walkTo = this.glade;
    }
    let targetHeading = this.heading;
    if (walkTo) {
      targetHeading = Math.atan2(walkTo.x - p.x, walkTo.z - p.z);
      // Turn first, then walk (big animals turn slowly).
      const turnErr = Math.abs(wrapAngle(targetHeading - this.heading));
      const want = (this.state === 'arrive' ? 2.0 : 1.3) * clamp(1.4 - turnErr, 0.15, 1);
      this.speed = damp(this.speed, want, 1.2, dt);
    } else {
      this.speed = damp(this.speed, 0, 1.5, dt);
      // Pausing on her walk: turn to gaze over the treetops at the valley.
      if (this.state === 'amble' && this.pause > 0) targetHeading = 0;
    }
    if (this.state === 'hiccup' || this.state === 'sing' || this.state === 'nuzzle' || this.state === 'content') targetHeading = 0;
    this.heading += wrapAngle(targetHeading - this.heading) * (1 - Math.exp(-0.6 * dt));
    p.x += Math.sin(this.heading) * this.speed * dt;
    p.z += Math.cos(this.heading) * this.speed * dt;
    p.y = c.physics.groundHeight(p.x, p.z);
    this.root.rotation.y = this.heading;
    this.gait += dt * this.speed * 1.35;
    const walk = clamp(this.speed / 1.3, 0, 1);
    // Gentle ground rumbles while walking.
    this.rumbleT -= dt;
    if (walk > 0.4 && this.rumbleT <= 0) {
      this.rumbleT = 6.5;
      c.sfx('sfx_dino_rumble', { pos: p, volume: 0.4, range: 110 });
      if (pl.distanceTo(p) < 28) c.shake(0.012);
    }
    // ------------------------------------------------------- head target
    const eyeW = c.player.eyePosition(this.tmp);
    const aceL = this.local(eyeW, this.tmp2);
    this.tiltTarget = 0;
    let pitch = 0.1;
    const h = this.headTarget;
    if (this.state === 'amble' || this.state === 'arrive') {
      // Curious peeks over the treetops.
      this.peekT -= dt;
      if (this.peekT <= 0 && this.peeking <= 0) {
        this.peeking = 4.5;
        this.peekT = 12 + Math.random() * 9;
        c.sfx('sfx_longneck_call', { pos: this.nose(V()), volume: 0.55, range: 160 });
      }
      if (this.peeking > 0) this.peeking -= dt;
      const pk = this.peeking > 0 ? Math.sin(Math.min(1, (4.5 - this.peeking) / 4.5) * Math.PI) : 0;
      h.set(Math.sin(t * 0.3) * 0.6 + pk * clamp(aceL.x * 0.08, -2, 2), 12.6 + pk * 2.8 + Math.sin(this.gait * 2) * 0.12 * walk, 5.4 + pk * 2.6);
      this.tiltTarget = pk * 0.42;
      pitch = 0.15 + pk * 0.15;
    } else if (this.state === 'hiccup') {
      h.set(Math.sin(t * 0.45) * 1.4, 6.9 + Math.sin(t * 0.9) * 0.35, 8.6);
      pitch = 0.3;
      this.tiltTarget = Math.sin(t * 0.7) * 0.18;
      this.hicT -= dt;
      if (this.hicT <= 0) {
        this.hiccup();
        this.hicT = 2.4 + Math.random() * 1.0 + this.calms * 0.45;
      }
    } else if (this.state === 'sing') {
      h.set(0, 12.2, 6.2);
      pitch = -0.55;
      this.tiltTarget = Math.sin(t * 2) * 0.12;
      this.noteT -= dt;
      if (this.noteT <= 0) {
        this.noteT = 0.25;
        c.fx.notes(this.nose(V()).add(new THREE.Vector3(0, 0.6, 0)), 2);
      }
      if (this.stateT > 3.6) {
        this.state = 'nuzzle';
        this.stateT = 0;
      }
    } else if (this.state === 'nuzzle') {
      // Lower the head right in front of Ace, within reach.
      const dir = this.tmp.set(aceL.x, 0, aceL.z - this.neckBase.z);
      const dist = dir.length();
      dir.normalize();
      const reach = Math.min(13, Math.max(4, dist - 3.6));
      h.set(dir.x * reach, Math.max(aceL.y + 0.7, 1.6), this.neckBase.z + dir.z * reach);
      pitch = 0.35;
      this.tiltTarget = 0.35 + Math.sin(t * 1.5) * 0.12;
      this.nuzzleHearts -= dt;
      if (this.nuzzleHearts <= 0) {
        this.nuzzleHearts = 0.45;
        c.fx.hearts(this.nose(V()).add(new THREE.Vector3(0, 0.6, 0)), 2);
      }
      if (this.stateT > 5.5) {
        this.state = 'content';
        this.stateT = 0;
      }
    } else {
      // Content: idle near the glade, lean in curiously when Ace is near.
      const near = clamp(1 - (Math.hypot(aceL.x, aceL.z - 8) - 4) / 10, 0, 1);
      h.set(Math.sin(t * 0.35) * 1.2 + aceL.x * 0.15 * near, 9.5 - near * 3 + Math.sin(t * 0.8) * 0.25, 7.5 + near * 1.5);
      pitch = 0.2 + near * 0.15;
      this.tiltTarget = near * 0.3 * Math.sin(t * 0.6);
      this.peekT -= dt;
      if (this.peekT <= 0) {
        this.peekT = 14 + Math.random() * 10;
        c.sfx('sfx_longneck_call', { pos: this.nose(V()), volume: 0.4, range: 120 });
        c.fx.notes(this.nose(V()).add(new THREE.Vector3(0, 0.6, 0)), 3);
      }
    }
    // Spring the head towards its target (hiccups kick the velocity).
    const k = this.state === 'nuzzle' ? 3.5 : 6;
    const dmp = this.state === 'nuzzle' ? 3.5 : 3.2;
    this.headVel.x += ((h.x - this.headLocal.x) * k - this.headVel.x * dmp) * dt;
    this.headVel.y += ((h.y - this.headLocal.y) * k - this.headVel.y * dmp) * dt;
    this.headVel.z += ((h.z - this.headLocal.z) * k - this.headVel.z * dmp) * dt;
    this.headLocal.addScaledVector(this.headVel, dt);
    this.head.position.copy(this.headLocal);
    // Head orientation: look at Ace (within limits) with a curious tilt.
    const toAce = Math.atan2(aceL.x - this.headLocal.x, aceL.z - this.headLocal.z);
    const lookOk = this.state !== 'sing' && Math.hypot(aceL.x, aceL.z) < 70;
    this.lookYaw = damp(this.lookYaw, lookOk ? clamp(toAce, -1.0, 1.0) : 0, 2, dt);
    this.tilt = damp(this.tilt, this.tiltTarget, 2.5, dt);
    const vPitch = Math.atan2(aceL.y - this.headLocal.y, Math.max(2, Math.hypot(aceL.x - this.headLocal.x, aceL.z - this.headLocal.z)));
    const lookPitch = lookOk && this.state !== 'amble' ? clamp(-vPitch, -0.3, 0.8) : pitch;
    this.head.rotation.set(damp(this.head.rotation.x, this.state === 'sing' ? pitch : lookPitch * 0.7 + pitch * 0.3, 3, dt), this.lookYaw, this.tilt);
    this.face.update(dt);
    // ------------------------------------------------------ neck & tail
    this.updateNeck();
    this.updateTail(t, walk);
    // Legs + body sway.
    for (let i = 0; i < 4; i++) {
      const ph = i === 0 || i === 3 ? 0 : Math.PI;
      this.legs[i].rotation.x = Math.sin(this.gait + ph) * 0.24 * walk;
    }
    this.bodyG.position.y = 4.8 + Math.abs(Math.sin(this.gait)) * 0.08 * walk;
    this.bodyG.rotation.z = Math.sin(this.gait) * 0.025 * walk;
    for (let i = 0; i < this.legColliders.length; i++) {
      const lc = this.legColliders[i];
      const l = this.legs[i];
      const ch = Math.cos(this.heading);
      const sh = Math.sin(this.heading);
      lc.x = p.x + l.position.x * ch + l.position.z * sh;
      lc.z = p.z - l.position.x * sh + l.position.z * ch;
      lc.yMin = p.y - 2;
      lc.yMax = p.y + 4;
    }
    this.bodyG.scale.x = damp(this.bodyG.scale.x, 1, 4, dt);
    this.bodyG.scale.y = damp(this.bodyG.scale.y, 1, 4, dt);
    this.bodyG.scale.z = damp(this.bodyG.scale.z, 1, 4, dt);
  }

  private updateNeck(): void {
    const b = this.bez;
    const base = this.neckBase;
    const head = this.headLocal;
    const L = base.distanceTo(head);
    b[0].copy(base);
    b[1].copy(base).add(this.tmp.set(0, L * 0.42, L * 0.1));
    // Approach the head from behind/below its facing.
    const yaw = this.head.rotation.y;
    b[2].copy(head).add(this.tmp.set(-Math.sin(yaw) * L * 0.22, -L * 0.18, -Math.cos(yaw) * L * 0.22));
    b[3].copy(head).add(this.tmp.set(-Math.sin(yaw) * 0.55, -0.15, -Math.cos(yaw) * 0.55));
    for (let i = 0; i < NECK_N; i++) {
      const t = i / (NECK_N - 1);
      const u = 1 - t;
      this.neckPts[i].set(0, 0, 0)
        .addScaledVector(b[0], u * u * u)
        .addScaledVector(b[1], 3 * u * u * t)
        .addScaledVector(b[2], 3 * u * t * t)
        .addScaledVector(b[3], t * t * t);
    }
    this.neck.update(this.neckPts, this.neckR);
  }

  private updateTail(t: number, walk: number): void {
    for (let i = 0; i < TAIL_N; i++) {
      const k = i / (TAIL_N - 1);
      const sway = Math.sin(t * 0.9 - i * 0.28) * k * k * (1.6 + walk * 0.8);
      this.tailPts[i].set(sway, 5.0 - k * 3.4 - Math.sin(k * Math.PI) * 0.2 + k * k * 0.6, -3.0 - k * 9.0);
    }
    this.tail.update(this.tailPts, this.tailR);
  }

  /** Test hook: jump straight into the hiccup moment and calm all five hiccups. */
  debugCalm(): void {
    this.root.position.set(this.glade.x, this.ctx.physics.groundHeight(this.glade.x, this.glade.z), this.glade.z);
    this.heading = 0;
    if (this.state === 'amble' || this.state === 'arrive') {
      this.state = 'hiccup';
      this.stateT = 0;
      this.onArrived?.();
    }
    for (let i = 0; i < 5 && this.state === 'hiccup'; i++) {
      this.calmCool = 0;
      this.onNoseHit({ kind: 'bubble', point: this.nose(V()), dir: new THREE.Vector3(0, 0, -1), speed: 10, power: 0.6 });
    }
  }

  sing(): void {
    this.state = 'sing';
    this.stateT = 0;
    this.face.beam(4);
    const n = this.nose(V());
    this.ctx.sfx('sfx_longneck_call', { pos: n, volume: 1, range: 200 });
    this.ctx.fx.celebrate(n, 1.6);
  }
}
