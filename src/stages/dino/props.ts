import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { geo, mat, part } from '../../kit/kit';
import type { Rng } from '../../core/math';
import { bakeLocalGeometry } from './bake';

// Dino Valley palette: warm sunlit sandstone, sage and moss greens, with
// restrained terracotta / peach / butter accents.
export const P = {
  grass: 0xa2b47c,
  grassDeep: 0x8aa169,
  grassLight: 0xb8c08a,
  moss: 0x86a06a,
  path: 0xe6d3a9,
  sand: 0xe4cfa2,
  cliffSand: 0xe5c99c,
  cliffOchre: 0xd7ab73,
  cliffPeach: 0xe2ae8a,
  cliffTerra: 0xc98c68,
  cliffCream: 0xf0ddb9,
  trunk: 0x9a7759,
  trunkDark: 0x7f6249,
  leafA: 0x8aa46d,
  leafB: 0x9db47a,
  leafC: 0x7b955f,
  leafD: 0xb2bf86,
  fernA: 0x88a467,
  fernB: 0x9fb879,
  fernC: 0x6f8c58,
  water: 0x8fc4c1,
  stone: 0xcdbfa6,
  stoneDark: 0xb3a386,
  terra: 0xd98b6a,
  peach: 0xeeb48f,
  butter: 0xefd08a,
  cream: 0xf6ecd8,
  twig: 0xa98560,
  straw: 0xe3cb92,
  amber: 0xf0a94a,
};

const c = (hex: number) => new THREE.Color(hex);

// ------------------------------------------------------------------ fronds

/**
 * One fern frond as a serrated, gently arching strip along +Z with a soft
 * colour gradient (darker at the stem, lighter at the tip).
 */
export function frondGeometry(len: number, width: number, up: number, droop: number, base: number, tip: number, segs = 12): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const cb = c(base);
  const ct = c(tip);
  const rows: { l: THREE.Vector3; m: THREE.Vector3; r: THREE.Vector3; col: THREE.Color }[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const y = up * t - droop * t * t;
    const z = len * t;
    const serr = i % 2 === 0 ? 1 : 0.5;
    const w = width * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02 + 0.02)), 0.7) * (i === 0 || i === segs ? 0.15 : serr);
    rows.push({
      l: new THREE.Vector3(-w, y - w * 0.18, z),
      m: new THREE.Vector3(0, y + w * 0.12, z),
      r: new THREE.Vector3(w, y - w * 0.18, z),
      col: cb.clone().lerp(ct, t),
    });
  }
  const push = (v: THREE.Vector3, cc: THREE.Color) => {
    pos.push(v.x, v.y, v.z);
    col.push(cc.r, cc.g, cc.b);
  };
  for (let i = 0; i < segs; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    push(a.l, a.col); push(b.l, b.col); push(a.m, a.col);
    push(a.m, a.col); push(b.l, b.col); push(b.m, b.col);
    push(a.m, a.col); push(b.m, b.col); push(a.r, a.col);
    push(a.r, a.col); push(b.m, b.col); push(b.r, b.col);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A rosette of fronds radiating from the origin. */
export function frondRosette(rng: Rng, n: number, o: { len: number; width: number; up: number; droop: number; tilt: number; base: number; tip: number; y?: number }): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const len = o.len * rng.range(0.8, 1.1);
    const f = frondGeometry(len, o.width, o.up * rng.range(0.85, 1.15), o.droop * rng.range(0.85, 1.2), o.base, o.tip);
    f.rotateX(-o.tilt * rng.range(0.8, 1.2));
    f.rotateY((i / n) * Math.PI * 2 + rng.range(-0.25, 0.25));
    f.translate(0, o.y ?? 0, 0);
    list.push(f);
  }
  const g = mergeGeometries(list, false)!;
  for (const x of list) x.dispose();
  return g;
}

/** Ground fern (giant when scaled). */
export function fernGeometry(rng: Rng): THREE.BufferGeometry {
  const a = frondRosette(rng, 9, { len: 1.5, width: 0.22, up: 0.9, droop: 1.05, tilt: 0.25, base: P.fernC, tip: P.fernB });
  const b = frondRosette(rng, 5, { len: 1.0, width: 0.17, up: 0.85, droop: 0.5, tilt: 0.05, base: P.fernC, tip: P.leafD });
  const g = mergeGeometries([a, b], false)!;
  return g;
}

