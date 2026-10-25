import * as THREE from 'three';
import { easeOutBack, clamp } from '../../core/math';
import { geo, mat, matUnique, mergeStatic, part } from '../../kit/kit';
import type { Hittable, HitInfo, HitResponse, ProjectileKind } from '../../gameplay/Hit';
import type { StageContext } from '../types';
import { fakeLight, haloSprite, type FakeLight } from './world';

const PETALS = 6;
let petalGeo: THREE.BufferGeometry | null = null;

/**
 * A dormant lantern coral: a closed, dim bud on a curvy stalk. A Glow Ball
 * wakes it up: the petals bloom open and a warm lantern glow fills the grove.
 */
export class LanternCoral implements Hittable {
  readonly group = new THREE.Group();
  readonly head = new THREE.Group();
  hitRadius = 1.15;
  active = true;
  aimAssist = 1.1;
  label = 'Lantern coral';
  lit = false;
  private petals: THREE.InstancedMesh;
  private petalMat: THREE.MeshStandardMaterial;
  private dummy = new THREE.Object3D();
  private orb: THREE.Mesh;
  private orbMat: THREE.MeshBasicMaterial;
  private halo: THREE.Sprite;
  private fake: FakeLight;
  private bloom = 0;
  private litT = 0;
  private wiggle = 0;
  private ph = Math.random() * 6;
  private hintT = -99;
  readonly headWorld = new THREE.Vector3();
  onLit: ((l: LanternCoral) => void) | null = null;
  onWrongHit: ((kind: ProjectileKind) => void) | null = null;
  private dimCol = new THREE.Color('#5a628f');
  private litCol: THREE.Color;

