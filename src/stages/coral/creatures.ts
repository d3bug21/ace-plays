import * as THREE from 'three';
import { Creature, Wander, type CreatureOptions } from '../../kit/Creature';
import { Face, geo, mat, part } from '../../kit/kit';
import { clamp, damp, dampAngle } from '../../core/math';
import type { StageContext } from '../types';
import type { HitInfo, HitResponse } from '../../gameplay/Hit';
import { C, CuteEyes, bake, latheBody, sstep } from './shared';
import { SURFACE } from './world';

const UP = new THREE.Vector3(0, 1, 0);
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Rounded fin from a 2D outline, extruded thin with soft bevels. Base at origin, grows along +Y, swept towards -X. */
function finGeometry(h: number, w: number, sweep: number, thick = 0.06): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w * 0.5, 0);
  s.quadraticCurveTo(-w * 0.5 - sweep * 0.35, h * 0.55, -sweep - w * 0.14, h * 0.9);
  s.quadraticCurveTo(-sweep - w * 0.02, h * 1.1, -sweep + w * 0.2, h * 0.92);
  s.quadraticCurveTo(w * 0.22, h * 0.42, w * 0.5, 0);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.6, bevelSize: thick * 0.6, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -thick / 2);
  return g;
}

/**
 * Base for free swimmers: smooth 3D steering with yaw, pitch and a gentle bank.
 * Models face +Z.
 */
export abstract class Swimmer extends Creature {
  pitch = 0;
  bank = 0;
  protected fwd = new THREE.Vector3();

  constructor(ctx: StageContext, opts: CreatureOptions) {
    super(ctx, opts);
    this.root.rotation.order = 'YXZ';
  }

  protected swimTowards(target: THREE.Vector3, maxSpeed: number, dt: number, turn = 2, slowRadius = 1.5): number {
    const p = this.root.position;
    const d = tmpA.subVectors(target, p);
    const dist = d.length();
    if (dist > 0.05) {
      const wantYaw = Math.atan2(d.x, d.z);
      const before = this.heading;
      this.heading = dampAngle(this.heading, wantYaw, turn, dt);
      const yawRate = (this.heading - before) / Math.max(dt, 1e-4);
      this.bank = damp(this.bank, clamp(-yawRate * 0.35, -0.5, 0.5), 3, dt);
      const wantPitch = clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.7, 0.7);
      this.pitch = damp(this.pitch, wantPitch, turn, dt);
    }
    const want = maxSpeed * Math.min(1, dist / slowRadius);
    this.speed = damp(this.speed, want, 2.5, dt);
    this.forward(this.fwd);
    p.addScaledVector(this.fwd, this.speed * dt);
    this.keepInWater();
    this.applyRotation();
    return dist;
  }

  protected forward(out: THREE.Vector3): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(Math.sin(this.heading) * cp, Math.sin(this.pitch), Math.cos(this.heading) * cp);
  }

  protected applyRotation(): void {
    this.root.rotation.set(-this.pitch, this.heading, this.bank, 'YXZ');
  }

  protected keepInWater(margin = 0.6): void {
    const p = this.root.position;
    const g = this.ctx.physics.groundHeight(p.x, p.z) + margin + this.opts.radius * 0.6;
    if (p.y < g) p.y = damp(p.y, g, 6, 1 / 60);
    const top = SURFACE - 0.8 - this.opts.radius;
    if (p.y > top) p.y = top;
    this.ctx.physics.clampBounds(p, 2);
  }
}

// =============================================================== Puffer fish
export class Puffer extends Swimmer {
  private inner = new THREE.Group();
  private spikes: THREE.Group;
  private tail = new THREE.Group();
  private fins: THREE.Group[] = [];
  private eyes: CuteEyes;
  private mouth: THREE.Mesh;
  puff = 0;
  private puffHold = 0;
  private wander: Wander;
  private home: THREE.Vector3;
  private spinV = 0;
  onPuffed: ((p: Puffer) => void) | null = null;
  private puffCount = 0;

