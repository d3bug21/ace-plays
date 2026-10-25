import * as THREE from 'three';
import { Noise, smoothstep, lerp } from '../../core/math';
import { distToPath } from '../../kit/terrain';

// World layout for Frosty Peaks: every landmark position lives here so the
// terrain, props, creatures and objectives agree with each other.
//
//            N (-Z)        Woolly's hill + snowball valley
//   slide hill  \             |            ridge
//        pond    Woolly basin |   igloo
//    (west)      cosy igloo  plaza   lagoon (east, seals)
//                       ice arch       snowman garden
//                        spawn (S, +Z)

export const SPAWN = new THREE.Vector3(0, 0, 40);

export const POND = { x: -26, z: 16, r: 10 };
export const ICE_Y = -0.22;

export const LAGOON = { x: 24, z: 10, r: 8.5 };
export const WATER_Y = -0.5;
export const FLOE_Y = -0.14;
export const FLOES = [
  { x: 19.6, z: 7, r: 1.9 },
  { x: 26.6, z: 5.4, r: 2.0 },
  { x: 25, z: 14.2, r: 1.9 },
  { x: 29.6, z: 13.6, r: 1.25 },
];

/** Snowball valley, top to bottom. */
export const VALLEY: [number, number][] = [
  [16, -38],
  [12, -33],
  [7, -28.6],
  [3, -24],
  [0.5, -19],
];
export const VALLEY_TOP = 7.6;
export const WOOLLY = new THREE.Vector3(-1.5, 0, -11.5);

/** Penguin slide chute, top to bottom (ends on the frozen pond). */
export const SLIDE: [number, number][] = [
  [-38, -12],
  [-35, -5],
  [-31.6, 1],
  [-29, 6.4],
];
export const SLIDE_TOP = 6.2;
export const SLIDE_HILL = { x: -41, z: -15, r: 13, h: 7.4 };

export const COSY_IGLOO = { x: -8, z: 8, r: 3.2, door: 0 }; // door faces +Z (rotation 0)
export const IGLOO_B = { x: 9.5, z: 4.5, r: 2.4, door: -0.7 };
export const IGLOO_C = { x: 14, z: -4.5, r: 2.1, door: -1.4 };
export const ARCH = { x: 0, z: 27 };
export const GARDEN = { x: 16, z: 32 };
export const PAD = new THREE.Vector3(10.5, 0, 33);

/** Walking paths (packed snow). */
export const PATHS: [number, number][][] = [
  [[0, 46], [0, 34], [0, 22], [0, 14], [-0.5, 4], [-1, -5]],
  [[0, 14], [-6, 13.5], [-12, 14], [-16, 15]],
  [[0, 14], [7, 12.5], [13, 12], [15.5, 11.5]],
  [[0, 30], [5, 31], [9, 32.5]],
];
/** Lantern trail up the ridge to the snowball. */
export const TRAIL: [number, number][] = [
  [-3.5, -7],
  [-7.5, -16],
  [-8.5, -25],
  [-5, -33],
  [2, -39.5],
  [10, -43],
  [17.5, -42.5],
];

export const BOUNDS = 57;

// ---------------------------------------------------------------- helpers

interface Polyline {
  pts: [number, number][];
  cum: number[];
  len: number;
}

function poly(pts: [number, number][]): Polyline {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}

export const valleyLine = poly(VALLEY);
export const slideLine = poly(SLIDE);
export const trailLine = poly(TRAIL);

/** Projection result: distance to the polyline and normalised progress 0..1 (clamped). */
export const proj = { d: 0, s: 0, tx: 0, tz: 0 };

export function project(x: number, z: number, L: Polyline): typeof proj {
  let best = Infinity;
  let bs = 0;
  let btx = 0;
  let btz = 1;
  const p = L.pts;
  for (let i = 0; i < p.length - 1; i++) {
    const ax = p[i][0];
    const az = p[i][1];
    const dx = p[i + 1][0] - ax;
    const dz = p[i + 1][1] - az;
    const l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const px = ax + dx * t;
    const pz = az + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      const l = Math.sqrt(l2);
      bs = (L.cum[i] + t * l) / L.len;
      btx = dx / l;
      btz = dz / l;
    }
  }
  proj.d = best;
  proj.s = bs;
  proj.tx = btx;
  proj.tz = btz;
  return proj;
}

