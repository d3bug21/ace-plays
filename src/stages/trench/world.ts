import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Noise, Rng, lerp, smoothstep } from '../../core/math';
import { distToPath, makeTerrain, scatter } from '../../kit/terrain';
import { geo, mat, matUnique, mergeStatic } from '../../kit/kit';
import type { StageContext } from '../types';

// ---------------------------------------------------------------------------
// Twilight Trench layout. Ace starts on a little lit ledge in the south (+Z),
// follows Glim through the Dark Stretch (a winding canyon heading north), and
// arrives in the wide Lantern Grove basin with Ollie's cave at its far end.
// A side passage west of the ledge opens into the Jelly Garden (challenge).

export const CEIL = 13;
export const ENTRY = { x: 0, z: 61, r: 12 };
export const GROVE = { x: 0, z: -24, r: 21 };
export const CAVE = { x: 0, z: -52, r: 13 };
export const GARDEN = { x: -29, z: 58, r: 10.5 };
export const NOOK = { x: -18.5, z: 31, r: 3.4 };
export const CANYON: [number, number][] = [[0, 56], [0, 47], [-6, 40], [-12, 31], [-8, 22], [4, 14], [7, 5], [2, -4], [0, -10]];
const CANYON_HW = 4.8;
const PASSAGE: [number, number][] = [[-6, 59], [-21, 58]];
const PASSAGE_HW = 3.6;
export const DOME = { x: 0, z: -52.5, r: 7.5 };

// Palette: deep navy water, dusky lavender rock, soft bioluminescent accents.
export const PAL = {
  fog: '#13233a',
  fogDark: '#0e1a2f',
  fogLit: '#1f3a56',
  sand: '#566384',
  sandLight: '#6a7798',
  rock: '#4a5277',
  rockLav: '#625d8c',
  rockHigh: '#333a5a',
  moss: '#3f6a74',
  cyan: '#8fe9ea',
  mint: '#a6f2cf',
  lav: '#cbb6f4',
  pink: '#f3b8cf',
  warm: '#ffd89a',
};

const smin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

// ---------------------------------------------------------------- fake lights
// Cheap "light pools": up to N soft emissive falloffs patched into rock/terrain
// materials, so glowing lanterns light the grove without real point lights.
export const FAKE_N = 12;
export const fakeUniforms = {
  uFakePos: { value: Array.from({ length: FAKE_N }, () => new THREE.Vector4(0, -999, 0, 0)) },
  uFakeCol: { value: Array.from({ length: FAKE_N }, () => new THREE.Color(0, 0, 0)) },
  uFakeRad: { value: new Array<number>(FAKE_N).fill(1) },
};

export function patchFakeLights(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFakePos = fakeUniforms.uFakePos;
    shader.uniforms.uFakeCol = fakeUniforms.uFakeCol;
    shader.uniforms.uFakeRad = fakeUniforms.uFakeRad;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFakeWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vFakeWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vFakeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFakeWorld;
        uniform vec4 uFakePos[${FAKE_N}];
        uniform vec3 uFakeCol[${FAKE_N}];
        uniform float uFakeRad[${FAKE_N}];`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 fakeL = vec3(0.0);
        for (int i = 0; i < ${FAKE_N}; i++) {
          vec4 L = uFakePos[i];
          float fd = distance(vFakeWorld, L.xyz);
          float ff = max(0.0, 1.0 - fd / uFakeRad[i]);
          fakeL += uFakeCol[i] * (L.w * ff * ff);
        }
        totalEmissiveRadiance += fakeL * (diffuseColor.rgb * 0.85 + 0.06);`,
      );
  };
  m.customProgramCacheKey = () => 'trenchFake';
  return m;
}

/** A handle to one fake light slot. */
export class FakeLight {
  constructor(private i: number) {}
  set(pos: THREE.Vector3, color: THREE.ColorRepresentation, strength: number, radius: number): void {
    fakeUniforms.uFakePos.value[this.i].set(pos.x, pos.y, pos.z, strength);
    fakeUniforms.uFakeCol.value[this.i].set(color);
    fakeUniforms.uFakeRad.value[this.i] = radius;
  }
  setStrength(s: number): void {
    fakeUniforms.uFakePos.value[this.i].w = s;
  }
  setPos(p: THREE.Vector3): void {
    const v = fakeUniforms.uFakePos.value[this.i];
    v.set(p.x, p.y, p.z, v.w);
  }
}
let fakeCursor = 0;
export function resetFakeLights(): void {
  fakeCursor = 0;
  for (const v of fakeUniforms.uFakePos.value) v.set(0, -999, 0, 0);
}
export function fakeLight(): FakeLight {
  return new FakeLight(Math.min(FAKE_N - 1, fakeCursor++));
}