  constructor(ctx: StageContext, pos: THREE.Vector3, tintColor = C.puffer) {
    super(ctx, { name: 'Puffer', size: 'small', radius: 0.62, centerY: 0, label: 'Puffer fish', giggleSfx: 'sfx_giggle' });
    this.home = pos.clone();
    const bodyM = mat(tintColor, { rough: 0.7 });
    const bellyM = mat(0xf6efdf, { rough: 0.75 });
    const spotM = mat(C.pufferSpot, { rough: 0.8 });
    const st = new THREE.Group();
    st.add(part(geo.sphere(24), bodyM, [0, 0, 0], [0.42, 0.4, 0.46]));
    st.add(part(geo.sphere(20), bellyM, [0, -0.12, 0.06], [0.36, 0.3, 0.38]));
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const n = new THREE.Vector3(Math.cos(a) * 0.55, 0.75, Math.sin(a) * 0.65 - 0.1).normalize();
      st.add(part(geo.sphere(8), spotM, [n.x * 0.415, n.y * 0.395, n.z * 0.455], [0.06, 0.045, 0.06], [0, 0, 0], false));
    }
    for (const s of [-1, 1]) st.add(part(geo.sphere(10), mat(0xebb7a8, { rough: 0.9 }), [s * 0.23, -0.03, 0.37], [0.06, 0.04, 0.03], [0, s * 0.55, 0], false));
    this.inner.add(bake(st, false, false));
    // Spikes: hidden at rest, poke out when puffed.
    const sp = new THREE.Group();
    const spikeM = mat(0xf3e6c0, { rough: 0.6 });
    for (let i = 0; i < 34; i++) {
      const y = 1 - (i / 33) * 2;
      const r = Math.sqrt(1 - y * y);
      const a = i * 2.39996;
      const n = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      if (n.z > 0.8) continue; // keep the face clear
      const c = part(geo.sphere(8), spikeM, [n.x * 0.37, n.y * 0.35, n.z * 0.41], [0.03, 0.085, 0.03], [0, 0, 0], false);
      c.quaternion.setFromUnitVectors(UP, n);
      sp.add(c);
    }
    this.spikes = bake(sp, false, false);
    this.inner.add(this.spikes);
    // Tail and fins.
    const finM = mat(0xf1dfae, { rough: 0.6, side: THREE.DoubleSide });
    this.tail.position.set(0, 0.02, -0.42);
    this.tail.add(part(geo.sphere(12), finM, [0, 0, -0.12], [0.03, 0.16, 0.14]));
    this.inner.add(this.tail);
    for (const s of [-1, 1]) {
      const f = new THREE.Group();
      f.position.set(s * 0.38, -0.02, 0.05);
      f.add(part(geo.sphere(10), finM, [s * 0.06, 0, -0.04], [0.08, 0.1, 0.025], [0, s * 0.6, 0], false));
      this.inner.add(f);
      this.fins.push(f);
    }
    this.eyes = new CuteEyes(0.1, 0.4, 0.45);
    this.eyes.mesh.position.set(0, 0.12, 0.36);
    this.inner.add(this.eyes.mesh);
    this.mouth = part(geo.torus(0.4, Math.PI * 2, 14), mat(0xb97b72, { rough: 0.5 }), [0, -0.07, 0.45], 0.035, [0, 0, 0], false);
    this.inner.add(this.mouth);

    this.body.add(this.inner);
    this.root.position.copy(pos);
    this.heading = ctx.rng.range(0, 6.28);
    this.wander = new Wander(pos.clone(), 2.6, 0.6, () => ctx.rng.next(), [pos.y - 0.8, pos.y + 0.8], [1, 3]);
  }

  get isPuffed(): boolean {
    return this.puff > 0.5;
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    this.doPuff();
    if (info.kind === 'ball' || info.kind === 'glow') {
      this.spinV = 6;
      return 'bounce';
    }
    return 'consume';
  }

  doPuff(): void {
    if (this.puffHold > 0.5) {
      // Already round: a happy wobble.
      this.squash = Math.min(1, this.squash + 0.3);
      return;
    }
    this.puffHold = 2.8;
    this.puffCount++;
    this.ctx.sfx('sfx_puffer_puff', { pos: this.root.position });
    this.ctx.fx.pop(this.root.position, 1.2, 0xf3ecd8);
    this.eyes.beam(0.3);
    this.onPuffed?.(this);
  }

  protected behave(dt: number): void {
    if (this.puffHold > 0) {
      // Round and floaty: drift up a touch and slowly turn.
      this.speed = damp(this.speed, 0, 3, dt);
      this.root.position.y += dt * 0.15;
      this.heading += dt * 0.6;
      this.pitch = damp(this.pitch, 0, 3, dt);
      this.keepInWater();
      this.applyRotation();
      return;
    }
    const v = this.wander.step(this.root.position, dt, tmpB);
    if (v.lengthSq() > 0.0001) this.swimTowards(this.wander.target, 0.6, dt, 1.5);
    else {
      this.speed = damp(this.speed, 0, 2, dt);
      // Look at Ace when he is close.
      const pl = this.ctx.player.position;
      if (this.distanceToPlayer() < 6) this.heading = dampAngle(this.heading, this.angleTo(pl.x, pl.z), 1.5, dt);
      this.keepInWater();
      this.applyRotation();
    }
    // Drift home if pushed far away.
    if (this.root.position.distanceTo(this.home) > 6) this.wander.target.copy(this.home);
  }

  protected animate(dt: number, t: number): void {
    this.eyes.update(dt);
    if (this.puffHold > 0) {
      this.puffHold -= dt;
      this.puff = damp(this.puff, 1, 9, dt);
    } else {
      // Slow, gentle deflate with a little stream of bubbles.
      const before = this.puff;
      this.puff = damp(this.puff, 0, 0.9, dt);
      if (before > 0.08 && Math.random() < dt * 8) {
        const m = this.mouth.getWorldPosition(tmpA);
        this.ctx.fx.trail(m, 0xeef8f8, 0.07, 0.8);
      }
    }
    const p = this.puff;
    const wob = Math.sin(t * 7) * 0.03 * p;
    this.inner.scale.set(1 + p * 0.75 + wob, 1 + p * 0.8 - wob, 1 + p * 0.6);
    this.spikes.scale.setScalar(1 + p * 0.24);
    this.mouth.scale.set(0.035 + p * 0.02, 0.035 + p * 0.035, 0.035);
    this.spinV = damp(this.spinV, 0, 1.5, dt);
    this.body.rotation.y += this.spinV * dt;
    const flap = Math.sin(t * (p > 0.3 ? 18 : 9));
    this.fins[0].rotation.y = -0.4 + flap * 0.45;
    this.fins[1].rotation.y = 0.4 - flap * 0.45;
    this.tail.rotation.y = Math.sin(t * 5) * 0.35 * (1 - p * 0.5);
    this.body.position.y = Math.sin(t * 1.6 + this.home.x) * 0.05;
  }
}

