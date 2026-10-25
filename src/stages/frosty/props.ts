import * as THREE from 'three';
import { geo, mat, matUnique, part } from '../../kit/kit';
import type { Rng } from '../../core/math';
import { bake } from './bake';

// Frosty Peaks props: snow-dusted pines, block igloos, the ice arch, snowmen,
// hats for the Hat Toss, ice crystals, ice lanterns, far mountains and the aurora.

export const P = {
  snow: 0xf6f3f6,
  snowShade: 0xd9d5ea,
  snowWarm: 0xfbeee7,
  path: 0xe7e1e8,
  ice: 0xc6dceb,
  iceDeep: 0xa3c3d9,
  water: 0x86a9c2,
  pineA: 0x6e8f8c,
  pineB: 0x7f9d95,
  pineC: 0x8aa69c,
  trunk: 0x8f7263,
  igloo: 0xf4f3f8,
  iglooShade: 0xe3e3f0,
  warm: 0xf7c99c,
  peach: 0xf0b48a,
  coral: 0xe7a08e,
  lilac: 0xc9b9dd,
  blue: 0xa4c0da,
  teal: 0x8fbcb8,
  coal: 0x4b4b57,
  carrot: 0xeea46e,
  rock: 0xb3b1c6,
  wood: 0xc39f84,
  woodDark: 0x9f7f69,
};

// ------------------------------------------------------------------ pines

/** A rounded, snow-dusted pine. `snowy` adds heavier snow on the tiers. */
export function pine(rng: Rng, scale = 1, snowy = 0.6): THREE.Group {
  const g = new THREE.Group();
  const tiers = rng.int(3, 4);
  const greens = [P.pineA, P.pineB, P.pineC];
  const green = mat(rng.pick(greens), { rough: 0.95 });
  const snow = mat(P.snow, { rough: 0.9 });
  g.add(part(geo.cyl(0.75, 1, 8), mat(P.trunk, { rough: 0.95 }), [0, 0.45, 0], [0.22, 0.9, 0.22]));
  let y = 0.75;
  let rad = 1.55;
  for (let i = 0; i < tiers; i++) {
    const h = 1.35 - i * 0.12;
    g.add(part(geo.cone(12), green, [0, y + h / 2, 0], [rad, h, rad], [0, rng.range(0, 3), 0]));
    // Rounded lower rim (soft pine look).
    g.add(part(geo.sphere(12), green, [0, y + 0.1, 0], [rad * 0.92, 0.22, rad * 0.92]));
    // Snow resting on each tier.
    const sr = rad * (0.55 + snowy * 0.2);
    g.add(part(geo.cone(12), snow, [0, y + h * 0.62, 0], [sr, h * 0.5, sr], [0, rng.range(0, 3), 0]));
    g.add(part(geo.sphere(10), snow, [0, y + h * 0.38, 0], [sr * 1.02, 0.13 + snowy * 0.06, sr * 1.02]));
    y += h * 0.62;
    rad *= 0.74;
  }
  g.add(part(geo.sphere(10), snow, [0, y + 0.55, 0], [0.22, 0.26, 0.22]));
  g.scale.setScalar(scale);
  return g;
}

// ----------------------------------------------------------------- igloos

