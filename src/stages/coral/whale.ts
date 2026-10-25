import * as THREE from 'three';
import { Face, geo, mat, part } from '../../kit/kit';
import { clamp, damp } from '../../core/math';
import { bubbleGeometry, createBubbleMaterial, releaseBubbleMaterial } from '../../fx/BubbleMaterial';
import type { StageContext } from '../types';
import type { Hittable, HitInfo, HitResponse, ProjectileKind } from '../../gameplay/Hit';
import { C, bake, latheBody, sstep } from './shared';
import { Swimmer } from './creatures';
import { SURFACE } from './world';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

function flukeGeometry(): THREE.BufferGeometry {
  // Half fluke (right side), flat in XZ, trailing edge scalloped.
  const s = new THREE.Shape();
  s.moveTo(0, 0.5);
  s.quadraticCurveTo(1.6, 0.4, 2.7, -0.6);
  s.quadraticCurveTo(2.2, -0.9, 1.5, -0.7);
  s.quadraticCurveTo(0.9, -0.6, 0.5, -0.95);
  s.quadraticCurveTo(0.2, -0.6, 0, -0.55);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2, curveSegments: 12 });
  g.rotateX(Math.PI / 2);
  g.translate(0, 0.06, 0);
  return g;
}

function flipperGeometry(): THREE.BufferGeometry {
  // Long humpback flipper with a gently bumpy leading edge, along +X.
  const s = new THREE.Shape();
  s.moveTo(0, 0.7);
  const n = 7;
  for (let i = 1; i <= n; i++) {
    const x = (i / n) * 4.4;
    const w = 0.7 * (1 - (i / n) * 0.7);
    s.quadraticCurveTo(x - 0.32, w + 0.12, x, w);
  }
  s.quadraticCurveTo(4.9, 0.05, 4.5, -0.2);
  s.quadraticCurveTo(2.4, -0.62, 0, -0.65);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 2, curveSegments: 8 });
  g.rotateX(Math.PI / 2);
  return g;
}

export type WhalePhase = 'roam' | 'arrive' | 'sing' | 'finale' | 'pass' | 'after';

/** Mama Mo, the gentle humpback. Huge, slow, and very musical. */
export class Whale extends Swimmer {
  private face: Face;
  private front = new THREE.Group();
  private mid = new THREE.Group();
  private tail = new THREE.Group();
  private flippers: THREE.Group[] = [];
  phase: WhalePhase = 'roam';
  private phaseT = 0;
  private ang = 0;
  songT = 6;
  private rollT = -1;
  readonly singCenter = new THREE.Vector3(0, 8.6, 2);
  singRadius = 16;
  private roamRadius = 37;
  /** Called on each song phrase while singing (stage spawns song bubbles). */
  onPhrase: ((mouth: THREE.Vector3, w: Whale) => void) | null = null;
  passStart = new THREE.Vector3();
  passEnd = new THREE.Vector3();
  ringPos = new THREE.Vector3();
  onRingPass: (() => void) | null = null;
  private passed = false;
  private approached = false;
  readonly mouth = new THREE.Object3D();

