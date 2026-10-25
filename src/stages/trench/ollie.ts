import * as THREE from 'three';
import { Face, geo, matUnique, part } from '../../kit/kit';
import { clamp, damp, easeInOutSine } from '../../core/math';
import type { Hittable, HitInfo, HitResponse, ProjectileKind } from '../../gameplay/Hit';
import type { PooledLight, StageContext } from '../types';
import type { SphereCollider } from '../../core/Physics';
import { haloSprite } from './world';

const ARMS = 8;
const RINGS = 30;
const RADIAL = 12;
const UP = new THREE.Vector3(0, 1, 0);

type Pose = 'hidden' | 'peek' | 'happy';

const SHY = new THREE.Color('#8594cf');
const BLUSH = new THREE.Color('#f0a7a0');
const TIP_DORMANT = new THREE.Color('#9ff0e4');
const TIP_HAPPY = new THREE.Color('#ffd0a6');

/** One of Ollie's arm-tips: a generous hittable with a glowing spot. */
class ArmTip implements Hittable {
  hitRadius = 1.0;
  active = false;
  aimAssist = 1.2;
  label = "Ollie's arm-tip";
  tickled = false;
  fizz = 0;
  curl = 0;
  wiggle = 0;
  readonly pos = new THREE.Vector3();
  constructor(private owner: Ollie, readonly index: number) {}
  hitCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.pos);
  }
  accepts(_k: ProjectileKind): boolean {
    return this.active;
  }
  onHit(info: HitInfo): HitResponse {
    this.owner.tickleTip(this, info);
    return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
  }
}

/**
 * Ollie: a huge, round, shy octopus hiding in his cave because it is too
 * dark. Eight long rounded arms are drawn with one instanced mesh.
 */
export class Ollie {
  readonly root = new THREE.Group();
  readonly mantle: THREE.Group;
  private mantleMat: THREE.MeshStandardMaterial;
  private spotMat: THREE.MeshStandardMaterial;
  private face: Face;
  private cheekMat: THREE.MeshStandardMaterial;
  private arms: THREE.Mesh;
  private armMat: THREE.MeshStandardMaterial;
  private armPos: Float32Array;
  private armNor: Float32Array;
  private ringP: THREE.Vector3[] = [];
  private ringR: number[] = [];
  private tipsMesh: THREE.InstancedMesh;
  private tipHalos: THREE.Sprite[] = [];
  readonly tips: ArmTip[] = [];
  pose: Pose = 'hidden';
  private poseT = 0;
  private blush = 0;
  private bases: THREE.Vector3[] = [];
  private tipAnchor: THREE.Vector3[] = [];
  /** Where each arm-tip rests in the peek pose (set by the stage). */
  peekTips: THREE.Vector3[] = [];
  private readonly hiddenPos: THREE.Vector3;
  private readonly peekPos: THREE.Vector3;
  private readonly happyPos: THREE.Vector3;
  private readonly bodyTarget = new THREE.Vector3();
  private shy = 0;
  private dummy = new THREE.Object3D();
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private col = new THREE.Color();
  private light: PooledLight | null = null;
  private lightK = 0;
  private swirlT = 0;
  private giggleT = 0;
  private collider: SphereCollider;
  readonly mantleHit: Hittable;
  onTickle: ((tip: ArmTip, fresh: boolean) => void) | null = null;
  onMantleHit: (() => void) | null = null;