/** A dome of rounded snow blocks with an entrance tunnel facing +Z. */
export function igloo(r: number, cosy = false): THREE.Group {
  const g = new THREE.Group();
  const block = mat(P.igloo, { rough: 0.7 });
  const blockB = mat(0xeeeef6, { rough: 0.7 });
  const fill = mat(P.iglooShade, { rough: 0.9 });
  const courses = 5;
  const bh = (r * Math.PI * 0.5) / (courses + 0.6);
  g.add(part(geo.sphere(24), fill, [0, 0, 0], [r * 0.97, r * 0.97, r * 0.97]));
  for (let c = 0; c < courses; c++) {
    const phi = ((c + 0.5) / (courses + 0.6)) * Math.PI * 0.5;
    const rr = r * Math.cos(phi);
    const y = r * Math.sin(phi);
    const n = Math.max(5, Math.round((Math.PI * 2 * rr) / (bh * 1.35)));
    const w = (Math.PI * 2 * rr) / n;
    for (let i = 0; i < n; i++) {
      const a = (i + (c % 2) * 0.5) / n * Math.PI * 2;
      const bx = Math.sin(a) * rr;
      const bz = Math.cos(a) * rr;
      // Leave the doorway open on the lowest courses.
      if (c < 2 && Math.abs(Math.atan2(bx, bz)) < 0.42) continue;
      const m = part(geo.box(0.32, 2), (i + c) % 3 === 0 ? blockB : block, [bx, y, bz], [w * 0.94, bh * 0.92, 0.42]);
      m.rotation.set(0, a, 0, 'YXZ');
      m.rotateX(-phi);
      g.add(m);
    }
  }
  g.add(part(geo.sphere(16), block, [0, r * 0.98, 0], [r * 0.32, r * 0.12, r * 0.32]));
  // Entrance tunnel.
  const tunnelR = Math.min(1.05, r * 0.36);
  const tunnelLen = r * 0.55 + 0.6;
  const tun = new THREE.CylinderGeometry(tunnelR, tunnelR, tunnelLen, 16, 1, true, -Math.PI / 2, Math.PI);
  tun.rotateX(Math.PI / 2);
  const tm = new THREE.Mesh(tun, mat(P.igloo, { rough: 0.75, side: THREE.DoubleSide }));
  tm.position.set(0, 0, r - 0.15);
  tm.castShadow = true;
  tm.receiveShadow = true;
  g.add(tm);
  // Arch rim of blocks around the tunnel mouth.
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI;
    g.add(part(geo.box(0.32, 2), block, [Math.cos(a) * (tunnelR + 0.05), Math.sin(a) * (tunnelR + 0.05), r - 0.15 + tunnelLen / 2], [0.42, 0.36, 0.4], [0, 0, a - Math.PI / 2]));
  }
  // Doorway: warm glow inside the cosy igloo, cool shade otherwise.
  // Back wall of the tunnel, then the doorway (warm glow inside the cosy igloo).
  const back = new THREE.Mesh(new THREE.CircleGeometry(tunnelR * 0.99, 20, 0, Math.PI), mat(0xc9c6dc, { rough: 1 }));
  back.position.set(0, 0, r * 0.99 + 0.02);
  g.add(back);
  const doorGeo = new THREE.CircleGeometry(tunnelR * 0.68, 20, 0, Math.PI);
  const doorMat = new THREE.MeshBasicMaterial({ map: doorTexture(cosy), color: 0xffffff });
  const door = new THREE.Mesh(doorGeo, doorMat);
  door.name = 'door';
  door.position.set(0, 0.0, r * 0.99 + 0.05);
  g.add(door);
  // A little wooden door frame.
  g.add(part(geo.torus(0.12, Math.PI, 16), mat(P.woodDark), [0, 0, r * 0.99 + 0.06], [tunnelR * 0.7, tunnelR * 0.7, 0.5]));
  // Round window.
  const win = part(geo.sphere(14), cosy ? mat(0xf6d2a6, { emissive: 0xf2b27c, emissiveIntensity: 0.7 }) : mat(0xbcd3e6, { rough: 0.2 }), [0, 0, 0], [0.32, 0.32, 0.08]);
  const wa = 0.95;
  win.position.set(Math.sin(wa) * r * 0.86, r * 0.48, Math.cos(wa) * r * 0.86);
  win.lookAt(new THREE.Vector3(Math.sin(wa) * r * 3, r * 0.9, Math.cos(wa) * r * 3));
  g.add(win);
  g.add(part(geo.torus(0.25, Math.PI * 2, 18), block, [win.position.x, win.position.y, win.position.z], 0.34, [0, wa, 0]));
  // Snow drift around the base.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.5) continue;
    g.add(part(geo.sphere(12), mat(P.snow), [Math.sin(a) * r * 0.98, 0, Math.cos(a) * r * 0.98], [0.9, 0.35, 0.7], [0, a, 0]));
  }
  return g;
}