  constructor(ctx: StageContext) {
    super(ctx, { name: 'Mama Mo', size: 'huge', radius: 4.2, centerY: 0, label: 'Mama Mo', bubbleable: false, bigBubbleable: false });
    const skin = mat(C.whale, { rough: 0.6 });
    const skinDark = mat(new THREE.Color(C.whale).multiplyScalar(0.86).getHex(), { rough: 0.6 });
    const L = 15;
    const SY = 0.82;
    const R = (t: number) => 2.35 * Math.pow(Math.sin(Math.PI * Math.pow(t, 1.55)), 0.5) + 0.32 * Math.pow(1 - t, 3);
    const topC = new THREE.Color(C.whale);
    const bellyC = new THREE.Color(C.whaleBelly);
    const grooveC = new THREE.Color(0xc9c6bd);
    const colorAt = (n: THREE.Vector3, p: THREE.Vector3, t: number, out: THREE.Color) => {
      const line = -0.2 + Math.sin(t * 7) * 0.06;
      const b = sstep(line + 0.15, line - 0.25, n.y);
      out.copy(topC).lerp(bellyC, b);
      // Throat grooves on the pale underside of the head.
      if (t > 0.6 && b > 0.5) {
        const ang = Math.atan2(n.x, -n.y);
        const groove = Math.pow(Math.abs(Math.cos(ang * 9)), 10);
        out.lerp(grooveC, groove * sstep(0.6, 0.72, t) * 0.8);
      }
      // A few soft pale freckles on the back.
      void p;
    };
    const jointT = 0.36;
    const zJoint = -L / 2 + jointT * L;
    const frontGeo = latheBody(L, R, { t0: jointT - 0.03, t1: 1, steps: 34, segments: 32, squashY: SY, colorAt });
    const fm = new THREE.Mesh(frontGeo, mat(0xffffff, { rough: 0.6, vertexColors: true }));
    fm.castShadow = true;
    this.front.add(fm);
    const surf = (t: number, th: number) => new THREE.Vector3(R(t) * Math.sin(th), R(t) * Math.cos(th) * SY, -L / 2 + t * L);
    const fr = new THREE.Group();
    // Knobbly tubercles on the head (humpback charm).
    for (let i = 0; i < 10; i++) {
      const t = 0.9 + (i % 5) * 0.018;
      const th = (Math.floor(i / 5) ? 1 : -1) * (0.22 + (i % 2) * 0.12);
      const p = surf(t, th);
      fr.add(part(geo.sphere(10), skin, [p.x, p.y, p.z], 0.13, [0, 0, 0], false));
    }
    const bh = surf(0.8, 0);
    fr.add(part(geo.sphere(10), skinDark, [bh.x, bh.y, bh.z], [0.32, 0.12, 0.22], [0, 0, 0], false));
    const dp = surf(0.4, 0);
    fr.add(part(geo.sphere(14), skinDark, [dp.x, dp.y + 0.05, dp.z], [0.16, 0.38, 0.7], [-0.35, 0, 0]));
    // A long gentle smile along each side of the jaw.
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) {
        const k = i / 10;
        const t = 0.985 - k * 0.16;
        const th = s * (2.45 - k * 0.75 - Math.pow(k, 3) * 0.25);
        pts.push(surf(t, th).multiplyScalar(1.015));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.07, 6, false), mat(0x3f4a55, { rough: 0.6 }));
      fr.add(tube);
    }
    this.front.add(bake(fr, true, false));
    this.body.add(this.front);
    // Tail stock bends from the joint.
    this.mid.position.set(0, 0, zJoint);
    const rearGeo = latheBody(L, R, { t0: 0, t1: jointT + 0.02, steps: 18, segments: 28, squashY: SY, colorAt });
    rearGeo.translate(0, 0, -zJoint);
    const rm = new THREE.Mesh(rearGeo, mat(0xffffff, { rough: 0.6, vertexColors: true }));
    rm.castShadow = true;
    this.mid.add(rm);
    this.body.add(this.mid);
    this.tail.position.set(0, 0, -L / 2 + 0.3 - zJoint);
    const tl = new THREE.Group();
    const fl = flukeGeometry();
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(fl, skin);
      f.position.set(0, 0, 0.35);
      f.scale.set(s * 1.1, 1, 1.1);
      tl.add(f);
    }
    tl.add(part(geo.sphere(14), skin, [0, 0, 0], [0.42, 0.3, 0.7]));
    this.tail.add(bake(tl, true, false));
    this.mid.add(this.tail);
    const flg = flipperGeometry();
    const flipM = mat(0xdcdad0, { rough: 0.65 });
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.copy(surf(0.7, s * 2.05)).multiplyScalar(0.92);
      const m = new THREE.Mesh(flg, flipM);
      m.scale.set(s * 1.05, 1, 1.05);
      m.rotation.x = 0.55;
      m.castShadow = true;
      g.add(m);
      this.body.add(g);
      this.flippers.push(g);
    }
    const eye = surf(0.84, 1.62);
    this.face = new Face({ eyeSize: 0.3, spacing: eye.x * 2, eyeY: eye.y, eyeZ: eye.z, sideAngle: 1.25, smile: false, blush: 0xd9a8a2, blushSize: 0.22, lidColor: C.whale });
    this.body.add(this.face.group);
    this.mouth.position.set(0, 0.2, L / 2);
    this.body.add(this.mouth);
    this.ang = 2.6;
    this.root.position.set(Math.cos(this.ang) * this.roamRadius, 10, Math.sin(this.ang) * this.roamRadius);
    this.heading = 0;
  }

  setPhase(p: WhalePhase): void {
    this.phase = p;
    this.phaseT = 0;
    if (p === 'sing') this.songT = 1.5;
    if (p === 'pass') {
      this.passed = false;
      this.approached = false;
    }
  }

  joyRoll(): void {
    this.rollT = 0;
    this.face.beam(4);
  }

  /** The whale is not a target while she is singing: projectiles go to her song bubbles. */
  override accepts(kind: ProjectileKind): boolean {
    if (this.phase === 'sing' || this.phase === 'finale' || this.phase === 'pass' || this.phase === 'arrive') return false;
    return super.accepts(kind);
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    this.face.beam(1.5);
    this.squash = Math.min(0.4, this.squash + 0.2);
    this.ctx.fx.notes(this.mouth.getWorldPosition(tmp).add(tmp2.set(0, 1.5, 0)), 2);
    return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
  }

  sing(volume = 1): void {
    this.ctx.sfx('sfx_whale_song', { pos: this.root.position, volume, range: 90, jitter: 0.03 });
    this.ctx.fx.notes(this.mouth.getWorldPosition(tmp).add(tmp2.set(0, 1.2, 0)), 4);
    this.face.beam(1.6);
  }

  protected override keepInWater(): void {
    const p = this.root.position;
    const g = this.ctx.physics.groundHeight(p.x, p.z) + 3.2;
    if (p.y < g) p.y = g;
    const top = SURFACE - 3.0;
    if (p.y > top) p.y = top;
  }

  protected behave(dt: number, t: number): void {
    this.phaseT += dt;
    const ph = this.phase;
    if (ph === 'roam' || ph === 'after') {
      this.ang += dt * (2.0 / this.roamRadius);
      const tx = Math.cos(this.ang + 0.25) * this.roamRadius;
      const tz = Math.sin(this.ang + 0.25) * this.roamRadius;
      this.swimTowards(tmp.set(tx, 10 + Math.sin(t * 0.1) * 1.2, tz), 2.0, dt, 0.5, 0.1);
      this.songT -= dt;
      if (this.songT <= 0) {
        this.songT = 16 + Math.random() * 8;
        this.sing(0.7);
      }
      return;
    }
    if (ph === 'arrive' || ph === 'sing' || ph === 'finale') {
      const c = this.singCenter;
      const p = this.root.position;
      if (ph === 'arrive') {
        // Head for the nearest point of the song circle, then start circling.
        this.ang = Math.atan2(p.z - c.z, p.x - c.x);
      }
      this.ang += dt * ((ph === 'arrive' ? 3 : 2.2) / this.singRadius);
      const tx = c.x + Math.cos(this.ang + 0.3) * this.singRadius;
      const tz = c.z + Math.sin(this.ang + 0.3) * this.singRadius;
      const d = this.swimTowards(tmp.set(tx, c.y + Math.sin(t * 0.2) * 1, tz), ph === 'arrive' ? 3.6 : 2.2, dt, 0.7, 0.1);
      if (ph === 'arrive' && (Math.hypot(p.x - c.x, p.z - c.z) < this.singRadius + 3 || this.phaseT > 14)) this.setPhase('sing');
      void d;
      if (ph === 'sing') {
        this.songT -= dt;
        if (this.songT <= 0) {
          this.songT = 6.5;
          this.sing(1);
          this.onPhrase?.(this.mouth.getWorldPosition(new THREE.Vector3()), this);
        }
      }
      return;
    }
    if (ph === 'pass') {
      const p = this.root.position;
      // First swim to the start of the pass line, then glide straight through the ring.
      if (!this.approached) {
        this.swimTowards(this.passStart, 5, dt, 1.1, 0.1);
        if (p.distanceTo(this.passStart) < 6 || this.phaseT > 18) this.approached = true;
        return;
      }
      this.swimTowards(this.ringSide() < 0 ? this.ringPos : this.passEnd, 3.6, dt, 1.6, 0.1);
      if (!this.passed && this.ringSide() >= 0) {
        this.passed = true;
        this.onRingPass?.();
      }
      if (this.passed && p.distanceTo(this.passEnd) < 5) this.setPhase('after');
    }
  }

  /** Signed distance of the whale's head past the ring plane (along the pass line). */
  private ringSide(): number {
    const dir = tmp2.subVectors(this.passEnd, this.passStart).normalize();
    const head = this.mouth.getWorldPosition(tmp);
    return head.sub(this.ringPos).dot(dir);
  }

  protected animate(dt: number, t: number): void {
    this.face.update(dt);
    const sp = 0.6 + this.speed * 0.12;
    const k = t * sp;
    this.mid.rotation.x = Math.sin(k) * 0.07;
    this.tail.rotation.x = Math.sin(k - 0.9) * 0.24;
    this.front.rotation.x = -Math.sin(k) * 0.02;
    const tuck = this.phase === 'pass' ? 1 : 0;
    this.flippers.forEach((f, i) => {
      const s = i ? 1 : -1;
      f.rotation.z = s * (-0.7 + Math.sin(k * 0.8) * 0.22) * (1 - tuck * 0.4);
      f.rotation.y = s * (0.55 + tuck * 0.5) + Math.sin(k * 0.8 + 1) * 0.08 * s;
    });
    if (this.rollT >= 0) {
      this.rollT += dt;
      const r = Math.min(1, this.rollT / 4);
      const e = r < 0.5 ? 2 * r * r : 1 - Math.pow(-2 * r + 2, 2) / 2;
      this.body.rotation.z = e * Math.PI * 2;
      if (Math.random() < dt * 6) this.ctx.fx.hearts(this.root.position.clone().add(tmp.set(0, 3.5, 0)), 1);
      if (r >= 1) {
        this.rollT = -1;
        this.body.rotation.z = 0;
      }
    }
    void clamp;
    void damp;
  }
}

