import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyCaustics } from '../../fx/Environment';
import { matUnique, mat, mergeStatic, type MatOptions } from '../../kit/kit';

// Coral Cove palette: sunny shallow lagoon. Restrained, harmonious accents on
// pale sand and teal water. Nothing loud.
export const C = {
  sand: 0xdccba6,
  sandDeep: 0xcdb98f,
  sandLight: 0xe8dcbf,
  rock: 0xb9b2a2,
  rockDark: 0x9c978b,
  moss: 0x8fb39a,
  mossLight: 0xa9c6a6,
  peach: 0xebb59b,
  dusty: 0xd99c8f,
  lavender: 0xb9a9d0,
  teal: 0x7fb7b1,
  cream: 0xf1e6cf,
  butter: 0xead08b,
  kelp: 0xa4a65e,
  kelpDark: 0x8a9452,
  seagrass: 0x8fb98d,
  shark: 0x93abbb,
  sharkBelly: 0xf2ede2,
  whale: 0x657f96,
  whaleBelly: 0xe9e6dc,
  turtleShell: 0x8fae8e,
  turtleShellLight: 0xb4c99c,
  turtleSkin: 0xcfc9a0,
  puffer: 0xead9a4,
  pufferSpot: 0xc8a76c,
  clown: 0xe9a070,
  crab: 0xe39a80,
  pearl: 0xfbf3e6,
  clam: 0xc9b8d6,
  boatHull: 0xf2e7d1,
  boatStripe: 0xd99a8c,
  boatTrim: 0x7fb1ad,
  wood: 0xc7a582,
};

// ------------------------------------------------------------ materials
const causticCache = new Map<string, THREE.MeshStandardMaterial>();
/** Matte material with seabed caustics (unique, cached per stage module). */
export function cmat(color: THREE.ColorRepresentation, o: MatOptions = {}, scale = 0.35): THREE.MeshStandardMaterial {
  const key = `${new THREE.Color(color).getHexString()}|${JSON.stringify(o)}|${scale}`;
  let m = causticCache.get(key);
  if (!m) {
    m = applyCaustics(matUnique(color, o), scale);
    causticCache.set(key, m);
  }
  return m;
}
export function clearMaterialCaches(): void {
  causticCache.clear();
}

/** Shared time uniform for every swaying plant. */
export const sway = { uSwayTime: { value: 0 } };

/**
 * Patch a material so geometry sways like it is in a gentle current.
 * `height` is the object-space height where the sway reaches `amp`.
 */