const doorTex: Record<string, THREE.CanvasTexture> = {};
/** Soft radial glow for an igloo doorway: warm and cosy, or cool shade. */
function doorTexture(cosy: boolean): THREE.CanvasTexture {
  const k = cosy ? 'cosy' : 'cool';
  if (doorTex[k]) return doorTex[k];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 128, 4, 64, 110, 110);
  if (cosy) {
    grd.addColorStop(0, '#fff0d2');
    grd.addColorStop(0.45, '#f6c48e');
    grd.addColorStop(1, '#b97c5c');
  } else {
    grd.addColorStop(0, '#8e97b9');
    grd.addColorStop(1, '#6d7596');
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  doorTex[k] = t;
  return t;
}

/** Penguin welcome mat + lantern posts for the cosy igloo. */
export function iglooDecor(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(geo.cyl(1, 1, 28), mat(P.coral, { rough: 0.95 }), [0, 0.03, 0], [0.95, 0.04, 0.6]));
  g.add(part(geo.cyl(1, 1, 28), mat(P.snowWarm, { rough: 0.95 }), [0, 0.05, 0], [0.72, 0.03, 0.42]));
  g.add(part(geo.cyl(1, 1, 28), mat(P.coral, { rough: 0.95 }), [0, 0.06, 0], [0.42, 0.03, 0.22]));
  for (const s of [-1, 1]) {
    g.add(part(geo.cyl(1, 1, 8), mat(P.woodDark), [s * 1.25, 0.55, 0.1], [0.06, 1.1, 0.06]));
    g.add(part(geo.sphere(12), mat(0xffe2bd, { emissive: 0xf6c08a, emissiveIntensity: 1.2 }), [s * 1.25, 1.2, 0.1], 0.14, [0, 0, 0], false));
    g.add(part(geo.cone(10), mat(P.snow), [s * 1.25, 1.38, 0.1], [0.16, 0.12, 0.16]));
  }
  return g;
}

// ---------------------------------------------------------------- ice arch

export function iceArch(): THREE.Group {
  const g = new THREE.Group();
  const ice = mat(0xd3e6f1, { rough: 0.38, emissive: 0x9cc3dd, emissiveIntensity: 0.18 });
  const ice2 = mat(0xc2daea, { rough: 0.4, emissive: 0x8db7d4, emissiveIntensity: 0.18 });
  const snow = mat(P.snow);
  const R = 3.3;
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1)) * Math.PI;
    const x = Math.cos(a) * R;
    const y = Math.sin(a) * R + 0.35;
    g.add(part(geo.box(0.22, 2), i % 2 ? ice : ice2, [x, y, 0], [0.98, 0.84, 1.2], [0, 0, a - Math.PI / 2]));
    if (i > 1 && i < n - 2) g.add(part(geo.sphere(12), snow, [x * 1.02, y + 0.42, 0], [0.55, 0.17, 0.66], [0, 0, a - Math.PI / 2]));
  }
  for (const s of [-1, 1]) {
    g.add(part(geo.box(0.25, 2), ice2, [s * R, 0.1, 0], [1.25, 0.6, 1.4]));
    g.add(part(geo.sphere(12), snow, [s * R, -0.1, 0], [1.4, 0.5, 1.5]));
  }
  return g;
}

// ---------------------------------------------------------------- snowmen

export interface SnowmanOpts {
  scale?: number;
  scarf?: number;
  hat?: 'top' | 'beanie' | null;
  hatColor?: number;
  arms?: boolean;
  wave?: number;
}