// ------------------------------------------------------------ song bubbles
function noteModel(): THREE.Group {
  const g = new THREE.Group();
  const m = mat(0xf6e2a6, { rough: 0.4, emissive: 0xf0d48a, emissiveIntensity: 0.9 });
  const st = new THREE.Group();
  st.add(part(geo.sphere(14), m, [-0.12, -0.22, 0], [0.17, 0.13, 0.12], [0, 0, 0.35], false));
  st.add(part(geo.cyl(1, 1, 8), m, [0.03, 0.08, 0], [0.035, 0.6, 0.035], [0, 0, 0], false));
  st.add(part(geo.box(0.3), m, [0.13, 0.32, 0], [0.22, 0.08, 0.05], [0, 0, -0.5], false));
  g.add(bake(st, false, false));
  return g;
}

export class SongBubble implements Hittable {
  readonly group = new THREE.Group();
  hitRadius = 1.45;
  active = true;
  aimAssist = 1.6;
  label = 'Song bubble';
  alive = true;
  readonly pos: THREE.Vector3;
  private vel: THREE.Vector3;
  private age = 0;
  private life = 26;
  private note: THREE.Group;
  private bubble: THREE.Mesh;
  private phase = Math.random() * 6;
  private glowT = 0;

  constructor(private ctx: StageContext, pos: THREE.Vector3, vel: THREE.Vector3, material: THREE.ShaderMaterial, private onPop: (b: SongBubble) => void) {
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.bubble = new THREE.Mesh(bubbleGeometry(), material);
    this.bubble.renderOrder = 7;
    this.bubble.scale.setScalar(0.85);
    this.note = noteModel();
    this.group.add(this.bubble, this.note);
    this.group.position.copy(pos);
    this.group.scale.setScalar(0.01);
    ctx.root.add(this.group);
    ctx.hits.add(this);
  }

  hitCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos);
  }

  accepts(_k: ProjectileKind): boolean {
    return this.active;
  }

  onHit(info: HitInfo): HitResponse {
    this.pop();
    return info.kind === 'ball' || info.kind === 'glow' ? 'pass' : 'consume';
  }

  pop(): void {
    if (!this.alive) return;
    this.alive = false;
    this.active = false;
    this.ctx.fx.pop(this.pos, 2.2, 0xf8f0d8);
    this.ctx.fx.notes(this.pos, 5);
    this.ctx.fx.sparkle(this.pos, 14, [0xffe9b0, 0xfff8e8, 0xd6eef3], 1.2);
    this.remove();
    this.onPop(this);
  }

  /** Fade away quietly (reached the surface or too old). */
  fade(): void {
    if (!this.alive) return;
    this.alive = false;
    this.active = false;
    this.ctx.fx.pop(this.pos, 1.4);
    this.remove();
  }

  private remove(): void {
    this.group.removeFromParent();
    this.ctx.hits.remove(this);
  }

  update(dt: number, t: number): void {
    if (!this.alive) return;
    this.age += dt;
    this.vel.multiplyScalar(Math.exp(-0.9 * dt));
    this.vel.y += 0.12 * dt;
    this.vel.y = Math.min(this.vel.y, 0.45);
    this.pos.addScaledVector(this.vel, dt);
    this.pos.x += Math.sin(t * 0.8 + this.phase) * dt * 0.25;
    this.pos.z += Math.cos(t * 0.7 + this.phase) * dt * 0.25;
    this.group.position.copy(this.pos);
    const grow = Math.min(1, this.age / 0.8);
    const s = (0.4 + 0.6 * grow) * (1 + Math.sin(t * 3 + this.phase) * 0.04);
    this.group.scale.setScalar(s);
    this.note.rotation.y = t * 1.2 + this.phase;
    this.note.position.y = Math.sin(t * 2 + this.phase) * 0.08;
    this.glowT -= dt;
    if (this.glowT <= 0) {
      this.glowT = 0.5;
      this.ctx.fx.glow.emit(this.pos, { count: 1, shape: 0, size: 2.4, sizeEnd: 1.6, speed: 0, life: 0.8, color: 0xf6e3b0, alpha: 0.22, fadeIn: 0.3 });
    }
    // Kind: swimming into a song bubble pops it too.
    const eye = this.ctx.player.eyePosition(tmp);
    if (eye.distanceTo(this.pos) < 1.7) {
      this.pop();
      return;
    }
    if (this.pos.y > SURFACE - 1.2 || this.age > this.life) this.fade();
  }
}