  constructor(private ctx: StageContext, pos: THREE.Vector3, height: number, private warm: string) {
    this.litCol = new THREE.Color(warm);
    const stalkM = mat('#77749f', { rough: 0.7 });
    const baseM = mat('#5d5a88', { rough: 0.9 });
    this.group.position.copy(pos);
    const stat = new THREE.Group();
    stat.add(part(geo.sphere(16), baseM, [0, 0, 0], [0.7, 0.35, 0.7], [0, 0, 0], false));
    // Gently curving stalk made of overlapping capsules.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 4; i++) {
      const k = i / 4;
      pts.push(new THREE.Vector3(Math.sin(k * 2.2 + this.ph) * 0.18 * k, k * height, Math.cos(k * 1.7 + this.ph) * 0.12 * k));
    }
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(geo.capsule(1, 8), stalkM);
      const r = 0.09 - i * 0.012;
      m.scale.set(r, len / 3 + r * 0.2, r);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      stat.add(m);
    }
    // Little leaves on the stalk.
    for (let i = 0; i < 3; i++) {
      const y = height * (0.3 + i * 0.2);
      stat.add(part(geo.sphere(10), stalkM, [Math.cos(i * 2.1) * 0.12, y, Math.sin(i * 2.1) * 0.12], [0.05, 0.16, 0.1], [0.6, i * 2.1, 0.6], false));
    }
    stat.add(part(geo.sphere(12), stalkM, [pts[4].x, pts[4].y, pts[4].z], [0.2, 0.12, 0.2], [0, 0, 0], false));
    this.group.add(mergeStatic(stat, false, false));
    this.head.position.copy(pts[4]);
    this.group.add(this.head);
    this.petalMat = matUnique('#6a6496', { rough: 0.45, emissive: '#3c3866', emissiveIntensity: 0.35, side: THREE.DoubleSide });
    // Petals: one instanced draw, each instance hinged at the bud's base.
    if (!petalGeo) petalGeo = new THREE.SphereGeometry(1, 16, 10).scale(0.17, 0.34, 0.07).translate(0, 0.3, 0.04);
    this.petals = new THREE.InstancedMesh(petalGeo, this.petalMat, PETALS);
    this.head.add(this.petals);
    this.orbMat = new THREE.MeshBasicMaterial({ color: this.dimCol.clone() });
    this.orb = new THREE.Mesh(geo.sphere(18), this.orbMat);
    this.orb.position.y = 0.3;
    this.orb.scale.setScalar(0.17);
    this.head.add(this.orb);
    this.halo = haloSprite(warm, 1.3, 0.12);
    ctx.root.add(this.halo);
    ctx.root.add(this.group);
    ctx.hits.add(this);
    this.fake = fakeLight();
    this.group.updateMatrixWorld(true);
    this.orb.getWorldPosition(this.headWorld);
    this.fake.set(this.headWorld, warm, 0, 9);
  }

  hitCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.headWorld);
  }

  accepts(_k: ProjectileKind): boolean {
    return !this.lit;
  }

  onHit(info: HitInfo): HitResponse {
    if (info.kind === 'glow') {
      this.light();
      return 'stick';
    }
    this.wiggle = 1;
    if (this.ctx.time - this.hintT > 5) {
      this.hintT = this.ctx.time;
      this.onWrongHit?.(info.kind);
    }
    return info.kind === 'ball' ? 'bounce' : 'consume';
  }

  light(): void {
    if (this.lit) return;
    this.lit = true;
    this.active = false;
    this.litT = 0;
    this.ctx.sfx('sfx_glow_light', { pos: this.headWorld, volume: 1 });
    this.ctx.fx.sparkle(this.headWorld, 22, [this.warm, '#fff6e2', '#f6dcf0'], 1.3);
    this.ctx.fx.glow.emit(this.headWorld, { count: 1, shape: 2, size: 0.6, sizeEnd: 5, speed: 0, life: 0.8, color: this.warm, alpha: 0.5, fadeIn: 0 });
    this.onLit?.(this);
  }

  update(dt: number, t: number): void {
    this.wiggle = Math.max(0, this.wiggle - dt * 2);
    if (this.lit) {
      this.litT += dt;
      this.bloom = Math.min(1, this.litT / 1.3);
    }
    const b = this.lit ? easeOutBack(this.bloom) : 0;
    const breathe = Math.sin(t * 1.3 + this.ph);
    const open = -0.32 + b * 1.35 + (this.lit ? Math.sin(t * 1.1 + this.ph) * 0.06 : breathe * 0.04) + Math.sin(t * 20) * this.wiggle * 0.15;
    for (let k = 0; k < PETALS; k++) {
      const yaw = (k / PETALS) * Math.PI * 2;
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.position.set(Math.sin(yaw) * 0.06, 0, Math.cos(yaw) * 0.06);
      this.dummy.rotateX(open + Math.sin(t * 1.5 + k) * 0.03);
      this.dummy.updateMatrix();
      this.petals.setMatrixAt(k, this.dummy.matrix);
    }
    this.petals.instanceMatrix.needsUpdate = true;
    this.head.rotation.z = Math.sin(t * 0.8 + this.ph) * 0.06;
    this.head.rotation.x = Math.cos(t * 0.6 + this.ph) * 0.05;
    this.orb.scale.setScalar(0.17 + b * 0.09 + (this.lit ? Math.sin(t * 2 + this.ph) * 0.01 : 0));
    // Dormant buds breathe a faint glow so they can be found in the dark.
    const dormant = 0.55 + 0.45 * (0.5 + 0.5 * breathe);
    if (this.lit) this.orbMat.color.copy(this.dimCol).lerp(this.litCol, this.bloom).multiplyScalar(1 + this.bloom * 0.6);
    else this.orbMat.color.copy(this.dimCol).multiplyScalar(0.9 + dormant * 0.5);
    if (this.lit) {
      this.petalMat.emissive.set('#3c3866').lerp(new THREE.Color('#f0b7c4'), this.bloom);
      this.petalMat.emissiveIntensity = 0.35 + this.bloom * 0.45;
    }
    this.group.updateMatrixWorld();
    this.orb.getWorldPosition(this.headWorld);
    this.halo.position.copy(this.headWorld);
    const size = this.lit ? 1.3 + this.bloom * 4.2 + Math.sin(t * 1.7 + this.ph) * 0.2 : 1.3 + dormant * 0.4;
    this.halo.scale.setScalar(size);
    const fog = this.ctx.scene.fog as THREE.FogExp2 | null;
    const dist = this.ctx.camera.position.distanceTo(this.headWorld);
    const fogK = fog ? Math.exp(-((fog.density * dist) ** 2)) : 1;
    const base = this.lit ? 0.12 + this.bloom * 0.33 : 0.1 + dormant * 0.08;
    (this.halo.material as THREE.SpriteMaterial).opacity = clamp(base * fogK, 0, 1);
    this.fake.setPos(this.headWorld);
    this.fake.setStrength(this.lit ? this.bloom * (1.5 + Math.sin(t * 1.7 + this.ph) * 0.08) : 0);
  }
}