/** A friendly snowman; returns the group and the head-top height for hats. */
export function snowman(o: SnowmanOpts = {}): { group: THREE.Group; headTop: number } {
  const g = new THREE.Group();
  const snow = mat(P.snow, { rough: 0.85 });
  const coal = mat(P.coal, { rough: 0.6 });
  const s = o.scale ?? 1;
  g.add(part(geo.sphere(20), snow, [0, 0.52, 0], [0.62, 0.56, 0.62]));
  g.add(part(geo.sphere(20), snow, [0, 1.25, 0], 0.44));
  g.add(part(geo.sphere(20), snow, [0, 1.86, 0], 0.32));
  for (let i = 0; i < 3; i++) g.add(part(geo.sphere(8), coal, [0, 1.12 + i * 0.16, 0.41 - Math.abs(i - 1) * 0.02], 0.045, [0, 0, 0], false));
  for (const e of [-1, 1]) g.add(part(geo.sphere(8), coal, [e * 0.11, 1.93, 0.28], [0.045, 0.05, 0.03], [0, 0, 0], false));
  // Smile of coal dots.
  for (let i = 0; i < 5; i++) {
    const a = (i / 4 - 0.5) * 1.3;
    g.add(part(geo.sphere(6), coal, [Math.sin(a) * 0.12, 1.77 - Math.cos(a) * 0.035, 0.29], 0.022, [0, 0, 0], false));
  }
  g.add(part(geo.cone(10), mat(P.carrot, { rough: 0.6 }), [0, 1.86, 0.42], [0.05, 0.24, 0.05], [Math.PI / 2, 0, 0]));
  // Rosy cheeks.
  for (const e of [-1, 1]) g.add(part(geo.sphere(8), mat(0xf2c3c0), [e * 0.19, 1.82, 0.24], [0.05, 0.035, 0.02], [0, e * 0.6, 0], false));
  if (o.scarf !== undefined) {
    const sc = mat(o.scarf, { rough: 0.95 });
    g.add(part(geo.torus(0.42, Math.PI * 2, 20), sc, [0, 1.6, 0], [0.3, 0.3, 0.3], [Math.PI / 2, 0, 0]));
    g.add(part(geo.box(0.3), sc, [0.16, 1.4, 0.3], [0.12, 0.38, 0.06], [0.2, 0, 0.25]));
  }
  if (o.arms !== false) {
    const wood = mat(P.woodDark, { rough: 0.9 });
    for (const side of [-1, 1]) {
      const up = side === 1 ? (o.wave ?? 0.5) : 0.25;
      const arm = new THREE.Group();
      arm.position.set(side * 0.4, 1.32, 0);
      arm.rotation.z = side * (Math.PI / 2 - up);
      arm.add(part(geo.cyl(0.6, 1, 6), wood, [0, 0.35, 0], [0.025, 0.7, 0.025]));
      arm.add(part(geo.cyl(0.6, 1, 6), wood, [side * -0.06, 0.6, 0], [0.018, 0.2, 0.018], [0, 0, side * 0.7]));
      g.add(arm);
    }
  }
  if (o.hat) g.add(hatModel(o.hat, o.hatColor ?? P.coal).translateY(2.1));
  g.scale.setScalar(s);
  return { group: g, headTop: 2.1 * s };
}

/** A hat: classic top hat or a pompom beanie (Hat Toss targets). */
export function hatModel(kind: 'top' | 'beanie', color: number, band = P.peach): THREE.Group {
  const g = new THREE.Group();
  const m = mat(color, { rough: 0.75 });
  if (kind === 'top') {
    g.add(part(geo.cyl(1, 1, 20), m, [0, 0.02, 0], [0.36, 0.04, 0.36]));
    g.add(part(geo.cyl(0.95, 1, 20), m, [0, 0.24, 0], [0.24, 0.42, 0.24]));
    g.add(part(geo.cyl(1, 1, 20), mat(band, { rough: 0.7 }), [0, 0.11, 0], [0.245, 0.08, 0.245]));
    g.add(part(geo.sphere(8), mat(0xf6efe4), [0.2, 0.14, 0.12], 0.06, [0, 0, 0], false));
  } else {
    g.add(part(geo.sphere(20, ), m, [0, 0.02, 0], [0.33, 0.3, 0.33]));
    g.add(part(geo.torus(0.35, Math.PI * 2, 20), mat(band, { rough: 0.9 }), [0, 0.02, 0], [0.31, 0.31, 0.31], [Math.PI / 2, 0, 0]));
    g.add(part(geo.sphere(12), mat(0xfbf6ef, { rough: 1 }), [0, 0.36, 0], 0.11));
  }
  return g;
}

// -------------------------------------------------------------- treasure

