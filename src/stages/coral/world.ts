import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Noise, Rng, smoothstep } from '../../core/math';
import { geo, mat, part } from '../../kit/kit';
import { scatter } from '../../kit/terrain';
import { applyCaustics } from '../../fx/Environment';
import { C, cmat, swayMaterial, strip, tint } from './shared';

// ---------------------------------------------------------------- layout
export const SURFACE = 16;
type XZ = [number, number];
export const L = {
  spawn: [0, 33] as XZ,
  nest: [-11, 18] as XZ,
  clearing: [0, -2] as XZ,
  sharkCenter: [0, -4] as XZ,
  boat: [25, -24] as XZ,
  spire: [31, 6] as XZ,
  ledge: [-28, 20] as XZ,
  kelp: [-30, -10] as XZ,
  kelpClam: [-33, -14] as XZ,
  cave: [-6, -41] as XZ,
  arch: [-13, -19] as XZ,
  pad: [8, 29] as XZ,
  vents: [[-6, -10], [15, -3], [-20, 30]] as XZ[],
  anemones: [[13, 18], [-18, 5], [19, -11], [-4, 22]] as XZ[],
  garden: [10, 16] as XZ,
};

const noise = new Noise(311);

function bump(x: number, z: number, c: XZ, r: number): number {
  const d = Math.hypot(x - c[0], z - c[1]) / r;
  return d >= 1 ? 0 : (1 - d * d) * (1 - d * d);
}

/** Seabed height. Gentle dunes, a flat clearing, and a rocky reef rim that wraps the lagoon. */
export function seabed(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = noise.fbm2(x * 0.028, z * 0.028, 3) * 1.3 + noise.n2(x * 0.09, z * 0.09) * 0.2;
  const dc = Math.hypot(x - L.clearing[0], z - L.clearing[1]);
  h *= 0.3 + 0.7 * smoothstep(6, 15, dc);
  h += bump(x, z, L.nest, 5) * 0.45;
  h += bump(x, z, L.spire, 7) * 1.0;
  h -= bump(x, z, L.kelp, 14) * 0.6;
  const rim = smoothstep(37, 56, r);
  h += rim * rim * 12 + rim * noise.fbm2(x * 0.07 + 5, z * 0.07, 3) * 3.2;
  h += smoothstep(56, 70, r) * 3;
  return Math.min(h, SURFACE - 1.5);
}

/** Areas kept open for gameplay. */
export function keepOut(x: number, z: number, extra = 0): boolean {
  const near = (c: XZ, r: number) => Math.hypot(x - c[0], z - c[1]) < r + extra;
  if (near(L.spawn, 6) || near(L.nest, 5.5) || near(L.clearing, 8) || near(L.pad, 3.5)) return true;
  if (near(L.boat, 6.5) || near(L.spire, 4.5) || near(L.ledge, 6) || near(L.cave, 8) || near(L.arch, 6)) return true;
  for (const v of L.vents) if (near(v, 2.2)) return true;
  for (const a of L.anemones) if (near(a, 2)) return true;
  return false;
}