// =============================================================== Clownfish
export class Clownfish extends Swimmer {
  private tail = new THREE.Group();
  private eyes: CuteEyes;
  private home: THREE.Vector3;
  private phase: number;
  private hide = 0;

  constructor(ctx: StageContext, anemone: THREE.Vector3, phase: number) {
    super(ctx, { name: 'Clownfish', size: 'small', radius: 0.32, centerY: 0, label: 'Clownfish' });
    this.home = anemone.clone();
    this.phase = phase;
    const orange = mat(C.clown, { rough: 0.55 });
    const white = mat(0xfbf6ee, { rough: 0.55 });
    const st = new THREE.Group();
    st.add(part(geo.sphere(18), orange, [0, 0, 0], [0.11, 0.14, 0.22]));
    for (const z of [0.1, -0.03, -0.15]) st.add(part(geo.sphere(16), white, [0, 0, z], [0.115, z < -0.1 ? 0.1 : 0.145, 0.028], [0, 0, 0], false));
    st.add(part(geo.sphere(10), orange, [0, 0.13, -0.02], [0.02, 0.07, 0.12], [0, 0, 0], false));
    for (const s of [-1, 1]) st.add(part(geo.sphere(8), orange, [s * 0.1, -0.04, 0.06], [0.02, 0.05, 0.06], [0, s * 0.4, 0], false));
    this.body.add(bake(st, false, false));
    this.tail.position.set(0, 0, -0.21);
    this.tail.add(part(geo.sphere(10), orange, [0, 0, -0.06], [0.018, 0.09, 0.07], [0, 0, 0], false));
    this.body.add(this.tail);
    this.eyes = new CuteEyes(0.045, 0.14, 0.6);
    this.eyes.mesh.position.set(0, 0.035, 0.15);
    this.body.add(this.eyes.mesh);
    this.root.position.copy(anemone).add(new THREE.Vector3(0, 0.9, 0));
  }

  protected behave(dt: number, t: number): void {
    const near = this.distanceToPlayer() < 3.2;
    this.hide = damp(this.hide, near ? 1 : 0, near ? 3 : 0.6, dt);
    const a = t * 0.7 + this.phase;
    const r = 0.7 * (1 - this.hide * 0.7);
    const target = tmpB.set(this.home.x + Math.cos(a) * r, this.home.y + 0.95 - this.hide * 0.55 + Math.sin(t * 1.3 + this.phase) * 0.12, this.home.z + Math.sin(a) * r);
    this.swimTowards(target, 1.4, dt, 3, 0.4);
  }

  protected animate(dt: number, t: number): void {
    this.eyes.update(dt);
    this.tail.rotation.y = Math.sin(t * 12 + this.phase) * 0.5;
  }
}

// =============================================================== Crab
export class Crab extends Creature {
  private claws: THREE.Group[] = [];
  private legs: THREE.Group[] = [];
  private eyes: CuteEyes;
  private wander: Wander;
  private gait = 0;
  private wave = 0;
  private bubbleT = 2 + Math.random() * 4;

