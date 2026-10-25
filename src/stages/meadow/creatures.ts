import * as THREE from 'three';
import { Creature, Wander } from '../../kit/Creature';
import { Face, geo, mat, part } from '../../kit/kit';
import { damp } from '../../core/math';
import type { StageContext } from '../types';
import type { HitInfo, HitResponse } from '../../gameplay/Hit';
import type { Ball } from '../../gameplay/Projectiles';

// ------------------------------------------------------------------ Bunny
export class Bunny extends Creature {
  private wander: Wander;
  private hopT = Math.random();
  private ears: THREE.Group[] = [];
  private face: Face;
  private tail: THREE.Mesh;
  private moveDir = new THREE.Vector3();

  constructor(ctx: StageContext, pos: THREE.Vector3, tint: number) {
    super(ctx, { name: 'Bunny', size: 'small', radius: 0.45, centerY: 0.32, grounded: true, shadow: 0.4, giggleSfx: 'sfx_bunny_squeak', label: 'Bunny' });
    const fur = mat(tint, { rough: 0.95 });
    const belly = mat(0xf7f1e6, { rough: 0.95 });
    const pink = mat(0xe9b2a8, { rough: 0.8 });
    this.body.add(part(geo.sphere(20), fur, [0, 0.24, 0], [0.24, 0.22, 0.3]));
    this.body.add(part(geo.sphere(16), belly, [0, 0.2, 0.12], [0.16, 0.15, 0.16]));
    const head = new THREE.Group();
    head.position.set(0, 0.45, 0.2);
    head.add(part(geo.sphere(20), fur, [0, 0, 0], [0.19, 0.17, 0.18]));
    head.add(part(geo.sphere(10), pink, [0, -0.02, 0.17], [0.03, 0.022, 0.02], [0, 0, 0], false));
    head.add(part(geo.sphere(12), belly, [0, -0.06, 0.13], [0.08, 0.05, 0.06], [0, 0, 0], false));
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(s * 0.07, 0.12, -0.03);
      ear.add(part(geo.capsule(1.6), fur, [0, 0.15, 0], [0.045, 0.06, 0.03]));
      ear.add(part(geo.capsule(1.6), pink, [0, 0.15, 0.012], [0.026, 0.05, 0.02], [0, 0, 0], false));
      ear.rotation.z = -s * 0.15;
      head.add(ear);
      this.ears.push(ear);
    }
    this.face = new Face({ eyeSize: 0.04, spacing: 0.15, eyeY: 0.03, eyeZ: 0.13, smile: false, blush: 0xe9b2a8, blushSize: 0.025, sideAngle: 0.35 });
    head.add(this.face.group);
    this.body.add(head);
    this.tail = part(geo.sphere(12), belly, [0, 0.27, -0.3], 0.08);
    this.body.add(this.tail);
    for (const s of [-1, 1]) this.body.add(part(geo.sphere(10), fur, [s * 0.12, 0.06, 0.12], [0.06, 0.05, 0.09]));
    for (const s of [-1, 1]) this.body.add(part(geo.sphere(10), fur, [s * 0.15, 0.08, -0.12], [0.08, 0.08, 0.13]));
    this.root.position.copy(pos);
    this.wander = new Wander(pos.clone(), 7, 1.8, () => ctx.rng.next(), null, [1, 3]);
    this.heading = ctx.rng.range(0, Math.PI * 2);
  }

  protected behave(dt: number): void {
    this.settleToGround(dt);
    const v = this.wander.step(this.root.position, dt, this.moveDir);
    // Shy but curious: hop a little away if Ace runs right up to it.
    const d = this.distanceToPlayer();
    if (d < 2.2) {
      const away = this.root.position.clone().sub(this.ctx.player.position).setY(0).normalize().multiplyScalar(2.2);
      v.copy(away);
    }
    const sp = v.length();
    this.speed = damp(this.speed, sp, 6, dt);
    if (sp > 0.05) {
      this.turnTowards(Math.atan2(v.x, v.z), 6, dt);
      this.hopT += dt * 2.4;
    }
    // Hop: move only during the airborne part of the hop cycle.
    const phase = this.hopT % 1;
    const airborne = this.speed > 0.1 && phase < 0.55;
    if (airborne) {
      this.root.position.x += Math.sin(this.heading) * this.speed * dt * 1.8;
      this.root.position.z += Math.cos(this.heading) * this.speed * dt * 1.8;
    }
    this.ctx.physics.clampBounds(this.root.position, 3);
    this.body.position.y = airborne ? Math.sin((phase / 0.55) * Math.PI) * 0.22 : 0;
  }

  protected animate(dt: number, t: number): void {
    this.face.update(dt);
    const perk = this.distanceToPlayer() < 6 ? 0.1 : -0.1;
    this.ears.forEach((e, i) => {
      e.rotation.x = damp(e.rotation.x, perk + Math.sin(t * 3 + i) * 0.08, 5, dt);
    });
    this.tail.position.y = 0.27 + Math.sin(t * 8) * 0.01;
    this.body.rotation.x = this.body.position.y > 0.05 ? -0.2 : 0;
  }
}