/** Ring of big shiny bubbles that Mama Mo swims through at the finale. */
export class BubbleRing {
  readonly group = new THREE.Group();
  private bubbles: THREE.Mesh[] = [];
  private t = 0;
  burst = false;
  private material: THREE.ShaderMaterial;
  constructor(private ctx: StageContext, pos: THREE.Vector3, facing: number, readonly radius = 6) {
    this.material = createBubbleMaterial({ wobble: 0.05, tint: 0xe3f2ee, glow: 0.3 });
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const b = new THREE.Mesh(bubbleGeometry(), this.material);
      b.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      b.scale.setScalar(0.01);
      b.userData.s = 0.45 + (i % 3) * 0.15;
      b.renderOrder = 7;
      this.group.add(b);
      this.bubbles.push(b);
    }
    this.group.position.copy(pos);
    this.group.rotation.y = facing;
    ctx.root.add(this.group);
  }

  get mat(): THREE.ShaderMaterial {
    return this.material;
  }

  pop(): void {
    if (this.burst) return;
    this.burst = true;
    for (const b of this.bubbles) {
      const w = b.getWorldPosition(new THREE.Vector3());
      this.ctx.fx.pop(w, 1.6);
      this.ctx.fx.sparkle(w, 4, [0xfff1c8, 0xd9f0f4], 0.8);
    }
    this.ctx.sfx('sfx_big_pop', { pos: this.group.position, volume: 1 });
    this.group.removeFromParent();
    releaseBubbleMaterial(this.material);
  }

  update(dt: number, t: number): void {
    if (this.burst) return;
    this.t += dt;
    this.bubbles.forEach((b, i) => {
      const k = clamp((this.t - i * 0.05) / 0.5, 0, 1);
      b.scale.setScalar(Math.max(0.01, (b.userData.s as number) * k * (1 + Math.sin(t * 3 + i) * 0.05)));
    });
    this.group.rotation.z += dt * 0.15;
    if (Math.random() < dt * 10) {
      const b = this.bubbles[Math.floor(Math.random() * this.bubbles.length)];
      this.ctx.fx.glow.emit(b.getWorldPosition(tmp), { count: 1, shape: 1, size: 0.5, sizeEnd: 0.05, speed: 0.3, life: 0.8, color: 0xfff2cf, alpha: 0.5 });
    }
  }
}
