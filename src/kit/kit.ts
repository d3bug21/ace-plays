import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Shared modelling kit: soft matte materials, rounded primitives and cute,
// friendly faces. Every creature and prop in the game is built from these so
// the whole world feels like one cohesive, clean, toy-like style.

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export interface MatOptions {
  rough?: number;
  metal?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  flat?: boolean;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
}

/** Cached soft matte material. Do not mutate the returned material; use matUnique for that. */
export function mat(color: THREE.ColorRepresentation, o: MatOptions = {}): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  const key = `${c.getHexString()}|${o.rough ?? 0.82}|${o.metal ?? 0}|${o.emissive ?? ''}|${o.emissiveIntensity ?? 1}|${o.flat ? 1 : 0}|${o.transparent ? o.opacity ?? 1 : 1}|${o.side ?? 0}|${o.vertexColors ? 1 : 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = matUnique(color, o);
    matCache.set(key, m);
  }
  return m;
}

export function matUnique(color: THREE.ColorRepresentation, o: MatOptions = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: o.rough ?? 0.82,
    metalness: o.metal ?? 0,
    emissive: o.emissive !== undefined ? new THREE.Color(o.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: o.emissiveIntensity ?? 1,
    flatShading: !!o.flat,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    vertexColors: !!o.vertexColors,
  });
}

// ------------------------------------------------------------- geometry cache
const geoCache = new Map<string, THREE.BufferGeometry>();
function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export const geo = {
  sphere: (seg = 24) => cachedGeo(`s${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.66)))),
  capsule: (len = 1, seg = 16) => cachedGeo(`c${len}|${seg}`, () => new THREE.CapsuleGeometry(1, len, 6, seg)),
  cyl: (top = 1, bottom = 1, seg = 20) => cachedGeo(`y${top}|${bottom}|${seg}`, () => new THREE.CylinderGeometry(top, bottom, 1, seg)),
  cone: (seg = 20) => cachedGeo(`k${seg}`, () => new THREE.ConeGeometry(1, 1, seg)),
  box: (r = 0.15, seg = 3) => cachedGeo(`b${r}|${seg}`, () => new RoundedBoxGeometry(1, 1, 1, seg, r)),
  torus: (tube = 0.25, arc = Math.PI * 2, seg = 24) => cachedGeo(`t${tube}|${arc}|${seg}`, () => new THREE.TorusGeometry(1, tube, 10, seg, arc)),
  ico: (detail = 1) => cachedGeo(`i${detail}`, () => new THREE.IcosahedronGeometry(1, detail)),
  dodec: () => cachedGeo('d', () => new THREE.DodecahedronGeometry(1, 0)),
};

/** Make a mesh from a shared geometry with position/scale in one call. */
export function part(
  g: THREE.BufferGeometry,
  m: THREE.Material,
  pos: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] | number = 1,
  rot: [number, number, number] = [0, 0, 0],
  shadow = true,
): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(pos[0], pos[1], pos[2]);
  if (typeof scale === 'number') mesh.scale.setScalar(scale);
  else mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.rotation.set(rot[0], rot[1], rot[2]);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  return mesh;
}

export const ball = (m: THREE.Material, pos: [number, number, number], scale: [number, number, number] | number, rot?: [number, number, number]) =>
  part(geo.sphere(), m, pos, scale, rot);