/** Point on a polyline at progress s (0..1). */
export function pointAt(L: Polyline, s: number, out: THREE.Vector3): THREE.Vector3 {
  const target = Math.max(0, Math.min(1, s)) * L.len;
  for (let i = 0; i < L.pts.length - 1; i++) {
    if (target <= L.cum[i + 1] || i === L.pts.length - 2) {
      const seg = L.cum[i + 1] - L.cum[i];
      const t = seg > 0 ? (target - L.cum[i]) / seg : 0;
      out.x = lerp(L.pts[i][0], L.pts[i + 1][0], Math.min(1, t));
      out.z = lerp(L.pts[i][1], L.pts[i + 1][1], Math.min(1, t));
      return out;
    }
  }
  return out;
}

export function valleyFloor(s: number): number {
  return VALLEY_TOP * Math.pow(1 - Math.max(0, Math.min(1, s)), 1.15);
}

export function slideFloor(s: number): number {
  const k = Math.max(0, Math.min(1, s));
  // Gentle start, steady middle, soft run-out onto the ice.
  const e = k < 0.12 ? k * 0.6 : k > 0.85 ? 1 - (1 - k) * 0.9 : k;
  return lerp(SLIDE_TOP, ICE_Y + 0.02, Math.min(1, e * 1.02));
}

const noise = new Noise(2026);

export function onFloe(x: number, z: number, pad = 0): boolean {
  for (const f of FLOES) if (Math.hypot(x - f.x, z - f.z) < f.r + pad) return true;
  return false;
}

export function inLagoonWater(x: number, z: number): boolean {
  return Math.hypot(x - LAGOON.x, z - LAGOON.z) < LAGOON.r - 0.15 && !onFloe(x, z, 0.05);
}

export function onPond(x: number, z: number): boolean {
  return Math.hypot(x - POND.x, z - POND.z) < POND.r - 0.2;
}