  constructor(ctx: StageContext, pos: THREE.Vector3, range = 5) {
    super(ctx, { name: 'Crab', size: 'small', radius: 0.5, centerY: 0.25, grounded: true, shadow: 0.55, label: 'Crab' });
    const shell = mat(C.crab, { rough: 0.6 });
    const pale = mat(0xf4dccd, { rough: 0.7 });
    const st = new THREE.Group();
    st.add(part(geo.sphere(22), shell, [0, 0.24, 0], [0.42, 0.2, 0.3]));
    st.add(part(geo.sphere(16), pale, [0, 0.16, 0.04], [0.36, 0.12, 0.26]));
    for (const s of [-1, 1]) st.add(part(geo.cyl(1, 1, 6), shell, [s * 0.1, 0.48, 0.18], [0.025, 0.22, 0.025], [0.2, 0, s * 0.15], false));
    this.body.add(bake(st, true, false));
    this.eyes = new CuteEyes(0.07, 0.24, 0.15);
    this.eyes.mesh.position.set(0, 0.62, 0.21);
    this.body.add(this.eyes.mesh);
    for (const s of [-1, 1]) {
      const claw = new THREE.Group();
      claw.position.set(s * 0.36, 0.26, 0.2);
      const cg = new THREE.Group();
      cg.add(part(geo.capsule(1, 8), shell, [s * 0.08, 0.06, 0.06], [0.05, 0.06, 0.05], [0.6, 0, -s * 0.9], false));
      cg.add(part(geo.sphere(14), shell, [s * 0.16, 0.16, 0.14], [0.11, 0.09, 0.12], [0, 0, 0]));
      cg.add(part(geo.sphere(10), pale, [s * 0.2, 0.2, 0.22], [0.05, 0.04, 0.07], [0, 0, 0], false));
      claw.add(bake(cg, false, false));
      this.body.add(claw);
      this.claws.push(claw);
      const legs = new THREE.Group();
      legs.position.set(s * 0.3, 0.2, -0.02);
      const lg = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const z = 0.12 - i * 0.13;
        lg.add(part(geo.capsule(1, 6), shell, [s * 0.13, -0.05, z], [0.03, 0.06, 0.03], [0, 0, s * 1.1], false));
        lg.add(part(geo.capsule(1, 6), shell, [s * 0.24, -0.14, z], [0.025, 0.05, 0.025], [0, 0, s * 0.3], false));
      }
      legs.add(bake(lg, false, false));
      this.body.add(legs);
      this.legs.push(legs);
    }
    this.root.position.copy(pos);
    this.wander = new Wander(pos.clone(), range, 0.9, () => ctx.rng.next(), null, [1, 4]);
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    if ((info.kind === 'bubble' || info.kind === 'bigBubble') && this.reaction === 'none' && Math.random() < 0.5) {
      this.bubbleWrap(3, 1.6);
      return 'consume';
    }
    this.waveClaws();
    return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
  }

  waveClaws(): void {
    if (this.wave < 0.3) {
      this.ctx.sfx('sfx_giggle', { pos: this.root.position, volume: 0.8, rate: 1.25 });
      this.ctx.fx.hearts(this.root.position.clone().add(new THREE.Vector3(0, 0.9, 0)), 2);
    }
    this.wave = 2.2;
    this.squash = 0.6;
    this.eyes.beam(1.5);
  }

  protected behave(dt: number): void {
    // Gentle underwater settle (much floatier than on land).
    const p = this.root.position;
    const gh = this.ctx.physics.groundHeight(p.x, p.z);
    if (p.y > gh + 0.01) {
      this.vel.y = Math.max(this.vel.y - 3 * dt, -1.6);
      p.y = Math.max(gh, p.y + this.vel.y * dt);
      if (p.y <= gh) this.ctx.fx.puff(p, 0xe9dfcf, 4, 0.5);
    } else {
      p.y = gh;
      this.vel.y = 0;
    }
    if (this.wave > 0) {
      this.speed = damp(this.speed, 0, 6, dt);
      // Turn to face Ace while waving.
      const pl = this.ctx.player.position;
      this.heading = dampAngle(this.heading, this.angleTo(pl.x, pl.z), 4, dt);
      this.root.rotation.y = this.heading;
      return;
    }
    const v = this.wander.step(p, dt, tmpB);
    const sp = v.length();
    this.speed = damp(this.speed, sp, 5, dt);
    if (sp > 0.05) {
      // Crabs walk sideways: local X points along the walk.
      const dir = Math.atan2(v.x, v.z);
      const side = Math.sin(dir - this.heading - Math.PI / 2) > 0 ? -1 : 1;
      this.heading = dampAngle(this.heading, dir - Math.PI / 2 * side, 3, dt);
      p.x += (v.x / sp) * this.speed * dt;
      p.z += (v.z / sp) * this.speed * dt;
    }
    this.root.rotation.y = this.heading;
    this.ctx.physics.clampBounds(p, 3);
  }

  protected animate(dt: number, t: number): void {
    this.eyes.update(dt);
    this.wave = Math.max(0, this.wave - dt);
    this.gait += dt * (2 + this.speed * 14);
    const walk = Math.min(1, this.speed * 2);
    this.legs[0].rotation.z = Math.sin(this.gait) * 0.25 * walk;
    this.legs[1].rotation.z = Math.sin(this.gait + Math.PI) * 0.25 * walk;
    this.body.position.y = Math.abs(Math.sin(this.gait)) * 0.03 * walk;
    const w = this.wave > 0 ? 1 : 0;
    this.claws.forEach((c, i) => {
      const s = i ? -1 : 1;
      const up = w * (1.1 + Math.sin(t * 9 + i * 1.5) * 0.45);
      c.rotation.z = damp(c.rotation.z, s * up * 0.9 + s * Math.sin(t * 2 + i) * 0.05, 8, dt);
      c.rotation.x = damp(c.rotation.x, -up * 0.4, 8, dt);
    });
    this.bubbleT -= dt;
    if (this.bubbleT <= 0) {
      this.bubbleT = 3 + Math.random() * 5;
      this.ctx.fx.breath(this.root.position.clone().add(new THREE.Vector3(0, 0.45, 0.3).applyAxisAngle(UP, this.heading)));
    }
  }
}

// =============================================================== Turtles
interface TurtleParts {
  group: THREE.Group;
  head: THREE.Group;
  front: THREE.Group[];
  back: THREE.Group[];
  face: Face | null;
  eyes: CuteEyes | null;
}