/** A limb segment between two points (rounded capsule). */
export function limb(m: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number): THREE.Mesh {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(geo.capsule(1), m);
  // Unit capsule spans 3 units along Y (length 1 + two radius-1 caps); scale to fit a..b.
  mesh.scale.set(radius, Math.max(0.001, len / 3), radius);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.castShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ faces

export interface Eye {
  group: THREE.Group;
  pupil: THREE.Object3D;
  lid: THREE.Mesh | null;
}

export interface FaceOptions {
  eyeSize?: number;
  spacing?: number;
  eyeY?: number;
  eyeZ?: number;
  pupilColor?: THREE.ColorRepresentation;
  white?: THREE.ColorRepresentation;
  smile?: boolean;
  smileWidth?: number;
  smileY?: number;
  smileColor?: THREE.ColorRepresentation;
  blush?: THREE.ColorRepresentation | null;
  blushSize?: number;
  /** Eyes sit on the sides of the head (fish, dinos) when > 0 (radians outward). */
  sideAngle?: number;
  lidColor?: THREE.ColorRepresentation;
}

/**
 * Big friendly eyes with a sparkle highlight, an optional smile and blush.
 * Returns a Face helper that can blink and glance.
 */
export class Face {
  readonly group = new THREE.Group();
  readonly eyes: Eye[] = [];
  smile: THREE.Mesh | null = null;
  private blinkT = 0;
  private nextBlink = 1 + Math.random() * 3;
  private happyT = 0;
  readonly opts: FaceOptions;

  constructor(o: FaceOptions = {}) {
    this.opts = o;
    const size = o.eyeSize ?? 0.12;
    const spacing = o.spacing ?? size * 2.3;
    const ey = o.eyeY ?? 0;
    const ez = o.eyeZ ?? 0;
    const white = mat(o.white ?? 0xfbf8f1, { rough: 0.35 });
    const pupilM = mat(o.pupilColor ?? 0x2b2f36, { rough: 0.3 });
    const shine = mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.6, rough: 0.2 });
    const lidM = o.lidColor !== undefined ? mat(o.lidColor) : null;
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const ang = (o.sideAngle ?? 0) * side;
      g.position.set(Math.sin(ang) * 0 + (side * spacing) / 2, ey, ez);
      g.rotation.y = ang;
      const sclera = part(geo.sphere(20), white, [0, 0, 0], [size, size * 1.08, size * 0.75], [0, 0, 0], false);
      const pupilG = new THREE.Group();
      const pupil = part(geo.sphere(16), pupilM, [0, 0, size * 0.55], [size * 0.58, size * 0.66, size * 0.4], [0, 0, 0], false);
      const hl = part(geo.sphere(8), shine, [-size * 0.2, size * 0.25, size * 0.82], size * 0.18, [0, 0, 0], false);
      pupilG.add(pupil, hl);
      g.add(sclera, pupilG);
      let lid: THREE.Mesh | null = null;
      if (lidM) {
        lid = part(geo.sphere(16), lidM, [0, size * 0.05, 0], [size * 1.08, size * 1.12, size * 0.8], [0, 0, 0], false);
        lid.scale.y = 0.001;
        g.add(lid);
      }
      this.group.add(g);
      this.eyes.push({ group: g, pupil: pupilG, lid });
    }
    if (o.smile !== false) {
      const w = o.smileWidth ?? spacing * 0.55;
      const sm = new THREE.Mesh(geo.torus(0.22, Math.PI, 16), mat(o.smileColor ?? 0x3b3236, { rough: 0.5 }));
      sm.scale.set(w, w * 0.85, w * 0.6);
      sm.rotation.z = Math.PI;
      sm.position.set(0, o.smileY ?? ey - size * 1.5, ez + size * 0.15);
      this.smile = sm;
      this.group.add(sm);
    }
    if (o.blush !== null) {
      const bm = mat(o.blush ?? 0xeab0a6, { rough: 0.9, transparent: true, opacity: 0.75 });
      const bs = o.blushSize ?? size * 0.55;
      for (const side of [-1, 1]) {
        const b = part(geo.sphere(12), bm, [side * spacing * 0.78, ey - size * 1.05, ez - size * 0.1], [bs, bs * 0.6, bs * 0.3], [0, 0, 0], false);
        this.group.add(b);
      }
    }
  }

  /** Make the face beam (eyes squint into happy arcs) for `dur` seconds. */
  beam(dur = 1.2): void {
    this.happyT = dur;
  }

  /** Point pupils towards a local-space direction (x right, y up), each in -1..1. */
  glance(x: number, y: number): void {
    const s = this.opts.eyeSize ?? 0.12;
    for (const e of this.eyes) {
      e.pupil.position.x = THREE.MathUtils.clamp(x, -1, 1) * s * 0.28;
      e.pupil.position.y = THREE.MathUtils.clamp(y, -1, 1) * s * 0.25;
    }
  }

  update(dt: number): void {
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blinkT = 0.14;
      this.nextBlink = 2 + Math.random() * 3.5;
    }
    let close = 0;
    if (this.blinkT > 0) {
      this.blinkT -= dt;
      close = Math.sin((1 - this.blinkT / 0.14) * Math.PI);
    }
    if (this.happyT > 0) {
      this.happyT -= dt;
      close = Math.max(close, 0.65);
    }
    for (const e of this.eyes) {
      if (e.lid) e.lid.scale.y = Math.max(0.001, close) * (this.opts.eyeSize ?? 0.12) * 1.12;
      else e.group.scale.y = 1 - close * 0.85;
    }
    if (this.smile) {
      const s = this.happyT > 0 ? 1.25 : 1;
      this.smile.scale.y = THREE.MathUtils.lerp(this.smile.scale.y, (this.opts.smileWidth ?? 0.15) * 0.85 * s, 0.2);
    }
  }
}

// ------------------------------------------------------------- utilities

/** Merge every static mesh in a group by material to cut draw calls. */
export function mergeStatic(group: THREE.Object3D, castShadow = true, receiveShadow = true): THREE.Group {
  group.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const g = m.geometry.clone();
    // Normalise attributes so geometries are mergeable.
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    }
    if (!g.attributes.color) {
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3).fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const ng = g.index ? g.toNonIndexed() : g;
    ng.applyMatrix4(m.matrixWorld);
    const list = byMat.get(m.material as THREE.Material) ?? [];
    list.push(ng);
    byMat.set(m.material as THREE.Material, list);
  });
  const out = new THREE.Group();
  for (const [m, list] of byMat) {
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    out.add(mesh);
  }
  return out;
}

/** Soft blob shadow for small things (cheaper and cuter than real shadows). */
let blobTex: THREE.Texture | null = null;
export function blobShadow(radius: number, opacity = 0.28): THREE.Mesh {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    grd.addColorStop(0, 'rgba(30,40,40,1)');
    grd.addColorStop(1, 'rgba(30,40,40,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

/** Recursively dispose geometries/materials that are not in the shared caches. */
export function disposeTree(root: THREE.Object3D): void {
  const shared = new Set<unknown>([...geoCache.values(), ...matCache.values()]);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose();
    const mm = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mm) {
      for (const x of Array.isArray(mm) ? mm : [mm]) {
        if (!shared.has(x)) x.dispose();
      }
    }
  });
}

/** Simple stripe/spot canvas texture for balls and props. */
export function stripeTexture(base: string, stripe: string, stripes = 2, size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size * 2;
  c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = stripe;
  const h = size / (stripes * 2 + 1);
  for (let i = 0; i < stripes; i++) g.fillRect(0, h * (1 + i * 2), c.width, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