// ---------------------------------------------------------------- textures
function rippleNormalMap(): THREE.CanvasTexture {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const H = (x: number, y: number) => {
    const u = x / N;
    const v = y / N;
    // Tileable sand ripples with a little warp.
    const warp = Math.sin(u * Math.PI * 2 * 2 + Math.sin(v * Math.PI * 2) * 1.2) * 0.12 + Math.sin(u * Math.PI * 2 * 3) * 0.04;
    const r1 = Math.sin((v * 5 + warp) * Math.PI * 2);
    const r2 = Math.sin((v * 9 + u * 2 + warp * 0.6) * Math.PI * 2) * 0.25;
    return Math.pow((r1 * 0.5 + 0.5), 1.6) + r2 * 0.3;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = H((x + 1) % N, y) - H((x - 1 + N) % N, y);
      const dy = H(x, (y + 1) % N) - H(x, (y - 1 + N) % N);
      const k = 2.2;
      const n = new THREE.Vector3(-dx * k, -dy * k, 1).normalize();
      const i = (y * N + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(52, 52);
  t.anisotropy = 4;
  return t;
}

function fanTexture(base: string, edge: string): THREE.CanvasTexture {
  const W = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = W / 2;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, W / 2);
  g.lineCap = 'round';
  const rng = new Rng(9);
  const ox = W / 2;
  const oy = W / 2;
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    const x2 = x + Math.cos(a) * len;
    const y2 = y - Math.sin(a) * len;
    g.strokeStyle = depth > 2 ? edge : base;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x2, y2);
    g.stroke();
    if (depth < 5) {
      branch(x2, y2, a + rng.range(0.15, 0.4), len * 0.78, w * 0.72, depth + 1);
      branch(x2, y2, a - rng.range(0.15, 0.4), len * 0.78, w * 0.72, depth + 1);
    }
  };
  for (let i = 0; i < 5; i++) branch(ox, oy, Math.PI * (0.2 + i * 0.15), 30, 7, 0);
  // Fine lattice.
  g.strokeStyle = base;
  g.globalAlpha = 0.55;
  g.lineWidth = 1.6;
  for (let r = 22; r < W / 2; r += 9) {
    g.beginPath();
    g.arc(ox, oy, r, Math.PI * 1.08, Math.PI * 1.92);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- geometry
function rockGeometry(seed: number, detail = 2): THREE.BufferGeometry {
  const n = new Noise(seed);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 1 + n.n2(v.x * 1.3 + v.z, v.y * 1.3) * 0.16 + n.n2(v.x * 3, v.z * 3 + v.y) * 0.05;
    v.multiplyScalar(d);
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.4; // flatter bottoms sit nicely in sand
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function brainGeometry(): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 3);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const cols: number[] = [];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const groove = Math.sin(v.x * 9 + Math.sin(v.z * 6) * 1.6) * Math.sin(v.z * 9 + Math.sin(v.y * 5) * 1.3);
    const d = 1 + groove * 0.06;
    v.multiplyScalar(d);
    if (v.y < -0.1) v.y = -0.1 + (v.y + 0.1) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
    const k = 0.78 + 0.22 * (groove * 0.5 + 0.5);
    cols.push(k, k, k * 0.98);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

let ROCKS: THREE.BufferGeometry[] | null = null;
let BRAIN: THREE.BufferGeometry | null = null;
/** Fresh shared geometries for each stage build (the engine disposes everything on exit). */
let ROCKS_LO: THREE.BufferGeometry[] | null = null;
let CAPSULE: THREE.BufferGeometry | null = null;
export function resetWorldCaches(): void {
  ROCKS = null;
  ROCKS_LO = null;
  BRAIN = null;
  CAPSULE = null;
}
function rocksLo(): THREE.BufferGeometry[] {
  if (!ROCKS_LO) ROCKS_LO = [11, 23, 37, 41].map((s) => rockGeometry(s, 2));
  return ROCKS_LO;
}
function capsule(): THREE.BufferGeometry {
  if (!CAPSULE) CAPSULE = new THREE.CapsuleGeometry(1, 1, 3, 6);
  return CAPSULE;
}
function rocks(): THREE.BufferGeometry[] {
  if (!ROCKS) ROCKS = [11, 23, 37, 41].map((s) => rockGeometry(s, 3));
  return ROCKS;
}

/** A soft rounded rock with moss baked into its vertex colours (tops are greener). */
export function rockMesh(rng: Rng, sx: number, sy: number, sz: number, color: number = C.rock, moss = 0.8): THREE.Mesh {
  const g = rng.pick(Math.max(sx, sz) > 2.2 ? rocks() : rocksLo()).clone();
  g.scale(sx, sy, sz);
  g.computeVertexNormals();
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(p.count * 3);
  const base = new THREE.Color(color);
  const mossA = new THREE.Color(C.moss);
  const mossB = new THREE.Color(C.mossLight);
  const c = new THREE.Color();
  const ph = rng.range(0, 50);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const v = noise.n2(x * 0.9 + ph, z * 0.9 + y * 0.5);
    c.copy(base).multiplyScalar(0.93 + v * 0.07);
    const m = smoothstep(0.42, 0.78, n.getY(i) + v * 0.22) * moss;
    c.lerp(v > 0 ? mossA : mossB, m * 0.85);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(g, cmat(0xffffff, { rough: 0.95, vertexColors: true }));
  mesh.rotation.y = rng.range(0, 6.28);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

export function rock(rng: Rng, size: number, color: number = C.rock, moss = true): THREE.Group {
  const g = new THREE.Group();
  g.add(rockMesh(rng, size * rng.range(0.9, 1.25), size * rng.range(0.55, 0.85), size * rng.range(0.9, 1.2), color, moss ? 0.85 : 0.35));
  return g;
}

export function brainCoral(rng: Rng, s: number, color: number): THREE.Group {
  if (!BRAIN) BRAIN = brainGeometry();
  const g = new THREE.Group();
  const m = new THREE.Mesh(BRAIN, cmat(color, { rough: 0.85, vertexColors: true }));
  m.scale.set(s * rng.range(1, 1.2), s * rng.range(0.65, 0.85), s * rng.range(1, 1.2));
  m.position.y = s * 0.05;
  g.add(m);
  return g;
}

export function staghorn(rng: Rng, s: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = cmat(color, { rough: 0.8 });
  const tipM = cmat(new THREE.Color(color).lerp(new THREE.Color(0xfff6ea), 0.45).getHex(), { rough: 0.7 });
  const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
    const to = from.clone().addScaledVector(dir, len);
    const seg = new THREE.Mesh(capsule(), m);
    seg.scale.set(r, len / 3 + r * 0.2, r);
    seg.position.copy(from).add(to).multiplyScalar(0.5);
    seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    g.add(seg);
    if (depth >= 2) {
      g.add(part(geo.sphere(7), tipM, [to.x, to.y, to.z], r * 1.15, [0, 0, 0], false));
      return;
    }
    const n = depth === 0 ? rng.int(3, 4) : 2;
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const nd = dir.clone().add(new THREE.Vector3(Math.cos(a) * 0.65, 0.2, Math.sin(a) * 0.65)).normalize();
      grow(to, nd, len * rng.range(0.6, 0.8), r * 0.75, depth + 1);
    }
  };
  grow(new THREE.Vector3(0, -0.1, 0), new THREE.Vector3(0, 1, 0), 0.6, 0.13, 0);
  g.scale.setScalar(s);
  return g;
}