/** Cycad: chunky, banded trunk with a crown of stiff fronds. */
export function cycadGeometry(rng: Rng): THREE.BufferGeometry {
  const grp = new THREE.Group();
  const h = 1.6;
  const bark = mat(0xa58663);
  const barkD = mat(0x947656);
  grp.add(part(geo.cyl(0.8, 1, 10), bark, [0, h / 2, 0], [0.27, h, 0.27]));
  for (let i = 0; i < 6; i++) grp.add(part(geo.torus(0.22, Math.PI * 2, 10), barkD, [0, 0.12 + i * 0.25, 0], [0.26 - i * 0.012, 0.26 - i * 0.012, 0.14], [Math.PI / 2, 0, 0]));
  grp.add(part(geo.sphere(10), mat(0x9a8a55), [0, h + 0.02, 0], [0.24, 0.16, 0.24]));
  const trunk = bakeLocalGeometry(grp);
  const crown = frondRosette(rng, 14, { len: 2.0, width: 0.17, up: 1.25, droop: 0.8, tilt: 0.3, base: 0x6f8f57, tip: 0xa7bb7c, y: h });
  return mergeGeometries([trunk, crown], false)!;
}

/** Tree fern: tall slender, slightly curving trunk and a drooping crown. */
export function treeFernGeometry(rng: Rng, h: number): THREE.BufferGeometry {
  const grp = new THREE.Group();
  const bark = mat(0x8a6f55);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const x = Math.sin(t0 * 1.6) * 0.25;
    grp.add(part(geo.cyl(0.9, 1, 8), bark, [x, (i + 0.5) * (h / n), 0], [0.2 - t0 * 0.03, h / n + 0.05, 0.2 - t0 * 0.03]));
  }
  grp.add(part(geo.sphere(8), mat(0x7a6a45), [Math.sin(1.6) * 0.25, h, 0], [0.26, 0.2, 0.26]));
  const trunk = bakeLocalGeometry(grp);
  const crown = frondRosette(rng, 11, { len: 2.3, width: 0.3, up: 0.8, droop: 1.9, tilt: 0.15, base: 0x6c8a55, tip: 0xa2b97a, y: h });
  crown.translate(Math.sin(1.6) * 0.25, 0, 0);
  const crown2 = frondRosette(rng, 5, { len: 1.3, width: 0.2, up: 1.0, droop: 0.6, tilt: 0.05, base: 0x6c8a55, tip: 0xb3c288, y: h });
  crown2.translate(Math.sin(1.6) * 0.25, 0, 0);
  return mergeGeometries([trunk, crown, crown2], false)!;
}

/** Horsetail clump (little segmented reeds). */
export function horsetailGeometry(rng: Rng): THREE.BufferGeometry {
  const grp = new THREE.Group();
  const m = mat(0x8fa56a);
  const ring = mat(0x6f8452);
  for (let i = 0; i < 6; i++) {
    const x = rng.range(-0.25, 0.25);
    const z = rng.range(-0.25, 0.25);
    const h = rng.range(0.5, 1.0);
    grp.add(part(geo.cyl(0.7, 1, 5), m, [x, h / 2, z], [0.035, h, 0.035]));
    for (let k = 1; k < 4; k++) grp.add(part(geo.cyl(1, 1, 5), ring, [x, (h * k) / 4, z], [0.045, 0.03, 0.045]));
    grp.add(part(geo.cone(5), mat(0xb5a36e), [x, h + 0.06, z], [0.04, 0.12, 0.04]));
  }
  return bakeLocalGeometry(grp);
}

// ------------------------------------------------------------------ trees

