import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Creature, Wander } from '../../kit/Creature';
import { Face, geo, mat, matUnique, part } from '../../kit/kit';
import { clamp, damp, dampAngle } from '../../core/math';
import type { PooledLight, StageContext } from '../types';
import type { HitInfo, HitResponse } from '../../gameplay/Hit';
import { fakeLight, haloSprite, type FakeLight } from './world';

/** Shared clock for shader-swayed tentacles. */
export const swayTime = { value: 0 };

/** MeshStandardMaterial whose vertices sway below y=0 (tentacles, fronds). */
function swayMaterial(color: THREE.ColorRepresentation, emissive: THREE.ColorRepresentation, ei: number, amount = 0.16): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: ei, roughness: 0.6, transparent: true, opacity: 0.85 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSway = swayTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSway;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float ph = modelMatrix[3].x * 0.7 + modelMatrix[3].z * 0.4;
      float depth = max(0.0, -transformed.y);
      transformed.x += sin(uSway * 1.6 - depth * 2.6 + ph + transformed.z * 4.0) * ${amount.toFixed(3)} * depth;
      transformed.z += cos(uSway * 1.3 - depth * 2.2 + ph * 1.3 + transformed.x * 4.0) * ${amount.toFixed(3)} * depth;`,
    );
  };
  m.customProgramCacheKey = () => `sway${amount}`;
  return m;
}

// ------------------------------------------------------------------ Glim

/**
 * Glim: a tiny, round, big-eyed angler fish whose bobbing lure is the only
 * light in the Dark Stretch. She leads Ace along a path and waits (with a
 * soft ping) whenever Ace falls behind.
 */
export class Glim extends Creature {
  private face: Face;
  private tail: THREE.Group;
  private fins: THREE.Mesh[] = [];
  private stalk: THREE.Group[] = [];
  readonly bulb: THREE.Mesh;
  private halo: THREE.Sprite;
  private light: PooledLight | null;
  private fake: FakeLight;
  private bulbMat: THREE.MeshBasicMaterial;
  path: THREE.Vector3[] = [];
  pathIdx = 0;
  mode: 'idle' | 'lead' | 'guide' = 'idle';
  /** Point to hover around in idle/guide mode. */
  readonly hoverAt = new THREE.Vector3();
  waiting = false;
  private pingT = 0;
  private flash = 0;
  private swimPh = 0;
  private wantVel = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private hoverTmp = new THREE.Vector3();
  leash = 8;
  /** Fired each time Glim pings while waiting. */
  onPing: (() => void) | null = null;
  readonly bulbWorld = new THREE.Vector3();

  constructor(ctx: StageContext, pos: THREE.Vector3) {
    super(ctx, { name: 'Glim', size: 'small', radius: 0.55, centerY: 0, label: 'Glim', giggleSfx: 'sfx_giggle' });
    const skin = mat('#9583c4', { rough: 0.6, emissive: '#3a2f5c', emissiveIntensity: 0.4 });
    const belly = mat('#cbbde6', { rough: 0.65, emissive: '#4a3f6a', emissiveIntensity: 0.3 });
    const fin = mat('#b6a6e0', { rough: 0.5, side: THREE.DoubleSide, emissive: '#3a2f5c', emissiveIntensity: 0.5 });
    this.body.add(part(geo.sphere(28), skin, [0, 0, 0], [0.34, 0.31, 0.36], [0, 0, 0], false));
    this.body.add(part(geo.sphere(20), belly, [0, -0.1, 0.06], [0.27, 0.2, 0.28], [0, 0, 0], false));
    // Little rounded spots along her back.
    for (let i = 0; i < 4; i++) this.body.add(part(geo.sphere(10), mat('#b9a9e2', { emissive: '#3a2f5c', emissiveIntensity: 0.5 }), [Math.sin(i * 2) * 0.12, 0.26 - i * 0.02, -0.05 - i * 0.07], 0.04, [0, 0, 0], false));
    this.face = new Face({ eyeSize: 0.1, spacing: 0.25, eyeY: 0.07, eyeZ: 0.3, smile: true, smileWidth: 0.11, smileY: -0.08, blush: '#f0a9bd', blushSize: 0.045, lidColor: '#9583c4' });
    this.body.add(this.face.group);
    // Fins.
    for (const s of [-1, 1]) {
      const f = part(geo.sphere(12), fin, [s * 0.33, -0.04, 0.02], [0.03, 0.09, 0.13], [0, 0, 0], false);
      this.body.add(f);
      this.fins.push(f);
    }
    this.body.add(part(geo.sphere(12), fin, [0, 0.3, -0.12], [0.025, 0.08, 0.12], [0.4, 0, 0], false));
    this.tail = new THREE.Group();
    this.tail.position.set(0, 0, -0.33);
    for (const s of [-1, 1]) this.tail.add(part(geo.sphere(12), fin, [0, s * 0.07, -0.1], [0.025, 0.11, 0.14], [s * 0.5, 0, 0], false));
    this.body.add(this.tail);
    // Lure stalk: a chain of joints from her forehead arcing forward.
    let parent: THREE.Object3D = this.body;
    const stalkM = mat('#a493d0', { rough: 0.5, emissive: '#3a2f5c', emissiveIntensity: 0.5 });
    for (let i = 0; i < 5; i++) {
      const j = new THREE.Group();
      j.position.set(0, i === 0 ? 0.28 : 0.085, i === 0 ? 0.08 : 0);
      j.rotation.x = 0.33;
      j.add(part(geo.capsule(1, 8), stalkM, [0, 0.045, 0], [0.019, 0.04, 0.019], [0, 0, 0], false));
      parent.add(j);
      this.stalk.push(j);
      parent = j;
    }
    this.bulbMat = new THREE.MeshBasicMaterial({ color: '#ffe6a6' });
    this.bulb = new THREE.Mesh(geo.sphere(16), this.bulbMat);
    this.bulb.scale.setScalar(0.075);
    this.bulb.position.y = 0.11;
    parent.add(this.bulb);
    this.halo = haloSprite('#ffd98e', 1.7, 0.42);
    ctx.root.add(this.halo);
    this.light = ctx.borrowLight();
    if (this.light) {
      this.light.light.color.set('#ffd99a');
      this.light.light.intensity = 6;
      this.light.light.distance = 14;
    }
    // Her glow on the rocks comes from a soft fake light (no harsh falloff).
    this.fake = fakeLight();
    this.fake.set(pos, '#ffe6bc', 0.7, 8.5);
    this.root.position.copy(pos);
    this.hoverAt.copy(pos);
  }

  override hitCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.root.position);
  }

  /** Happy little flash of the lure (pings, lantern lighting). */
  sparkle(): void {
    this.flash = 1;
    this.face.beam(1);
  }

  /** Progress (0..n) of Glim along her path, for "who is ahead" checks. */
  get progress(): number {
    return this.pathIdx;
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    // Glim loves bubbles: a happy twirl rather than floating away from her job.
    this.happySpin();
    this.sparkle();
    this.ctx.sfx('sfx_angler_ping', { pos: this.root.position, volume: 0.7 });
    return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
  }

  protected behave(dt: number, t: number): void {
    const p = this.root.position;
    const ace = this.ctx.player.position;
    const aceEye = this.tmp.set(ace.x, ace.y + 1.0, ace.z);
    const dAce = p.distanceTo(aceEye);
    let target: THREE.Vector3 | null = null;
    let speed = 3.0;
    this.waiting = false;
    if (this.mode === 'lead' && this.path.length) {
      // Skip to whichever waypoint is closest ahead of Ace, if Ace rushed on.
      target = this.path[Math.min(this.pathIdx, this.path.length - 1)];
      if (p.distanceTo(target) < 1.2 && this.pathIdx < this.path.length - 1) this.pathIdx++;
      const aceAhead = this.aceProgress() > this.pathIdx + 0.5;
      if (aceAhead) speed = 5.2;
      else if (dAce > this.leash) {
        this.waiting = true;
        speed = 0;
      } else if (dAce < 3.5) speed = 4.0;
    } else {
      // Hover lazily around a point.
      const a = t * 0.6;
      target = this.hoverTmp.set(this.hoverAt.x + Math.cos(a) * 1.4, this.hoverAt.y + Math.sin(t * 1.1) * 0.35, this.hoverAt.z + Math.sin(a) * 1.4);
      speed = p.distanceTo(this.hoverAt) > 5 ? 4.5 : 1.6;
    }
    if (this.waiting) {
      this.pingT -= dt;
      if (this.pingT <= 0) {
        this.pingT = 2.4;
        this.flash = 1;
        this.ctx.sfx('sfx_angler_ping', { pos: p, volume: 0.9, range: 60 });
        this.onPing?.();
      }
      // Turn to look back at Ace and bob in place.
      this.wantVel.set(0, Math.sin(t * 2) * 0.2, 0);
      this.turnTowards(this.angleTo(ace.x, ace.z), 3, dt);
    } else if (target) {
      this.pingT = Math.min(this.pingT, 0.6);
      this.wantVel.subVectors(target, p);
      const d = this.wantVel.length();
      if (d > 0.01) this.wantVel.multiplyScalar(Math.min(speed, d * 1.8) / d);
      if (this.mode !== 'lead' && this.wantVel.lengthSq() < 2.5 && dAce < 9) this.turnTowards(this.angleTo(ace.x, ace.z), 3, dt);
      else if (this.wantVel.lengthSq() > 0.04) this.turnTowards(Math.atan2(this.wantVel.x, this.wantVel.z), 4, dt);
    }
    this.vel.x = damp(this.vel.x, this.wantVel.x, 2.5, dt);
    this.vel.y = damp(this.vel.y, this.wantVel.y, 2.5, dt);
    this.vel.z = damp(this.vel.z, this.wantVel.z, 2.5, dt);
    p.addScaledVector(this.vel, dt);
    const floor = this.ctx.physics.groundHeight(p.x, p.z) + 0.8;
    if (p.y < floor) p.y = floor;
    this.speed = this.vel.length();
  }

  /** Index of the path waypoint Ace is closest to. */
  aceProgress(): number {
    const a = this.ctx.player.position;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.path.length; i++) {
      const w = this.path[i];
      const d = Math.hypot(w.x - a.x, w.z - a.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  protected animate(dt: number, t: number): void {
    this.face.update(dt);
    this.swimPh += dt * (3 + this.speed * 3);
    this.tail.rotation.y = Math.sin(this.swimPh) * 0.5;
    this.fins[0].rotation.y = Math.sin(this.swimPh * 1.3) * 0.5 - 0.2;
    this.fins[1].rotation.y = -Math.sin(this.swimPh * 1.3) * 0.5 + 0.2;
    this.body.rotation.x = damp(this.body.rotation.x, -this.vel.y * 0.15, 4, dt);
    // Stalk bobs like a fishing rod.
    this.stalk.forEach((j, i) => {
      j.rotation.x = 0.33 + Math.sin(t * 2.2 - i * 0.6) * 0.07 + (this.waiting ? Math.sin(t * 5 - i) * 0.05 : 0);
      j.rotation.z = Math.sin(t * 1.4 - i * 0.5) * 0.06;
    });
    this.flash = Math.max(0, this.flash - dt * 1.4);
    const glow = 1 + this.flash * 0.6 + Math.sin(t * 3) * 0.05;
    this.bulb.scale.setScalar(0.075 * (1 + this.flash * 0.35));
    this.bulb.getWorldPosition(this.bulbWorld);
    this.halo.position.copy(this.bulbWorld);
    this.halo.scale.setScalar(1.7 * glow);
    // Fade halo with fog distance (sprite fog is off for additive).
    const fogD = this.ctx.camera.position.distanceTo(this.bulbWorld);
    const fog = this.ctx.scene.fog as THREE.FogExp2 | null;
    const fogK = fog ? Math.exp(-((fog.density * fogD) ** 2)) : 1;
    (this.halo.material as THREE.SpriteMaterial).opacity = clamp(0.42 * glow * fogK, 0, 1);
    if (this.light) {
      // The real light floats above the bulb: a soft lantern glow around Ace and Glim, never a glare on her.
      this.light.light.position.set(this.bulbWorld.x, this.bulbWorld.y + 2.6, this.bulbWorld.z);
      this.light.light.intensity = 6 * glow;
    }
    this.fake.setPos(this.bulbWorld);
    this.fake.setStrength(0.7 * glow);
  }

  override dispose(): void {
    this.light?.release();
    this.light = null;
    this.halo.removeFromParent();
    super.dispose();
  }
}

// ------------------------------------------------------------------ Jelly

const JELLY_COLS = ['#cbb6f4', '#f3b8cf', '#9fe6ea', '#b7c9f6'];

function jellyBellGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const rim = Math.max(0, 0.3 - v.y) / 0.5;
    const s = 1 + Math.cos(a * 8) * 0.05 * rim;
    p.setXYZ(i, v.x * s, v.y * 0.8, v.z * s);
  }
  g.computeVertexNormals();
  return g;
}

let jellyTentacleGeo: THREE.BufferGeometry | null = null;
function tentacleGeometry(): THREE.BufferGeometry {
  if (jellyTentacleGeo) return jellyTentacleGeo;
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const len = 1.1 + (i % 3) * 0.35;
    const c = new THREE.CylinderGeometry(0.018, 0.008, len, 4, 6).translate(Math.cos(a) * 0.72, -len / 2, Math.sin(a) * 0.72);
    c.deleteAttribute('uv');
    parts.push(c.toNonIndexed());
  }
  // Frilly oral arms in the middle.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const c = new THREE.CylinderGeometry(0.07, 0.025, 1.0, 5, 6).translate(Math.cos(a) * 0.18, -0.55, Math.sin(a) * 0.18);
    const p = c.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k);
      p.setX(k, p.getX(k) + Math.sin(y * 9 + i) * 0.04);
      p.setZ(k, p.getZ(k) + Math.cos(y * 8 + i) * 0.04);
    }
    c.deleteAttribute('uv');
    parts.push(c.toNonIndexed());
  }
  jellyTentacleGeo = mergeGeometries(parts)!;
  jellyTentacleGeo.computeVertexNormals();
  return jellyTentacleGeo;
}

let bellGeo: THREE.BufferGeometry | null = null;
let jellyFaceGeo: THREE.BufferGeometry | null = null;

/** Tiny merged face (two glossy eyes with highlights and a smile), one draw call. */
function simpleFaceGeometry(): THREE.BufferGeometry {
  if (jellyFaceGeo) return jellyFaceGeo;
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  const dark = new THREE.Color('#2a2740');
  const white = new THREE.Color('#ffffff');
  for (const s of [-1, 1]) {
    paint(new THREE.SphereGeometry(1, 12, 8).scale(0.05, 0.06, 0.035).translate(s * 0.08, 0, 0), dark);
    paint(new THREE.SphereGeometry(1, 6, 4).scale(0.016, 0.016, 0.01).translate(s * 0.08 - 0.015, 0.02, 0.03), white);
  }
  paint(new THREE.TorusGeometry(0.035, 0.008, 4, 10, Math.PI).rotateZ(Math.PI).translate(0, -0.06, 0.01), dark);
  jellyFaceGeo = mergeGeometries(parts)!;
  return jellyFaceGeo;
}
const faceMat = new THREE.MeshBasicMaterial({ vertexColors: true });

/** Build a jelly model (bell + glowing core + swaying tentacles). Used by both creatures and challenge targets. */
export function jellyModel(color: string, scale = 1, face = true): { group: THREE.Group; bell: THREE.Group; bellMat: THREE.MeshStandardMaterial; core: THREE.Mesh; face: THREE.Mesh | null } {
  bellGeo ??= jellyBellGeometry();
  const group = new THREE.Group();
  const bell = new THREE.Group();
  const bellMat = matUnique(color, { rough: 0.25, emissive: color, emissiveIntensity: 0.55, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
  bellMat.depthWrite = false;
  const b = new THREE.Mesh(bellGeo, bellMat);
  b.scale.set(0.5, 0.5, 0.5);
  b.renderOrder = 2;
  bell.add(b);
  const core = new THREE.Mesh(geo.sphere(14), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.45) }));
  core.scale.set(0.2, 0.15, 0.2);
  core.position.y = 0.12;
  bell.add(core);
  let f: THREE.Mesh | null = null;
  if (face) {
    f = new THREE.Mesh(simpleFaceGeometry(), faceMat);
    f.position.set(0, 0.15, 0.41);
    f.rotation.x = -0.35;
    bell.add(f);
  }
  group.add(bell);
  const tent = new THREE.Mesh(tentacleGeometry(), tentacleMat(color));
  tent.scale.setScalar(0.5);
  tent.position.y = 0.02;
  group.add(tent);
  group.scale.setScalar(scale);
  return { group, bell, bellMat, core, face: f };
}

/** Blink a simple face now and then (squints when happy). */
export function blinkFace(f: THREE.Mesh | null, t: number, happy: boolean): void {
  if (!f) return;
  const ph = t % 4.3;
  const blink = ph < 0.14 ? Math.sin((ph / 0.14) * Math.PI) : 0;
  f.scale.y = happy ? 0.45 : 1 - blink * 0.85;
}

const tentMats = new Map<string, THREE.MeshStandardMaterial>();
function tentacleMat(color: string): THREE.MeshStandardMaterial {
  let m = tentMats.get(color);
  if (!m) {
    m = swayMaterial(color, color, 0.6, 0.22);
    m.depthWrite = false;
    tentMats.set(color, m);
  }
  return m;
}

/** Drifting jellyfish. Bubbling one makes it glow brighter and twirl. */
export class Jelly extends Creature {
  private model: ReturnType<typeof jellyModel>;
  private wander: Wander;
  private pulsePh = Math.random() * 6;
  private glow = 0;
  private twirl = 0;
  private baseEI = 0.55;
  private happyEyes = 0;
  private blinkPh = Math.random() * 10;
  private desired = new THREE.Vector3();
  onGlow: (() => void) | null = null;

  constructor(ctx: StageContext, pos: THREE.Vector3, colorIdx: number, area: number, yRange: [number, number], scale = 1) {
    super(ctx, { name: 'Jelly', size: 'small', radius: 0.62 * scale, centerY: 0.1 * scale, label: 'Jellyfish', giggleSfx: 'sfx_jelly_glow' });
    this.model = jellyModel(JELLY_COLS[colorIdx % JELLY_COLS.length], scale);
    this.body.add(this.model.group);
    this.root.position.copy(pos);
    this.wander = new Wander(pos.clone(), area, 0.45, () => ctx.rng.next(), yRange, [1, 3]);
  }

  protected override defaultReaction(info: HitInfo): HitResponse {
    this.brighten();
    return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
  }

  brighten(): void {
    const first = this.glow < 0.3;
    this.glow = 1;
    if (first) {
      this.twirl = 1;
      this.ctx.sfx('sfx_jelly_glow', { pos: this.root.position });
      this.ctx.fx.sparkle(this.hitCenter(new THREE.Vector3()), 10, ['#f5ecff', '#cfefff'], 0.8);
      this.happyEyes = 1.5;
      this.onGlow?.();
    }
  }

  protected behave(dt: number): void {
    const v = this.wander.step(this.root.position, dt, this.desired);
    this.vel.x = damp(this.vel.x, v.x, 1, dt);
    this.vel.z = damp(this.vel.z, v.z, 1, dt);
    // Jet upward on each contraction, sink slowly between.
    const pulse = Math.max(0, Math.sin(this.pulsePh));
    this.vel.y = damp(this.vel.y, v.y * 0.6 + pulse * 0.35 - 0.12, 2, dt);
    this.root.position.addScaledVector(this.vel, dt);
    const floor = this.ctx.physics.groundHeight(this.root.position.x, this.root.position.z) + 1.2;
    if (this.root.position.y < floor) this.root.position.y = floor;
    // Drift gently aside when Ace swims through.
    const d = this.distanceToPlayer();
    if (d < 1.8) {
      const away = this.root.position.clone().sub(this.ctx.player.position).normalize();
      this.root.position.addScaledVector(away, dt * 1.2);
    }
  }

  protected animate(dt: number, t: number): void {
    this.pulsePh += dt * (2.2 + this.glow * 1.5);
    const c = Math.sin(this.pulsePh);
    this.model.bell.scale.set(1 + c * 0.08, 1 - c * 0.12, 1 + c * 0.08);
    blinkFace(this.model.face, t + this.blinkPh, this.happyEyes > 0);
    this.happyEyes = Math.max(0, this.happyEyes - dt);
    this.glow = Math.max(0, this.glow - dt / 7);
    this.model.bellMat.emissiveIntensity = this.baseEI + this.glow * 0.55 + Math.max(0, c) * 0.08;
    this.model.core.scale.set(0.2 + this.glow * 0.06, 0.15 + this.glow * 0.04, 0.2 + this.glow * 0.06);
    if (this.twirl > 0) {
      this.twirl = Math.max(0, this.twirl - dt / 1.4);
      this.body.rotation.y += dt * 9 * this.twirl;
      this.body.position.y = Math.sin((1 - this.twirl) * Math.PI) * 0.4;
    }
    this.body.rotation.z = Math.sin(t * 0.7 + this.pulsePh * 0.1) * 0.08;
  }
}

// ------------------------------------------------------------ Dumbo octopus

/** Tiny dumbo octopus: flaps its ear fins and bobs about. */
export class Dumbo extends Creature {
  private face: Face;
  private ears: THREE.Mesh[] = [];
  private skirt: THREE.Mesh;
  private wander: Wander;
  private ph = Math.random() * 6;
  private desired = new THREE.Vector3();

  constructor(ctx: StageContext, pos: THREE.Vector3, tint: string) {
    super(ctx, { name: 'Dumbo octopus', size: 'small', radius: 0.55, centerY: 0.1, label: 'Dumbo octopus' });
    const skin = mat(tint, { rough: 0.6, emissive: tint, emissiveIntensity: 0.12 });
    const light = mat(new THREE.Color(tint).lerp(new THREE.Color('#ffffff'), 0.35), { rough: 0.6 });
    this.body.add(part(geo.sphere(24), skin, [0, 0.12, 0], [0.32, 0.36, 0.3], [0, 0, 0], false));
    for (const s of [-1, 1]) {
      const e = part(geo.sphere(14), light, [s * 0.34, 0.32, 0], [0.16, 0.035, 0.11], [0, 0, s * 0.3], false);
      this.body.add(e);
      this.ears.push(e);
    }
    const skirtGeo = new THREE.ConeGeometry(0.36, 0.3, 16, 1, true);
    const p = skirtGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y < 0) {
        const a = Math.atan2(p.getZ(i), p.getX(i));
        p.setY(i, y - Math.max(0, Math.cos(a * 8)) * 0.08);
      }
    }
    skirtGeo.computeVertexNormals();
    this.skirt = new THREE.Mesh(skirtGeo, mat(tint, { rough: 0.6, side: THREE.DoubleSide }));
    this.skirt.rotation.x = Math.PI;
    this.skirt.position.y = -0.14;
    this.body.add(this.skirt);
    this.face = new Face({ eyeSize: 0.075, spacing: 0.2, eyeY: 0.12, eyeZ: 0.26, smile: true, smileWidth: 0.07, smileY: 0.0, blush: '#f2a6a0', blushSize: 0.035 });
    this.body.add(this.face.group);
    this.root.position.copy(pos);
    this.wander = new Wander(pos.clone(), 7, 0.9, () => ctx.rng.next(), [pos.y - 1.2, pos.y + 2.5], [0.5, 2]);
  }

  protected behave(dt: number): void {
    const v = this.wander.step(this.root.position, dt, this.desired);
    this.vel.lerp(v, Math.min(1, dt * 1.5));
    this.root.position.addScaledVector(this.vel, dt);
    const floor = this.ctx.physics.groundHeight(this.root.position.x, this.root.position.z) + 0.9;
    if (this.root.position.y < floor) this.root.position.y = floor;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.05) this.turnTowards(Math.atan2(this.vel.x, this.vel.z), 2.5, dt);
    else this.turnTowards(this.angleTo(this.ctx.player.position.x, this.ctx.player.position.z), 1.5, dt);
    this.speed = sp;
  }

  protected animate(dt: number, t: number): void {
    this.face.update(dt);
    this.ph += dt * (3 + this.speed * 4);
    const f = Math.sin(this.ph);
    this.ears[0].rotation.z = -0.3 - f * 0.55;
    this.ears[1].rotation.z = 0.3 + f * 0.55;
    this.skirt.scale.set(1 + Math.sin(this.ph * 0.5) * 0.08, 1, 1 + Math.sin(this.ph * 0.5) * 0.08);
    this.body.position.y = Math.sin(t * 1.5 + this.ph * 0.1) * 0.06;
    this.body.rotation.x = 0.15 + this.speed * 0.2;
  }
}

// ---------------------------------------------------------- lanternfish

/**
 * A school of tiny lanternfish: glowing dots drifting together as one, and
 * parting gently around Ace (one instanced draw).
 */
export class LanternSchool {
  readonly mesh: THREE.InstancedMesh;
  private offs: THREE.Vector3[] = [];
  private pos: THREE.Vector3[] = [];
  private vel: THREE.Vector3[] = [];
  private ph: number[] = [];
  private center = new THREE.Vector3();
  private dummy = new THREE.Object3D();
  private tmp = new THREE.Vector3();

  constructor(
    private ctx: StageContext,
    private home: THREE.Vector3,
    private range: [number, number, number],
    count: number,
    color: string,
    private speed = 0.18,
  ) {
    const body = new THREE.SphereGeometry(1, 8, 6).scale(0.03, 0.035, 0.08);
    const tail = new THREE.ConeGeometry(0.03, 0.05, 4).rotateX(-Math.PI / 2).translate(0, 0, -0.1);
    const g = mergeGeometries([body.toNonIndexed(), tail.toNonIndexed()].map((x) => {
      x.deleteAttribute('uv');
      return x;
    }))!;
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color }), count);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      const o = new THREE.Vector3((Math.random() - 0.5) * 3.2, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 3.2);
      this.offs.push(o);
      this.pos.push(home.clone().add(o));
      this.vel.push(new THREE.Vector3());
      this.ph.push(Math.random() * 6);
    }
    ctx.root.add(this.mesh);
  }

  update(dt: number, t: number): void {
    const s = t * this.speed;
    const [rx, ry, rz] = this.range;
    this.center.set(this.home.x + Math.sin(s) * rx, this.home.y + Math.sin(s * 1.7) * ry, this.home.z + Math.sin(s * 0.8 + 1) * rz);
    const ace = this.ctx.player.position;
    const ax = ace.x;
    const ay = ace.y + 0.9;
    const az = ace.z;
    for (let i = 0; i < this.pos.length; i++) {
      const p = this.pos[i];
      const o = this.offs[i];
      const ph = this.ph[i];
      this.tmp.set(
        this.center.x + o.x + Math.sin(t * 0.9 + ph) * 0.3,
        this.center.y + o.y + Math.sin(t * 1.3 + ph) * 0.2,
        this.center.z + o.z + Math.cos(t * 0.8 + ph) * 0.3,
      );
      // Part around Ace.
      const dx = p.x - ax;
      const dy = p.y - ay;
      const dz = p.z - az;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < 6.25) {
        const d = Math.sqrt(d2) || 1;
        const push = (2.5 - d) * 2.2;
        this.tmp.x += (dx / d) * push;
        this.tmp.y += (dy / d) * push;
        this.tmp.z += (dz / d) * push;
      }
      const v = this.vel[i];
      v.x = damp(v.x, (this.tmp.x - p.x) * 1.4, 3, dt);
      v.y = damp(v.y, (this.tmp.y - p.y) * 1.4, 3, dt);
      v.z = damp(v.z, (this.tmp.z - p.z) * 1.4, 3, dt);
      p.addScaledVector(v, dt);
      this.dummy.position.copy(p);
      const sp = Math.hypot(v.x, v.z);
      if (sp > 0.02) this.dummy.rotation.y = dampAngle(this.dummy.rotation.y, Math.atan2(v.x, v.z), 6, dt);
      this.dummy.rotation.set(0, Math.atan2(v.x, v.z) + Math.sin(t * 8 + ph) * 0.15, 0);
      const sc = 1 + Math.sin(t * 2 + ph) * 0.1;
      this.dummy.scale.setScalar(sc);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