export function crystalModel(): THREE.Group {
  const src = new THREE.Group();
  const oct = new THREE.OctahedronGeometry(1, 0);
  const m = mat(0xd2ecf7);
  const m2 = mat(0xeaf6fc);
  const a = new THREE.Mesh(oct, m);
  a.scale.set(0.16, 0.42, 0.16);
  src.add(a);
  const b = new THREE.Mesh(oct, m2);
  b.scale.set(0.1, 0.26, 0.1);
  b.position.set(0.17, -0.12, 0.04);
  b.rotation.z = -0.5;
  src.add(b);
  const c = new THREE.Mesh(oct, m2);
  c.scale.set(0.09, 0.22, 0.09);
  c.position.set(-0.15, -0.14, -0.05);
  c.rotation.z = 0.55;
  src.add(c);
  const g = new THREE.Group();
  const mesh = bake(src, { rough: 0.15, emissive: 0x9fd2ec, emissiveIntensity: 0.6, shadow: true });
  mesh.material = (mesh.material as THREE.MeshStandardMaterial).clone();
  (mesh.material as THREE.MeshStandardMaterial).flatShading = true;
  (mesh.material as THREE.MeshStandardMaterial).metalness = 0.1;
  g.add(mesh);
  return g;
}

// -------------------------------------------------------------- lanterns

export interface Lantern {
  group: THREE.Group;
  flame: THREE.Mesh;
  flameMat: THREE.MeshStandardMaterial;
  shell: THREE.MeshStandardMaterial;
}

/** A hollow ice-block lantern on a snowy post, waiting for a Glow Ball. */
export function lanternModel(): Lantern {
  const g = new THREE.Group();
  const base = new THREE.Group();
  base.add(part(geo.sphere(14), mat(P.snow), [0, 0.05, 0], [0.6, 0.25, 0.6]));
  base.add(part(geo.cyl(1, 1.1, 10), mat(P.woodDark, { rough: 0.9 }), [0, 0.45, 0], [0.09, 0.8, 0.09]));
  base.add(part(geo.box(0.2), mat(P.wood), [0, 0.88, 0], [0.62, 0.08, 0.62]));
  base.add(part(geo.box(0.2), mat(P.snow), [0, 1.56, 0], [0.66, 0.1, 0.66]));
  base.add(part(geo.sphere(12), mat(P.snow), [0, 1.62, 0], [0.32, 0.12, 0.32]));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) base.add(part(geo.cyl(1, 1, 6), mat(P.wood), [sx * 0.27, 1.22, sz * 0.27], [0.03, 0.62, 0.03]));
  g.add(bake(base, { shadow: true }));
  const shell = matUnique(0xdcecf5, { rough: 0.25, transparent: true, opacity: 0.5, emissive: 0xa9d0e6, emissiveIntensity: 0.25 });
  shell.depthWrite = false;
  const box = part(geo.box(0.12, 3), shell, [0, 1.22, 0], [0.56, 0.62, 0.56], [0, 0, 0], false);
  box.renderOrder = 4;
  g.add(box);
  const flameMat = matUnique(0xc9d6e4, { rough: 0.5, emissive: 0x000000, emissiveIntensity: 0 });
  const flame = part(geo.sphere(14), flameMat, [0, 1.2, 0], 0.16, [0, 0, 0], false);
  g.add(flame);
  return { group: g, flame, flameMat, shell };
}

// ------------------------------------------------------------- little props

export function sled(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(P.wood, { rough: 0.8 });
  const run = mat(P.coral, { rough: 0.6 });
  for (let i = 0; i < 4; i++) g.add(part(geo.box(0.2), wood, [0, 0.32, -0.45 + i * 0.3], [0.62, 0.05, 0.22]));
  for (const s of [-1, 1]) {
    g.add(part(geo.box(0.3), run, [s * 0.28, 0.08, 0], [0.05, 0.05, 1.3]));
    g.add(part(geo.torus(0.3, Math.PI * 0.5, 10), run, [s * 0.28, 0.25, 0.65], [0.18, 0.18, 0.18], [0, Math.PI / 2, -Math.PI / 2]));
    for (const z of [-0.4, 0.3]) g.add(part(geo.box(0.3), run, [s * 0.28, 0.2, z], [0.04, 0.24, 0.04]));
  }
  return g;
}