function turtleModel(shellColor = C.turtleShell, hero = false): TurtleParts {
  const group = new THREE.Group();
  const shellM = mat(shellColor, { rough: 0.7 });
  const plateM = mat(new THREE.Color(shellColor).lerp(new THREE.Color(C.turtleShellLight), 0.6).getHex(), { rough: 0.7 });
  const rimM = mat(0xd8cfa6, { rough: 0.75 });
  const skin = mat(C.turtleSkin, { rough: 0.8 });
  const spot = mat(0xb4ae86, { rough: 0.85 });
  const st = new THREE.Group();
  st.add(part(geo.sphere(26), shellM, [0, 0.05, 0], [0.82, 0.4, 1.0]));
  st.add(part(geo.sphere(20), rimM, [0, -0.04, 0], [0.86, 0.14, 1.04]));
  st.add(part(geo.sphere(20), mat(0xeee2bf, { rough: 0.8 }), [0, -0.1, 0.02], [0.7, 0.14, 0.88]));
  // Shell plates: a centre row and two side rows.
  const plates: [number, number, number, number][] = [
    [0, 0.42, 0.4, 0.26], [0, 0.45, 0, 0.3], [0, 0.42, -0.42, 0.26],
    [-0.42, 0.3, 0.25, 0.22], [0.42, 0.3, 0.25, 0.22], [-0.45, 0.28, -0.25, 0.22], [0.45, 0.28, -0.25, 0.22],
  ];
  for (const [x, y, z, r] of plates) {
    const n = new THREE.Vector3(x / 0.82, y / 0.4, z / 1.0).normalize();
    const pm = part(geo.sphere(14), plateM, [x, y, z], [r, 0.05, r * 1.1], [0, 0, 0], false);
    pm.quaternion.setFromUnitVectors(UP, n);
    st.add(pm);
  }
  st.add(part(geo.cone(8), skin, [0, -0.02, -1.02], [0.06, 0.18, 0.05], [-Math.PI / 2, 0, 0], false));
  group.add(bake(st, true, false));
  const head = new THREE.Group();
  head.position.set(0, 0.07, 1.1);
  const hs = new THREE.Group();
  hs.add(part(geo.capsule(1, 10), skin, [0, 0, -0.08], [0.17, 0.12, 0.17], [Math.PI / 2, 0, 0]));
  hs.add(part(geo.sphere(18), skin, [0, 0.04, 0.16], [0.24, 0.21, 0.27]));
  hs.add(part(geo.sphere(8), spot, [0.1, 0.17, 0.12], [0.05, 0.02, 0.05], [0, 0, 0], false));
  hs.add(part(geo.sphere(8), spot, [-0.08, 0.18, 0.05], [0.04, 0.02, 0.04], [0, 0, 0], false));
  if (!hero) hs.add(part(geo.torus(0.22, Math.PI, 10), mat(0x5b4a40, { rough: 0.6 }), [0, -0.02, 0.41], [0.06, 0.05, 0.04], [0, 0, Math.PI], false));
  head.add(bake(hs, true, false));
  let face: Face | null = null;
  let eyes: CuteEyes | null = null;
  if (hero) {
    face = new Face({ eyeSize: 0.075, spacing: 0.28, eyeY: 0.1, eyeZ: 0.3, sideAngle: 0.4, smileWidth: 0.08, smileY: -0.03, blush: 0xe6b3a3, blushSize: 0.04, lidColor: C.turtleSkin });
    head.add(face.group);
  } else {
    eyes = new CuteEyes(0.07, 0.27, 0.45);
    eyes.mesh.position.set(0, 0.1, 0.32);
    head.add(eyes.mesh);

  }
  group.add(head);
  const front: THREE.Group[] = [];
  const back: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const f = new THREE.Group();
    f.position.set(s * 0.66, -0.02, 0.48);
    f.add(part(geo.sphere(14), skin, [s * 0.45, 0, -0.18], [0.5, 0.05, 0.18], [0, s * 0.45, 0]));
    group.add(f);
    front.push(f);
    const b = new THREE.Group();
    b.position.set(s * 0.5, -0.04, -0.75);
    b.add(part(geo.sphere(12), skin, [s * 0.15, 0, -0.12], [0.2, 0.04, 0.16], [0, -s * 0.5, 0], false));
    group.add(b);
    back.push(b);
  }
  return { group, head, front, back, face, eyes };
}

function animateTurtle(tp: TurtleParts, t: number, dt: number, stroke: number, rate = 1.6): void {
  tp.face?.update(dt);
  tp.eyes?.update(dt);
  const s = Math.sin(t * rate);
  const c = Math.cos(t * rate);
  tp.front[0].rotation.z = -s * 0.55 * stroke - 0.05;
  tp.front[1].rotation.z = s * 0.55 * stroke + 0.05;
  tp.front[0].rotation.y = c * 0.35 * stroke;
  tp.front[1].rotation.y = -c * 0.35 * stroke;
  tp.back[0].rotation.y = Math.sin(t * rate + 1) * 0.3;
  tp.back[1].rotation.y = -Math.sin(t * rate + 1) * 0.3;
  tp.head.rotation.x = Math.sin(t * 0.7) * 0.06;
  tp.head.rotation.y = Math.sin(t * 0.43) * 0.12;
}

/** Big sea turtle that glides slow loops around the cove. */
export class GliderTurtle extends Swimmer {
  private tp: TurtleParts;
  private ang: number;
  constructor(ctx: StageContext, private center: THREE.Vector3, private ring: number, private y: number, private dir: number, scale = 1.4) {
    super(ctx, { name: 'Sea turtle', size: 'medium', radius: 1.3 * scale * 0.8, centerY: 0, label: 'Sea turtle' });
    this.tp = turtleModel(C.turtleShell, false);
    this.tp.group.scale.setScalar(scale);
    this.body.add(this.tp.group);
    this.ang = ctx.rng.range(0, 6.28);
    this.root.position.set(center.x + Math.cos(this.ang) * ring, y, center.z + Math.sin(this.ang) * ring);
  }
  protected override defaultReaction(info: HitInfo): HitResponse {
    this.happySpin();
    this.tp.eyes?.beam(1.4);
    this.ctx.sfx('sfx_turtle_chirp', { pos: this.root.position, rate: 0.8 });
    return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
  }
  protected behave(dt: number, t: number): void {
    this.ang += dt * this.dir * (1.5 / this.ring);
    const tx = this.center.x + Math.cos(this.ang + this.dir * 0.4) * this.ring;
    const tz = this.center.z + Math.sin(this.ang + this.dir * 0.4) * this.ring;
    const ty = this.y + Math.sin(t * 0.15 + this.ring) * 2.2;
    this.swimTowards(tmpB.set(tx, ty, tz), 1.6, dt, 0.8, 0.1);
  }
  protected animate(dt: number, t: number): void {
    animateTurtle(this.tp, t, dt, 1, 1.1);
  }
}

