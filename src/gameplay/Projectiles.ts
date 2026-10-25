import * as THREE from 'three';
import type { SfxOptions } from '../audio/AudioManager';
import type { PhysicsWorld, ContactResult, Collider } from '../core/Physics';
import { bubbleGeometry, createBubbleMaterial } from '../fx/BubbleMaterial';
import type { Effects } from '../fx/Particles';
import { geo, stripeTexture } from '../kit/kit';
import type { HitRegistry, Hittable, HitInfo, ProjectileKind } from './Hit';
import type { PooledLight } from '../stages/types';

export interface ProjectileHost {
  physics: PhysicsWorld;
  hits: HitRegistry;
  fx: Effects;
  sfx(id: string, o?: SfxOptions): void;
  borrowLight(): PooledLight | null;
  underwater: boolean;
  /** Called whenever any projectile hits a hittable (for cheers / HUD). */
  onTargetHit?(kind: ProjectileKind, target: Hittable): void;
}

export interface Bubble {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  life: number;
  age: number;
  kind: 'bubble' | 'bigBubble';
  alive: boolean;
}

export interface Ball {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number;
  life: number;
  age: number;
  glow: boolean;
  light: PooledLight | null;
  stuck: boolean;
  restTime: number;
  squash: number;
  squashN: THREE.Vector3;
  alive: boolean;
  lastTarget: Hittable | null;
  lastTargetT: number;
  bounces: number;
  /** Stages may tag balls (e.g. a seal is balancing it). When set, physics is skipped. */
  heldBy: unknown;
}

interface Fizz {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  alive: boolean;
}

export type BallImpactFn = (ball: Ball, collider: Collider | null, speed: number, normal: THREE.Vector3) => void;

const BALL_COLORS: [string, string][] = [
  ['#f3ead8', '#6fa8a3'],
  ['#e9a593', '#f6ede0'],
  ['#efcf7b', '#f7f1e3'],
  ['#9fc3d9', '#f5efe4'],
];

const MAX_BALLS = 14;
const MAX_GLOW = 5;
const MAX_BUBBLES = 40;
const MAX_FIZZ = 260;

export class Projectiles {
  readonly group = new THREE.Group();
  readonly bubbles: Bubble[] = [];
  readonly balls: Ball[] = [];
  private fizz: Fizz[] = [];
  private fizzMesh: THREE.InstancedMesh;
  private bubbleMat = createBubbleMaterial({ wobble: 0.04 });
  private bigBubbleMat = createBubbleMaterial({ wobble: 0.05, tint: 0xd5ecf2 });
  private fizzMat = createBubbleMaterial({ wobble: 0.0, film: 0.6 });
  private ballMats: THREE.MeshStandardMaterial[];
  private glowMat: THREE.MeshStandardMaterial;
  private contact: ContactResult = { hit: false, normal: new THREE.Vector3(), depth: 0, collider: null, ground: false };
  private host: ProjectileHost;
  private colorCursor = 0;
  private ballImpactListeners: BallImpactFn[] = [];
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private dummy = new THREE.Object3D();