// ------------------------------------------------------------------- Duck
export class Duck extends Creature {
  private face: Face;
  private angle: number;
  private paddle = 0;
  private wing: THREE.Mesh[] = [];
  private bob = Math.random() * 10;

  constructor(ctx: StageContext, private center: THREE.Vector3, private ring: number, private waterY: number, small = false) {
    super(ctx, { name: 'Duck', size: 'small', radius: small ? 0.35 : 0.5, centerY: 0.2, giggleSfx: 'sfx_duck_quack', label: small ? 'Duckling' : 'Duck' });
    const featherC = small ? 0xf0dc98 : 0xf4efe4;
    const feather = mat(featherC, { rough: 0.85 });
    const beak = mat(0xe8b65c, { rough: 0.6 });
    this.body.add(part(geo.sphere(20), feather, [0, 0.12, 0], [0.28, 0.2, 0.38]));
    this.body.add(part(geo.cone(10), feather, [0, 0.24, -0.38], [0.12, 0.2, 0.08], [-1.9, 0, 0]));
    const head = part(geo.sphere(18), feather, [0, 0.4, 0.22], 0.17);
    this.body.add(head);
    this.body.add(part(geo.sphere(12), beak, [0, 0.37, 0.39], [0.08, 0.035, 0.09]));
    for (const s of [-1, 1]) {
      const w = part(geo.sphere(14), mat(small ? 0xe9d185 : 0xe9e2d4, { rough: 0.85 }), [s * 0.24, 0.16, -0.02], [0.07, 0.13, 0.26]);
      this.body.add(w);
      this.wing.push(w);
    }
    this.face = new Face({ eyeSize: 0.04, spacing: 0.17, eyeY: 0.44, eyeZ: 0.34, smile: false, blush: null, sideAngle: 0.5 });
    this.body.add(this.face.group);
    if (small) this.root.scale.setScalar(0.6);
    this.angle = ctx.rng.range(0, Math.PI * 2);
    this.root.position.set(center.x + Math.cos(this.angle) * ring, waterY, center.z + Math.sin(this.angle) * ring);
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    if (info.kind === 'ball' || info.kind === 'glow') {
      this.happySpin();
      this.ctx.sfx('sfx_duck_quack', { pos: this.root.position });
      this.ctx.fx.splash(this.root.position.clone().setY(this.waterY), 0.6);
      return 'bounce';
    }
    return super.defaultReaction(info);
  }

  protected behave(dt: number, t: number): void {
    this.angle += dt * 0.18 * (this.ring > 2.5 ? 1 : -1.3);
    const tx = this.center.x + Math.cos(this.angle) * this.ring;
    const tz = this.center.z + Math.sin(this.angle) * this.ring;
    const p = this.root.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    p.x += dx * Math.min(1, dt * 1.5);
    p.z += dz * Math.min(1, dt * 1.5);
    p.y = damp(p.y, this.waterY + Math.sin(t * 2 + this.bob) * 0.03, 4, dt);
    if (Math.abs(dx) + Math.abs(dz) > 0.01) this.turnTowards(Math.atan2(dx, dz), 3, dt);
    this.paddle += dt;
    if (Math.random() < dt * 0.05) this.ctx.sfx('sfx_duck_quack', { pos: p, volume: 0.5, range: 30 });
  }

  protected animate(dt: number, t: number): void {
    this.face.update(dt);
    this.body.rotation.z = Math.sin(t * 1.6 + this.bob) * 0.05;
    this.wing.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * Math.max(0, Math.sin(t * 2 + this.bob)) * 0.1));
  }
}