/** Mama Turtle rests on her nest and waits for her babies. */
export class MamaTurtle extends Creature {
  readonly tp: TurtleParts;
  private happyT = 0;
  constructor(ctx: StageContext, pos: THREE.Vector3, facing: number) {
    super(ctx, { name: 'Mama Turtle', size: 'big', radius: 2.0, centerY: 0.9, label: 'Mama Turtle', shadow: 2.6 });
    this.tp = turtleModel(0x86a688, true);
    this.tp.group.scale.setScalar(2.2);
    this.tp.group.position.y = 0.95;
    this.body.add(this.tp.group);
    this.root.position.copy(pos);
    this.heading = facing;
    this.root.rotation.y = facing;
  }
  celebrate(): void {
    this.happyT = 2.5;
    this.tp.face?.beam(2.5);
    this.ctx.fx.hearts(this.root.position.clone().add(new THREE.Vector3(0, 3, 0)), 5);
    this.squash = 0.7;
  }
  protected override defaultReaction(info: HitInfo): HitResponse {
    this.tp.face?.beam(1.2);
    this.giggleBounce();
    return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
  }
  protected behave(dt: number): void {
    // Look towards Ace when he is near.
    const pl = this.ctx.player.position;
    const want = this.distanceToPlayer() < 12 ? this.angleTo(pl.x, pl.z) : this.heading;
    this.tp.head.rotation.y = damp(this.tp.head.rotation.y, clamp(want - this.heading, -0.6, 0.6), 2, dt);
  }
  protected animate(dt: number, t: number): void {
    this.tp.face?.update(dt);
    this.happyT = Math.max(0, this.happyT - dt);
    const stroke = this.happyT > 0 ? 1 : 0.25;
    const s = Math.sin(t * (this.happyT > 0 ? 5 : 1.1));
    this.tp.front[0].rotation.z = -s * 0.4 * stroke;
    this.tp.front[1].rotation.z = s * 0.4 * stroke;
    this.tp.back[0].rotation.y = Math.sin(t * 0.8) * 0.15;
    this.tp.back[1].rotation.y = -Math.sin(t * 0.8) * 0.15;
    this.tp.head.rotation.x = Math.sin(t * 0.6) * 0.08 - (this.happyT > 0 ? Math.abs(Math.sin(t * 6)) * 0.2 : 0);
    this.tp.group.position.y = 0.95 + Math.sin(t * 0.9) * 0.03;
  }
}

export type BabyState = 'lost' | 'follow' | 'wait' | 'home';

/** Lost baby turtle: follows Ace like a duckling and goes home to Mama. */
export class BabyTurtle extends Swimmer {
  private tp: TurtleParts;
  state: BabyState = 'lost';
  readonly spot: THREE.Vector3;
  slot = 0;
  homeSpot = new THREE.Vector3();
  private chirpT = 2;
  private trailT = 0;
  private stateT = 0;
  /** Provided by the stage: a point on Ace's recent swim trail `back` metres behind him. */
  trailPoint: ((back: number, out: THREE.Vector3) => THREE.Vector3) | null = null;
  canFollow: () => boolean = () => true;
  onStartFollow: ((b: BabyTurtle) => void) | null = null;

  constructor(ctx: StageContext, pos: THREE.Vector3, shell: number) {
    super(ctx, { name: 'Baby turtle', size: 'small', radius: 0.55, centerY: 0, label: 'Baby turtle' });
    this.tp = turtleModel(shell, false);
    this.tp.group.scale.setScalar(0.5);
    this.tp.head.scale.setScalar(1.35);
    this.body.add(this.tp.group);
    this.spot = pos.clone();
    this.root.position.copy(pos);
    this.heading = ctx.rng.range(0, 6.28);
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    this.happySpin();
    this.tp.eyes?.beam(1);
    this.ctx.sfx('sfx_turtle_chirp', { pos: this.root.position });
    return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
  }

  setState(s: BabyState): void {
    this.state = s;
    this.stateT = 0;
  }