/** The terrain height field (also used for physics). */
export function height(x: number, z: number): number {
  const r = Math.hypot(x, z);
  // Soft snowy undulation, calmer on paths and in the play spaces.
  let n = noise.fbm2(x * 0.03, z * 0.03, 3) * 1.1 + noise.n2(x * 0.11, z * 0.11) * 0.12;
  let calm = 1;
  for (const p of PATHS) calm = Math.min(calm, smoothstep(1.5, 7, distToPath(x, z, p)));
  calm = Math.min(calm, smoothstep(8, 16, Math.hypot(x - WOOLLY.x, z - WOOLLY.z)));
  calm = Math.min(calm, smoothstep(5, 9, Math.hypot(x - SPAWN.x, z - SPAWN.z)));
  calm = Math.min(calm, smoothstep(4, 8, Math.hypot(x - COSY_IGLOO.x, z - COSY_IGLOO.z)));
  calm = Math.min(calm, smoothstep(3, 6, Math.hypot(x - IGLOO_B.x, z - IGLOO_B.z)));
  calm = Math.min(calm, smoothstep(3, 6, Math.hypot(x - IGLOO_C.x, z - IGLOO_C.z)));
  calm = Math.min(calm, smoothstep(2.5, 6, Math.hypot(x - PAD.x, z - PAD.z)));
  n *= 0.25 + 0.75 * calm;
  let h = n;

  // Boundary hills and far snowy slopes.
  h += smoothstep(49, 66, r) * 10 + smoothstep(60, 80, r) * 14;

  // The northern ridge (Woolly's hill).
  const ridge = 9.6 * smoothstep(-13, -42, z) * (1 - smoothstep(30, 44, Math.abs(x - 4)) * 0.6);
  h += ridge;

  // Slide hill in the north-west.
  const sh = Math.hypot(x - SLIDE_HILL.x, z - SLIDE_HILL.z);
  h += SLIDE_HILL.h * (1 - smoothstep(3, SLIDE_HILL.r, sh));

  // Carved snowball valley with soft guide banks (only where it cuts into the hill).
  const vp = project(x, z, valleyLine);
  if (vp.d < 14) {
    const floor = valleyFloor(vp.s);
    const d = vp.d;
    const bank = d < 4.4 ? 0.9 * (d / 2.2) * (d / 2.2) : 3.6 + (d - 4.4) * 1.4;
    const ch = floor + bank;
    h = Math.min(h, lerp(ch, h, smoothstep(9, 14, d)));
  }

  // Penguin slide chute: raised icy lips and a smooth trough.
  const sp = project(x, z, slideLine);
  if (sp.d < 5) {
    const d = sp.d;
    const floor = slideFloor(sp.s);
    const lip = d < 0.85 ? 0.06 * (d / 0.85) * (d / 0.85) : d < 1.6 ? 0.06 + (d - 0.85) * 0.55 : 0.47 - (d - 1.6) * 0.4;
    const chute = floor + lip;
    const w = smoothstep(1.9, 4.8, d);
    h = lerp(chute, h, w);
  }

  // Frozen pond (flat ice) with a soft rim.
  const pd = Math.hypot(x - POND.x, z - POND.z);
  if (pd < POND.r + 4) {
    const rim = Math.max(0, 1 - Math.abs(pd - POND.r - 0.9) / 1.6) * 0.25;
    h = lerp(h + rim, ICE_Y, 1 - smoothstep(POND.r - 0.4, POND.r + 0.9, pd));
  }

  // Seal lagoon: open water bed and floating ice floes.
  const ld = Math.hypot(x - LAGOON.x, z - LAGOON.z);
  if (ld < LAGOON.r + 4) {
    const shore = lerp(h, 0.02, 1 - smoothstep(LAGOON.r + 0.5, LAGOON.r + 3.5, ld));
    h = lerp(shore, -1.9, 1 - smoothstep(LAGOON.r - 1.4, LAGOON.r + 0.05, ld));
    for (const f of FLOES) {
      const fd = Math.hypot(x - f.x, z - f.z);
      if (fd < f.r + 0.1) h = Math.max(h, FLOE_Y - smoothstep(f.r - 0.35, f.r + 0.1, fd) * 0.55);
    }
  }
  return h;
}

/** Terrain slope gradient (dh/dx, dh/dz) by central differences. */
export function gradient(x: number, z: number, out: { x: number; z: number }): { x: number; z: number } {
  const e = 0.25;
  out.x = (height(x + e, z) - height(x - e, z)) / (2 * e);
  out.z = (height(x, z + e) - height(x, z - e)) / (2 * e);
  return out;
}

/** Spots that props and scatter should keep clear of. */
export function keepClear(x: number, z: number, pad = 0): boolean {
  for (const p of PATHS) if (distToPath(x, z, p) < 2.2 + pad) return true;
  if (distToPath(x, z, TRAIL) < 1.8 + pad) return true;
  if (project(x, z, valleyLine).d < 5.5 + pad) return true;
  if (project(x, z, slideLine).d < 2.6 + pad) return true;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 1.5 + pad) return true;
  if (Math.hypot(x - LAGOON.x, z - LAGOON.z) < LAGOON.r + 1.5 + pad) return true;
  if (Math.hypot(x - WOOLLY.x, z - WOOLLY.z) < 9 + pad) return true;
  if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 6 + pad) return true;
  if (Math.hypot(x - COSY_IGLOO.x, z - COSY_IGLOO.z) < COSY_IGLOO.r + 2.5 + pad) return true;
  if (Math.hypot(x - IGLOO_B.x, z - IGLOO_B.z) < IGLOO_B.r + 2 + pad) return true;
  if (Math.hypot(x - IGLOO_C.x, z - IGLOO_C.z) < IGLOO_C.r + 2 + pad) return true;
  if (Math.hypot(x - ARCH.x, z - ARCH.z) < 5 + pad) return true;
  if (Math.hypot(x - GARDEN.x, z - GARDEN.z) < 10 + pad) return true;
  return false;
}