export function tableCoral(rng: Rng, s: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = cmat(color, { rough: 0.85 });
  g.add(part(geo.cyl(0.6, 1, 10), m, [0, 0.35, 0], [0.18, 0.7, 0.18]));
  const tiers = rng.int(1, 2);
  for (let i = 0; i < tiers; i++) {
    const r = 1 - i * 0.35;
    g.add(part(geo.cyl(1, 0.85, 22), m, [rng.range(-0.1, 0.1), 0.75 + i * 0.35, rng.range(-0.1, 0.1)], [r, 0.12, r * rng.range(0.85, 1)]));
  }
  g.scale.setScalar(s);
  return g;
}

export function tubeSponge(rng: Rng, s: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = cmat(color, { rough: 0.9 });
  const inner = mat(new THREE.Color(color).multiplyScalar(0.55).getHex(), { rough: 1 });
  const n = rng.int(3, 5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(0, 0.6);
    const r = i === 0 ? 0 : rng.range(0.22, 0.38);
    const h = rng.range(0.6, 1.3) * (i === 0 ? 1.3 : 1);
    const rad = rng.range(0.11, 0.16);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const tube = part(geo.cyl(1, 0.8, 14), m, [x, h / 2, z], [rad, h, rad], [rng.range(-0.12, 0.12), 0, rng.range(-0.12, 0.12)]);
    g.add(tube);
    g.add(part(geo.torus(0.25, Math.PI * 2, 14), m, [x, h, z], [rad, rad, rad], [Math.PI / 2, 0, 0], false));
    g.add(part(geo.cyl(1, 1, 12), inner, [x, h - 0.02, z], [rad * 0.8, 0.02, rad * 0.8], [0, 0, 0], false));
  }
  g.scale.setScalar(s);
  return g;
}

export function leatherCoral(rng: Rng, s: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const m = cmat(color, { rough: 0.85 });
  g.add(part(geo.cyl(0.8, 1, 10), m, [0, 0.25, 0], [0.22, 0.5, 0.22]));
  // Wavy mushroom cap from a deformed disc.
  const cap = new THREE.CylinderGeometry(1, 0.9, 0.1, 28, 1);
  const p = cap.attributes.position as THREE.BufferAttribute;
  const ph = rng.range(0, 6);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const rr = Math.hypot(x, z);
    p.setY(i, p.getY(i) + Math.sin(a * 5 + ph) * 0.1 * rr - rr * rr * 0.08);
  }
  cap.computeVertexNormals();
  const mesh = new THREE.Mesh(cap, m);
  mesh.scale.set(0.7, 1, 0.7);
  mesh.position.y = 0.55;
  g.add(mesh);
  g.scale.setScalar(s);
  return g;
}

