import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { geo, mat, part } from '../../kit/kit';

// Draw-call savers for Frosty Peaks. Creatures and props are modelled with the
// shared kit primitives, then every rigid piece is "baked" into one
// vertex-coloured mesh so a whole penguin is a handful of draws, not thirty.

const tmpM = new THREE.Matrix4();

/** Merge every mesh under `src` into one vertex-coloured geometry, in src's local frame. */
export function bakeGeometry(src: THREE.Object3D): THREE.BufferGeometry {
  src.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
  const list: THREE.BufferGeometry[] = [];
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (g.index) g = g.toNonIndexed();
    const c = ((m.material as THREE.MeshStandardMaterial).color ?? new THREE.Color(1, 1, 1)) as THREE.Color;
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    tmpM.multiplyMatrices(inv, m.matrixWorld);
    g.applyMatrix4(tmpM);
    list.push(g);
  });
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return merged ?? new THREE.BufferGeometry();
}

export interface BakeOptions {
  rough?: number;
  shadow?: boolean;
  receive?: boolean;
  emissive?: number;
  emissiveIntensity?: number;
}

/** Bake a group of kit parts into a single mesh with a shared vertex-colour material. */
export function bake(src: THREE.Object3D, o: BakeOptions = {}): THREE.Mesh {
  const m = mat(0xffffff, { vertexColors: true, rough: o.rough ?? 0.88, emissive: o.emissive, emissiveIntensity: o.emissiveIntensity });
  const mesh = new THREE.Mesh(bakeGeometry(src), m);
  mesh.castShadow = o.shadow ?? false;
  mesh.receiveShadow = o.receive ?? true;
  return mesh;
}

/** Group helper: build parts into a temp group then bake. */
export function bakeParts(build: (g: THREE.Group) => void, o: BakeOptions = {}): THREE.Mesh {
  const g = new THREE.Group();
  build(g);
  return bake(g, o);
}

export interface EyeOptions {
  size: number;
  spacing: number;
  y: number;
  z: number;
  /** Outward rotation for side-set eyes. */
  side?: number;
  /** Draw a white sclera (big friendly eyes); otherwise glossy bead eyes. */
  sclera?: boolean;
  pupil?: number;
  /** Optional eyelash flick (Woolly). */
  lashes?: number;
}

/**
 * Cute eyes baked into one mesh: sclera, pupil and a sparkle highlight.
 * Blinks by squashing the mesh vertically about the eye line, and squints
 * happily with beam(). Same look as kit Face, a fraction of the draws.
 */
export class CuteEyes {
  readonly mesh: THREE.Mesh;
  private blinkT = 0;
  private nextBlink = 1 + Math.random() * 3;
  private happyT = 0;
  private sleepy = 0;
  /** 0 = open, 1 = closed (sleeping creatures). */
  closed = 0;

  constructor(o: EyeOptions) {
    const g = new THREE.Group();
    const s = o.size;
    const white = mat(0xfbf8f1);
    const pupil = mat(o.pupil ?? 0x2b2f3a);
    const shine = mat(0xffffff);
    for (const side of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set((side * o.spacing) / 2, 0, 0);
      e.rotation.y = (o.side ?? 0) * side;
      if (o.sclera) {
        e.add(part(geo.sphere(16), white, [0, 0, 0], [s, s * 1.08, s * 0.75]));
        e.add(part(geo.sphere(14), pupil, [0, 0, s * 0.55], [s * 0.6, s * 0.68, s * 0.4]));
        e.add(part(geo.sphere(8), shine, [-s * 0.2, s * 0.26, s * 0.86], s * 0.2));
        e.add(part(geo.sphere(6), shine, [s * 0.18, -s * 0.2, s * 0.82], s * 0.09));
      } else {
        e.add(part(geo.sphere(14), pupil, [0, 0, 0], [s, s * 1.12, s * 0.7]));
        e.add(part(geo.sphere(8), shine, [-s * 0.32, s * 0.38, s * 0.6], s * 0.3));
        e.add(part(geo.sphere(6), shine, [s * 0.3, -s * 0.3, s * 0.6], s * 0.13));
      }
      if (o.lashes) {
        for (let k = 0; k < 3; k++) {
          e.add(part(geo.capsule(1, 6), pupil, [side * (s * 0.55 + k * s * 0.18), s * (0.85 - k * 0.12), s * 0.2], [s * 0.07, s * o.lashes * 0.18, s * 0.07], [0, 0, side * (-0.6 - k * 0.35)]));
        }
      }
      g.add(e);
    }
    this.mesh = new THREE.Mesh(bakeGeometry(g), mat(0xffffff, { vertexColors: true, rough: 0.3 }));
    this.mesh.position.set(0, o.y, o.z);
    this.mesh.castShadow = false;
  }

  beam(dur = 1.2): void {
    this.happyT = Math.max(this.happyT, dur);
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
      close = Math.sin((1 - Math.max(0, this.blinkT) / 0.14) * Math.PI);
    }
    if (this.happyT > 0) {
      this.happyT -= dt;
      close = Math.max(close, 0.62);
    }
    this.sleepy += (this.closed - this.sleepy) * Math.min(1, dt * 6);
    close = Math.max(close, this.sleepy * 0.92);
    this.mesh.scale.y = 1 - close * 0.88;
  }
}