/** Chunky, mossy round-canopy tree (static, merged later). */
export function mossyTree(rng: Rng, s = 1, fruit = false): THREE.Group {
  const g = new THREE.Group();
  const trunkH = rng.range(2.6, 3.6);
  const bark = mat(P.trunk, { rough: 0.95 });
  g.add(part(geo.cyl(0.62, 1, 10), bark, [0, trunkH / 2, 0], [0.42, trunkH, 0.42]));
  // Root flare.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng.range(0, 0.5);
    g.add(part(geo.sphere(8), bark, [Math.cos(a) * 0.35, 0.15, Math.sin(a) * 0.35], [0.28, 0.3, 0.18], [0, -a, 0]));
  }
  // A couple of chunky boughs.
  g.add(part(geo.cyl(0.6, 1, 8), bark, [0.45, trunkH - 0.2, 0], [0.16, 1.4, 0.16], [0, 0, -0.8]));
  g.add(part(geo.cyl(0.6, 1, 8), bark, [-0.4, trunkH - 0.1, 0.2], [0.14, 1.2, 0.14], [0.3, 0, 0.75]));
  const leaves = [mat(P.leafA, { rough: 0.95 }), mat(P.leafB, { rough: 0.95 }), mat(P.leafC, { rough: 0.95 })];
  const n = rng.int(4, 6);
  const blobs: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(0, 1);
    const r = i === 0 ? 0 : rng.range(0.9, 1.4);
    const sz = i === 0 ? rng.range(1.7, 2.0) : rng.range(1.0, 1.4);
    const p: [number, number, number, number] = [Math.cos(a) * r, trunkH + 0.9 + (i === 0 ? 0.6 : rng.range(-0.3, 0.4)), Math.sin(a) * r, sz];
    blobs.push(p);
    g.add(part(geo.ico(1), leaves[i % 3], [p[0], p[1], p[2]], [sz, sz * 0.82, sz]));
  }
  // Moss caps on top of the canopy (lighter, soft).
  const mossM = mat(P.leafD, { rough: 1 });
  for (let i = 0; i < 3; i++) {
    const b = blobs[i % blobs.length];
    g.add(part(geo.ico(1), mossM, [b[0] * 0.8, b[1] + b[3] * 0.55, b[2] * 0.8], [b[3] * 0.55, b[3] * 0.3, b[3] * 0.55]));
  }
  if (fruit) {
    const fm = mat(P.peach, { rough: 0.6 });
    for (let i = 0; i < 7; i++) {
      const b = blobs[rng.int(0, blobs.length - 1)];
      const a = rng.range(0, Math.PI * 2);
      g.add(part(geo.sphere(10), fm, [b[0] + Math.cos(a) * b[3] * 0.9, b[1] - b[3] * 0.3, b[2] + Math.sin(a) * b[3] * 0.9], 0.18));
    }
  }
  g.scale.setScalar(s);
  return g;
}

/** Monkey-puzzle style conifer with tiered whorls - a prehistoric silhouette. */
export function araucaria(rng: Rng, s = 1): THREE.Group {
  const g = new THREE.Group();
  const h = rng.range(7.5, 10);
  const bark = mat(0x8e7157, { rough: 0.95 });
  g.add(part(geo.cyl(0.55, 1, 8), bark, [0, h / 2, 0], [0.32, h, 0.32]));
  const tiers = rng.int(4, 5);
  const greens = [mat(0x6f8b5c, { rough: 0.95 }), mat(0x7f9965, { rough: 0.95 }), mat(0x8ea56f, { rough: 0.95 })];
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const y = h * (0.55 + t * 0.45);
    const r = 2.3 - t * 1.4 + rng.range(-0.2, 0.2);
    g.add(part(geo.sphere(12), greens[i % 3], [0, y, 0], [r, 0.5, r]));
    // Little branch tufts poking out.
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + rng.range(0, 1);
      g.add(part(geo.sphere(8), greens[(i + 1) % 3], [Math.cos(a) * r * 0.85, y - 0.1, Math.sin(a) * r * 0.85], [0.5, 0.35, 0.5]));
    }
  }
  g.add(part(geo.sphere(10), greens[2], [0, h + 0.35, 0], [0.6, 0.6, 0.6]));
  g.scale.setScalar(s);
  return g;
}

export function boulder(rng: Rng, s: number, col?: number): THREE.Mesh {
  const m = part(geo.dodec(), mat(col ?? rng.pick([P.stone, P.cliffSand, P.stoneDark, P.cliffOchre]), { rough: 0.95 }), [0, s * 0.35, 0], [s * rng.range(0.9, 1.3), s * rng.range(0.55, 0.8), s * rng.range(0.9, 1.2)], [rng.range(0, 1), rng.range(0, 6), rng.range(0, 0.4)]);
  return m;
}