/** A coral head: a mossy rock base crowned with a little family of corals. */
export function coralHead(rng: Rng, s: number, palette: number[]): THREE.Group {
  const g = new THREE.Group();
  const base = rockMesh(rng, s * 1.2, s * 0.7, s * 1.1, rng.chance(0.5) ? C.rock : C.rockDark, 0.6);
  base.position.y = s * 0.2;
  g.add(base);
  const n = rng.int(3, 5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const r = i === 0 ? 0 : rng.range(0.4, 0.85) * s;
    const col = rng.pick(palette);
    const k = rng.int(0, 3);
    const cs = rng.range(0.55, 0.95) * s;
    const c = k === 0 ? brainCoral(rng, cs * 0.7, col) : k === 1 ? staghorn(rng, cs * 1.1, col) : k === 2 ? tubeSponge(rng, cs * 0.9, col) : tableCoral(rng, cs * 0.8, col);
    c.position.set(Math.cos(a) * r, s * 0.55 - (r / s) * s * 0.25, Math.sin(a) * r);
    c.rotation.y = rng.range(0, 6.28);
    g.add(c);
  }
  return g;
}

/** A tall coral-crusted rock spire. Returns the height of the top platform. */
export function spire(rng: Rng): { group: THREE.Group; top: number } {
  const g = new THREE.Group();
  let y = 0;
  const tiers = 7;
  for (let i = 0; i < tiers; i++) {
    const r = 2.5 - i * 0.2;
    const rk = rock(rng, r, i % 2 ? C.rock : C.rockDark, false);
    rk.position.set(rng.range(-0.25, 0.25), y + r * 0.35, rng.range(-0.25, 0.25));
    rk.scale.y = 1.5;
    g.add(rk);
    // Little shelves and coral tufts on the sides.
    const a = rng.range(0, Math.PI * 2);
    if (i % 2 === 0) {
      const tc = tableCoral(rng, 0.9, [C.peach, C.lavender, C.cream][i % 3]);
      tc.position.set(Math.cos(a) * (r * 0.9), y + 0.4, Math.sin(a) * (r * 0.9));
      g.add(tc);
    } else {
      const bc = brainCoral(rng, 0.55, [C.dusty, C.teal, C.butter][i % 3]);
      bc.position.set(Math.cos(a) * (r * 0.95), y + 0.6, Math.sin(a) * (r * 0.95));
      g.add(bc);
    }
    y += r * 0.72;
  }
  const top = y + 0.4;
  const plat = rock(rng, 2.0, C.rock, true);
  plat.scale.set(1, 0.45, 1);
  plat.position.y = top - 0.4;
  g.add(plat);
  // Crown of staghorn around the edge of the top.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const sc = staghorn(rng, 0.9, i % 2 ? C.peach : C.lavender);
    sc.position.set(Math.cos(a) * 1.5, top - 0.1, Math.sin(a) * 1.5);
    g.add(sc);
  }
  return { group: g, top };
}

/** Flat rock ledge on two boulders; something precious sits in the shade beneath. */
export function ledge(rng: Rng): { group: THREE.Group; slabMin: number; slabMax: number } {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const b = rock(rng, 1.7, C.rockDark, false);
    b.position.set(s * 2.9, 0.6, 0);
    b.scale.y = 1.5;
    g.add(b);
  }
  const slab = rockMesh(rng, 4.4, 0.8, 3.0, C.rock, 1);
  slab.rotation.y = 0;
  slab.position.y = 2.95;
  g.add(slab);
  const sc = staghorn(rng, 1.1, C.dusty);
  sc.position.set(-1.5, 3.6, 0.5);
  g.add(sc);
  const bc = brainCoral(rng, 0.8, C.lavender);
  bc.position.set(1.6, 3.5, -0.4);
  g.add(bc);
  return { group: g, slabMin: 2.35, slabMax: 3.7 };
}

/** Horseshoe of boulders with a roof: a little grotto facing +Z. */
export function grotto(rng: Rng): { group: THREE.Group; boulders: { x: number; y: number; z: number; r: number }[]; roofMin: number; roofMax: number } {
  const g = new THREE.Group();
  const boulders: { x: number; y: number; z: number; r: number }[] = [];
  const R = 4.3;
  for (let i = 0; i < 7; i++) {
    const a = THREE.MathUtils.degToRad(52 + i * (256 / 6));
    const x = Math.sin(a) * R;
    const z = Math.cos(a) * R;
    const r = 2.2;
    const b = rock(rng, r, i % 2 ? C.rockDark : C.rock, false);
    b.position.set(x, 1.0, z);
    b.scale.y = 1.6;
    g.add(b);
    boulders.push({ x, y: 1.2, z, r: 2.0 });
  }
  const roof = rockMesh(rng, 5.6, 1.4, 5.6, C.rock, 1);
  roof.position.y = 4.1;
  g.add(roof);
  for (let i = 0; i < 5; i++) {
    const a = rng.range(0, Math.PI * 2);
    const c = [staghorn, brainCoral, tubeSponge][i % 3](rng, rng.range(0.6, 1), [C.peach, C.lavender, C.teal, C.butter, C.dusty][i]);
    c.position.set(Math.cos(a) * 3, 5.2, Math.sin(a) * 3);
    g.add(c);
  }
  return { group: g, boulders, roofMin: 3.15, roofMax: 5.6 };
}