// ------------------------------------------------------------------- halos
let haloTex: THREE.Texture | null = null;
export function haloTexture(): THREE.Texture {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 63);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.14)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  haloTex = new THREE.CanvasTexture(c);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}

/** Additive soft glow sprite (fog handled manually by the owner). */
export function haloSprite(color: THREE.ColorRepresentation, size: number, opacity = 0.5): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: haloTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  s.scale.setScalar(size);
  s.userData.baseOpacity = opacity;
  s.renderOrder = 4;
  return s;
}

const haloVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  uniform float uTime;
  varying vec3 vColor;
  varying float vAlpha;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float breathe = 0.85 + 0.15 * sin(uTime * 0.9 + position.x * 0.7 + position.z * 0.3);
    gl_PointSize = aSize * breathe * uScale / max(0.1, -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    vColor = aColor;
    vAlpha = aAlpha * breathe;
    #include <fog_vertex>
  }
`;
const haloFrag = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - r), 2.4) * vAlpha;
    #ifdef USE_FOG
      float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      a *= (1.0 - fogF);
    #endif
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Static soft glow halos around plant clusters (one draw call). */
export class HaloField {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private alpha: Float32Array;
  private base: Float32Array;
  constructor(items: { pos: THREE.Vector3; size: number; color: THREE.ColorRepresentation; alpha: number }[]) {
    const n = items.length;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.base = new Float32Array(n);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    items.forEach((it, i) => {
      pos.set([it.pos.x, it.pos.y, it.pos.z], i * 3);
      size[i] = it.size;
      this.alpha[i] = this.base[i] = it.alpha;
      c.set(it.color);
      col.set([c.r, c.g, c.b], i * 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 400 }, uTime: { value: 0 } }]),
      vertexShader: haloVert,
      fragmentShader: haloFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.renderOrder = 3;
  }
  /** Scale every halo's brightness (grove wakes up as lanterns light). */
  setGain(fn: (i: number) => number): void {
    for (let i = 0; i < this.base.length; i++) this.alpha[i] = this.base[i] * fn(i);
    (this.points.geometry.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
  update(t: number, scale: number): void {
    this.material.uniforms.uTime.value = t;
    this.material.uniforms.uScale.value = scale;
  }
}

// ------------------------------------------------------------------- world

/** How deep in the Dark Stretch a point is (0 outside, 1 fully inside). */
export function darkness(x: number, z: number): number {
  void x;
  return smoothstep(50, 44, z) * smoothstep(-6, 1, z);
}

export function inGrove(x: number, z: number): number {
  return 1 - smoothstep(GROVE.r - 2, GROVE.r + 6, Math.hypot(x - GROVE.x, z - GROVE.z) * (z < -40 ? 0.7 : 1));
}

export class TrenchWorld {
  readonly noise = new Noise(311);
  private grid: Float32Array;
  private cgrid: Float32Array;
  private readonly gx0 = -62;
  private readonly gz0 = -78;
  private readonly step = 0.5;
  private readonly gw: number;
  private readonly gh: number;

  constructor() {
    this.gw = Math.round(124 / this.step) + 1;
    this.gh = Math.round(168 / this.step) + 1;
    this.grid = new Float32Array(this.gw * this.gh);
    this.cgrid = new Float32Array(this.gw * this.gh);
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) {
        const x = this.gx0 + i * this.step;
        const z = this.gz0 + j * this.step;
        this.grid[j * this.gw + i] = this.computeHeight(x, z);
        // Ceiling follows the floor: low and snug in the Dark Stretch, roomy in the grove.
        const clear = lerp(lerp(11, 14, inGrove(x, z)), 8, darkness(x, z));
        this.cgrid[j * this.gw + i] = Math.min(CEIL, this.floorBase(x, z) + clear);
      }
    }
  }

  /** Signed distance-ish field: negative inside open water, positive into rock. */
  field(x: number, z: number): number {
    let d = Math.hypot(x - ENTRY.x, z - ENTRY.z) - ENTRY.r;
    d = smin(d, Math.hypot(x - GROVE.x, z - GROVE.z) - GROVE.r, 6);
    d = smin(d, Math.hypot(x - CAVE.x, z - CAVE.z) - CAVE.r, 5);
    d = smin(d, distToPath(x, z, CANYON) - CANYON_HW, 3);
    d = smin(d, Math.hypot(x - GARDEN.x, z - GARDEN.z) - GARDEN.r, 3);
    d = smin(d, distToPath(x, z, PASSAGE) - PASSAGE_HW, 2.5);
    d = smin(d, Math.hypot(x - NOOK.x, z - NOOK.z) - NOOK.r, 2);
    d += this.noise.fbm2(x * 0.06, z * 0.06, 3) * 1.8;
    return d;
  }

  floorBase(x: number, z: number): number {
    const n = this.noise;
    let h = lerp(0.6, -2.6, smoothstep(14, -14, z));
    const gd = Math.hypot(x - GROVE.x, z - GROVE.z);
    h -= (1 - smoothstep(2, 19, gd)) * 1.4;
    const ed = Math.hypot(x - ENTRY.x, z - ENTRY.z);
    h += (1 - smoothstep(7, 13, ed)) * 0.6;
    h += n.fbm2(x * 0.05 + 7, z * 0.05, 3) * 0.7 + n.n2(x * 0.22, z * 0.22) * 0.12;
    return h;
  }

  private computeHeight(x: number, z: number): number {
    const d = this.field(x, z);
    let h = this.floorBase(x, z);
    h += smoothstep(-3.5, 0.5, d) * 1.4;
    if (d > 0) {
      const w = smoothstep(0, 8.5, d);
      h += w * 27 + this.noise.fbm2(x * 0.11, z * 0.11, 2) * 2.4 * w;
    }
    return h;
  }

  height = (x: number, z: number): number => this.sample(this.grid, x, z, 30);
  ceilingAt = (x: number, z: number): number => this.sample(this.cgrid, x, z, CEIL);

  private sample(g: Float32Array, x: number, z: number, outside: number): number {
    const fx = (x - this.gx0) / this.step;
    const fz = (z - this.gz0) / this.step;
    if (fx < 0 || fz < 0 || fx >= this.gw - 1 || fz >= this.gh - 1) return outside;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const w = this.gw;
    const a = g[j * w + i];
    const b = g[j * w + i + 1];
    const c = g[(j + 1) * w + i];
    const d = g[(j + 1) * w + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Build the static scenery. Returns animated bits the stage updates. */
  build(ctx: StageContext, rng: Rng): WorldParts {
    const root = ctx.root;
    const H = this.height;
    const n = this.noise;

    // --- Terrain
    const cSand = new THREE.Color(PAL.sand);
    const cSandL = new THREE.Color(PAL.sandLight);
    const cRock = new THREE.Color(PAL.rock);
    const cLav = new THREE.Color(PAL.rockLav);
    const cHigh = new THREE.Color(PAL.rockHigh);
    const cMoss = new THREE.Color(PAL.moss);
    const tmpC = new THREE.Color();
    const terrainMat = patchFakeLights(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }));
    const terrain = makeTerrain({
      size: 124,
      segments: 186,
      center: [0, 6],
      height: H,
      material: terrainMat,
      color: (x, z, h, out) => {
        const d = this.field(x, z);
        const v = n.n2(x * 0.09 + 4, z * 0.09) * 0.5 + 0.5;
        out.copy(cSand).lerp(cSandL, v * 0.6);
        // Ripples of lighter sand.
        out.lerp(cSandL, Math.max(0, Math.sin(x * 0.9 + z * 0.4 + n.n2(x * 0.1, z * 0.1) * 3)) * 0.18);
        const wall = smoothstep(-1.5, 2.5, d);
        tmpC.copy(cRock).lerp(cLav, n.n2(x * 0.05, z * 0.05 + 9) * 0.5 + 0.5);
        tmpC.lerp(cHigh, smoothstep(6, 16, h));
        out.lerp(tmpC, wall);
        out.lerp(cMoss, smoothstep(-2.5, 0, d) * (1 - smoothstep(0, 2.5, d)) * 0.45 * (n.n2(x * 0.2, z * 0.2) * 0.5 + 0.5));
      },
    });
    terrain.receiveShadow = false;
    root.add(terrain);

    // --- Soft rounded boulders hugging the walls (merged).
    const rockGeos = [0, 1, 2].map((k) => lumpyRock(k * 17 + 3));
    const rockMats = [
      patchFakeLights(new THREE.MeshStandardMaterial({ color: PAL.rock, roughness: 0.95 })),
      patchFakeLights(new THREE.MeshStandardMaterial({ color: PAL.rockLav, roughness: 0.95 })),
      patchFakeLights(new THREE.MeshStandardMaterial({ color: '#56658a', roughness: 0.95 })),
    ];
    const statics = new THREE.Group();
    const colliders: { x: number; y: number; z: number; r: number }[] = [];
    let placed = 0;
    for (let tries = 0; tries < 6000 && placed < 190; tries++) {
      const x = rng.range(-50, 50);
      const z = rng.range(-70, 76);
      const d = this.field(x, z);
      if (d < -0.6 || d > 3.2) continue;
      const r = lerp(1.1, 3.4, smoothstep(-0.6, 3.2, d)) * rng.range(0.8, 1.2);
      const m = new THREE.Mesh(rng.pick(rockGeos), rng.pick(rockMats));
      const y = H(x, z) - r * 0.25;
      m.position.set(x, y, z);
      m.scale.set(r, r * rng.range(0.6, 0.85), r * rng.range(0.85, 1.1));
      m.rotation.set(rng.range(-0.2, 0.2), rng.range(0, 6), rng.range(-0.2, 0.2));
      statics.add(m);
      placed++;
      if (d < 1.2) colliders.push({ x, y: y + r * 0.1, z, r: r * 0.72 });
    }
    // Stacked rocks rising up the walls for depth.
    for (let i = 0; i < 70; i++) {
      const x = rng.range(-50, 50);
      const z = rng.range(-70, 76);
      const d = this.field(x, z);
      if (d < 3 || d > 7) continue;
      const r = rng.range(2.5, 4.5);
      const m = new THREE.Mesh(rng.pick(rockGeos), rng.pick(rockMats));
      m.position.set(x, H(x, z) - r * 0.2, z);
      m.scale.set(r, r * 0.75, r);
      m.rotation.y = rng.range(0, 6);
      statics.add(m);
    }

    // --- Arches: a big friendly one where the Dark Stretch begins, a little one on the ledge.
    const archMat = rockMats[1];
    const bigArch = { cx: 0, cz: 47.5, R: 6.2, yaw: 0, r: 1.45, count: 15 };
    const smallArch = { cx: 9.2, cz: 63.5, R: 2.1, yaw: Math.PI / 2 - 0.3, r: 0.62, count: 11 };
    for (const a of [bigArch, smallArch]) {
      const base = H(a.cx, a.cz) - 0.3;
      for (let i = 0; i < a.count; i++) {
        const ang = (i / (a.count - 1)) * Math.PI;
        const lx = Math.cos(ang) * a.R;
        const ly = Math.sin(ang) * a.R * 1.05;
        const wx = a.cx + Math.cos(a.yaw) * lx;
        const wz = a.cz - Math.sin(a.yaw) * lx;
        const rr = a.r * (1 + Math.sin(i * 2.3) * 0.12) * (i === 0 || i === a.count - 1 ? 1.35 : 1);
        const m = new THREE.Mesh(rockGeos[i % 3], archMat);
        m.position.set(wx, base + ly + (i === 0 || i === a.count - 1 ? 0 : 0.2), wz);
        m.scale.set(rr * 1.15, rr, rr * 1.05);
        m.rotation.set(i, i * 0.7, 0);
        statics.add(m);
        colliders.push({ x: wx, y: m.position.y, z: wz, r: rr * 0.95 });
      }
    }

    // --- Tube-worm column in the grove (treasure on top).
    const column = { x: 12.5, z: -33.5, top: 0 };
    {
      const g0 = H(column.x, column.z);
      let y = g0;
      for (let i = 0; i < 5; i++) {
        const r = lerp(2.0, 1.25, i / 4) * (1 + Math.sin(i * 1.7) * 0.08);
        const m = new THREE.Mesh(rockGeos[i % 3], rockMats[i % 2]);
        m.position.set(column.x + Math.sin(i * 1.3) * 0.25, y + r * 0.55, column.z + Math.cos(i * 1.9) * 0.25);
        m.scale.set(r, r * 0.95, r);
        m.rotation.set(0, i, 0);
        statics.add(m);
        y += r * 1.15;
      }
      column.top = y - 0.3;
      ctx.physics.add({ kind: 'cylinder', x: column.x, z: column.z, r: 1.7, yMin: -20, yMax: column.top - 0.4, tag: 'column' });
    }

    // --- Ollie's cave: a rounded dome with an arched doorway facing the grove.
    const domeY = H(DOME.x, DOME.z) - 0.8;
    const domeMat = patchFakeLights(new THREE.MeshStandardMaterial({ color: '#57608a', roughness: 0.95, side: THREE.DoubleSide }));
    const dome = new THREE.Mesh(caveDome(DOME.r, 1), domeMat);
    dome.position.set(DOME.x, domeY, DOME.z);
    root.add(dome);
    const inner = new THREE.Mesh(caveDome(DOME.r - 0.45, 2), new THREE.MeshStandardMaterial({ color: '#121a30', roughness: 1, side: THREE.BackSide }));
    inner.position.copy(dome.position);
    root.add(inner);
    // Rim boulders around the doorway.
    for (let i = 0; i < 13; i++) {
      const ang = (i / 12) * Math.PI;
      const lx = Math.cos(ang) * 3.9;
      const ly = Math.sin(ang) * 5.3;
      const lz = Math.sqrt(Math.max(0, DOME.r * DOME.r - lx * lx - ly * ly)) - 0.1;
      const rr = 0.85 + Math.sin(i * 1.9) * 0.15 + (i === 0 || i === 12 ? 0.5 : 0);
      const m = new THREE.Mesh(rockGeos[i % 3], rockMats[(i + 1) % 3]);
      m.position.set(DOME.x + lx, domeY + ly, DOME.z + lz);
      m.scale.set(rr, rr * 0.9, rr * 0.8);
      m.rotation.set(i, i * 2, 0);
      statics.add(m);
    }
    ctx.physics.add({ kind: 'sphere', center: new THREE.Vector3(DOME.x, domeY, DOME.z), r: DOME.r + 0.15, tag: 'cave' });

    // --- Giant clam shell (treasure inside).
    const clamPos = new THREE.Vector3(-11.5, 0, -31);
    clamPos.y = H(clamPos.x, clamPos.z) + 0.5;
    const clam = makeClam();
    clam.group.position.copy(clamPos);
    clam.group.rotation.y = 0.9;
    root.add(clam.group);
    ctx.physics.add({ kind: 'cylinder', x: clamPos.x, z: clamPos.z, r: 1.5, yMin: -20, yMax: clamPos.y - 0.3, tag: 'clam' });

    for (const c of colliders) ctx.physics.add({ kind: 'sphere', center: new THREE.Vector3(c.x, c.y, c.z), r: c.r });
    root.add(mergeStatic(statics, false, false));

    // --- Bioluminescent plants (never in the Dark Stretch).
    const plantClusters: { x: number; z: number; r: number; n: number; col: string }[] = [
      // Entry ledge: "a little light".
      { x: -7, z: 64, r: 2.6, n: 14, col: PAL.cyan },
      { x: 7, z: 57, r: 2.2, n: 10, col: PAL.mint },
      { x: -4, z: 52, r: 1.8, n: 7, col: PAL.lav },
      { x: 5, z: 68, r: 2.4, n: 10, col: PAL.lav },
      // Jelly garden.
      { x: -31, z: 63, r: 3, n: 14, col: PAL.pink },
      { x: -26, z: 52, r: 2.6, n: 12, col: PAL.lav },
      { x: -35, z: 56, r: 2.4, n: 10, col: PAL.cyan },
      { x: -22, z: 61, r: 2, n: 8, col: PAL.mint },
      // Lantern grove.
      { x: -12, z: -14, r: 3, n: 14, col: PAL.cyan },
      { x: 13, z: -18, r: 3, n: 14, col: PAL.mint },
      { x: -16, z: -30, r: 3, n: 12, col: PAL.lav },
      { x: 4, z: -26, r: 3.5, n: 16, col: PAL.mint },
      { x: -5, z: -40, r: 3, n: 12, col: PAL.cyan },
      { x: 9, z: -42, r: 2.6, n: 10, col: PAL.lav },
      { x: 17, z: -28, r: 2.4, n: 10, col: PAL.cyan },
      { x: -9, z: -22, r: 2.2, n: 8, col: PAL.pink },
      { x: 0, z: -14, r: 2.4, n: 8, col: PAL.lav },
      // Cosy glows either side of Ollie's doorway.
      { x: -5.2, z: -44.5, r: 1.6, n: 9, col: PAL.mint },
      { x: 5.2, z: -44.5, r: 1.6, n: 9, col: PAL.cyan },
    ];
    const plantGlow: Record<string, string> = { [PAL.cyan]: '#62d3da', [PAL.mint]: '#6fdcb0', [PAL.lav]: '#a68ae4', [PAL.pink]: '#e08cb4' };
    const plantMat = (c: string) => mat('#2c3550', { emissive: plantGlow[c], emissiveIntensity: 0.8, rough: 0.6 });
    const seaPen = seaPenGeometry();
    const bulb = glowBulbGeometry();
    const colsAll = [PAL.cyan, PAL.mint, PAL.lav, PAL.pink];
    const halos: { pos: THREE.Vector3; size: number; color: string; alpha: number }[] = [];
    const plantMeshes: { mesh: THREE.InstancedMesh; grove: boolean }[] = [];
    for (const col of colsAll) {
      const clusters = plantClusters.filter((c) => c.col === col);
      if (!clusters.length) continue;
      for (const [g, scaleR, share] of [[seaPen, [0.8, 1.5], 0.45], [bulb, [0.7, 1.4], 0.55]] as [THREE.BufferGeometry, [number, number], number][]) {
        for (const grove of [false, true]) {
          const cl = clusters.filter((c) => (c.z < 0) === grove);
          if (!cl.length) continue;
          const spots: [number, number, number][] = [];
          for (const c of cl) {
            const cnt = Math.round(c.n * share);
            for (let k = 0; k < cnt; k++) {
              const a = rng.range(0, Math.PI * 2);
              const r = Math.sqrt(rng.next()) * c.r;
              spots.push([c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, rng.range(scaleR[0], scaleR[1])]);
            }
          }
          const im = scatter(g, grove ? matUnique('#2c3550', { emissive: plantGlow[col], emissiveIntensity: 0.8, rough: 0.6 }) : plantMat(col), spots.length, (i, d) => {
            const [x, z, s] = spots[i];
            d.position.set(x, H(x, z) - 0.05, z);
            d.scale.setScalar(s);
            d.rotation.set(rng.range(-0.15, 0.15), rng.range(0, 6), rng.range(-0.15, 0.15));
            return true;
          });
          root.add(im);
          plantMeshes.push({ mesh: im, grove });
        }
      }
      for (const c of clusters) halos.push({ pos: new THREE.Vector3(c.x, H(c.x, c.z) + 1.0, c.z), size: c.r * 2.6 + 2, color: col, alpha: 0.32 });
    }

    // Glow moss: tiny luminous dots freckling the rock (lit zones only).
    for (const col of [PAL.cyan, PAL.mint, PAL.lav]) {
      const spots: [number, number, number][] = [];
      for (let tries = 0; tries < 9000 && spots.length < 190; tries++) {
        const x = rng.range(-50, 50);
        const z = rng.range(-70, 76);
        if (darkness(x, z) > 0.05) continue;
        const d = this.field(x, z);
        if (d < -0.3 || d > 4.5) continue;
        const h = H(x, z);
        if (h > 10) continue;
        spots.push([x, h, z]);
      }
      const im = scatter(geo.sphere(8), mat('#2c3550', { emissive: col, emissiveIntensity: 1.3 }), spots.length, (i, d) => {
        const [x, y, z] = spots[i];
        d.position.set(x, y + 0.02, z);
        d.scale.setScalar(rng.range(0.05, 0.13));
        return true;
      });
      root.add(im);
      plantMeshes.push({ mesh: im, grove: false });
    }

    // Dim rocky crumbs on the floor everywhere (cosy detail; reads under any light).
    root.add(
      scatter(geo.ico(1), mat('#4d5679', { rough: 1 }), 700, (_i, d) => {
        const x = rng.range(-48, 48);
        const z = rng.range(-68, 74);
        const f = this.field(x, z);
        if (f > 0.5) return false;
        d.position.set(x, H(x, z), z);
        const s = rng.range(0.08, 0.32);
        d.scale.set(s, s * 0.6, s);
        d.rotation.set(rng.range(0, 3), rng.range(0, 3), 0);
        return true;
      }),
    );

    // --- Tube worms (plumes duck into their tubes when Ace swims close).
    const wormSpots: THREE.Vector3[] = [];
    const wormClusters: [number, number, number, number][] = [
      [3.5, 66, 1.2, 7],
      [-10, -9, 1.4, 8],
      [15, -22, 1.4, 8],
      [-14, -37, 1.4, 9],
      [6, -46, 1.3, 7],
      [-24, 55, 1.2, 7],
    ];
    for (const [cx, cz, r, cnt] of wormClusters) {
      for (let k = 0; k < cnt; k++) {
        const a = rng.range(0, 6.28);
        const rr = Math.sqrt(rng.next()) * r;
        const x = cx + Math.cos(a) * rr;
        const z = cz + Math.sin(a) * rr;
        wormSpots.push(new THREE.Vector3(x, H(x, z) - 0.05, z));
      }
    }
    // A crown of worms on the column top.
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const rr = k === 0 ? 0 : 0.75;
      wormSpots.push(new THREE.Vector3(column.x + Math.cos(a) * rr * 1.0, column.top - 0.25, column.z + Math.sin(a) * rr * 1.0));
    }
    const worms = new TubeWorms(wormSpots, rng);
    root.add(worms.group);

    const haloField = new HaloField(halos);
    root.add(haloField.points);

    return { terrain, column, clam, clamPos, worms, haloField, plantMeshes, domeY, rockMats, archMat };
  }
}

export interface WorldParts {
  terrain: THREE.Mesh;
  column: { x: number; z: number; top: number };
  clam: Clam;
  clamPos: THREE.Vector3;
  worms: TubeWorms;
  haloField: HaloField;
  plantMeshes: { mesh: THREE.InstancedMesh; grove: boolean }[];
  domeY: number;
  rockMats: THREE.MeshStandardMaterial[];
  archMat: THREE.MeshStandardMaterial;
}

// ------------------------------------------------------------- geometry

/** Soft, lumpy but rounded rock blob (indexed so normals stay smooth). */
function lumpyRock(seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 18, 12);
  const nz = new Noise(seed);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + nz.n2(v.x * 1.3 + v.z, v.y * 1.3) * 0.16 + nz.n2(v.x * 3 + 5, v.z * 3 + v.y) * 0.04;
    v.multiplyScalar(k);
    if (v.y < -0.4) v.y = -0.4 + (v.y + 0.4) * 0.4; // flatter base
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  return g;
}

/** Hemisphere dome with an arched doorway cut facing +Z. */
function caveDome(r: number, seed: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2 + 0.08);
  const nz = new Noise(seed + 40);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + nz.n2(v.x * 0.35, v.z * 0.35 + v.y * 0.2) * 0.05;
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  const ng = g.toNonIndexed();
  const pos = ng.attributes.position as THREE.BufferAttribute;
  const nor = ng.attributes.normal as THREE.BufferAttribute;
  const keepP: number[] = [];
  const keepN: number[] = [];
  for (let t = 0; t < pos.count; t += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < 3; k++) {
      cx += pos.getX(t + k) / 3;
      cy += pos.getY(t + k) / 3;
      cz += pos.getZ(t + k) / 3;
    }
    const inDoor = cz > 0 && (cx / 3.7) ** 2 + (cy / 5.4) ** 2 < 1;
    if (inDoor) continue;
    for (let k = 0; k < 3; k++) {
      keepP.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
      keepN.push(nor.getX(t + k), nor.getY(t + k), nor.getZ(t + k));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(keepP, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(keepN, 3));
  return out;
}

function seaPenGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(new THREE.CylinderGeometry(0.025, 0.035, 0.9, 5).translate(0, 0.45, 0).toNonIndexed());
  for (let i = 0; i < 9; i++) {
    const y = 0.35 + i * 0.065;
    const s = 1 - Math.abs(i - 4) / 6;
    const leaf = new THREE.SphereGeometry(1, 6, 4).scale(0.035, 0.1 * s + 0.04, 0.015);
    leaf.rotateZ(0.9);
    leaf.translate(0.08 * s + 0.02, y, 0);
    leaf.rotateY(i * 2.4);
    parts.push(leaf.toNonIndexed());
  }
  parts.push(new THREE.SphereGeometry(0.06, 8, 6).translate(0, 0.95, 0).toNonIndexed());
  const g = mergeGeometries(parts.map((p) => {
    p.deleteAttribute('uv');
    return p;
  }))!;
  return g;
}

function glowBulbGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const h = 0.22 + i * 0.12;
    const a = i * 2.1;
    const ox = Math.cos(a) * 0.07;
    const oz = Math.sin(a) * 0.07;
    parts.push(new THREE.CylinderGeometry(0.015, 0.022, h, 5).translate(ox, h / 2, oz).toNonIndexed());
    parts.push(new THREE.SphereGeometry(0.06 + i * 0.012, 10, 8).translate(ox, h + 0.04, oz).toNonIndexed());
  }
  return mergeGeometries(parts.map((p) => {
    p.deleteAttribute('uv');
    return p;
  }))!;
}

// ------------------------------------------------------------- giant clam

export interface Clam {
  group: THREE.Group;
  lid: THREE.Group;
  open: number;
}

function makeClam(): Clam {
  const group = new THREE.Group();
  const shellM = patchFakeLights(new THREE.MeshStandardMaterial({ color: '#b9b0d6', roughness: 0.55 }));
  const innerM = new THREE.MeshStandardMaterial({ color: '#f1dbe6', roughness: 0.4, emissive: '#c9a8d8', emissiveIntensity: 0.35, side: THREE.DoubleSide });
  const shellGeo = (): THREE.BufferGeometry => {
    const g = new THREE.SphereGeometry(1.5, 36, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const a = Math.atan2(v.z, v.x);
      const rim = 1 - v.y / 1.5;
      const flute = 1 + Math.cos(a * 9) * 0.07 * rim;
      p.setXYZ(i, v.x * flute, v.y * 0.42, v.z * flute);
    }
    g.computeVertexNormals();
    return g;
  };
  const sg = shellGeo();
  const bottom = new THREE.Mesh(sg, shellM);
  bottom.rotation.x = Math.PI;
  bottom.position.y = 0.05;
  const bottomIn = new THREE.Mesh(sg, innerM);
  bottomIn.rotation.x = Math.PI;
  bottomIn.scale.setScalar(0.94);
  bottomIn.position.y = 0.09;
  group.add(bottom, bottomIn);
  const lid = new THREE.Group();
  lid.position.set(0, 0.08, -1.45);
  const top = new THREE.Mesh(sg, shellM);
  top.position.z = 1.45;
  const topIn = new THREE.Mesh(sg, innerM);
  topIn.position.z = 1.45;
  topIn.scale.setScalar(0.94);
  topIn.position.y = -0.03;
  lid.add(top, topIn);
  group.add(lid);
  return { group, lid, open: 0.7 };
}

// ------------------------------------------------------------- tube worms

export class TubeWorms {
  readonly group = new THREE.Group();
  private plumes: THREE.InstancedMesh;
  private spots: THREE.Vector3[];
  private heights: number[] = [];
  private out: number[] = [];
  private away: number[] = [];
  private dummy = new THREE.Object3D();
  private phase: number[] = [];

  constructor(spots: THREE.Vector3[], rng: Rng) {
    this.spots = spots;
    const tubeGeo = new THREE.CylinderGeometry(0.07, 0.09, 1, 8, 1, true).translate(0, 0.5, 0);
    const rimGeo = new THREE.TorusGeometry(0.075, 0.022, 6, 10).rotateX(Math.PI / 2);
    const tubeMat = mat('#e9e1d2', { rough: 0.7, side: THREE.DoubleSide });
    for (const _ of spots) {
      this.heights.push(rng.range(0.5, 1.25));
      this.out.push(1);
      this.away.push(0);
      this.phase.push(rng.range(0, 6));
    }
    const tubes = scatter(tubeGeo, tubeMat, spots.length, (i, d) => {
      d.position.copy(spots[i]);
      d.scale.set(1, this.heights[i], 1);
      return true;
    });
    const rims = scatter(rimGeo, mat('#f4ede2', { rough: 0.6 }), spots.length, (i, d) => {
      d.position.copy(spots[i]).setY(spots[i].y + this.heights[i]);
      return true;
    });
    // Plume: a little crown of soft coral-pink feathers.
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 7; k++) {
      const f = new THREE.SphereGeometry(1, 6, 4).scale(0.03, 0.13, 0.05).translate(0, 0.12, 0.04);
      f.rotateX(0.5);
      f.rotateY((k / 7) * Math.PI * 2);
      f.deleteAttribute('uv');
      parts.push(f.toNonIndexed());
    }
    const plumeGeo = mergeGeometries(parts)!;
    this.plumes = new THREE.InstancedMesh(plumeGeo, mat('#e8949a', { emissive: '#e57f8f', emissiveIntensity: 0.55, rough: 0.6 }), spots.length);
    this.plumes.frustumCulled = false;
    this.group.add(tubes, rims, this.plumes);
  }

  update(dt: number, t: number, ace: THREE.Vector3): void {
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      const top = s.y + this.heights[i];
      const dx = ace.x - s.x;
      const dy = ace.y + 0.7 - top;
      const dz = ace.z - s.z;
      const near = dx * dx + dy * dy + dz * dz < 2.6 * 2.6;
      if (near) this.away[i] = 1.4;
      else this.away[i] = Math.max(0, this.away[i] - dt);
      const want = this.away[i] > 0 ? 0 : 1;
      // Duck in fast, peek back out slowly.
      this.out[i] += (want - this.out[i]) * Math.min(1, dt * (want ? 2.2 : 12));
      const o = this.out[i];
      this.dummy.position.set(s.x, top - (1 - o) * 0.28, s.z);
      const sway = Math.sin(t * 1.4 + this.phase[i]) * 0.12 * o;
      this.dummy.rotation.set(sway, this.phase[i], Math.cos(t * 1.1 + this.phase[i]) * 0.1 * o);
      const sc = 0.05 + o * 0.95;
      this.dummy.scale.set(sc * (0.9 + Math.sin(t * 2 + this.phase[i]) * 0.08), sc, sc);
      this.dummy.updateMatrix();
      this.plumes.setMatrixAt(i, this.dummy.matrix);
    }
    this.plumes.instanceMatrix.needsUpdate = true;
  }
}

/** Animate the clam lid gently breathing open and closed. */
export function updateClam(c: Clam, t: number, aceNear: boolean): void {
  const target = aceNear ? 0.95 : 0.55 + Math.sin(t * 0.5) * 0.25;
  c.open += (target - c.open) * 0.03;
  c.lid.rotation.x = -c.open;
}