/** Sandstone arch made of chunky stacked stones. */
export function rockArch(rng: Rng, span: number, height: number): THREE.Group {
  const g = new THREE.Group();
  const cols = [P.cliffSand, P.cliffOchre, P.cliffPeach, P.cliffCream];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = Math.PI * (1 - t);
    const x = Math.cos(a) * span;
    const y = Math.sin(a) * height;
    const sz = 1.25 + Math.sin(t * Math.PI) * -0.2 + rng.range(-0.1, 0.15);
    g.add(part(geo.box(0.18), mat(cols[i % cols.length], { rough: 0.95 }), [x, y + 0.4, 0], [sz * 1.25, sz * 1.1, 1.7 + rng.range(-0.15, 0.2)], [0, rng.range(-0.15, 0.15), a - Math.PI / 2]));
  }
  // Moss on top and boulders at the feet.
  g.add(part(geo.sphere(10), mat(P.moss, { rough: 1 }), [0, height + 1.05, 0], [1.4, 0.3, 0.9]));
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const b = boulder(rng, rng.range(0.8, 1.3));
      b.position.x = sx * (span + rng.range(0.7, 1.4));
      b.position.z = rng.range(-1.2, 1.2);
      g.add(b);
    }
  }
  return g;
}

/** Big twig nest with a soft straw lining. Radius ~r. */
export function bigNest(rng: Rng, r: number): THREE.Group {
  const g = new THREE.Group();
  const twig = mat(P.twig, { rough: 0.95 });
  const twigD = mat(0x8c6c4c, { rough: 0.95 });
  const twigL = mat(0xc4a076, { rough: 0.95 });
  // Woven rim: overlapping rings of twigs laid around the edge at a few heights.
  g.add(part(geo.torus(0.09, Math.PI * 2, 36), twigD, [0, 0.28, 0], [r * 1.02, r * 1.02, r * 2.2], [Math.PI / 2, 0, 0]));
  for (let layer = 0; layer < 4; layer++) {
    const n = 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + layer * 0.37 + rng.range(-0.05, 0.05);
      const rr = r * (1.0 + (layer % 2) * 0.06) + rng.range(-0.08, 0.08);
      const y = 0.2 + layer * 0.17 + rng.range(-0.04, 0.04);
      const len = rng.range(1.0, 1.5);
      const m = [twig, twigD, twigL][(i + layer) % 3];
      const tw = part(geo.cyl(1, 1, 5), m, [Math.cos(a) * rr, y, Math.sin(a) * rr], [0.06, len, 0.06], [0, 0, 0]);
      // Lay the twig along the rim tangent with a little tilt.
      tw.rotation.set(0, -a, Math.PI / 2 + rng.range(-0.35, 0.35));
      g.add(tw);
    }
  }
  g.add(part(geo.sphere(24), mat(P.straw, { rough: 1 }), [0, 0.04, 0], [r * 0.95, 0.22, r * 0.95]));
  // A few stray twigs poking out.
  for (let i = 0; i < 14; i++) {
    const a = rng.range(0, Math.PI * 2);
    const tw = part(geo.cyl(1, 1, 5), twig, [Math.cos(a) * r * 1.15, 0.2, Math.sin(a) * r * 1.15], [0.045, rng.range(0.7, 1.1), 0.045]);
    tw.rotation.set(0, -a + rng.range(-0.6, 0.6), Math.PI / 2 + rng.range(-0.3, 0.3));
    g.add(tw);
  }
  // Soft feathers tucked in the rim.
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, Math.PI * 2);
    g.add(part(geo.sphere(8), mat(i % 2 ? P.peach : P.cream, { rough: 0.9 }), [Math.cos(a) * r * 0.98, 0.85, Math.sin(a) * r * 0.98], [0.08, 0.05, 0.35], [rng.range(-0.4, 0.4), -a, 0.5]));
  }
  return g;
}

/** Giant mushroom with a flat, walkable cap. */
export function giantMushroom(h: number, r: number, cap = P.terra): THREE.Group {
  const g = new THREE.Group();
  g.add(part(geo.cyl(0.8, 1, 14), mat(0xf1e4c8), [0, h / 2, 0], [r * 0.28, h, r * 0.28]));
  g.add(part(geo.sphere(20), mat(cap, { rough: 0.75 }), [0, h, 0], [r, r * 0.42, r]));
  g.add(part(geo.cyl(1, 1, 20), mat(0xeedcbc), [0, h - 0.05, 0], [r * 0.92, 0.1, r * 0.92]));
  const spot = mat(0xf6ecd8, { rough: 0.8 });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const rr = r * 0.62;
    g.add(part(geo.sphere(8), spot, [Math.cos(a) * rr, h + r * 0.3, Math.sin(a) * rr], [r * 0.14, r * 0.05, r * 0.14], [Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4]));
  }
  return g;
}