/** Natural rock arch (in the XY plane). */
export function arch(rng: Rng): { group: THREE.Group; stones: THREE.Vector3[]; r: number } {
  const g = new THREE.Group();
  const stones: THREE.Vector3[] = [];
  const R = 4.8;
  const n = 10;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI;
    const p = new THREE.Vector3(Math.cos(t) * R, Math.sin(t) * R * 1.05, 0);
    const b = rock(rng, 1.45, i % 2 ? C.rock : C.rockDark, i > 2 && i < 7);
    b.position.copy(p);
    b.rotation.z = t - Math.PI / 2;
    g.add(b);
    stones.push(p);
  }
  return { group: g, stones, r: 1.35 };
}

/** A toy-like sunken sailboat. Hull runs along local X (bow at +X). */
export function sailboat(): THREE.Group {
  const g = new THREE.Group();
  const outline = (s: number) => {
    const sh = new THREE.Shape();
    sh.moveTo(-3.4 * s, -1.15 * s);
    sh.quadraticCurveTo(-3.6 * s, 0, -3.4 * s, 1.15 * s);
    sh.lineTo(1.2 * s, 1.4 * s);
    sh.quadraticCurveTo(3.0 * s, 1.2 * s, 3.8 * s, 0);
    sh.quadraticCurveTo(3.0 * s, -1.2 * s, 1.2 * s, -1.4 * s);
    sh.closePath();
    return sh;
  };
  const ring = (outer: number, inner: number) => {
    const sh = outline(outer);
    sh.holes.push(new THREE.Path(outline(inner).getPoints(24).reverse()));
    return sh;
  };
  const ext = (sh: THREE.Shape, depth: number) => {
    const eg = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2, curveSegments: 16 });
    eg.rotateX(-Math.PI / 2);
    return eg;
  };
  const hullM = cmat(C.boatHull, { rough: 0.7 });
  const stripeM = cmat(C.boatStripe, { rough: 0.7 });
  const trimM = cmat(C.boatTrim, { rough: 0.6 });
  const floor = new THREE.Mesh(ext(outline(0.93), 0.25), cmat(C.wood, { rough: 0.85 }));
  floor.position.y = 0.05;
  g.add(floor);
  const walls = new THREE.Mesh(ext(ring(1, 0.92), 1.5), hullM);
  g.add(walls);
  const stripe = new THREE.Mesh(ext(ring(1.02, 0.99), 0.28), stripeM);
  stripe.position.y = 0.85;
  g.add(stripe);
  const rim = new THREE.Mesh(ext(ring(1.03, 0.9), 0.12), trimM);
  rim.position.y = 1.5;
  g.add(rim);
  // Rounded bottom + keel.
  g.add(part(geo.sphere(20), hullM, [0, 0.05, 0], [3.4, 0.45, 1.25]));
  g.add(part(geo.box(0.1), trimM, [-0.3, -0.25, 0], [5.2, 0.35, 0.22]));
  // Portholes.
  for (const z of [-1, 1]) {
    for (const x of [-1.8, -0.6, 0.6]) {
      g.add(part(geo.torus(0.3, Math.PI * 2, 16), trimM, [x, 1.1, z * 1.36], 0.18, [0, 0, 0], false));
      g.add(part(geo.cyl(1, 1, 14), mat(0xbfe1df, { rough: 0.2, emissive: 0x8cc8c2, emissiveIntensity: 0.2 }), [x, 1.1, z * 1.35], [0.16, 0.04, 0.16], [Math.PI / 2, 0, 0], false));
    }
  }
  // Mast, boom and a soft striped sail.
  const woodM = cmat(C.wood, { rough: 0.8 });
  g.add(part(geo.cyl(0.8, 1, 10), woodM, [0.6, 3.4, 0], [0.12, 6.4, 0.12]));
  g.add(part(geo.sphere(12), cmat(C.butter, { rough: 0.5 }), [0.6, 6.7, 0], 0.2));
  g.add(part(geo.cyl(1, 1, 8), woodM, [-0.8, 2.0, 0], [0.08, 2.8, 0.08], [0, 0, Math.PI / 2]));
  const sail = new THREE.Shape();
  sail.moveTo(0, 0);
  sail.lineTo(-2.7, 0);
  sail.quadraticCurveTo(-1.2, 2.2, 0, 4.4);
  sail.closePath();
  const sg = new THREE.ShapeGeometry(sail, 10);
  const sailMesh = new THREE.Mesh(sg, cmat(C.cream, { rough: 0.9, side: THREE.DoubleSide }));
  sailMesh.position.set(0.5, 2.15, 0.05);
  g.add(sailMesh);
  const band = new THREE.Shape();
  band.moveTo(-0.0, 1.5);
  band.lineTo(-1.95, 1.5);
  band.quadraticCurveTo(-1.6, 1.9, -1.25, 2.3);
  band.lineTo(0, 2.3);
  band.closePath();
  const bandMesh = new THREE.Mesh(new THREE.ShapeGeometry(band, 6), cmat(C.boatStripe, { rough: 0.9, side: THREE.DoubleSide }));
  bandMesh.position.set(0.5, 2.15, 0.07);
  g.add(bandMesh);
  // Little flag on top.
  const fl = new THREE.Shape();
  fl.moveTo(0, 0);
  fl.lineTo(0.9, -0.22);
  fl.lineTo(0, -0.45);
  fl.closePath();
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(fl), cmat(C.boatTrim, { side: THREE.DoubleSide }));
  flag.position.set(0.65, 6.6, 0);
  g.add(flag);
  // A barnacle or two for story.
  for (let i = 0; i < 7; i++) g.add(part(geo.sphere(8), cmat(0xd8d0c0), [-2.6 + i * 0.75, 0.3 + (i % 2) * 0.3, 1.32 * (i % 3 ? 1 : -1)], [0.12, 0.1, 0.06], [0, 0, 0], false));
  return g;
}

