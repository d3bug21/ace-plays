import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bubbleGeometry } from '../../fx/BubbleMaterial';
import type { StageContext } from '../types';
import type { Hittable, HitInfo, HitResponse, ProjectileKind } from '../../gameplay/Hit';
import { fishMaterial, strip, tint } from './shared';
import { SURFACE } from './world';

/** One little fish shape (faces +Z), vertex coloured so instance tints keep a pale belly and dark eyes. */
function fishGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.SphereGeometry(1, 14, 10).scale(0.065, 0.1, 0.19);
  // Two-tone body: darker back, paler belly.
  const b = strip(body);
  const p = b.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = y > 0.01 ? 0.78 : y > -0.03 ? 0.95 : 1.12;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  b.setAttribute('color', new THREE.BufferAttribute(col, 3));
  parts.push(b);
  const tail = new THREE.ConeGeometry(0.09, 0.15, 4).rotateX(-Math.PI / 2).scale(0.25, 1, 1).translate(0, 0, -0.24);
  parts.push(tint(strip(tail), 0xcfcfcf));
  const dorsal = new THREE.ConeGeometry(0.05, 0.1, 4).scale(0.2, 1, 1.6).translate(0, 0.1, -0.03);
  parts.push(tint(strip(dorsal), 0xbdbdbd));
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.024, 8, 6).translate(s * 0.05, 0.025, 0.11);
    parts.push(tint(strip(eye), 0x1d2226));
    const shine = new THREE.SphereGeometry(0.008, 4, 3).translate(s * 0.068, 0.034, 0.122);
    parts.push(tint(strip(shine), 0xffffff));
  }
  return mergeGeometries(parts)!;
}

class FishHit implements Hittable {
  hitRadius = 0.32;
  active = true;
  aimAssist = 0;
  constructor(private school: FishSchool, readonly i: number) {}
  hitCenter(out: THREE.Vector3): THREE.Vector3 {
    return this.school.positionOf(this.i, out);
  }
  accepts(_k: ProjectileKind): boolean {
    return this.school.wrapT[this.i] <= 0;
  }
  onHit(info: HitInfo): HitResponse {
    return this.school.hit(this.i, info);
  }
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const dummy = new THREE.Object3D();

export interface SchoolOptions {
  home: THREE.Vector3;
  count: number;
  color: number;
  colors?: number[];
  scale?: number;
  radius: number;
  spread: number;
  speed: number;
  seed: number;
}

/**
 * A school of little fish (one instanced draw). They follow a slow wandering
 * leader, swirl in loose slots, part gently around Ace, and a bubble wraps a
 * single fish for a floaty ride.
 */
export class FishSchool {
  readonly mesh: THREE.InstancedMesh;
  private pos: Float32Array;
  private vel: Float32Array;
  private slot: Float32Array;
  readonly wrapT: Float32Array;
  private wrapMesh: (THREE.Mesh | null)[];
  private hits: FishHit[] = [];
  private leader = new THREE.Vector3();
  private t0: number;
  private scared = 0;

  constructor(private ctx: StageContext, readonly o: SchoolOptions, private bubbleMat: THREE.ShaderMaterial) {
    const n = o.count;
    this.mesh = new THREE.InstancedMesh(fishGeometry(), fishMaterial(), n);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.slot = new Float32Array(n * 4);
    this.wrapT = new Float32Array(n);
    this.wrapMesh = new Array(n).fill(null);
    let s = o.seed;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    this.t0 = rnd() * 100;
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = o.home.x + (rnd() - 0.5) * o.spread * 2;
      this.pos[i * 3 + 1] = o.home.y + (rnd() - 0.5) * o.spread;
      this.pos[i * 3 + 2] = o.home.z + (rnd() - 0.5) * o.spread * 2;
      // Slot: a point on a loose torus around the leader + its own phase.
      this.slot[i * 4] = rnd() * Math.PI * 2;
      this.slot[i * 4 + 1] = 0.5 + rnd() * 0.5;
      this.slot[i * 4 + 2] = (rnd() - 0.5) * 2;
      this.slot[i * 4 + 3] = 0.8 + rnd() * 0.4;
      c.set(o.colors ? o.colors[i % o.colors.length] : o.color).multiplyScalar(0.92 + rnd() * 0.16);
      this.mesh.setColorAt(i, c);
      const h = new FishHit(this, i);
      this.hits.push(h);
      ctx.hits.add(h);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    ctx.root.add(this.mesh);
  }

  positionOf(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
  }