export function stump(h: number, r: number): THREE.Group {
  const g = new THREE.Group();
  g.add(part(geo.cyl(0.92, 1, 14), mat(P.trunk, { rough: 0.95 }), [0, h / 2, 0], [r, h, r]));
  g.add(part(geo.cyl(1, 1, 14), mat(0xe2c79c), [0, h + 0.01, 0], [r * 0.9, 0.04, r * 0.9]));
  g.add(part(geo.torus(0.12, Math.PI * 2, 18), mat(0xc9a77a), [0, h + 0.03, 0], [r * 0.55, r * 0.55, 1], [Math.PI / 2, 0, 0]));
  g.add(part(geo.sphere(8), mat(P.moss, { rough: 1 }), [r * 0.6, h * 0.6, r * 0.6], [r * 0.4, h * 0.25, r * 0.3]));
  return g;
}

/** Hollow log lying along X (the peeker hides inside). */
export function hollowLog(len: number, r: number): THREE.Group {
  const g = new THREE.Group();
  const bark = mat(P.trunkDark, { rough: 0.95 });
  g.add(part(geo.cyl(1, 1, 16), bark, [0, r, 0], [r, len, r], [0, 0, Math.PI / 2]));
  g.add(part(geo.torus(0.18, Math.PI * 2, 18), mat(P.trunk), [len / 2, r, 0], [r * 0.9, r * 0.9, r * 0.9], [0, Math.PI / 2, 0]));
  g.add(part(geo.cyl(1, 1, 16), mat(0x3f3430, { rough: 1 }), [len / 2 + 0.01, r, 0], [r * 0.78, 0.02, r * 0.78], [0, 0, Math.PI / 2], false));
  const moss = mat(P.moss, { rough: 1 });
  for (let i = 0; i < 5; i++) g.add(part(geo.sphere(8), moss, [-len / 2 + 0.5 + i * (len - 1) / 4, r * 1.9, (i % 2 ? 0.1 : -0.1)], [0.3, 0.1, 0.25]));
  g.add(part(geo.cyl(1, 1, 8), mat(0xf1e4c8), [-len / 2 + 0.6, r * 2 + 0.12, 0.15], [0.04, 0.24, 0.04]));
  g.add(part(geo.sphere(10), mat(P.butter), [-len / 2 + 0.6, r * 2 + 0.25, 0.15], [0.14, 0.07, 0.14]));
  return g;
}

/** Flat stepping stone (top at y=0). */
export function steppingStone(rng: Rng, r: number): THREE.Mesh {
  return part(geo.sphere(12), mat(rng.pick([P.stone, P.stoneDark, P.cliffSand]), { rough: 0.9 }), [0, -0.12, 0], [r, 0.28, r * rng.range(0.8, 1)]);
}

// ---------------------------------------------------------------- pickups

export function eggModel(spots = P.peach, base = P.cream): THREE.Group {
  const g = new THREE.Group();
  g.add(part(geo.sphere(20), mat(base, { rough: 0.55, emissive: base, emissiveIntensity: 0.08 }), [0, 0, 0], [0.26, 0.34, 0.26]));
  const sm = mat(spots, { rough: 0.6 });
  const pts: [number, number][] = [[0.3, 0.1], [1.6, 0.25], [2.8, -0.05], [4.2, 0.3], [5.3, -0.2], [0.9, -0.3], [3.6, -0.35]];
  for (const [a, y] of pts) {
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    const yy = y * 0.34;
    const rad = Math.sqrt(Math.max(0.0, 1 - (yy / 0.34) ** 2)) * 0.26;
    g.add(part(geo.sphere(8), sm, [nx * rad * 0.97, yy, nz * rad * 0.97], [0.05, 0.05, 0.05], [0, 0, 0], false));
  }
  return g;
}