export function swayMaterial(m: THREE.MeshStandardMaterial, amp: number, height: number, freq = 0.8, bend = 1.4): THREE.MeshStandardMaterial {
  const inv = 1 / height;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSwayTime = sway.uSwayTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uSwayTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float hN = clamp(position.y * ${inv.toFixed(5)}, 0.0, 1.5);
          vec3 ip = modelMatrix[3].xyz;
          #ifdef USE_INSTANCING
            ip += instanceMatrix[3].xyz;
          #endif
          float ph = ip.x * 0.37 + ip.z * 0.23;
          float w = hN * hN;
          transformed.x += sin(uSwayTime * ${freq.toFixed(3)} + ph + hN * ${bend.toFixed(3)}) * ${amp.toFixed(3)} * w;
          transformed.z += cos(uSwayTime * ${(freq * 0.73).toFixed(3)} + ph * 1.3 + hN * ${bend.toFixed(3)}) * ${(amp * 0.6).toFixed(3)} * w;
        }`,
      );
  };
  m.customProgramCacheKey = () => `sway${amp}|${height}|${freq}|${bend}`;
  return m;
}

/** Instanced fish get a tail wiggle from their instance index. Fish face +Z, tail towards -Z. */
export const fishUniforms = { uFishTime: { value: 0 } };
export function fishMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.05, vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFishTime = fishUniforms.uFishTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uFishTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float idf = float(gl_InstanceID);
          float back = max(0.0, -position.z + 0.04);
          transformed.x += sin(uFishTime * 11.0 + idf * 1.37 - position.z * 6.0) * back * back * 1.6;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'coralFish';
  return m;
}

// ------------------------------------------------------------ cute eyes
/**
 * Cheap, cute eyes for small creatures: both eyes merged into one vertex-coloured
 * mesh (white, dark pupil, sparkle), so each critter costs one draw call for its eyes.
 * Blinks by squashing vertically.
 */
export class CuteEyes {
  readonly mesh: THREE.Mesh;
  private blinkT = 0;
  private next = 1 + Math.random() * 3;
  private happy = 0;
  constructor(size: number, spacing: number, sideAngle = 0.3, pupilColor = 0x2e3338) {
    const parts: THREE.BufferGeometry[] = [];
    const white = new THREE.Color(0xfbf8f1);
    const dark = new THREE.Color(pupilColor);
    const shine = new THREE.Color(0xffffff);
    const add = (g: THREE.BufferGeometry, c: THREE.Color, m: THREE.Matrix4) => {
      const ng = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
      ng.deleteAttribute('uv');
      const n = ng.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.push(ng);
    };
    const sph = new THREE.SphereGeometry(1, 14, 10);
    const small = new THREE.SphereGeometry(1, 8, 6);
    for (const s of [-1, 1]) {
      const base = new THREE.Matrix4().makeRotationY(s * sideAngle).premultiply(new THREE.Matrix4().makeTranslation((s * spacing) / 2, 0, 0));
      add(sph, white, base.clone().multiply(new THREE.Matrix4().makeScale(size, size * 1.08, size * 0.75)));
      add(sph, dark, base.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, size * 0.5)).multiply(new THREE.Matrix4().makeScale(size * 0.6, size * 0.68, size * 0.4)));
      add(small, shine, base.clone().multiply(new THREE.Matrix4().makeTranslation(-size * 0.2, size * 0.26, size * 0.82)).multiply(new THREE.Matrix4().makeScale(size * 0.19, size * 0.19, size * 0.12)));
    }
    const g = mergeGeometries(parts)!;
    this.mesh = new THREE.Mesh(g, mat(0xffffff, { rough: 0.3, vertexColors: true }));
    this.mesh.castShadow = false;
  }
  beam(d = 1.2): void {
    this.happy = d;
  }
  update(dt: number): void {
    this.next -= dt;
    if (this.next <= 0) {
      this.blinkT = 0.14;
      this.next = 2 + Math.random() * 3.5;
    }
    let close = 0;
    if (this.blinkT > 0) {
      this.blinkT -= dt;
      close = Math.sin((1 - Math.max(0, this.blinkT) / 0.14) * Math.PI);
    }
    if (this.happy > 0) {
      this.happy -= dt;
      close = Math.max(close, 0.6);
    }
    this.mesh.scale.y = 1 - close * 0.85;
  }
}

/** Bake a colour into a geometry (for merged vertex-coloured models). */
export function tint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, jitter = 0, rnd: () => number = Math.random): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i += 3) {
    const j = 1 + (rnd() - 0.5) * jitter;
    for (let k = 0; k < 3 && i + k < n; k++) {
      col[(i + k) * 3] = c.r * j;
      col[(i + k) * 3 + 1] = c.g * j;
      col[(i + k) * 3 + 2] = c.b * j;
    }
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

/** Keep only position/normal/color so geometries merge cleanly. */
export function strip(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(ng.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') ng.deleteAttribute(name);
  return ng;
}

/**
 * Smooth creature body from a side profile: radius as a function of t (0 = tail, 1 = nose),
 * spun around the Z axis (nose at +Z). `colorAt` receives the outward normal and the local
 * position and returns a vertex colour (e.g. pale belly, darker back).
 */
export function latheBody(
  length: number,
  radius: (t: number) => number,
  opts: { steps?: number; segments?: number; squashY?: number; squashX?: number; t0?: number; t1?: number; colorAt?: (n: THREE.Vector3, p: THREE.Vector3, t: number, out: THREE.Color) => void },
): THREE.BufferGeometry {
  const steps = opts.steps ?? 28;
  const t0 = opts.t0 ?? 0;
  const t1 = opts.t1 ?? 1;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = t0 + (i / steps) * (t1 - t0);
    pts.push(new THREE.Vector2(Math.max(0.0001, radius(t)), -length / 2 + t * length));
  }
  const g = new THREE.LatheGeometry(pts, opts.segments ?? 28);
  g.rotateX(Math.PI / 2); // lathe axis Y -> Z (head at +Z)
  g.scale(opts.squashX ?? 1, opts.squashY ?? 1, 1);
  g.deleteAttribute('uv');
  const merged = mergeVerticesSafe(g);
  merged.computeVertexNormals();
  if (opts.colorAt) {
    const p = merged.attributes.position as THREE.BufferAttribute;
    const n = merged.attributes.normal as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    const nv = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      nv.fromBufferAttribute(n, i);
      pv.fromBufferAttribute(p, i);
      opts.colorAt(nv, pv, (pv.z + length / 2) / length, c);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return merged;
}

function mergeVerticesSafe(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('normal');
  return mergeVertices(g, 1e-4);
}

/** Smoothstep helper for colour functions. */
export function sstep(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Convert plain matte meshes in a static group to one shared vertex-coloured
 * caustic material (colour baked per vertex), so a whole reef merges into a
 * handful of draw calls. Emissive, textured or transparent materials are kept.
 */
export function paintStatic(root: THREE.Object3D, forceRough?: number): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material)) meshes.push(m);
  });
  const c = new THREE.Color();
  for (const m of meshes) {
    const src = m.material as THREE.MeshStandardMaterial;
    if (!src.isMeshStandardMaterial || src.map || src.transparent) continue;
    if (src.emissive && src.emissive.getHex() !== 0 && src.emissiveIntensity > 0.05) continue;
    const g = m.geometry.clone();
    const n = g.attributes.position.count;
    const had = src.vertexColors && g.attributes.color ? (g.attributes.color as THREE.BufferAttribute) : null;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c.copy(src.color);
      if (had) c.multiply(new THREE.Color(had.getX(i), had.getY(i), had.getZ(i)));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    m.geometry = g;
    const rough = forceRough ?? Math.round(src.roughness * 5) / 5;
    m.material = cmat(0xffffff, { rough, vertexColors: true, side: src.side === THREE.DoubleSide ? THREE.DoubleSide : undefined });
  }
}

/** paintStatic + mergeStatic: a rigid multi-part model becomes (usually) one draw call. */
export function bake(g: THREE.Object3D, castShadow = true, receiveShadow = false, rough = 0.65): THREE.Group {
  paintStatic(g, rough);
  return mergeStatic(g, castShadow, receiveShadow);
}