/** Mama Turtle's nest: a soft sand mound with a sleepy round rock behind. */
export function nest(rng: Rng): THREE.Group {
  const g = new THREE.Group();
  const r = rock(rng, 2.3, C.rock, true);
  r.position.set(-2.8, 0.6, -2.5);
  g.add(r);
  const r2 = rock(rng, 1.3, C.rockDark, true);
  r2.position.set(-0.6, 0.3, -3.6);
  g.add(r2);
  const lc = leatherCoral(rng, 1.4, C.peach);
  lc.position.set(-4.2, 0, 0.5);
  g.add(lc);
  const ts = tubeSponge(rng, 1.1, C.lavender);
  ts.position.set(2.8, 0, -2.2);
  g.add(ts);
  // Ring of tiny shells around the nest.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.add(part(geo.sphere(8), cmat(i % 2 ? C.cream : C.peach), [Math.cos(a) * 3.2, 0.05, Math.sin(a) * 3.2], [0.18, 0.08, 0.14], [0, a, 0], false));
  }
  return g;
}

// ---------------------------------------------------------------- terrain mesh
export function makeSeabed(): THREE.Mesh {
  const size = 160;
  const segs = 200;
  const g = new THREE.PlaneGeometry(size, size, segs, segs);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(C.sand);
  const deep = new THREE.Color(C.sandDeep);
  const light = new THREE.Color(C.sandLight);
  const rockC = new THREE.Color(0xc4baa5);
  const mossC = new THREE.Color(0xa8bda0);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = seabed(x, z);
    pos.setY(i, h);
    const v = noise.n2(x * 0.05 + 3, z * 0.05) * 0.5 + 0.5;
    c.copy(sand).lerp(deep, v * 0.55).lerp(light, smoothstep(0.2, 1.2, h) * 0.35 * (1 - v));
    const r = Math.hypot(x, z);
    const rim = smoothstep(40, 52, r);
    c.lerp(rockC, rim * 0.75);
    c.lerp(mossC, rim * smoothstep(0.1, 0.6, noise.n2(x * 0.11, z * 0.11)) * 0.5);
    // Seagrass meadow tint near the nest, darker in the kelp forest.
    c.lerp(new THREE.Color(0xcfd3b0), bump(x, z, L.nest, 10) * 0.45);
    c.lerp(new THREE.Color(0xc9c4a0), bump(x, z, L.kelp, 16) * 0.5);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, normalMap: rippleNormalMap(), normalScale: new THREE.Vector2(0.55, 0.55) });
  applyCaustics(m, 0.32);
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- plants (instanced, swaying)
function kelpGeometry(): THREE.BufferGeometry {
  const H = 10;
  const parts: THREE.BufferGeometry[] = [];
  const stem = new THREE.CylinderGeometry(0.035, 0.06, H, 5, 8).translate(0, H / 2, 0);
  parts.push(tint(strip(stem), C.kelpDark));
  const leaf = new THREE.CircleGeometry(1, 10);
  leaf.scale(0.17, 0.7, 1);
  leaf.translate(0, 0.7, 0);
  for (let i = 0; i < 13; i++) {
    const y = 0.8 + i * 0.7;
    const l = leaf.clone();
    l.rotateZ((i % 2 ? 1 : -1) * 0.7);
    l.rotateY(i * 2.4);
    l.translate(0, y, 0);
    parts.push(tint(strip(l), i % 3 === 0 ? C.kelpDark : C.kelp));
  }
  // Float bulb near the top.
  parts.push(tint(strip(new THREE.SphereGeometry(0.14, 8, 6).translate(0, H, 0)), 0xc1b86e));
  return mergeGeometries(parts)!;
}

function grassGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    const b = new THREE.PlaneGeometry(0.07, 1, 1, 4).translate(0, 0.5, 0);
    const p = b.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (1 - p.getY(i) * 0.7));
    b.rotateY(k * 1.25);
    b.rotateZ((k - 2) * 0.12);
    b.translate((k - 2) * 0.05, 0, ((k * 7) % 3) * 0.04 - 0.04);
    parts.push(tint(strip(b), k % 2 ? C.seagrass : 0x9fc39a));
  }
  return mergeGeometries(parts)!;
}

function tentacleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const t = new THREE.CapsuleGeometry(0.035, 0.5, 3, 6).translate(0, 0.28, 0);
  const tip = new THREE.SphereGeometry(0.045, 6, 4).translate(0, 0.56, 0);
  parts.push(tint(strip(t), 0xf1d6c4));
  parts.push(tint(strip(tip), 0xf8ece0));
  return mergeGeometries(parts)!;
}

export interface Plants {
  kelp: THREE.InstancedMesh;
  grass: THREE.InstancedMesh;
  fans: THREE.InstancedMesh[];
  tentacles: THREE.InstancedMesh;
}

export function makePlants(rng: Rng, kelpSkip: XZ[]): Plants {
  const kelpM = swayMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, emissive: 0x3c4a1e, emissiveIntensity: 0.25 }), 0.9, 10, 0.55, 1.2);
  const kelpSpots: [number, number, number][] = [];
  for (let i = 0; i < 420 && kelpSpots.length < 150; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next());
    const x = L.kelp[0] + Math.cos(a) * r * 12;
    const z = L.kelp[1] + Math.sin(a) * r * 16;
    if (kelpSkip.some((s) => Math.hypot(x - s[0], z - s[1]) < 2.4)) continue;
    if (keepOut(x, z)) continue;
    kelpSpots.push([x, z, rng.range(0.65, 1.25)]);
  }
  // A few kelp clumps around the rim for depth.
  for (let i = 0; i < 46; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(40, 50);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (keepOut(x, z, 2)) continue;
    kelpSpots.push([x, z, rng.range(0.4, 0.8)]);
  }
  const kelp = scatter(kelpGeometry(), kelpM, kelpSpots.length, (i, d, c) => {
    const [x, z, s] = kelpSpots[i];
    d.position.set(x, seabed(x, z) - 0.1, z);
    d.rotation.y = rng.range(0, 6.28);
    d.scale.set(1, s, 1);
    c.setScalar(rng.range(0.9, 1.08));
    return true;
  });
  kelp.frustumCulled = false;

  const grassM = swayMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), 0.18, 1, 1.3, 1.5);
  const grassSpots: [number, number][] = [];
  const patches: [XZ, number, number][] = [
    [L.nest, 9, 520],
    [[-22, 12], 6, 160],
    [[18, 26], 5, 120],
    [[4, -20], 6, 140],
    [[-30, -10], 12, 200],
    [[30, -6], 5, 100],
  ];
  for (const [c, rad, n] of patches) {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * rad;
      const x = c[0] + Math.cos(a) * r;
      const z = c[1] + Math.sin(a) * r;
      if (Math.hypot(x - L.nest[0], z - L.nest[1]) < 3.4) continue;
      if (Math.hypot(x - L.spawn[0], z - L.spawn[1]) < 3) continue;
      grassSpots.push([x, z]);
    }
  }
  const grass = scatter(grassGeometry(), grassM, grassSpots.length, (i, d, c) => {
    const [x, z] = grassSpots[i];
    d.position.set(x, seabed(x, z) - 0.05, z);
    d.rotation.y = rng.range(0, 6.28);
    const s = rng.range(0.55, 1.2);
    d.scale.set(s, s * rng.range(0.8, 1.3), s);
    c.setScalar(rng.range(0.85, 1.1));
    return true;
  });
  grass.frustumCulled = false;

  // Sea fans (two tints), on the rim and around big rocks.
  const fans: THREE.InstancedMesh[] = [];
  const fanGeo = new THREE.CircleGeometry(1, 20, 0, Math.PI);
  const tints: [string, string][] = [
    ['#c9a3c4', '#e2c6dc'],
    ['#e3a993', '#f3d2c2'],
  ];
  for (let k = 0; k < 2; k++) {
    const m = swayMaterial(
      new THREE.MeshStandardMaterial({ map: fanTexture(tints[k][0], tints[k][1]), transparent: false, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85 }),
      0.12,
      1,
      0.9,
      0.5,
    );
    const spots: [number, number][] = [];
    for (let i = 0; i < 200 && spots.length < 26; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.chance(0.6) ? rng.range(36, 48) : rng.range(12, 34);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (keepOut(x, z, 1)) continue;
      spots.push([x, z]);
    }
    const inst = scatter(fanGeo, m, spots.length, (i, d) => {
      const [x, z] = spots[i];
      d.position.set(x, seabed(x, z) - 0.1, z);
      d.rotation.y = rng.range(0, 6.28);
      const s = rng.range(0.9, 1.8);
      d.scale.set(s, s, s);
      return true;
    });
    inst.frustumCulled = false;
    fans.push(inst);
  }

  // Anemone tentacles: one instanced draw for every anemone.
  const tentM = swayMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.6, emissive: 0x4a2a20, emissiveIntensity: 0.12 }), 0.16, 0.6, 1.6, 1.2);
  const tPos: { p: THREE.Vector3; q: THREE.Quaternion; s: number }[] = [];
  for (const a of L.anemones) {
    const y = seabed(a[0], a[1]) + 0.55;
    for (let i = 0; i < 46; i++) {
      const ring = i < 16 ? 0.35 : i < 32 ? 0.6 : 0.8;
      const ang = (i / 16) * Math.PI * 2 + ring * 2.1;
      const tilt = ring * 0.9;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(ang) * tilt, 0, -Math.cos(ang) * tilt));
      tPos.push({ p: new THREE.Vector3(a[0] + Math.cos(ang) * ring * 0.7, y, a[1] + Math.sin(ang) * ring * 0.7), q, s: rng.range(0.9, 1.4) });
    }
  }
  const tentacles = scatter(tentacleGeometry(), tentM, tPos.length, (i, d) => {
    d.position.copy(tPos[i].p);
    d.quaternion.copy(tPos[i].q);
    d.scale.setScalar(tPos[i].s);
    return true;
  });
  return { kelp, grass, fans, tentacles };
}