export function gemModel(): THREE.Group {
  const g = new THREE.Group();
  const m = mat(P.amber, { rough: 0.25, metal: 0.1, emissive: 0xd07a28, emissiveIntensity: 0.45 });
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.26, 6), m);
  top.position.y = 0.13;
  const bot = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.4, 6), m);
  bot.rotation.x = Math.PI;
  bot.position.y = -0.2;
  top.castShadow = bot.castShadow = true;
  g.add(top, bot);
  g.add(part(geo.sphere(8), mat(0xfff3d6, { emissive: 0xffe9c0, emissiveIntensity: 0.8 }), [-0.07, 0.12, 0.12], [0.04, 0.06, 0.03], [0, 0, 0], false));
  return g;
}

/** Plump fern fruit pod for the Fern Fruit Pop course. */
export function fruitPodModel(i: number): THREE.Group {
  const g = new THREE.Group();
  const cols = [P.peach, P.butter, 0xe79a7e, 0xf0c48a];
  const m = mat(cols[i % cols.length], { rough: 0.45, emissive: cols[i % cols.length], emissiveIntensity: 0.12 });
  g.add(part(geo.sphere(20), m, [0, 0, 0], [0.36, 0.42, 0.36]));
  // Soft segments.
  const seg = mat(new THREE.Color(cols[i % cols.length]).multiplyScalar(0.88), { rough: 0.5 });
  for (let k = 0; k < 4; k++) g.add(part(geo.sphere(10), seg, [0, 0, 0], [0.05, 0.4, 0.37], [0, (k / 4) * Math.PI, 0], false));
  // Leafy cap + stem.
  const leaf = mat(P.fernA, { rough: 0.8 });
  for (let k = 0; k < 4; k++) g.add(part(geo.sphere(8), leaf, [Math.cos(k * 1.57) * 0.14, 0.38, Math.sin(k * 1.57) * 0.14], [0.16, 0.05, 0.08], [0, -k * 1.57, 0.4], false));
  g.add(part(geo.cyl(1, 1, 5), mat(0x7f9a5e), [0, 0.65, 0], [0.025, 0.5, 0.025], [0, 0, 0], false));
  g.add(part(geo.sphere(8), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.5 }), [-0.13, 0.15, 0.28], [0.06, 0.09, 0.04], [0, 0, 0], false));
  return g;
}

/** Warm steam vent ring of pebbles. */
export function ventRing(rng: Rng): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const b = boulder(rng, rng.range(0.3, 0.5), rng.pick([P.stoneDark, P.cliffTerra, P.stone]));
    b.position.set(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7);
    g.add(b);
  }
  g.add(part(geo.cyl(1, 1, 14), mat(0x8f7a66), [0, 0.03, 0], [0.55, 0.05, 0.55]));
  return g;
}

/** Wooden signpost with a canvas label. */
export function signpost(text: string, color = '#5b4a40'): THREE.Group {
  const g = new THREE.Group();
  g.add(part(geo.box(0.1), mat(P.trunk), [0, 0.75, 0], [0.14, 1.5, 0.14]));
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 96;
  const x = cv.getContext('2d')!;
  x.fillStyle = '#f2e4c6';
  x.fillRect(0, 0, 256, 96);
  x.strokeStyle = '#c9a982';
  x.lineWidth = 8;
  x.strokeRect(4, 4, 248, 88);
  x.fillStyle = color;
  x.font = '600 38px Fredoka, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  g.add(part(geo.box(0.03), mat(0xd8bf95), [0, 1.45, 0], [1.36, 0.54, 0.08]));
  const label = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  label.position.set(0, 1.45, 0.045);
  g.add(label);
  return g;
}

/** Soft water texture: pale streaks for the river and waterfall. */
export function waterTexture(streak: string, base: string, vertical = false): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 128;
  const x = cv.getContext('2d')!;
  x.fillStyle = base;
  x.fillRect(0, 0, 128, 128);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    x.fillStyle = streak;
    x.globalAlpha = 0.25 + rnd() * 0.45;
    const px = rnd() * 128;
    const py = rnd() * 128;
    const len = 18 + rnd() * 40;
    const w = 2 + rnd() * 4;
    x.beginPath();
    if (vertical) x.ellipse(px, py, w, len, 0, 0, Math.PI * 2);
    else x.ellipse(px, py, len, w, 0, 0, Math.PI * 2);
    x.fill();
    // Wrap copies so it tiles.
    x.beginPath();
    if (vertical) x.ellipse(px, py - 128, w, len, 0, 0, Math.PI * 2);
    else x.ellipse(px - 128, py, len, w, 0, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