  hit(i: number, info: HitInfo): HitResponse {
    if (info.kind === 'bubble' || info.kind === 'bigBubble') {
      this.wrapT[i] = 3.2;
      const m = new THREE.Mesh(bubbleGeometry(), this.bubbleMat);
      m.renderOrder = 7;
      m.scale.setScalar(0.01);
      this.ctx.root.add(m);
      this.wrapMesh[i] = m;
      this.ctx.sfx('sfx_bubble_wrap', { pos: this.positionOf(i, tmp), volume: 0.7 });
      this.ctx.fx.sparkle(tmp, 6, [0xe9f6f8, 0xfff6e0], 0.6);
      this.scared = 1.2;
      return 'consume';
    }
    // Balls and fizz send the school darting off happily.
    this.vel[i * 3] += info.dir.x * 4;
    this.vel[i * 3 + 1] += info.dir.y * 4 + 1;
    this.vel[i * 3 + 2] += info.dir.z * 4;
    this.scared = 1.5;
    return info.kind === 'fizz' ? 'consume' : 'pass';
  }

  update(dt: number, t: number): void {
    const o = this.o;
    const tt = t * 0.12 * o.speed + this.t0;
    // Leader wanders a smooth loop around home.
    this.leader.set(
      o.home.x + Math.sin(tt) * o.radius + Math.sin(tt * 2.3) * o.radius * 0.3,
      o.home.y + Math.sin(tt * 1.7) * 1.4,
      o.home.z + Math.cos(tt * 0.8) * o.radius,
    );
    this.scared = Math.max(0, this.scared - dt);
    const pl = this.ctx.player.eyePosition(tmp2);
    const ground = this.ctx.physics.groundHeight;
    const n = o.count;
    const sc = o.scale ?? 1;
    const maxSp = 2.2 * o.speed * (this.scared > 0 ? 1.8 : 1);
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      let px = this.pos[ix];
      let py = this.pos[ix + 1];
      let pz = this.pos[ix + 2];
      if (this.wrapT[i] > 0) {
        this.wrapT[i] -= dt;
        py += dt * 0.55;
        this.pos[ix + 1] = py;
        const m = this.wrapMesh[i]!;
        const age = 3.2 - this.wrapT[i];
        m.position.set(px, py, pz);
        m.scale.setScalar(0.32 * sc * Math.min(1, age / 0.3) * (1 + Math.sin(t * 6) * 0.04));
        dummy.position.set(px, py, pz);
        dummy.rotation.set(Math.sin(t * 2) * 0.3, t * 1.5 + i, Math.sin(t * 2.4) * 0.3);
        dummy.scale.setScalar(sc);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        if (Math.random() < dt * 1.2) this.ctx.fx.hearts(tmp.set(px, py + 0.3, pz), 1);
        if (this.wrapT[i] <= 0) {
          this.ctx.fx.pop(m.position, 0.8);
          this.ctx.sfx('sfx_bubble_pop', { pos: m.position, volume: 0.6 });
          m.removeFromParent();
          this.wrapMesh[i] = null;
        }
        continue;
      }
      const a = this.slot[i * 4] + t * 0.35 * this.slot[i * 4 + 3];
      const r = o.spread * this.slot[i * 4 + 1];
      const tx = this.leader.x + Math.cos(a) * r;
      const ty = this.leader.y + this.slot[i * 4 + 2] * o.spread * 0.35;
      const tz = this.leader.z + Math.sin(a) * r;
      let vx = this.vel[ix];
      let vy = this.vel[ix + 1];
      let vz = this.vel[ix + 2];
      let dx = tx - px;
      let dy = ty - py;
      let dz = tz - pz;
      const k = 1.6 * dt;
      vx += dx * k;
      vy += dy * k;
      vz += dz * k;
      // Part around Ace.
      dx = px - pl.x;
      dy = py - pl.y;
      dz = pz - pl.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 12) {
        const d = Math.sqrt(d2) + 0.001;
        const push = (3.5 - d) * 5 * dt;
        vx += (dx / d) * push;
        vy += (dy / d) * push * 0.6;
        vz += (dz / d) * push;
      }
      const sp = Math.hypot(vx, vy, vz);
      if (sp > maxSp) {
        vx *= maxSp / sp;
        vy *= maxSp / sp;
        vz *= maxSp / sp;
      }
      const drag = Math.exp(-0.6 * dt);
      vx *= drag;
      vy *= drag;
      vz *= drag;
      px += vx * dt;
      py += vy * dt;
      pz += vz * dt;
      const g = ground(px, pz) + 0.6;
      if (py < g) {
        py = g;
        vy = Math.abs(vy) * 0.5;
      }
      if (py > SURFACE - 1.2) py = SURFACE - 1.2;
      this.pos[ix] = px;
      this.pos[ix + 1] = py;
      this.pos[ix + 2] = pz;
      this.vel[ix] = vx;
      this.vel[ix + 1] = vy;
      this.vel[ix + 2] = vz;
      dummy.position.set(px, py, pz);
      const hs = Math.hypot(vx, vz);
      dummy.rotation.set(-Math.atan2(vy, hs + 0.001) * 0.8, Math.atan2(vx, vz), 0, 'YXZ');
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const h of this.hits) this.ctx.hits.remove(h);
    for (const m of this.wrapMesh) m?.removeFromParent();
  }
}