export function fishBucket(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(geo.cyl(1, 0.8, 16), mat(P.blue, { rough: 0.6 }), [0, 0.22, 0], [0.26, 0.44, 0.26]));
  g.add(part(geo.torus(0.12, Math.PI * 2, 16), mat(0xdfe6ee, { rough: 0.4, metal: 0.3 }), [0, 0.44, 0], [0.26, 0.26, 0.26], [Math.PI / 2, 0, 0]));
  const fish = mat(0xc3cfdc, { rough: 0.4, metal: 0.15 });
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1;
    const f = new THREE.Group();
    f.add(part(geo.sphere(10), fish, [0, 0, 0], [0.05, 0.16, 0.08]));
    f.add(part(geo.cone(6), fish, [0, -0.19, 0], [0.06, 0.08, 0.02], [Math.PI, 0, 0]));
    f.position.set(Math.cos(a) * 0.1, 0.5 + i * 0.03, Math.sin(a) * 0.1);
    f.rotation.set(0.2 * Math.cos(a), a, 0.3 * Math.sin(a));
    g.add(f);
  }
  return g;
}

/** A short rustic fence with snow-capped posts. */
export function fence(len: number): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(P.wood, { rough: 0.9 });
  const snow = mat(P.snow);
  const posts = Math.max(2, Math.round(len / 1.6) + 1);
  for (let i = 0; i < posts; i++) {
    const x = -len / 2 + (i / (posts - 1)) * len;
    g.add(part(geo.cyl(1, 1, 8), wood, [x, 0.45, 0], [0.07, 0.9, 0.07]));
    g.add(part(geo.sphere(8), snow, [x, 0.92, 0], [0.11, 0.07, 0.11]));
  }
  g.add(part(geo.box(0.2), wood, [0, 0.7, 0], [len, 0.07, 0.05]));
  g.add(part(geo.box(0.2), wood, [0, 0.38, 0], [len, 0.07, 0.05]));
  g.add(part(geo.box(0.3), snow, [0, 0.75, 0], [len, 0.04, 0.09]));
  return g;
}

export function signpost(): THREE.Group {
  const g = new THREE.Group();
  const wood = mat(P.woodDark, { rough: 0.9 });
  g.add(part(geo.cyl(1, 1, 8), wood, [0, 1.0, 0], [0.08, 2.0, 0.08]));
  const boards: [number, number, number][] = [[1.65, P.peach, -0.5], [1.3, P.lilac, 0.9], [0.95, P.blue, 2.4]];
  for (const [y, c, a] of boards) {
    const b = new THREE.Group();
    b.position.y = y;
    b.rotation.y = a;
    b.add(part(geo.box(0.25), mat(c, { rough: 0.8 }), [0.42, 0, 0], [0.8, 0.24, 0.06]));
    b.add(part(geo.cone(4), mat(c, { rough: 0.8 }), [0.9, 0, 0], [0.17, 0.2, 0.05], [0, 0, -Math.PI / 2]));
    g.add(b);
  }
  g.add(part(geo.sphere(10), mat(P.snow), [0, 2.03, 0], [0.13, 0.08, 0.13]));
  return g;
}

/** Snowy boulder (lilac rock with a snow cap). */
export function rock(rng: Rng, s: number): THREE.Group {
  const g = new THREE.Group();
  g.add(part(geo.dodec(), mat(P.rock, { rough: 0.95, flat: true }), [0, s * 0.35, 0], [s, s * 0.7, s * 0.9], [rng.range(0, 3), rng.range(0, 3), 0]));
  g.add(part(geo.sphere(12), mat(P.snow), [0, s * 0.78, 0], [s * 0.8, s * 0.25, s * 0.7]));
  return g;
}

// ------------------------------------------------------------- far scenery

/** Distant ring of snowy peaks (merged by the caller). */
export function mountains(rng: Rng): THREE.Group {
  const g = new THREE.Group();
  const base = mat(0xc3c3de, { rough: 1, flat: true });
  const base2 = mat(0xcfcae2, { rough: 1, flat: true });
  const cap = mat(0xf7f2f4, { rough: 0.9, flat: true });
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rng.range(-0.08, 0.08);
    const r = rng.range(140, 190);
    const h = rng.range(38, 78) * (Math.abs(Math.sin(a * 0.5 + 0.3)) * 0.4 + 0.75);
    const w = rng.range(40, 62);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const ry = rng.range(0, 6);
    g.add(part(geo.cone(7), i % 2 ? base : base2, [x, h / 2 - 6, z], [w, h, w * 0.9], [0, ry, 0], false));
    g.add(part(geo.cone(7), cap, [x, h - 6 - h * 0.19, z], [w * 0.39, h * 0.4, w * 0.39 * 0.9], [0, ry, 0], false));
  }
  return g;
}