  constructor(private ctx: StageContext, floorY: number, caveZ: number) {
    this.hiddenPos = new THREE.Vector3(0, floorY + 2.6, caveZ - 2.5);
    this.peekPos = new THREE.Vector3(0, floorY + 2.7, caveZ + 5.0);
    this.happyPos = new THREE.Vector3(0, floorY + 5.6, caveZ + 12.5);
    this.root.position.copy(this.hiddenPos);
    this.bodyTarget.copy(this.hiddenPos);
    this.mantleMat = matUnique(SHY, { rough: 0.55 });
    this.spotMat = matUnique(SHY.clone().lerp(new THREE.Color('#ffffff'), 0.25), { rough: 0.55 });
    this.mantle = new THREE.Group();
    this.mantle.add(part(geo.sphere(40), this.mantleMat, [0, 0.4, -0.5], [2.35, 2.7, 2.3], [-0.3, 0, 0], false));
    // Soft rounded spots on his head.
    const spots: [number, number, number, number][] = [
      [0.9, 2.1, -0.2, 0.32],
      [-1.1, 1.7, 0.4, 0.26],
      [0.2, 2.75, -1.0, 0.36],
      [-0.5, 1.0, 1.55, 0.2],
      [1.5, 1.0, 0.9, 0.22],
      [-1.7, 0.6, -0.6, 0.28],
    ];
    for (const [x, y, z, r] of spots) this.mantle.add(part(geo.sphere(14), this.spotMat, [x, y, z], [r, r * 0.6, r], [0, 0, 0], false));
    // Face sits low on the front, like a real octopus' eyes above its arms.
    this.face = new Face({ eyeSize: 0.5, spacing: 1.55, eyeY: -0.35, eyeZ: 1.85, smile: true, smileWidth: 0.3, smileY: -1.2, smileColor: '#43344f', blush: null, lidColor: '#7f8ec8', pupilColor: '#262a3a' });
    this.mantle.add(this.face.group);
    this.cheekMat = matUnique('#f19a9a', { rough: 0.9, transparent: true, opacity: 0 });
    for (const s of [-1, 1]) this.mantle.add(part(geo.sphere(14), this.cheekMat, [s * 1.35, -0.95, 1.65], [0.32, 0.18, 0.12], [0, s * 0.5, 0], false));
    this.root.add(this.mantle);
    ctx.root.add(this.root);

    // Arms: one dynamic tube mesh for all eight (smooth, rounded, one draw call).
    const vpr = RINGS * RADIAL + 1;
    this.armPos = new Float32Array(ARMS * vpr * 3);
    this.armNor = new Float32Array(ARMS * vpr * 3);
    const armCol = new Float32Array(ARMS * vpr * 3);
    const idx: number[] = [];
    for (let a = 0; a < ARMS; a++) {
      const o = a * vpr;
      for (let k = 0; k < RINGS; k++) {
        for (let j = 0; j < RADIAL; j++) {
          const v = o + k * RADIAL + j;
          // Underside (towards ring angle PI) is paler, like real octopus arms.
          const ang = (j / RADIAL) * Math.PI * 2;
          const under = Math.max(0, -Math.cos(ang));
          const spot = under > 0.8 && k % 3 === 1 ? 0.12 : 0;
          const c = 0.84 + under * 0.2 + spot;
          armCol.set([c, c * (0.98 + under * 0.04), c], v * 3);
          if (k < RINGS - 1) {
            const j2 = (j + 1) % RADIAL;
            const a0 = o + k * RADIAL + j;
            const a1 = o + k * RADIAL + j2;
            const b0 = o + (k + 1) * RADIAL + j;
            const b1 = o + (k + 1) * RADIAL + j2;
            idx.push(a0, b0, a1, a1, b0, b1);
          }
        }
      }
      const tipV = o + RINGS * RADIAL;
      armCol.set([0.95, 0.95, 0.95], tipV * 3);
      for (let j = 0; j < RADIAL; j++) {
        const j2 = (j + 1) % RADIAL;
        idx.push(o + (RINGS - 1) * RADIAL + j, tipV, o + (RINGS - 1) * RADIAL + j2);
      }
    }
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(this.armPos, 3).setUsage(THREE.DynamicDrawUsage));
    ag.setAttribute('normal', new THREE.BufferAttribute(this.armNor, 3).setUsage(THREE.DynamicDrawUsage));
    ag.setAttribute('color', new THREE.BufferAttribute(armCol, 3));
    ag.setIndex(idx);
    this.armMat = new THREE.MeshStandardMaterial({ color: SHY.clone(), roughness: 0.55, vertexColors: true });
    this.arms = new THREE.Mesh(ag, this.armMat);
    this.arms.frustumCulled = false;
    for (let k = 0; k < RINGS; k++) {
      this.ringP.push(new THREE.Vector3());
      this.ringR.push(0);
    }
    this.tipsMesh = new THREE.InstancedMesh(geo.sphere(14), new THREE.MeshBasicMaterial({ color: '#ffffff' }), ARMS);
    this.tipsMesh.frustumCulled = false;
    for (let i = 0; i < ARMS; i++) this.tipsMesh.setColorAt(i, TIP_DORMANT);
    ctx.root.add(this.arms, this.tipsMesh);