  constructor(host: ProjectileHost) {
    this.host = host;
    this.ballMats = BALL_COLORS.map(([a, b]) => {
      const m = new THREE.MeshStandardMaterial({ map: stripeTexture(a, b, 1), roughness: 0.45, metalness: 0 });
      return m;
    });
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0xbfeee6, emissive: 0x9fe8de, emissiveIntensity: 2.2, roughness: 0.3 });
    this.fizzMesh = new THREE.InstancedMesh(bubbleGeometry(), this.fizzMat, MAX_FIZZ);
    this.fizzMesh.frustumCulled = false;
    this.fizzMesh.count = 0;
    this.fizzMesh.renderOrder = 5;
    this.group.add(this.fizzMesh);
    for (let i = 0; i < MAX_FIZZ; i++) this.fizz.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, max: 1, alive: false });
  }

  onBallImpact(fn: BallImpactFn): void {
    this.ballImpactListeners.push(fn);
  }

  clearListeners(): void {
    this.ballImpactListeners.length = 0;
  }

  // ------------------------------------------------------------------- fire

  fireBubble(origin: THREE.Vector3, dir: THREE.Vector3, big = false, inherit?: THREE.Vector3): Bubble {
    // Recycle the oldest bubble when at capacity.
    if (this.bubbles.length >= MAX_BUBBLES) this.popBubble(this.bubbles[0], false);
    const radius = big ? 0.62 : 0.2;
    const mesh = new THREE.Mesh(bubbleGeometry(), big ? this.bigBubbleMat : this.bubbleMat);
    mesh.renderOrder = 6;
    mesh.scale.setScalar(0.01);
    const b: Bubble = {
      mesh,
      pos: origin.clone(),
      vel: dir.clone().multiplyScalar(big ? 9 : 14),
      radius,
      life: big ? 5.5 : 3.2,
      age: 0,
      kind: big ? 'bigBubble' : 'bubble',
      alive: true,
    };
    if (inherit) b.vel.addScaledVector(inherit, 0.5);
    mesh.position.copy(b.pos);
    this.group.add(mesh);
    this.bubbles.push(b);
    return b;
  }

  fireBall(origin: THREE.Vector3, dir: THREE.Vector3, glow = false, speed = 17, inherit?: THREE.Vector3): Ball {
    const live = this.balls.filter((b) => b.glow === glow);
    if (live.length >= (glow ? MAX_GLOW : MAX_BALLS)) this.removeBall(live[0], true);
    const radius = glow ? 0.2 : 0.19;
    const m = glow ? this.glowMat : this.ballMats[this.colorCursor++ % this.ballMats.length];
    const mesh = new THREE.Mesh(geo.sphere(20), m);
    mesh.scale.setScalar(radius);
    mesh.castShadow = true;
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    const b: Ball = {
      mesh,
      pos: origin.clone(),
      vel: dir.clone().multiplyScalar(speed),
      radius,
      life: glow ? 16 : 7,
      age: 0,
      glow,
      light: null,
      stuck: false,
      restTime: 0,
      squash: 0,
      squashN: new THREE.Vector3(0, 1, 0),
      alive: true,
      lastTarget: null,
      lastTargetT: 0,
      bounces: 0,
      heldBy: null,
    };
    if (inherit) b.vel.addScaledVector(inherit, 0.4);
    if (glow) {
      b.light = this.host.borrowLight();
      if (b.light) {
        b.light.light.color.set(0xa8efe4);
        b.light.light.intensity = 6;
        b.light.light.distance = 9;
      }
    }
    mesh.position.copy(b.pos);
    this.group.add(mesh);
    this.balls.push(b);
    return b;
  }

  fireFizz(origin: THREE.Vector3, dir: THREE.Vector3, count = 3): void {
    for (let n = 0; n < count; n++) {
      const f = this.fizz.find((x) => !x.alive);
      if (!f) return;
      f.alive = true;
      f.pos.copy(origin).addScaledVector(dir, n * 0.15);
      f.vel.copy(dir).multiplyScalar(13 + Math.random() * 4);
      f.vel.x += (Math.random() - 0.5) * 1.6;
      f.vel.y += (Math.random() - 0.5) * 1.6;
      f.vel.z += (Math.random() - 0.5) * 1.6;
      f.max = f.life = 0.55 + Math.random() * 0.25;
    }
  }

  // ----------------------------------------------------------------- update

  update(dt: number, t: number): void {
    const h = this.host;
    const uw = h.underwater;

    // Bubbles ---------------------------------------------------------------
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (!b.alive) {
        this.bubbles.splice(i, 1);
        continue;
      }
      b.age += dt;
      b.life -= dt;
      const drag = b.kind === 'bigBubble' ? 1.4 : 1.15;
      b.vel.multiplyScalar(Math.exp(-drag * dt));
      b.vel.y += (uw ? 1.3 : 0.55) * dt;
      b.vel.x += Math.sin(t * 2.1 + i) * 0.25 * dt;
      b.vel.z += Math.cos(t * 1.7 + i * 1.3) * 0.25 * dt;
      b.pos.addScaledVector(b.vel, dt);
      const grow = Math.min(1, b.age / 0.09);
      const s = b.radius * (0.6 + 0.4 * grow);
      b.mesh.scale.set(s * (1 + Math.sin(t * 11 + i) * 0.03), s * (1 + Math.cos(t * 9 + i) * 0.03), s);
      b.mesh.position.copy(b.pos);
      if (Math.random() < dt * 10) h.fx.trail(b.pos, 0xe7f5f8, 0.05, 0.35);

      const target = h.hits.overlap(b.pos, b.radius * 1.5 + 0.1, b.kind);
      if (target) {
        const info: HitInfo = { kind: b.kind, point: b.pos.clone(), dir: this.tmp.copy(b.vel).normalize().clone(), speed: b.vel.length(), power: b.kind === 'bigBubble' ? 1 : 0.6 };
        const resp = target.onHit(info);
        h.onTargetHit?.(b.kind, target);
        if (resp === 'consume' || resp === 'stick') {
          this.popBubble(b, true, false);
          continue;
        }
        if (resp === 'bounce') {
          target.hitCenter(this.tmp2);
          const n = this.tmp.subVectors(b.pos, this.tmp2).normalize();
          b.vel.reflect(n).multiplyScalar(0.5);
          b.pos.addScaledVector(n, 0.1);
        }
      }
      h.physics.sphereContact(b.pos, b.radius * 0.8, this.contact);
      if (this.contact.hit || b.life <= 0) {
        this.popBubble(b, true);
        continue;
      }
      if (uw && h.physics.waterSurface !== null && b.pos.y > h.physics.waterSurface - 0.2) {
        this.popBubble(b, true);
        continue;
      }
    }

    // Balls -----------------------------------------------------------------
    const g = uw ? 4.2 : 15.5;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (!b.alive) {
        this.balls.splice(i, 1);
        continue;
      }
      b.age += dt;
      b.life -= dt;
      if (b.light) b.light.light.position.copy(b.pos);
      if (b.life <= 0) {
        this.removeBall(b, true);
        continue;
      }
      // Fade out the last half second.
      if (b.life < 0.4) b.mesh.scale.setScalar(b.radius * Math.max(0.01, b.life / 0.4));
      if (b.glow && b.light) {
        const pulse = 5.5 + Math.sin(t * 3 + i) * 0.8;
        b.light.light.intensity = pulse * Math.min(1, b.life / 1.5);
      }
      if (b.heldBy) {
        b.mesh.position.copy(b.pos);
        continue;
      }
      if (b.stuck) {
        b.mesh.position.copy(b.pos);
        continue;
      }
      const sub = 2;
      const sdt = dt / sub;
      for (let s = 0; s < sub; s++) {
        b.vel.y -= g * sdt;
        if (uw) b.vel.multiplyScalar(Math.exp(-1.1 * sdt));
        else b.vel.multiplyScalar(Math.exp(-0.05 * sdt));
        b.pos.addScaledVector(b.vel, sdt);
        h.physics.sphereContact(b.pos, b.radius, this.contact);
        if (this.contact.hit) {
          const n = this.contact.normal;
          b.pos.addScaledVector(n, this.contact.depth + 0.001);
          const vn = b.vel.dot(n);
          if (vn < 0) {
            const bounciness = this.contact.collider?.bounciness ?? 1;
            const e = (b.glow ? 0.32 : 0.74) * bounciness;
            const impact = -vn;
            b.vel.addScaledVector(n, -(1 + e) * vn);
            // Tangential rolling friction.
            const vnn = b.vel.dot(n);
            this.tmp.copy(b.vel).addScaledVector(n, -vnn);
            const fr = this.contact.ground ? (b.glow ? 0.75 : 0.16) : 0.08;
            this.tmp.multiplyScalar(1 - Math.min(1, fr * (impact > 2 ? 1 : 0.25)));
            b.vel.copy(this.tmp).addScaledVector(n, vnn);
            if (impact > 1.4) {
              b.bounces++;
              const vol = Math.min(1, impact / 12);
              h.sfx(b.glow ? 'sfx_boop' : 'sfx_ball_boing', { pos: b.pos, volume: 0.25 + vol * 0.75, rate: 0.95 + Math.min(0.25, impact * 0.015) });
              b.squash = Math.min(0.35, impact * 0.03);
              b.squashN.copy(n);
              if (impact > 5) h.fx.puff(b.pos.clone().addScaledVector(n, -b.radius), uw ? 0xd9e6e0 : 0xe8dfcf, 3, 0.5);
              for (const l of this.ballImpactListeners) l(b, this.contact.collider, impact, n);
              if (b.glow && this.contact.ground) {
                b.stuck = true;
                b.vel.set(0, 0, 0);
                h.fx.sparkle(b.pos, 8, [0xbff3ea, 0xfdf8e8], 0.7);
              }
            }
          }
          // Rolling resistance when resting on the ground.
          if (this.contact.ground) {
            const rr = Math.exp(-0.9 * sdt);
            b.vel.x *= rr;
            b.vel.z *= rr;
          }
        }
      }
      // Spin the ball to match its rolling motion.
      const speed = Math.hypot(b.vel.x, b.vel.z);
      if (speed > 0.01) {
        this.tmp.set(b.vel.z, 0, -b.vel.x).normalize();
        b.mesh.rotateOnWorldAxis(this.tmp, (speed * dt) / b.radius);
      }
      // Squash & stretch on bounce.
      b.squash *= Math.exp(-14 * dt);
      const sq = b.squash;
      b.mesh.scale.set(b.radius * (1 + sq * 0.5), b.radius * (1 - sq), b.radius * (1 + sq * 0.5));
      b.mesh.position.copy(b.pos);
      if (b.glow && Math.random() < dt * 14) h.fx.trail(b.pos, 0xa8efe4, 0.12, 0.5, true);

      // Rest detection.
      if (b.vel.lengthSq() < 0.15 && this.contact.hit) {
        b.restTime += dt;
        if (b.restTime > 2.2 && !b.glow) b.life = Math.min(b.life, 0.6);
      } else b.restTime = 0;

      // Targets.
      b.lastTargetT -= dt;
      const kind: ProjectileKind = b.glow ? 'glow' : 'ball';
      const target = h.hits.overlap(b.pos, b.radius + 0.12, kind, b.lastTargetT > 0 ? b.lastTarget : null);
      if (target) {
        const info: HitInfo = { kind, point: b.pos.clone(), dir: b.vel.clone().normalize(), speed: b.vel.length(), power: Math.min(1, b.vel.length() / 14) };
        const resp = target.onHit(info);
        h.onTargetHit?.(kind, target);
        b.lastTarget = target;
        b.lastTargetT = 0.35;
        if (resp === 'consume') {
          this.removeBall(b, true);
          continue;
        } else if (resp === 'stick') {
          b.stuck = true;
          b.vel.set(0, 0, 0);
        } else if (resp === 'bounce') {
          target.hitCenter(this.tmp2);
          const n = this.tmp.subVectors(b.pos, this.tmp2);
          if (n.lengthSq() < 1e-6) n.set(0, 1, 0);
          n.normalize();
          const vn = b.vel.dot(n);
          if (vn < 0) b.vel.addScaledVector(n, -1.6 * vn);
          b.vel.y = Math.max(b.vel.y, 2.5);
          b.pos.copy(this.tmp2).addScaledVector(n, target.hitRadius + b.radius + 0.13);
          b.squash = 0.3;
          b.squashN.copy(n);
          h.sfx('sfx_ball_boing', { pos: b.pos, volume: 0.8, rate: 1.1 });
        }
      }
    }

    // Fizz -----------------------------------------------------------------
    let n = 0;
    for (const f of this.fizz) {
      if (!f.alive) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.alive = false;
        continue;
      }
      f.vel.multiplyScalar(Math.exp(-2.6 * dt));
      f.vel.y += (uw ? 2 : 0.8) * dt;
      f.pos.addScaledVector(f.vel, dt);
      const target = h.hits.overlap(f.pos, 0.16, 'fizz');
      if (target) {
        const resp = target.onHit({ kind: 'fizz', point: f.pos.clone(), dir: f.vel.clone().normalize(), speed: f.vel.length(), power: 0.15 });
        h.onTargetHit?.('fizz', target);
        if (resp !== 'pass') {
          f.alive = false;
          if (Math.random() < 0.3) h.fx.pop(f.pos, 0.35);
          continue;
        }
      }
      h.physics.sphereContact(f.pos, 0.06, this.contact);
      if (this.contact.hit) {
        f.alive = false;
        if (Math.random() < 0.25) h.fx.pop(f.pos, 0.3);
        continue;
      }
      const life01 = f.life / f.max;
      const s = 0.05 + 0.04 * Math.sin(life01 * Math.PI);
      this.dummy.position.copy(f.pos);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.fizzMesh.setMatrixAt(n++, this.dummy.matrix);
    }
    this.fizzMesh.count = n;
    this.fizzMesh.instanceMatrix.needsUpdate = true;
  }

  popBubble(b: Bubble, effects: boolean, sound = true): void {
    if (!b.alive) return;
    b.alive = false;
    this.group.remove(b.mesh);
    if (effects) {
      const big = b.kind === 'bigBubble';
      this.host.fx.pop(b.pos, big ? 2.2 : 1);
      if (sound) this.host.sfx(big ? 'sfx_big_pop' : 'sfx_bubble_pop', { pos: b.pos, volume: 0.8 });
    }
    const i = this.bubbles.indexOf(b);
    if (i >= 0) this.bubbles.splice(i, 1);
  }

  removeBall(b: Ball, effects: boolean): void {
    if (!b.alive) return;
    b.alive = false;
    this.group.remove(b.mesh);
    if (b.light) {
      b.light.release();
      b.light = null;
    }
    if (effects) this.host.fx.sparkle(b.pos, 6, b.glow ? [0xbff3ea] : [0xfff2d6, 0xffffff], 0.5);
    const i = this.balls.indexOf(b);
    if (i >= 0) this.balls.splice(i, 1);
  }

  clear(): void {
    for (const b of [...this.bubbles]) this.popBubble(b, false);
    for (const b of [...this.balls]) this.removeBall(b, false);
    for (const f of this.fizz) f.alive = false;
    this.fizzMesh.count = 0;
    this.bubbles.length = 0;
    this.balls.length = 0;
  }
}