  protected behave(dt: number, t: number): void {
    this.stateT += dt;
    const pl = this.ctx.player.position;
    const d = this.root.position.distanceTo(tmpA.copy(pl).setY(pl.y + 0.6));
    if (this.state === 'lost' || this.state === 'wait') {
      // Paddle in a small circle around where it is, calling softly.
      const c = this.state === 'lost' ? this.spot : this.waitSpot;
      const a = t * 0.6 + this.spot.x;
      this.swimTowards(tmpB.set(c.x + Math.cos(a) * 0.8, c.y + Math.sin(t * 0.9) * 0.3, c.z + Math.sin(a) * 0.8), 0.7, dt, 2, 0.5);
      this.chirpT -= dt;
      if (this.chirpT <= 0) {
        this.chirpT = 4 + Math.random() * 3;
        if (d < 30) this.ctx.sfx('sfx_turtle_chirp', { pos: this.root.position, volume: 0.6, range: 30 });
      }
      // A gentle column of bubbles so it can always be found.
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.12;
        const p = tmpB.copy(this.root.position);
        p.x += (Math.random() - 0.5) * 0.3;
        p.z += (Math.random() - 0.5) * 0.3;
        p.y += 0.3;
        this.ctx.fx.soft.emit(p, { count: 1, shape: 3, size: 0.13, sizeEnd: 0.2, speed: 0.7, life: 6, drag: 0.1, gravity: -0.9, color: 0xf4fbfb, alpha: 0.75, dir: UP, spread: 0.05, wobble: 0.8, fadeIn: 0.2 });
      }
      if (d < 4.2 && this.canFollow()) {
        this.setState('follow');
        this.tp.eyes?.beam(1.2);
        this.ctx.sfx('sfx_turtle_chirp', { pos: this.root.position });
        this.ctx.fx.hearts(this.root.position.clone().add(new THREE.Vector3(0, 0.6, 0)), 2);
        this.onStartFollow?.(this);
      }
      return;
    }
    if (this.state === 'follow') {
      if (d > 16) {
        this.waitSpot.copy(this.root.position);
        this.setState('wait');
        return;
      }
      const target = this.trailPoint ? this.trailPoint(2.2 + this.slot * 1.7, tmpB) : tmpB.copy(pl);
      const dist = this.root.position.distanceTo(target);
      this.swimTowards(target, clamp(dist * 1.3, 0, 6.2), dt, 3.5, 0.3);
      return;
    }
    if (this.state === 'home') {
      const a = t * 0.3 + this.slot * 1.57;
      const target = tmpB.set(this.homeSpot.x + Math.cos(a) * 3.6, this.homeSpot.y + 0.9 + Math.sin(t + this.slot) * 0.3, this.homeSpot.z + Math.sin(a) * 3.6);
      this.swimTowards(target, 1.3, dt, 2, 0.4);
    }
  }

  readonly waitSpot = new THREE.Vector3();

  protected animate(dt: number, t: number): void {
    const stroke = clamp(this.speed / 2, 0.35, 1);
    animateTurtle(this.tp, t * (1 + stroke), dt, stroke, 2.6);
  }
}

// =============================================================== Shark
export class Shark extends Swimmer {
  private face: Face;
  private tail = new THREE.Group();
  private tailFin = new THREE.Group();
  private pecs: THREE.Group[] = [];
  private ang: number;
  private rollT = -1;
  private tickles = 0;
  booped = false;
  onBoop: ((s: Shark) => void) | null = null;
  private glintT = 0;