    for (let i = 0; i < ARMS; i++) {
      const a = (i / ARMS) * Math.PI * 2 + Math.PI / ARMS;
      this.bases.push(new THREE.Vector3(Math.sin(a) * 1.45, -1.75, Math.cos(a) * 1.2 - 0.3));
      this.tipAnchor.push(this.hiddenTip(i, new THREE.Vector3()));
      const tip = new ArmTip(this, i);
      this.tips.push(tip);
      ctx.hits.add(tip);
      const h = haloSprite('#a6f2e4', 1.3, 0);
      ctx.root.add(h);
      this.tipHalos.push(h);
    }
    this.collider = ctx.physics.add({ kind: 'sphere', center: this.root.position.clone(), r: 2.3, tag: 'ollie' });
    this.mantleHit = {
      hitRadius: 2.5,
      active: true,
      aimAssist: 0,
      label: 'Ollie',
      hitCenter: (out) => out.copy(this.root.position).add(this.tmpD.set(0, 0.5, 0.4)),
      accepts: () => this.pose !== 'hidden',
      onHit: (info: HitInfo): HitResponse => {
        this.face.beam(0.8);
        this.onMantleHit?.();
        return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
      },
    };
    ctx.hits.add(this.mantleHit);
  }

  get tickledCount(): number {
    return this.tips.filter((t) => t.tickled).length;
  }

  private hiddenTip(i: number, out: THREE.Vector3): THREE.Vector3 {
    const a = (i / ARMS) * Math.PI * 2;
    return out.set(this.hiddenPos.x + Math.sin(a) * 2.4, this.hiddenPos.y - 2.0, this.hiddenPos.z + Math.cos(a) * 2.2);
  }

  peek(): void {
    if (this.pose !== 'hidden') return;
    this.pose = 'peek';
    this.poseT = 0;
    this.light = this.ctx.borrowLight();
    if (this.light) {
      this.light.light.color.set('#ffd2b4');
      this.light.light.distance = 18;
      this.light.light.intensity = 0;
    }
  }

  celebrate(): void {
    this.pose = 'happy';
    this.poseT = 0;
    this.swirlT = 6;
    this.giggleT = 0.1;
    for (const t of this.tips) t.active = false;
    this.face.beam(4);
  }

  tickleTip(tip: ArmTip, info: HitInfo): void {
    tip.wiggle = 1;
    tip.curl = 1;
    let fresh = false;
    if (!tip.tickled) {
      if (info.kind === 'fizz') tip.fizz++;
      if (info.kind !== 'fizz' || tip.fizz >= 4) {
        tip.tickled = true;
        tip.aimAssist = 0;
        fresh = true;
        this.ctx.fx.hearts(tip.pos.clone().add(this.tmpA.set(0, 0.6, 0)), 3, '#f6b2b8');
        this.ctx.fx.sparkle(tip.pos, 12, ['#ffe0c2', '#fff6e8'], 0.9);
        this.face.beam(1.2);
        this.blush = Math.min(1, this.blush + 0.06);
      }
    }
    if (fresh || info.kind !== 'fizz' || Math.random() < 0.15) this.ctx.sfx('sfx_giggle', { pos: tip.pos, volume: 0.8, rate: 0.75 });
    this.onTickle?.(tip, fresh);
  }

  /** Write one arm's tube vertices (and its suckers) from ringP / ringR. */
  private writeArm(i: number): void {
    const vpr = RINGS * RADIAL + 1;
    const o = i * vpr;
    const P = this.armPos;
    const N = this.armNor;
    const T = this.tmpA;
    const nrm = this.tmpB;
    const bin = this.tmpC;
    for (let k = 0; k < RINGS; k++) {
      const p = this.ringP[k];
      const q = this.ringP[Math.min(RINGS - 1, k + 1)];
      const q0 = this.ringP[Math.max(0, k - 1)];
      T.subVectors(q, q0);
      if (T.lengthSq() < 1e-8) T.set(0, 0, 1);
      T.normalize();
      // Parallel-transport the ring frame along the arm so curls never twist or pinch.
      if (k === 0) nrm.copy(UP);
      nrm.addScaledVector(T, -nrm.dot(T));
      if (nrm.lengthSq() < 1e-6) nrm.set(1, 0, 0).addScaledVector(T, -T.x);
      nrm.normalize();
      bin.crossVectors(T, nrm);
      const r = this.ringR[k];
      for (let j = 0; j < RADIAL; j++) {
        const ang = (j / RADIAL) * Math.PI * 2;
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        const nx = nrm.x * c + bin.x * sn;
        const ny = nrm.y * c + bin.y * sn;
        const nz = nrm.z * c + bin.z * sn;
        const v = (o + k * RADIAL + j) * 3;
        P[v] = p.x + nx * r;
        P[v + 1] = p.y + ny * r;
        P[v + 2] = p.z + nz * r;
        N[v] = nx;
        N[v + 1] = ny;
        N[v + 2] = nz;
      }
    }
    // Rounded tip cap.
    const last = this.ringP[RINGS - 1];
    const tv = (o + RINGS * RADIAL) * 3;
    P[tv] = last.x + T.x * this.ringR[RINGS - 1];
    P[tv + 1] = last.y + T.y * this.ringR[RINGS - 1];
    P[tv + 2] = last.z + T.z * this.ringR[RINGS - 1];
    N[tv] = T.x;
    N[tv + 1] = T.y;
    N[tv + 2] = T.z;
  }

  private tipTarget(i: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.pose === 'hidden') return this.hiddenTip(i, out);
    if (this.pose === 'peek') {
      const p = this.peekTips[i];
      return out.set(p.x + Math.sin(t * 0.7 + i * 1.3) * 0.35, p.y + Math.sin(t * 0.9 + i) * 0.3, p.z + Math.cos(t * 0.6 + i * 0.8) * 0.35);
    }
    // Happy: arms raised and waving all around.
    const a = (i / ARMS) * Math.PI * 2 + Math.PI / ARMS;
    const wave = Math.sin(t * 2.2 + i * 0.8);
    const R = 5.2 + Math.sin(t * 1.3 + i) * 0.6;
    const front = Math.cos(a);
    // Side and back arms wave high; front arms sweep low so his happy face shows.
    const y = front > 0.3 ? -2.6 + wave * 0.6 : 0.8 + wave * 1.9 + (i % 2) * 0.7;
    const sx = Math.sin(a) * (front > 0.3 ? 1.5 : 1.15);
    return out.set(this.root.position.x + sx * R, this.root.position.y + y, this.root.position.z + front * R * 0.85);
  }

  update(dt: number, t: number): void {
    this.poseT += dt;
    // Before he peeks, Ollie is tucked away out of sight (no eyes in the dark).
    const shown = this.pose !== 'hidden';
    this.root.visible = shown;
    this.arms.visible = shown;
    this.tipsMesh.visible = shown;
    const ace = this.ctx.player.position;
    // Body target.
    if (this.pose === 'hidden') this.bodyTarget.copy(this.hiddenPos);
    else if (this.pose === 'peek') {
      const d = Math.hypot(ace.x - this.peekPos.x, ace.z - this.peekPos.z);
      this.shy = damp(this.shy, d < 7 ? 1 : 0, 2, dt);
      const k = easeInOutSine(clamp(this.poseT / 2.5, 0, 1));
      this.bodyTarget.lerpVectors(this.hiddenPos, this.peekPos, k);
      this.bodyTarget.z -= this.shy * 1.3;
      this.bodyTarget.y += Math.sin(t * 0.9) * 0.15;
    } else {
      const k = easeInOutSine(clamp(this.poseT / 3, 0, 1));
      this.bodyTarget.lerpVectors(this.peekPos, this.happyPos, k);
      this.bodyTarget.y += Math.sin(t * 1.6) * 0.35 * k;
    }
    this.root.position.x = damp(this.root.position.x, this.bodyTarget.x, 3, dt);
    this.root.position.y = damp(this.root.position.y, this.bodyTarget.y, 3, dt);
    this.root.position.z = damp(this.root.position.z, this.bodyTarget.z, 3, dt);
    this.collider.center.copy(this.root.position).add(this.tmpA.set(0, 0.5, 0));
    // Breathing mantle, a happy wobble when celebrating.
    const breathe = Math.sin(t * 1.2);
    const happy = this.pose === 'happy' ? 1 : 0;
    this.mantle.scale.set(1 + breathe * 0.025, 1 - breathe * 0.02 + happy * Math.sin(t * 5) * 0.03, 1 + breathe * 0.025);
    this.mantle.rotation.z = happy * Math.sin(t * 2.4) * 0.12;
    this.mantle.rotation.x = -this.shy * 0.12;
    // Eyes follow Ace (or glance away shyly).
    this.face.update(dt);
    const local = this.tmpA.copy(ace).sub(this.root.position);
    const gx = clamp(local.x / 8, -1, 1) * (1 - this.shy * 0.6) + this.shy * Math.sin(t * 0.7) * 0.6;
    const gy = clamp((local.y + 1) / 8, -1, 1) - this.shy * 0.5;
    this.face.glance(gx, gy);

    // Blush (warm colour) when tickled and when celebrating.
    if (this.pose === 'happy') this.blush = Math.min(1, this.blush + dt / 2);
    this.mantleMat.color.copy(SHY).lerp(BLUSH, this.blush);
    this.spotMat.color.copy(SHY).lerp(BLUSH, this.blush).lerp(new THREE.Color('#ffffff'), 0.28);
    this.cheekMat.opacity = this.pose === 'hidden' ? 0 : 0.35 + this.blush * 0.5;

    // Arms.
    const armCol = this.col.copy(SHY).lerp(BLUSH, this.blush);
    for (let i = 0; i < ARMS; i++) {
      const tip = this.tips[i];
      const target = this.tipTarget(i, t, this.tmpB);
      const rate = this.pose === 'peek' && this.poseT < 4 ? 1.1 : 2.2;
      this.tipAnchor[i].x = damp(this.tipAnchor[i].x, target.x, rate, dt);
      this.tipAnchor[i].y = damp(this.tipAnchor[i].y, target.y, rate, dt);
      this.tipAnchor[i].z = damp(this.tipAnchor[i].z, target.z, rate, dt);
      tip.curl = damp(tip.curl, tip.tickled ? 0.35 : 0, 1.5, dt);
      tip.wiggle = Math.max(0, tip.wiggle - dt * 0.8);
      const B = this.tmpC.copy(this.bases[i]).add(this.root.position);
      const T = this.tipAnchor[i];
      const span = B.distanceTo(T);
      const out = this.tmpD.subVectors(T, B).setY(0);
      if (out.lengthSq() < 1e-4) out.set(0, 0, 1);
      out.normalize();
      const side = this.tmpA.crossVectors(out, UP).normalize();
      const C = this.ctrl.addVectors(B, T).multiplyScalar(0.5).addScaledVector(UP, span * (this.pose === 'happy' ? 0.15 : this.pose === 'peek' ? 0.1 : 0.25));
      for (let k = 0; k < RINGS; k++) {
        const sl = k / (RINGS - 1);
        const s = 1 - Math.pow(1 - sl, 1.3);
        const u = 1 - s;
        const p = this.ringP[k];
        p.set(u * u * B.x + 2 * u * s * C.x + s * s * T.x, u * u * B.y + 2 * u * s * C.y + s * s * T.y, u * u * B.z + 2 * u * s * C.z + s * s * T.z);
        const wv = Math.sin(t * 1.3 + i * 0.9 - s * 5) * 0.4 * s + Math.sin(t * 13 + i) * 0.18 * tip.wiggle * s;
        p.addScaledVector(side, wv);
        p.y += Math.cos(t * 1.0 + i - s * 4) * 0.22 * s;
        if (s > 0.62) {
          // Curl the tip up and back into a happy little spiral.
          const kk = (s - 0.62) / 0.38;
          const ang = kk * kk * (1.2 + tip.curl * 3.6);
          const rr = 0.55 + tip.curl * 0.3;
          p.addScaledVector(UP, Math.sin(ang) * rr * kk);
          p.addScaledVector(out, -(1 - Math.cos(ang)) * rr * kk * 0.8);
        }
        this.ringR[k] = 0.07 + 0.52 * Math.pow(1 - s, 0.9);
      }
      this.writeArm(i);
      tip.pos.copy(this.ringP[RINGS - 1]);
      // Glowing tip spot.
      this.dummy.position.copy(tip.pos);
      this.dummy.quaternion.identity();
      this.dummy.scale.setScalar(0.2 + (tip.tickled ? 0.04 : Math.sin(t * 3 + i) * 0.025));
      this.dummy.updateMatrix();
      this.tipsMesh.setMatrixAt(i, this.dummy.matrix);
      this.tipsMesh.setColorAt(i, this.tmpColor.copy(tip.tickled || this.pose === 'happy' ? TIP_HAPPY : TIP_DORMANT));
      const h = this.tipHalos[i];
      h.position.copy(tip.pos);
      const show = this.pose === 'hidden' ? 0 : clamp(this.poseT / 3, 0, 1);
      (h.material as THREE.SpriteMaterial).color.copy(tip.tickled || this.pose === 'happy' ? TIP_HAPPY : TIP_DORMANT);
      (h.material as THREE.SpriteMaterial).opacity = show * (tip.tickled ? 0.35 : 0.3 + Math.sin(t * 3 + i) * 0.08);
      h.scale.setScalar(tip.tickled ? 1.6 : 1.3);
      tip.active = this.pose === 'peek' && this.poseT > 2.5;
    }
    (this.arms.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.arms.geometry.attributes.normal as THREE.BufferAttribute).needsUpdate = true;
    this.armMat.color.copy(armCol);
    this.tipsMesh.instanceMatrix.needsUpdate = true;
    if (this.tipsMesh.instanceColor) this.tipsMesh.instanceColor.needsUpdate = true;

    // Warm glow from the cave once he peeks out.
    if (this.light) {
      this.lightK = damp(this.lightK, 1, 0.8, dt);
      this.light.light.position.copy(this.root.position).add(this.tmpA.set(0, 1.5, 4.2));
      this.light.light.intensity = this.lightK * (10 + happy * 6);
      this.light.light.color.set('#ffd2b4').lerp(new THREE.Color('#ffc2c2'), this.blush * 0.5);
    }

    // Celebration: giggles and a big swirl of glowing bubbles.
    if (this.giggleT > 0) {
      this.giggleT -= dt;
      if (this.giggleT <= 0) {
        this.ctx.sfx('sfx_octopus_giggle', { pos: this.root.position, volume: 1, range: 80 });
        this.ctx.fx.hearts(this.root.position.clone().add(this.tmpA.set(0, 3.2, 1.5)), 6, '#f6b0b4');
      }
    }
    if (this.swirlT > 0) {
      this.swirlT -= dt;
      const n = 5;
      for (let k = 0; k < n; k++) {
        const a = t * 3 + (k / n) * Math.PI * 2;
        const life = 6 - this.swirlT;
        const R = 3.2 + Math.sin(t * 2 + k) * 0.4 + life * 0.25;
        const pos = this.tmpA.set(this.root.position.x + Math.cos(a) * R, this.root.position.y - 1.5 + ((t * 1.8 + k * 0.4) % 6), this.root.position.z + Math.sin(a) * R);
        this.ctx.fx.glow.emit(pos, { count: 1, shape: 3, size: 0.35, sizeEnd: 0.5, speed: 0.4, life: 2.2, color: k % 2 ? '#a6f2e4' : '#ffd8b8', alpha: 0.75, gravity: -0.5, drag: 1, wobble: 0.6 });
      }
    }
  }

  private tmpColor = new THREE.Color();
  private ctrl = new THREE.Vector3();
}