/** Starfish, shells and pebbles sprinkled on the sand. */
export function makeSandBits(rng: Rng): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 1 : 0.42;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  star.closePath();
  const sg = new THREE.ExtrudeGeometry(star, { depth: 0.15, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2 });
  sg.rotateX(-Math.PI / 2);
  const cols = [C.peach, C.dusty, C.butter, C.lavender];
  out.push(
    scatter(sg, mat(0xffffff, { rough: 0.8 }), 40, (_i, d, c) => {
      const x = rng.range(-38, 38);
      const z = rng.range(-38, 38);
      if (keepOut(x, z) || Math.hypot(x, z) > 40) return false;
      d.position.set(x, seabed(x, z) + 0.02, z);
      d.rotation.y = rng.range(0, 6);
      d.scale.setScalar(rng.range(0.16, 0.26));
      c.set(rng.pick(cols));
      return true;
    }),
  );
  // Spiral-ish shells: squashed cones.
  out.push(
    scatter(new THREE.ConeGeometry(1, 2.2, 9).rotateZ(Math.PI / 2.4).translate(0, 0.4, 0), mat(0xffffff, { rough: 0.6 }), 60, (_i, d, c) => {
      const x = rng.range(-40, 40);
      const z = rng.range(-40, 40);
      if (Math.hypot(x, z) > 42) return false;
      d.position.set(x, seabed(x, z), z);
      d.rotation.y = rng.range(0, 6);
      d.scale.setScalar(rng.range(0.07, 0.12));
      c.set(rng.pick([C.cream, C.sandLight, C.peach, 0xe9d9c8]));
      return true;
    }),
  );
  // Pebbles.
  out.push(
    scatter(rockGeometry(5, 1), mat(0xffffff, { rough: 0.95 }), 220, (_i, d, c) => {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(4, 46);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      d.position.set(x, seabed(x, z), z);
      d.rotation.y = rng.range(0, 6);
      const s = rng.range(0.1, 0.32);
      d.scale.set(s, s * 0.6, s);
      c.set(rng.pick([0xcfc6b4, 0xbdb5a5, 0xd9cfbd]));
      return true;
    }),
  );
  return out;
}