  constructor(ctx: StageContext, private center: THREE.Vector3, private ring: number, public y: number, private dir: number, tintColor = C.shark) {
    super(ctx, { name: 'Shark', size: 'big', radius: 1.9, centerY: 0, label: 'Shark', giggleSfx: 'sfx_shark_boop' });
    const skin = mat(tintColor, { rough: 0.55 });
    const L = 3.5;
    const R = (t: number) => 0.72 * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.3)), 0.6) + 0.13 * (1 - t) * (1 - t);
    const SX = 0.86;
    const top = new THREE.Color(tintColor);
    const bellyC = new THREE.Color(C.sharkBelly);
    const bodyGeo = latheBody(L, R, {
      steps: 34,
      segments: 30,
      squashX: SX,
      colorAt: (n, p, t, out) => {
        const line = -0.12 + Math.sin(t * 9) * 0.05;
        out.copy(top).lerp(bellyC, sstep(line + 0.12, line - 0.2, n.y));
        void p;
      },
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, mat(0xffffff, { rough: 0.55, vertexColors: true }));
    bodyMesh.castShadow = true;
    this.body.add(bodyMesh);
    const surf = (t: number, th: number) => new THREE.Vector3(R(t) * Math.sin(th) * SX, R(t) * Math.cos(th), -L / 2 + t * L);
    const st = new THREE.Group();
    const qY = new THREE.Quaternion().setFromAxisAngle(UP, -Math.PI / 2);
    const dorsal = new THREE.Mesh(finGeometry(0.85, 0.8, 0.5, 0.07), skin);
    dorsal.quaternion.copy(qY);
    dorsal.position.copy(surf(0.55, 0)).add(new THREE.Vector3(0, -0.08, 0));
    st.add(dorsal);
    const second = new THREE.Mesh(finGeometry(0.22, 0.26, 0.14, 0.05), skin);
    second.quaternion.copy(qY);
    second.position.copy(surf(0.2, 0)).add(new THREE.Vector3(0, -0.04, 0));
    st.add(second);
    const anal = new THREE.Mesh(finGeometry(0.2, 0.24, 0.12, 0.05), skin);
    anal.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI)).multiply(qY);
    anal.position.copy(surf(0.24, Math.PI)).add(new THREE.Vector3(0, 0.04, 0));
    st.add(anal);
    this.body.add(bake(st, true, false));
    for (const s of [-1, 1]) {
      const pg = new THREE.Group();
      pg.position.copy(surf(0.66, s * 2.1)).multiply(new THREE.Vector3(0.92, 0.92, 1));
      const pf = new THREE.Mesh(finGeometry(0.78, 0.46, 0.42, 0.05), skin);
      const qZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -s * (Math.PI / 2 + 0.55));
      pf.quaternion.copy(qZ).multiply(qY);
      pf.castShadow = true;
      pg.add(pf);
      this.body.add(pg);
      this.pecs.push(pg);
    }
    this.tail.position.set(0, 0, -L / 2 + 0.12);
    this.tail.add(part(geo.sphere(16), skin, [0, 0, -0.18], [0.12, 0.17, 0.3]));
    this.tailFin.position.set(0, 0, -0.38);
    const qX = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
    const upper = new THREE.Mesh(finGeometry(1.0, 0.34, 0.25, 0.06), skin);
    upper.quaternion.copy(qX(-0.75)).multiply(qY);
    const lower = new THREE.Mesh(finGeometry(0.62, 0.3, 0.16, 0.06), skin);
    lower.quaternion.copy(qX(Math.PI + 0.75)).multiply(qY);
    upper.castShadow = lower.castShadow = true;
    this.tailFin.add(upper, lower);
    this.tail.add(this.tailFin);
    this.body.add(this.tail);
    const eye = surf(0.85, 0.95);
    this.face = new Face({ eyeSize: 0.145, spacing: eye.x * 2, eyeY: eye.y, eyeZ: eye.z, sideAngle: 0.75, smile: false, blush: 0xe7b2ad, blushSize: 0.085 });
    this.body.add(this.face.group);
    // A wide, friendly grin that follows the underside of the snout.
    const grin: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const k = i / 12;
      const th = Math.PI * (0.6 + k * 0.8);
      const lift = Math.pow(Math.abs(k - 0.5) * 2, 2.2) * 0.06;
      grin.push(surf(0.925 - Math.pow(Math.abs(k - 0.5) * 2, 2) * 0.05, th).multiplyScalar(1.01).add(new THREE.Vector3(0, lift, 0)));
    }
    const grinMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(grin), 20, 0.028, 6, false), mat(0x4a4447, { rough: 0.5 }));
    this.body.add(grinMesh);
    this.ang = ctx.rng.range(0, 6.28);
    this.root.position.set(center.x + Math.cos(this.ang) * ring, y, center.z + Math.sin(this.ang) * ring);
  }

  get rolling(): boolean {
    return this.rollT >= 0;
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    if (info.kind === 'fizz') {
      this.tickles++;
      this.squash = Math.min(0.6, this.squash + 0.08);
      if (this.tickles >= 14) this.boop();
      return 'consume';
    }
    this.boop();
    return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
  }

  boop(): void {
    this.tickles = 0;
    if (this.rollT >= 0) return;
    this.rollT = 0;
    this.face.beam(2.2);
    this.ctx.sfx('sfx_shark_boop', { pos: this.root.position, volume: 1 });
    this.ctx.fx.hearts(this.root.position.clone().add(new THREE.Vector3(0, 1.4, 0)), 4);
    this.ctx.fx.sparkle(this.root.position, 10, [0xfff3d6, 0xd9f0f4], 1);
    const first = !this.booped;
    this.booped = true;
    this.label = 'Happy shark';
    this.onBoop?.(this);
    void first;
  }

  protected behave(dt: number, t: number): void {
    const speedMul = this.rollT >= 0 ? 1.4 : 1;
    this.ang += dt * this.dir * ((2.4 * speedMul) / this.ring);
    const lead = this.dir * 0.35;
    const tx = this.center.x + Math.cos(this.ang + lead) * this.ring;
    const tz = this.center.z + Math.sin(this.ang + lead) * this.ring;
    const ty = this.y + Math.sin(t * 0.35 + this.ring) * 1.2;
    this.swimTowards(tmpB.set(tx, ty, tz), 2.4 * speedMul, dt, 1.6, 0.1);
  }

  protected animate(dt: number, t: number): void {
    this.face.update(dt);
    const sw = 1.6 + this.speed * 0.6;
    this.tail.rotation.y = Math.sin(t * sw) * 0.22;
    this.tailFin.rotation.y = Math.sin(t * sw - 0.8) * 0.3;
    this.body.rotation.y = -Math.sin(t * sw) * 0.05;
    this.pecs[0].rotation.z = Math.sin(t * 0.9) * 0.1;
    this.pecs[1].rotation.z = -Math.sin(t * 0.9) * 0.1;
    if (this.rollT >= 0) {
      this.rollT += dt;
      const k = Math.min(1, this.rollT / 1.5);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.body.rotation.z = e * Math.PI * 2 * this.dir;
      this.body.position.y = Math.sin(k * Math.PI) * 0.5;
      if (k >= 1) {
        this.rollT = -1;
        this.body.rotation.z = 0;
        this.body.position.y = 0;
      }
    }
    if (this.booped) {
      this.glintT -= dt;
      if (this.glintT <= 0) {
        this.glintT = 0.9;
        this.ctx.fx.glow.emit(tmpA.copy(this.root.position).add(tmpB.set(0, 1.25, 0)), { count: 1, shape: 1, size: 0.5, sizeEnd: 0.05, speed: 0.2, life: 0.8, color: 0xfff0c8, alpha: 0.5 });
      }
    }
  }
}