// ---------------------------------------------------------------- Biscuit
type DogState = 'nap' | 'sit' | 'chase' | 'carry' | 'drop' | 'celebrate';

/** Biscuit: a big fluffy sheepdog who loves fetch. The tutorial's big friend. */
export class Biscuit extends Creature {
  state: DogState = 'sit';
  private face: Face;
  private head = new THREE.Group();
  private tail = new THREE.Group();
  private ears: THREE.Mesh[] = [];
  private legs: THREE.Group[] = [];
  private tongue: THREE.Mesh;
  private mouth = new THREE.Object3D();
  private target: Ball | null = null;
  private wag = 1;
  private gait = 0;
  private stateT = 0;
  readonly home: THREE.Vector3;
  fetches = 0;
  onFetch: (() => void) | null = null;
  fetchEnabled = false;
  private zzz = 0;

  constructor(ctx: StageContext, pos: THREE.Vector3) {
    super(ctx, { name: 'Biscuit', size: 'big', radius: 1.5, centerY: 1.4, grounded: true, shadow: 2.2, giggleSfx: 'sfx_dog_woof', label: 'Biscuit' });
    this.home = pos.clone();
    const fluff = mat(0xf1e9da, { rough: 1 });
    const grey = mat(0xb9ad9c, { rough: 1 });
    const dark = mat(0x3b3236, { rough: 0.5 });
    const pink = mat(0xe39a8c, { rough: 0.6 });
    // Body with fluffy clumps.
    const torso = new THREE.Group();
    torso.position.y = 1.25;
    torso.add(part(geo.sphere(28), fluff, [0, 0, 0], [0.95, 0.85, 1.35]));
    torso.add(part(geo.sphere(24), grey, [0, 0.32, -0.25], [0.82, 0.6, 0.95]));
    const rng = ctx.rng;
    // A few soft fur tufts break up the silhouette without looking lumpy.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const p = new THREE.Vector3(Math.sin(a) * 0.86, -0.25 + (i % 2) * 0.12, Math.cos(a) * 1.22);
      torso.add(part(geo.sphere(14), fluff, [p.x, p.y, p.z], [0.3, 0.26, 0.3]));
    }
    this.body.add(torso);
    // Legs (pivot at the hip).
    const legPos: [number, number][] = [[-0.5, 0.75], [0.5, 0.75], [-0.5, -0.75], [0.5, -0.75]];
    for (const [x, z] of legPos) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.95, z);
      leg.add(part(geo.capsule(1), fluff, [0, -0.45, 0], [0.26, 0.26, 0.26]));
      leg.add(part(geo.sphere(14), fluff, [0, -0.86, 0.08], [0.28, 0.16, 0.34]));
      this.body.add(leg);
      this.legs.push(leg);
    }
    // Head.
    this.head.position.set(0, 2.05, 1.15);
    this.head.add(part(geo.sphere(28), fluff, [0, 0, 0], [0.72, 0.66, 0.66]));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      this.head.add(part(geo.sphere(10), fluff, [Math.cos(a) * 0.6, Math.sin(a) * 0.5 + 0.05, -0.1], 0.2));
    }
    // Fluffy fringe that sits just above the eyes.
    this.head.add(part(geo.sphere(16), grey, [0, 0.44, 0.2], [0.5, 0.2, 0.36]));
    const snout = part(geo.box(0.45), fluff, [0, -0.2, 0.55], [0.5, 0.36, 0.42]);
    this.head.add(snout);
    this.head.add(part(geo.sphere(16), dark, [0, -0.08, 0.78], [0.13, 0.1, 0.09]));
    this.tongue = part(geo.capsule(0.6), pink, [0, -0.42, 0.62], [0.1, 0.08, 0.05], [0.3, 0, 0]);
    this.head.add(this.tongue);
    this.mouth.position.set(0, -0.38, 0.8);
    this.head.add(this.mouth);
    for (const s of [-1, 1]) {
      const ear = part(geo.sphere(16), grey, [s * 0.62, 0.05, 0], [0.18, 0.42, 0.28]);
      this.head.add(ear);
      this.ears.push(ear);
    }
    this.face = new Face({ eyeSize: 0.13, spacing: 0.44, eyeY: 0.16, eyeZ: 0.6, smile: false, blush: 0xeab0a6, blushSize: 0.09 });
    // Teal collar with a little golden tag.
    const collar = part(geo.torus(0.12, Math.PI * 2, 28), mat(0x5f9f99, { rough: 0.6 }), [0, 1.72, 0.95], [0.62, 0.62, 0.5], [1.25, 0, 0]);
    this.body.add(collar);
    this.body.add(part(geo.cyl(1, 1, 16), mat(0xf0cb6c, { rough: 0.35, metal: 0.3 }), [0, 1.42, 1.38], [0.11, 0.03, 0.11], [1.3, 0, 0]));
    this.head.add(this.face.group);
    this.body.add(this.head);
    // Tail: chain of fluff.
    this.tail.position.set(0, 1.55, -1.25);
    for (let i = 0; i < 4; i++) this.tail.add(part(geo.sphere(12), i % 2 ? grey : fluff, [0, i * 0.18, -i * 0.12], 0.28 - i * 0.04));
    this.body.add(this.tail);
    this.root.position.copy(pos);
    this.heading = Math.PI; // face south towards the park
    this.root.rotation.y = this.heading;
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    if (info.kind === 'bubble' || info.kind === 'bigBubble' || info.kind === 'fizz') {
      // Snap! Biscuit "catches" bubbles and wags.
      this.wag = 3;
      this.face.beam(1);
      if (info.kind !== 'fizz') {
        this.ctx.sfx('sfx_dog_woof', { pos: this.root.position, volume: 0.7 });
        this.ctx.fx.hearts(this.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.8, 0)), 2);
      }
      if (this.state === 'nap') this.wake();
      return 'consume';
    }
    this.giggleBounce();
    this.wag = 3;
    if (this.state === 'nap') this.wake();
    return 'bounce';
  }

  wake(): void {
    this.state = 'sit';
    this.stateT = 0;
    this.ctx.sfx('sfx_dog_woof', { pos: this.root.position });
  }

  nap(): void {
    this.state = 'nap';
  }

  celebrate(): void {
    this.state = 'celebrate';
    this.stateT = 0;
    this.wag = 4;
    this.face.beam(4);
    this.ctx.sfx('sfx_dog_woof', { pos: this.root.position });
  }

  protected behave(dt: number, t: number): void {
    this.settleToGround(dt);
    this.stateT += dt;
    const p = this.root.position;
    const balls = this.ctx.projectiles.balls;
    if (this.state === 'sit' || this.state === 'nap') {
      this.speed = damp(this.speed, 0, 6, dt);
      // Look towards Ace.
      this.turnTowards(this.angleTo(this.ctx.player.position.x, this.ctx.player.position.z), 2, dt);
      if (this.state === 'nap') {
        this.zzz -= dt;
        if (this.zzz <= 0) {
          this.zzz = 1.4;
          this.ctx.fx.soft.emit(this.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.9, 0)), { count: 1, shape: 3, size: 0.25, sizeEnd: 0.5, speed: 0.5, life: 2, color: 0xffffff, alpha: 0.7, dir: new THREE.Vector3(0.3, 1, 0), spread: 0.1, gravity: -0.2 });
        }
        if (this.distanceToPlayer() < 6) this.wake();
      }
      if (this.fetchEnabled && this.state === 'sit') {
        let best: Ball | null = null;
        let bestD = 22;
        for (const b of balls) {
          if (b.glow || b.heldBy || b.bounces < 1 || b.age < 0.4) continue;
          const d = b.pos.distanceTo(p);
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
        if (best) {
          this.target = best;
          this.state = 'chase';
          this.stateT = 0;
          this.ctx.sfx('sfx_dog_woof', { pos: p, volume: 0.9 });
          this.wag = 3;
        }
      }
    } else if (this.state === 'chase') {
      const b = this.target;
      if (!b || !b.alive || b.heldBy) {
        this.state = 'sit';
        return;
      }
      b.life = Math.max(b.life, 4);
      this.runTowards(b.pos.x, b.pos.z, 7, dt);
      const mouth = this.mouth.getWorldPosition(new THREE.Vector3());
      if (Math.hypot(mouth.x - b.pos.x, mouth.z - b.pos.z) < 1.1 || this.stateT > 9) {
        b.heldBy = this;
        b.vel.set(0, 0, 0);
        this.state = 'carry';
        this.stateT = 0;
        this.ctx.fx.puff(b.pos, 0xe9dfcf, 5, 0.6);
      }
    } else if (this.state === 'carry') {
      const b = this.target;
      if (b && b.alive) {
        this.mouth.getWorldPosition(b.pos);
        b.life = Math.max(b.life, 4);
      }
      const pl = this.ctx.player.position;
      const toward = new THREE.Vector3(p.x - pl.x, 0, p.z - pl.z);
      const dist = toward.length();
      if (dist > 3.2) this.runTowards(pl.x, pl.z, 6, dt);
      else {
        this.speed = damp(this.speed, 0, 8, dt);
        this.turnTowards(this.angleTo(pl.x, pl.z), 5, dt);
        if (this.stateT > 0.6 || dist <= 3.2) {
          this.state = 'drop';
          this.stateT = 0;
        }
      }
      if (this.stateT > 14) this.state = 'drop';
    } else if (this.state === 'drop') {
      const b = this.target;
      if (b && b.alive) {
        b.heldBy = null;
        const pl = this.ctx.player.position;
        b.vel.set(pl.x - b.pos.x, 2, pl.z - b.pos.z).normalize().multiplyScalar(2.5);
        b.bounces = 0;
        b.life = 6;
      }
      this.target = null;
      this.fetches++;
      this.wag = 4;
      this.face.beam(1.5);
      this.ctx.sfx('sfx_dog_woof', { pos: p });
      this.ctx.fx.hearts(this.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.9, 0)), 4);
      this.onFetch?.();
      this.state = 'sit';
      this.stateT = 0;
    } else if (this.state === 'celebrate') {
      // Happy roll-over, then sit proudly.
      const k = Math.min(1, this.stateT / 1.6);
      this.body.rotation.z = Math.sin(k * Math.PI) * Math.PI * 0.95;
      this.body.position.y = Math.sin(k * Math.PI) * 0.6;
      if (Math.random() < dt * 4) this.ctx.fx.hearts(this.root.position.clone().add(new THREE.Vector3(0, 2.4, 0)), 1);
      if (k >= 1) {
        this.body.rotation.z = 0;
        this.body.position.y = 0;
        this.state = 'sit';
      }
    }
    void t;
  }

  private runTowards(x: number, z: number, speed: number, dt: number): void {
    const p = this.root.position;
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    this.turnTowards(Math.atan2(dx, dz), 5, dt);
    const want = d > 1 ? speed : speed * d;
    this.speed = damp(this.speed, want, 4, dt);
    p.x += Math.sin(this.heading) * this.speed * dt;
    p.z += Math.cos(this.heading) * this.speed * dt;
    this.ctx.physics.clampBounds(p, 3);
  }

  protected animate(dt: number, t: number): void {
    this.face.update(dt);
    this.wag = damp(this.wag, this.state === 'nap' ? 0.2 : 1, 1.5, dt);
    this.tail.rotation.y = Math.sin(t * (8 + this.wag * 4)) * 0.5 * this.wag;
    this.tail.rotation.x = -0.4;
    const run = Math.min(1, this.speed / 5);
    this.gait += dt * (4 + this.speed * 2.2);
    this.legs.forEach((l, i) => {
      const ph = i === 0 || i === 3 ? 0 : Math.PI;
      l.rotation.x = Math.sin(this.gait + ph) * 0.7 * run;
    });
    const napping = this.state === 'nap';
    const sitting = this.state === 'sit' && this.speed < 0.3;
    // Head bobs while running, tilts curiously when sitting.
    this.head.rotation.z = sitting ? Math.sin(t * 0.8) * 0.12 : 0;
    this.head.rotation.x = damp(this.head.rotation.x, napping ? 0.45 : sitting ? -0.05 : Math.sin(this.gait * 2) * 0.08, 4, dt);
    this.head.position.y = damp(this.head.position.y, napping ? 1.5 : 2.05, 3, dt);
    this.tongue.visible = !napping;
    this.tongue.scale.y = 0.08 + Math.abs(Math.sin(t * 6)) * 0.03 * (run + 0.3);
    this.ears.forEach((e, i) => (e.rotation.z = (i ? -1 : 1) * (0.1 + Math.sin(this.gait * 2) * 0.15 * run)));
  }
}