// ------------------------------------------------------------------ aurora

const auroraVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const auroraFrag = /* glsl */ `
  uniform float uTime;
  uniform float uStrength;
  uniform vec3 uColA;
  uniform vec3 uColB;
  varying vec2 vUv;
  void main() {
    float x = vUv.x;
    float wave = sin(x * 9.0 + uTime * 0.25) * 0.08 + sin(x * 23.0 - uTime * 0.4) * 0.03;
    float y = vUv.y + wave;
    float curtain = smoothstep(0.0, 0.25, y) * smoothstep(1.0, 0.35, y);
    float rays = 0.55 + 0.45 * sin(x * 140.0 + sin(x * 11.0 + uTime * 0.3) * 4.0 + uTime * 0.6);
    rays = mix(1.0, rays, 0.55);
    float ends = smoothstep(0.0, 0.18, x) * smoothstep(1.0, 0.82, x);
    float a = curtain * rays * ends * uStrength;
    vec3 col = mix(uColA, uColB, smoothstep(0.3, 0.95, y));
    col = mix(col, vec3(1.0), 0.15 * rays);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }
`;

export interface Aurora {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
}

/** A faint ribbon of aurora light in the northern sky. */
export function makeAurora(): Aurora {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uStrength: { value: 0.3 },
      uColA: { value: new THREE.Color(0x9fe6cf) },
      uColB: { value: new THREE.Color(0xcbb6f0) },
    },
    vertexShader: auroraVert,
    fragmentShader: auroraFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const group = new THREE.Group();
  // Two gently curving ribbons.
  const ribbons: [number, number, number, number, number][] = [
    // centreAngle, arc, radius, y0, height
    [-Math.PI / 2 - 0.1, 1.6, 260, 78, 85],
    [-Math.PI / 2 + 0.5, 1.0, 280, 118, 60],
  ];
  for (const [ca, arc, rad, y0, hgt] of ribbons) {
    const seg = 60;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      const a = ca - arc / 2 + u * arc;
      const wob = Math.sin(u * Math.PI * 3) * 18;
      const r = rad + wob;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const lift = Math.sin(u * Math.PI) * 14;
      pos.push(x, y0 + lift, z, x * 1.04, y0 + lift + hgt, z * 1.04);
      uv.push(u, 0, u, 1);
      if (i < seg) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    m.renderOrder = -5;
    group.add(m);
  }
  return { group, material };
}

// --------------------------------------------------------------- textures

/** Frosted ice texture for the pond: soft blue with white swirls and hairline cracks. */
export function iceTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.5);
  grd.addColorStop(0, '#b9d6ea');
  grd.addColorStop(0.7, '#c8deee');
  grd.addColorStop(1, '#eef4f8');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Frosty swirls (skate marks).
  g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.12 + rnd() * 0.2})`;
    g.lineWidth = 2 + rnd() * 5;
    g.beginPath();
    const cx = S * (0.2 + rnd() * 0.6);
    const cy = S * (0.2 + rnd() * 0.6);
    const r = S * (0.05 + rnd() * 0.18);
    const a0 = rnd() * 6;
    g.arc(cx, cy, r, a0, a0 + 1 + rnd() * 2.5);
    g.stroke();
  }
  // Hairline cracks.
  for (let i = 0; i < 9; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.35 + rnd() * 0.25})`;
    g.lineWidth = 1.2;
    g.beginPath();
    let x = S * (0.2 + rnd() * 0.6);
    let y = S * (0.2 + rnd() * 0.6);
    g.moveTo(x, y);
    let a = rnd() * 6.28;
    for (let k = 0; k < 6; k++) {
      a += (rnd() - 0.5) * 1.2;
      x += Math.cos(a) * 18;
      y += Math.sin(a) * 18;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // Soft snow dust near the rim.
  for (let i = 0; i < 400; i++) {
    const a = rnd() * Math.PI * 2;
    const r = S * (0.38 + rnd() * 0.12);
    g.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.4})`;
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 2 + rnd() * 6, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
