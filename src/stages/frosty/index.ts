import * as THREE from 'three';
import type { StageMeta } from '../index';
import { Stage, type StageContext, type StageEnvironment, type StageInfo, type ObjectiveDef } from '../types';
import { Rng, clamp, damp, smoothstep, easeInOutSine } from '../../core/math';
import { makeTerrain, scatter, distToPath } from '../../kit/terrain';
import { geo, mat, mergeStatic, part } from '../../kit/kit';
import { makeClouds } from '../../fx/Environment';
import { Shape } from '../../fx/Particles';
import { Collectible, PopTarget, TargetCourse } from '../../gameplay/Helpers';
import type { Hittable, HitInfo, HitResponse, ProjectileKind } from '../../gameplay/Hit';
import * as L from './layout';
import * as props from './props';
import { Penguin, Seal, Hare, Fox } from './creatures';
import { Woolly, Snowball } from './woolly';

const P = props.P;
const UPV = new THREE.Vector3(0, 1, 0);

const info: StageInfo = {
  id: 'frosty',
  name: 'Frosty Peaks',
  tagline: 'Snowy hills, sliding penguins, playful seals and a great big woolly friend.',
  map: { x: 64, y: 18 },
  accent: '#8fb2cc',
  icon: 'penguin',
  musicId: 'mus_frosty',
  ambienceId: 'amb_frosty',
  introNarration: 'nar_frosty_intro',
  introAce: 'ace_frosty_intro',
  mode: 'walk',
  reward: undefined,
  footstep: 'sfx_step_snow',
};

const objectives: ObjectiveDef[] = [
  { id: 'seals', kind: 'main', label: 'Play catch with the seals', icon: 'seal', target: 3, hint: 'Bounce a Boing Ball near each seal' },
  { id: 'penguins', kind: 'main', label: 'Float penguins home', icon: 'penguin', target: 6, hint: 'Hold to blow a BIG bubble' },
  { id: 'lanterns', kind: 'main', label: 'Light the ice lanterns', icon: 'lantern', target: 5, hint: 'Glow Balls light the way up the hill' },
  { id: 'woolly', kind: 'main', label: "Roll Woolly's giant snowball", icon: 'mammoth', target: 1, hint: 'Bounce balls at the snowball to roll it down' },
  { id: 'crystals', kind: 'treasure', label: 'Find ice crystals', icon: 'snowflake', target: 5 },
  { id: 'hats', kind: 'challenge', label: 'Snowman Hat Toss: 10 hats in 45s', icon: 'snowman', target: 1 },
];

export const meta: StageMeta = { info, objectives, introColors: ['#bcc6dc', '#46506b'] };

export function create(): Stage {
  return new FrostyStage();
}

interface LanternSlot {
  model: props.Lantern;
  pos: THREE.Vector3;
  lit: boolean;
  litT: number;
  hit: Hittable;
}

interface ShakeTree {
  hit: Hittable;
  pos: THREE.Vector3;
  s: number;
  cool: number;
}

type Finale = 'none' | 'catch' | 'juggle' | 'toss' | 'done';

class FrostyStage extends Stage {
  readonly info = info;
  readonly objectives = objectives;
  readonly env: StageEnvironment = {
    sky: { top: '#8593cc', horizon: '#f8d3c2', bottom: '#eadde6', sunColor: '#ffd3a1', sunSize: 2.6 },
    fog: { color: '#efdfe0', density: 0.0052 },
    hemi: { sky: '#eee6f3', ground: '#a9a7d2', intensity: 0.95 },
    sun: { color: '#ffd09c', intensity: 3.1, dir: [-0.78, 0.36, 0.3], shadows: true },
    exposure: 0.97,
    bloom: { strength: 0.24, radius: 0.55, threshold: 0.93 },
    weather: { kind: 'snow', density: 0.32, color: '#ffffff' },
  };
  readonly spawn = { pos: L.SPAWN.clone(), yaw: 0 };
  override challengePar = 45;

  private rng = new Rng(311);
  private penguins: Penguin[] = [];
  private seals: Seal[] = [];
  private hares: Hare[] = [];
  private foxes: Fox[] = [];
  private woolly!: Woolly;
  private snowball!: Snowball;
  private crystals: Collectible[] = [];
  private course!: TargetCourse;
  private courseTargets: PopTarget[] = [];
  private coursePopped: boolean[] = [];
  private lanterns: LanternSlot[] = [];
  private trees: ShakeTree[] = [];
  private aurora!: props.Aurora;
  private auroraTarget = 0.3;
  private clouds!: THREE.Group;
  private timers: { t: number; fn: () => void }[] = [];
  private finale: Finale = 'none';
  private finaleT = 0;
  private catchFrom = new THREE.Vector3();
  private lastSafe = new THREE.Vector3();
  private hintCool: Record<string, number> = {};
  private iceHinted = false;
  private slideCheer = 0;
  private sealSaid = false;
  private liftedSaid = false;
  private stepHinted = new Set<string>();
  private blasterNag = 0;
  private dustT = 0;
  private homeCount = 0;
  private doorGlow: THREE.MeshBasicMaterial | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  build(ctx: StageContext): void {
    this.ctx = ctx;
    const root = ctx.root;
    const rng = this.rng;
    const H = L.height;
    ctx.physics.groundHeight = H;
    ctx.physics.boundsRadius = L.BOUNDS;
    this.spawn.pos.y = H(L.SPAWN.x, L.SPAWN.z);
    this.lastSafe.copy(this.spawn.pos);

    this.buildTerrain();
    this.buildWater();

    // --- Far scenery
    root.add(mergeStatic(props.mountains(rng), false, false));
    this.clouds = makeClouds(10, 180, 70, 0xfff0ee, 9);
    this.clouds.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.isMeshStandardMaterial) {
        m.emissive.set(0xffe6dc);
        m.emissiveIntensity = 0.75;
      }
    });
    root.add(this.clouds);
    this.aurora = props.makeAurora();
    root.add(this.aurora.group);

    // --- Statics (merged by material)
    const statics = new THREE.Group();
    this.buildPines(statics);
    this.buildVillage(statics);
    this.buildDecor(statics);
    root.add(mergeStatic(statics));

    this.buildCreatures();
    this.buildWoolly();
    this.buildLanterns();
    this.buildCrystals();
    this.buildCourse();
  }

  // ================================================================ terrain

  private buildTerrain(): void {
    const H = L.height;
    const cSnow = new THREE.Color(P.snow);
    const cShade = new THREE.Color(0xdcd8ec);
    const cWarm = new THREE.Color(0xfbefe8);
    const cPath = new THREE.Color(0xe9e2ea);
    const cIce = new THREE.Color(0xcde1ee);
    const cBed = new THREE.Color(0x7f9fb8);
    const cShore = new THREE.Color(0xdde8f1);
    const sun = new THREE.Vector3(...this.env.sun.dir).normalize();
    const n = new THREE.Vector3();
    const gr = { x: 0, z: 0 };
    const terrain = makeTerrain({
      size: 200,
      segments: 200,
      height: H,
      color: (x, z, h, out) => {
        L.gradient(x, z, gr);
        n.set(-gr.x, 1, -gr.z).normalize();
        const lit = n.dot(sun);
        out.copy(cSnow);
        out.lerp(cShade, clamp(0.45 - lit * 1.4, 0, 0.6));
        out.lerp(cWarm, clamp(lit * 1.2 - 0.3, 0, 0.7));
        // Packed-snow paths.
        let dp = Infinity;
        for (const p of L.PATHS) dp = Math.min(dp, distToPath(x, z, p));
        dp = Math.min(dp, distToPath(x, z, L.TRAIL) + 0.3);
        out.lerp(cPath, (1 - smoothstep(0.9, 1.8, dp)) * 0.85);
        // Icy chute.
        const sp = L.project(x, z, L.slideLine);
        out.lerp(cIce, (1 - smoothstep(0.7, 1.2, sp.d)) * 0.9);
        // Lagoon bed and icy shore.
        const ld = Math.hypot(x - L.LAGOON.x, z - L.LAGOON.z);
        out.lerp(cShore, (1 - smoothstep(L.LAGOON.r - 0.2, L.LAGOON.r + 1.4, ld)) * 0.8);
        out.lerp(cBed, 1 - smoothstep(L.LAGOON.r - 2.2, L.LAGOON.r - 0.4, ld));
        void h;
      },
    });
    this.ctx.root.add(terrain);
  }

  private buildWater(): void {
    const root = this.ctx.root;
    // Frozen pond.
    const ice = new THREE.Mesh(
      new THREE.CircleGeometry(L.POND.r + 0.5, 56),
      new THREE.MeshStandardMaterial({ map: props.iceTexture(), roughness: 0.82, metalness: 0, color: 0xffffff, emissive: 0x9fc4dc, emissiveIntensity: 0.16 }),
    );
    ice.rotation.x = -Math.PI / 2;
    ice.position.set(L.POND.x, L.ICE_Y + 0.02, L.POND.z);
    ice.receiveShadow = true;
    root.add(ice);
    // Seal lagoon water + floes.
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(L.LAGOON.r + 0.4, 56),
      new THREE.MeshStandardMaterial({ color: 0x86aecb, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.9, emissive: 0x5f87a6, emissiveIntensity: 0.18 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(L.LAGOON.x, L.WATER_Y, L.LAGOON.z);
    water.receiveShadow = true;
    root.add(water);
    // Shelf ice around the lagoon edge.
    const r = L.LAGOON.r;
    const shelf = new THREE.Mesh(
      new THREE.LatheGeometry([new THREE.Vector2(r - 0.75, L.WATER_Y - 0.1), new THREE.Vector2(r - 0.7, -0.12), new THREE.Vector2(r - 0.5, 0.0), new THREE.Vector2(r + 0.2, 0.06), new THREE.Vector2(r + 0.9, 0.04)], 72),
      mat(0xe3eef6, { rough: 0.45 }),
    );
    shelf.position.set(L.LAGOON.x, 0, L.LAGOON.z);
    shelf.receiveShadow = true;
    root.add(shelf);
    const floes = new THREE.Group();
    const iceSide = mat(0xc6dcec, { rough: 0.4, emissive: 0x8fb6d2, emissiveIntensity: 0.15 });
    const top = mat(P.snow, { rough: 0.85 });
    for (const f of L.FLOES) {
      const fl = new THREE.Group();
      const sides = new THREE.CylinderGeometry(1, 0.85, 1, 12);
      const sm = new THREE.Mesh(sides, iceSide);
      sm.scale.set(f.r + 0.18, 0.62, (f.r + 0.18) * 0.92);
      sm.position.y = L.FLOE_Y - 0.3;
      fl.add(sm);
      fl.add(part(geo.sphere(16), top, [0, L.FLOE_Y - 0.02, 0], [f.r + 0.05, 0.12, (f.r + 0.05) * 0.9]));
      fl.position.set(f.x, 0, f.z);
      fl.rotation.y = f.x * 0.7;
      floes.add(fl);
    }
    // Little ice chunks floating about.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.4;
      const r = 3 + (i % 3) * 1.7;
      const x = L.LAGOON.x + Math.cos(a) * r;
      const z = L.LAGOON.z + Math.sin(a) * r;
      if (L.onFloe(x, z, 0.6)) continue;
      floes.add(part(geo.dodec(), mat(0xd8e8f2, { rough: 0.25, flat: true }), [x, L.WATER_Y + 0.05, z], [0.32, 0.14, 0.26], [0, a, 0]));
    }
    root.add(mergeStatic(floes));
  }

  // ================================================================== props

  private buildPines(statics: THREE.Group): void {
    const rng = this.rng;
    const H = L.height;
    const spots: [number, number, number][] = [];
    // Big ring of pines around the playfield.
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2 + rng.range(-0.04, 0.04);
      const r = rng.range(47, 60);
      spots.push([Math.cos(a) * r, Math.sin(a) * r, rng.range(1.2, 1.8)]);
    }
    // Clusters and singles inside.
    const clusters: [number, number, number, number][] = [
      [-36, 28, 6, 7], [-18, 34, 5, 5], [34, 0, 5, 5], [36, -18, 6, 6], [-22, -22, 6, 7], [-12, -30, 5, 5],
      [28, 42, 5, 5], [-40, 4, 5, 4], [20, -20, 4, 4], [-30, -34, 6, 5],
    ];
    for (const [cx, cz, cr, n] of clusters) {
      for (let k = 0; k < n; k++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * cr;
        spots.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, rng.range(0.8, 1.45)]);
      }
    }
    const placed: [number, number, number][] = [];
    for (const [x, z, s] of spots) {
      if (L.keepClear(x, z, 0.5)) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 2.4)) continue;
      placed.push([x, z, s]);
      const t = props.pine(rng, s, rng.range(0.3, 1));
      t.position.set(x, H(x, z) - 0.15, z);
      t.rotation.y = rng.range(0, 6);
      statics.add(t);
      if (Math.hypot(x, z) < L.BOUNDS + 2) this.ctx.physics.add({ kind: 'cylinder', x, z, r: 0.32 * s, yMin: -5, yMax: 40, tag: 'tree' });
    }
    // The big snowy pine that hides an ice crystal.
    const big = props.pine(rng, 1.6, 1);
    big.position.set(35.5, H(35.5, 0.2) - 0.1, 0.2);
    statics.add(big);
    this.ctx.physics.add({ kind: 'cylinder', x: 35.5, z: 0.2, r: 0.45, yMin: -5, yMax: 40, tag: 'tree' });
    placed.push([35.5, 0.2, 1.6]);
    // Shakeable snowy pines near the paths: a ball or bubble knocks snow off.
    const near = placed.filter(([x, z]) => Math.hypot(x, z) < 46).slice(0, 26);
    for (const [x, z, s] of near) {
      const pos = new THREE.Vector3(x, H(x, z) + 2.4 * s, z);
      const tree: ShakeTree = {
        pos,
        s,
        cool: 0,
        hit: {
          hitRadius: 1.3 * s,
          active: true,
          aimAssist: 0,
          hitCenter: (out) => out.copy(pos),
          accepts: (k: ProjectileKind) => k !== 'fizz',
          onHit: (h: HitInfo): HitResponse => this.shakeTree(tree, h),
        },
      };
      this.ctx.hits.add(tree.hit);
      this.trees.push(tree);
    }
  }

  private shakeTree(t: ShakeTree, h: HitInfo): HitResponse {
    const ctx = this.ctx;
    if (t.cool <= 0) {
      t.cool = 1.2;
      for (let i = 0; i < 3; i++) {
        const p = this.tmp.copy(t.pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.6 * t.s, (i - 1) * 0.7 * t.s, (Math.random() - 0.5) * 1.6 * t.s));
        ctx.fx.soft.emit(p, { count: 10, shape: Shape.Dot, size: 0.3, sizeEnd: 0.5, speed: 0.8, life: 1.3, gravity: 4, drag: 1.5, color: 0xffffff, alpha: 0.75, radius: 0.6, dir: new THREE.Vector3(0, -1, 0), spread: 0.8 });
      }
      ctx.sfx('sfx_snow_poof', { pos: t.pos, volume: 0.6 });
    }
    return h.kind === 'ball' || h.kind === 'glow' ? 'bounce' : 'consume';
  }

  private buildVillage(statics: THREE.Group): void {
    const ctx = this.ctx;
    const H = L.height;
    const phys = ctx.physics;
    // Igloos.
    for (const ig of [L.COSY_IGLOO, L.IGLOO_B, L.IGLOO_C]) {
      const cosy = ig === L.COSY_IGLOO;
      const g = props.igloo(ig.r, cosy);
      const y = H(ig.x, ig.z) - 0.05;
      g.position.set(ig.x, y, ig.z);
      g.rotation.y = ig.door;
      // Doorways stay separate (unlit glow material, not merged).
      const door = g.getObjectByName('door') as THREE.Mesh | undefined;
      if (door) {
        g.remove(door);
        door.position.applyEuler(new THREE.Euler(0, ig.door, 0));
        door.position.add(g.position);
        door.rotation.y = ig.door;
        if (cosy) {
          this.doorGlow = door.material as THREE.MeshBasicMaterial;
          this.doorGlow.color.setScalar(0.85);
        }
        ctx.root.add(door);
      }
      statics.add(g);
      phys.add({ kind: 'cylinder', x: ig.x, z: ig.z, r: ig.r * 0.96, yMin: -3, yMax: y + ig.r * 0.92 });
    }
    const decor = props.iglooDecor();
    const doorZ = L.COSY_IGLOO.z + L.COSY_IGLOO.r + L.COSY_IGLOO.r * 0.55 + 0.6;
    decor.position.set(L.COSY_IGLOO.x, H(L.COSY_IGLOO.x, doorZ + 0.7), doorZ + 0.7);
    statics.add(decor);
    // Ice arch over the path.
    const arch = props.iceArch();
    arch.position.set(L.ARCH.x, H(L.ARCH.x, L.ARCH.z), L.ARCH.z);
    statics.add(arch);
    for (const s of [-1, 1]) phys.add({ kind: 'box', min: new THREE.Vector3(L.ARCH.x + s * 3.3 - 0.7, -3, L.ARCH.z - 0.7), max: new THREE.Vector3(L.ARCH.x + s * 3.3 + 0.7, 30, L.ARCH.z + 0.7) });
    // Rustic fences along the path from the spawn meadow to the arch.
    for (const [x, z, len, ry] of [[-3.4, 35, 5, Math.PI / 2], [3.4, 34, 4, Math.PI / 2], [-4.2, 30.4, 2.6, 1.2], [4.4, 37.5, 3, Math.PI / 2 + 0.2]] as [number, number, number, number][]) {
      const f = props.fence(len);
      f.position.set(x, H(x, z) - 0.05, z);
      f.rotation.y = ry;
      statics.add(f);
    }
    // Signpost at the plaza.
    const sign = props.signpost();
    sign.position.set(2.6, H(2.6, 15.5), 15.5);
    statics.add(sign);
    phys.add({ kind: 'cylinder', x: 2.6, z: 15.5, r: 0.15, yMin: -2, yMax: 10 });
  }

  private buildDecor(statics: THREE.Group): void {
    const rng = this.rng;
    const H = L.height;
    const phys = this.ctx.physics;
    // Friendly snowmen around the world (no hats - hats are for the Hat Toss).
    const deco: [number, number, number, number, 'top' | 'beanie' | null][] = [
      [-6.5, 31.5, 0.5, P.coral, 'top'],
      [5, 23, -0.5, P.lilac, 'beanie'],
      [-14, 22, 0.9, P.blue, null],
      [-6, -2, 0.3, P.peach, 'beanie'],
      [8, -10, -0.6, P.teal, null],
    ];
    for (const [x, z, ry, scarf, hat] of deco) {
      const s = props.snowman({ scarf, hat, hatColor: hat === 'top' ? 0x5a5670 : P.blue, wave: 1.1 });
      s.group.position.set(x, H(x, z) - 0.05, z);
      s.group.rotation.y = ry;
      statics.add(s.group);
      phys.add({ kind: 'cylinder', x, z, r: 0.55, yMin: -2, yMax: H(x, z) + 2.2 });
    }
    // Rocks.
    for (let i = 0; i < 26; i++) {
      const x = rng.range(-50, 50);
      const z = rng.range(-50, 50);
      if (Math.hypot(x, z) > 52 || L.keepClear(x, z, 1)) continue;
      const s = rng.range(0.5, 1.3);
      const r = props.rock(rng, s);
      r.position.set(x, H(x, z) - 0.1, z);
      statics.add(r);
      if (s > 0.8) phys.add({ kind: 'cylinder', x, z, r: s * 0.8, yMin: -2, yMax: H(x, z) + s * 0.8 });
    }
    // Sled at the bottom of the slide, fish bucket by the lagoon.
    const sl = props.sled();
    sl.position.set(-31.5, H(-31.5, 7.5), 7.5);
    sl.rotation.y = 0.6;
    statics.add(sl);
    const fb = props.fishBucket();
    fb.position.set(14.5, H(14.5, 8.5), 8.5);
    statics.add(fb);
    // Slide top: a little snowy platform with flags.
    const top = L.pointAt(L.slideLine, 0, new THREE.Vector3());
    for (const s of [-1, 1]) {
      const fx = top.x + s * 1.4;
      const fz = top.z - 0.8;
      statics.add(part(geo.cyl(1, 1, 6), mat(P.woodDark), [fx, H(fx, fz) + 0.8, fz], [0.05, 1.6, 0.05]));
      const flag = part(geo.cone(3), mat(s < 0 ? P.coral : P.blue, { rough: 0.8 }), [fx + 0.25, H(fx, fz) + 1.45, fz], [0.12, 0.45, 0.04], [0, 0, -Math.PI / 2]);
      statics.add(flag);
    }
    // Soft snow mounds (instanced).
    const mounds = scatter(geo.sphere(14), mat(P.snow, { rough: 0.9 }), 120, (_i, d) => {
      const x = rng.range(-52, 52);
      const z = rng.range(-52, 52);
      if (Math.hypot(x, z) > 54 || L.keepClear(x, z, 0.3)) return false;
      const s = rng.range(0.6, 1.6);
      d.position.set(x, H(x, z) - 0.05, z);
      d.scale.set(s, s * 0.32, s * rng.range(0.7, 1.1));
      d.rotation.y = rng.range(0, 6);
      return true;
    });
    mounds.receiveShadow = true;
    this.ctx.root.add(mounds);
  }

  // ============================================================== creatures

  private buildCreatures(): void {
    const ctx = this.ctx;
    const H = L.height;
    const ig = L.COSY_IGLOO;
    const mouthZ = ig.z + ig.r - 0.15 + (ig.r * 0.55 + 0.6) / 2;
    const door = new THREE.Vector3(ig.x, H(ig.x, mouthZ + 0.9) + 0.4, mouthZ + 0.9);
    const inside = new THREE.Vector3(ig.x, 0, mouthZ - 1.0);
    const scarves = [P.coral, P.lilac, P.blue, P.peach, P.teal, 0xefcf7b];
    const pond = new THREE.Vector3(L.POND.x, 0, L.POND.z);
    const specs: { pos: [number, number]; chick?: boolean; slider?: boolean }[] = [
      { pos: [-22, 12] },
      { pos: [-28, 19], chick: true },
      { pos: [-19, 20] },
      { pos: [-30, 4], slider: true },
      { pos: [-36, -8], slider: true },
      { pos: [-24, 9], chick: true },
    ];
    specs.forEach((s, i) => {
      const p = new THREE.Vector3(s.pos[0], 0, s.pos[1]);
      p.y = H(p.x, p.z);
      const pg = new Penguin(ctx, p, { chick: s.chick, slider: s.slider, region: pond, regionR: L.POND.r + 2, scarf: scarves[i], door, inside });
      pg.onHome = () => this.penguinHome();
      pg.onTooHeavy = () => this.tooHeavy();
      pg.onLifted = () => {
        if (!this.liftedSaid) {
          this.liftedSaid = true;
          ctx.say(ctx.hasAbility('bigBubble') ? 'ace_bigbubble' : 'ace_penguin', 1);
        } else if (ctx.rng.chance(0.35)) ctx.say('ace_penguin', 0);
        ctx.cheer(ctx.rng.pick(['Up you go!', 'Float home!', 'Wheee, penguin!']));
      };
      this.penguins.push(pg);
    });
    // Seals on the floes.
    const tints = [0xa7abbf, 0xb4abc6, 0xefebe4];
    for (let i = 0; i < 3; i++) {
      const f = L.FLOES[i];
      const p = new THREE.Vector3(f.x, L.FLOE_Y, f.z);
      const toShore = Math.atan2(L.LAGOON.x - f.x, L.LAGOON.z - f.z) + Math.PI;
      const s = new Seal(ctx, p, toShore, tints[i], i === 2);
      s.onCatch = () => {
        if (!this.sealSaid) {
          this.sealSaid = true;
          ctx.say('ace_seal', 1);
        }
      };
      s.onBalanced = () => this.sealPlayed();
      this.seals.push(s);
    }
    // Snow hares and arctic foxes.
    for (const [x, z] of [[-12, 28], [14, 20], [-30, -18], [24, -12], [30, 30]] as [number, number][]) {
      this.hares.push(new Hare(ctx, new THREE.Vector3(x, H(x, z), z), 8));
    }
    for (const [x, z] of [[-16, -8], [26, -2], [-38, 28], [6, -20]] as [number, number][]) {
      this.foxes.push(new Fox(ctx, new THREE.Vector3(x, H(x, z), z)));
    }
  }

  private buildWoolly(): void {
    const ctx = this.ctx;
    const p = L.WOOLLY.clone();
    p.y = L.height(p.x, p.z);
    const end = L.pointAt(L.valleyLine, 0.75, new THREE.Vector3());
    this.woolly = new Woolly(ctx, p, 0.25);
    ctx.physics.add({ kind: 'cylinder', x: p.x, z: p.z, r: 2.3, yMin: -2, yMax: p.y + 5.5, tag: 'woolly' });
    void end;
    this.snowball = new Snowball(ctx);
    const sb = this.snowball;
    sb.onArrive = () => this.startFinale();
    sb.onCheckpoint = (n) => {
      ctx.cheer(n === 1 ? 'Keep it rolling!' : 'Nearly there!');
      ctx.sfx('sfx_mammoth_trumpet', { pos: this.woolly.position, volume: 0.6, range: 80 });
      ctx.fx.sparkle(sb.pos.clone().add(new THREE.Vector3(0, sb.R + 0.4, 0)), 12, [0xffffff, 0xd6eef3], 1.2);
    };
    sb.onReform = () => {
      ctx.cheer('Whoops! Back up it goes!');
    };
    sb.onNudgeDisabled = () => {
      if (this.cooled('snowball', 8)) ctx.hint("That's Woolly's giant snowball! Let's help the other friends first.", 4);
    };
    sb.onFirstPush = () => ctx.cheer('Roll, snowball, roll!');
  }

  private buildLanterns(): void {
    const ctx = this.ctx;
    const fr = [0.2, 0.36, 0.52, 0.68, 0.84];
    for (const f of fr) {
      const at = L.pointAt(L.trailLine, f, new THREE.Vector3());
      const pr = L.project(at.x, at.z, L.trailLine);
      const side = f > 0.5 ? 1 : -1;
      at.x += pr.tz * 1.7 * side;
      at.z += -pr.tx * 1.7 * side;
      at.y = L.height(at.x, at.z);
      const model = props.lanternModel();
      model.group.position.copy(at);
      ctx.root.add(model.group);
      ctx.physics.add({ kind: 'cylinder', x: at.x, z: at.z, r: 0.35, yMin: -3, yMax: at.y + 1.7 });
      const center = at.clone().add(new THREE.Vector3(0, 1.22, 0));
      const slot: LanternSlot = {
        model,
        pos: center,
        lit: false,
        litT: 0,
        hit: {
          hitRadius: 0.75,
          active: true,
          aimAssist: 1.1,
          label: 'Ice lantern',
          hitCenter: (out) => out.copy(center),
          accepts: () => !slot.lit,
          onHit: (h: HitInfo): HitResponse => this.lanternHit(slot, h),
        },
      };
      ctx.hits.add(slot.hit);
      this.lanterns.push(slot);
    }
  }

  private lanternHit(slot: LanternSlot, h: HitInfo): HitResponse {
    const ctx = this.ctx;
    const glowOk = h.kind === 'glow' || !ctx.hasBlaster('glow');
    if (!glowOk) {
      if (h.kind !== 'fizz' && this.cooled('lantern', 5)) ctx.hint('Lanterns need a Glow Ball! Press [4] to light them up.', 4);
      ctx.fx.sparkle(slot.pos, 4, [0xd6eef3], 0.5);
      return h.kind === 'ball' ? 'bounce' : 'consume';
    }
    slot.lit = true;
    slot.litT = 0;
    slot.hit.active = false;
    slot.model.flameMat.color.set(0xffe2b8);
    slot.model.flameMat.emissive.set(0xf8b46e);
    slot.model.shell.color.set(0xfff3e4);
    slot.model.shell.emissive.set(0xf7c08c);
    slot.model.shell.emissiveIntensity = 0.55;
    ctx.sfx('sfx_glow_light', { pos: slot.pos });
    ctx.fx.sparkle(slot.pos, 18, [0xffe3b8, 0xfff6e6], 1.1);
    const lit = this.lanterns.filter((l) => l.lit).length;
    if (ctx.objectives.isCurrent('lanterns')) {
      ctx.objectives.set('lanterns', lit);
      if (lit < this.lanterns.length) ctx.cheer(lit === this.lanterns.length - 1 ? 'One more lantern!' : 'Glowing!');
    }
    return 'consume';
  }

  private buildCrystals(): void {
    const ctx = this.ctx;
    const H = L.height;
    const ib = L.IGLOO_B;
    const behind = new THREE.Vector3(ib.x - Math.sin(ib.door) * (ib.r + 1.1), 0, ib.z - Math.cos(ib.door) * (ib.r + 1.1));
    const slideTop = L.pointAt(L.slideLine, 0, new THREE.Vector3());
    const spots: THREE.Vector3[] = [
      new THREE.Vector3(L.ARCH.x, H(L.ARCH.x, L.ARCH.z) + 4.75, L.ARCH.z), // on top of the ice arch
      behind.setY(H(behind.x, behind.z) + 0.75), // behind an igloo
      new THREE.Vector3(34.4, H(34.4, 1.1) + 0.55, 1.1), // under the big snowy pine
      new THREE.Vector3(L.FLOES[3].x, L.FLOE_Y + 0.75, L.FLOES[3].z), // on a floe in the lagoon
      new THREE.Vector3(slideTop.x, H(slideTop.x, slideTop.z) + 0.9, slideTop.z - 0.4), // top of the penguin slide
    ];
    for (const p of spots) {
      this.crystals.push(new Collectible(ctx, p, props.crystalModel(), { objective: 'crystals', say: 'ace_found', cheer: 'Ice crystal!', color: 0xcfeaf6, glint: 1.3 }));
    }
  }

  private buildCourse(): void {
    const ctx = this.ctx;
    const H = L.height;
    const spots: [number, number][] = [
      [16, 28.5], [18.5, 33.5], [16, 38], [21.5, 27.5], [23.5, 31.5], [21.5, 38.5], [26, 35], [27.5, 29], [19, 43], [12.5, 41.5],
    ];
    const statics = new THREE.Group();
    const scarves = [P.coral, P.lilac, P.blue, P.peach, P.teal];
    const targets: { pos: THREE.Vector3; model: () => THREE.Object3D }[] = [];
    spots.forEach(([x, z], i) => {
      const sc = 0.85 + (i % 3) * 0.12;
      const s = props.snowman({ scale: sc, scarf: scarves[i % scarves.length], wave: 0.2 + (i % 4) * 0.4 });
      const y = H(x, z) - 0.05;
      s.group.position.set(x, y, z);
      s.group.rotation.y = Math.atan2(L.PAD.x - x, L.PAD.z - z);
      statics.add(s.group);
      ctx.physics.add({ kind: 'cylinder', x, z, r: 0.55 * sc, yMin: -2, yMax: y + 1.7 * sc });
      const kind: 'top' | 'beanie' = i % 2 === 0 ? 'top' : 'beanie';
      const col = kind === 'top' ? 0x5a5670 : [P.blue, P.coral, P.lilac, P.peach, P.teal][i % 5];
      targets.push({ pos: new THREE.Vector3(x, y + s.headTop + 0.18, z), model: () => props.hatModel(kind, col, kind === 'top' ? P.peach : 0xfbf6ef) });
    });
    ctx.root.add(mergeStatic(statics));
    this.course = new TargetCourse(ctx, {
      objective: 'hats',
      pad: L.PAD.clone(),
      par: 45,
      title: 'Snowman Hat Toss',
      intro: 'nar_challenge',
      targets,
      padColor: 0x9fc3e0,
    });
    // Peek at the course's targets so popped hats can burst into snow puffs.
    this.courseTargets = (this.course as unknown as { targets: PopTarget[] }).targets ?? [];
    this.coursePopped = this.courseTargets.map(() => false);
  }

  // ============================================================= objectives

  private cooled(key: string, sec: number): boolean {
    const t = this.ctx.time;
    if ((this.hintCool[key] ?? -99) + sec > t) return false;
    this.hintCool[key] = t;
    return true;
  }

  private later(sec: number, fn: () => void): void {
    this.timers.push({ t: sec, fn });
  }

  private sealPlayed(): void {
    const ctx = this.ctx;
    const n = this.seals.filter((s) => s.played).length;
    if (ctx.objectives.isCurrent('seals')) {
      ctx.objectives.set('seals', n);
      if (n < 3) ctx.cheer(n === 1 ? 'Seal-tastic!' : 'Clap clap clap!');
    } else ctx.cheer('Arf arf!');
  }

  private tooHeavy(): void {
    const ctx = this.ctx;
    ctx.cheer(ctx.rng.pick(['Too heavy!', 'Hee hee, wobble!', 'Need a BIG bubble!']));
    if (this.cooled('heavy', 7)) ctx.hint('Penguins are too heavy for little bubbles! Hold [Click] to charge a BIG bubble, then let go.', 5);
  }

  private penguinHome(): void {
    const ctx = this.ctx;
    this.homeCount++;
    ctx.sfx('sfx_penguin_squeak', { pos: this.penguins[0].o.door, rate: 1.2 });
    ctx.fx.hearts(this.penguins[0].o.door.clone().add(new THREE.Vector3(0, 1.2, 0)), 4);
    ctx.fx.sparkle(this.penguins[0].o.door.clone().add(new THREE.Vector3(0, 1, 0)), 10, [0xffe3b8, 0xfff6e6], 0.9);
    if (this.doorGlow) this.doorGlow.color.setScalar(Math.min(1.35, 0.85 + this.homeCount * 0.09));
    if (ctx.objectives.isCurrent('penguins')) {
      ctx.objectives.set('penguins', this.homeCount);
      if (this.homeCount < 6) ctx.cheer(`Home sweet home! ${this.homeCount} of 6`);
    } else ctx.cheer('Cosy and warm!');
  }

  override begin(): void {
    this.showStepHint();
    // Point Ace towards the seals on the lagoon to start.
    this.later(this.ctx.probe ? 0 : 2.8, () => {
      if (this.ctx.objectives.isCurrent('seals')) {
        this.ctx.focusOn(this.seals[1].position.clone().add(new THREE.Vector3(0, 0.6, 0)), 1.8);
        this.ctx.say('ace_lookthere', 0);
      }
    });
  }

  /** Glance towards the next goal if it's far away. */
  private guideTo(p: THREE.Vector3, delay = 2.2): void {
    this.later(delay, () => {
      if (this.ctx.player.position.distanceTo(p) > 14) this.ctx.focusOn(p, 1.8);
    });
  }

  override onObjectiveComplete(id: string): void {
    const ctx = this.ctx;
    if (id === 'seals') {
      ctx.banner('Seal of approval!', 'The seals loved playing catch', 2.6);
      for (const s of this.seals) ctx.fx.hearts(s.position.clone().add(new THREE.Vector3(0, 1.4, 0)), 3);
      ctx.sfx('sfx_seal_clap');
      ctx.say('ace_yay', 1);
      this.later(1.6, () => this.syncCounts());
      this.guideTo(this.penguins[0].position.clone().add(new THREE.Vector3(0, 0.6, 0)), 3.2);
    }
    if (id === 'penguins') {
      ctx.say('ace_happy', 1);
      this.later(1.2, () => this.penguinParty());
      this.later(1.6, () => this.syncCounts());
      this.guideTo(this.lanterns[0].pos.clone(), 3.4);
    }
    if (id === 'lanterns') {
      ctx.say('ace_cool', 1);
      this.later(1.5, () => this.wakeWoolly());
    }
    if (id === 'woolly') {
      ctx.banner('What a catch, Woolly!', 'Best snowball game ever!', 3.5);
    }
    if (id === 'crystals') ctx.fx.celebrate(ctx.player.eyePosition(new THREE.Vector3()).add(ctx.player.viewForward(new THREE.Vector3()).multiplyScalar(3)), 0.8);
    this.later(0.2, () => this.showStepHint());
  }

  /** Early progress (done before a step was current) is credited when it becomes current. */
  private syncCounts(): void {
    const ctx = this.ctx;
    if (ctx.objectives.isCurrent('penguins')) ctx.objectives.set('penguins', this.homeCount);
    if (ctx.objectives.isCurrent('lanterns')) ctx.objectives.set('lanterns', this.lanterns.filter((l) => l.lit).length);
    if (ctx.objectives.isCurrent('seals')) ctx.objectives.set('seals', this.seals.filter((s) => s.played).length);
  }

  private penguinParty(): void {
    const ctx = this.ctx;
    const door = this.penguins[0].o.door;
    this.penguins.forEach((p, i) => {
      p.party(new THREE.Vector3(door.x + (i - 2.5) * 0.7, L.height(door.x, door.z + 1.5), door.z + 1.5), (i / 6) * Math.PI * 2);
    });
    ctx.fx.celebrate(door.clone().add(new THREE.Vector3(0, 1.6, 1.5)), 1.1);
    ctx.banner('All the penguins are home!', 'Snug as a bug in their cosy scarves', 3);
  }

  private wakeWoolly(): void {
    const ctx = this.ctx;
    this.snowball.enabled = true;
    this.woolly.eager = true;
    this.woolly.watch = this.snowball.pos;
    this.woolly.trumpet(1);
    ctx.narrate('nar_frosty_woolly');
    ctx.banner('Big friend: Woolly!', 'Roll the giant snowball down to him', 3.5);
    ctx.focusOn(this.snowball.pos.clone(), 2.4);
    this.later(2.6, () => ctx.say('ace_woolly', 1));
  }

  private showStepHint(): void {
    const ctx = this.ctx;
    const cur = ctx.objectives.current();
    if (!cur) {
      ctx.hint(null);
      return;
    }
    const id = cur.def.id;
    const first = !this.stepHinted.has(id);
    this.stepHinted.add(id);
    if (id === 'seals') {
      ctx.hint(ctx.hasBlaster('boing') ? 'Press [2] for the Boing Ball, then bounce balls to the seals!' : 'Blow bubbles at the seals on the ice floes - they love to play!');
    } else if (id === 'penguins') {
      if (ctx.hasAbility('bigBubble')) {
        ctx.hint('Penguins are heavy! Hold [Click] to charge a BIG bubble, then let go.');
        if (first) ctx.narrate('nar_frosty_bigbubble');
      } else ctx.hint('Blow bubbles at the penguins to float them home to the cosy igloo!');
    } else if (id === 'lanterns') {
      ctx.hint(ctx.hasBlaster('glow') ? 'Press [4] for the Glow Ball and light the ice lanterns up the hill!' : 'Bubble the ice lanterns up the hill to light the way!');
    } else if (id === 'woolly') {
      ctx.hint(ctx.hasBlaster('boing') ? "Bounce Boing Balls [2] at the giant snowball to roll it down to Woolly!" : 'Push the giant snowball down to Woolly!');
    }
  }

  // ================================================================ finale

  private startFinale(): void {
    const ctx = this.ctx;
    this.finale = 'catch';
    this.finaleT = 0;
    this.catchFrom.copy(this.snowball.pos);
    this.woolly.startCatch();
    this.woolly.watch = this.snowball.pos;
    ctx.hint(null);
    ctx.focusOn(this.woolly.position.clone().add(new THREE.Vector3(0, 5, 0)), 3.2);
    ctx.sfx('sfx_mammoth_trumpet', { pos: this.woolly.position, volume: 1, range: 90 });
    ctx.cheer('Catch, Woolly!');
  }

  private updateFinale(dt: number): void {
    if (this.finale === 'none' || this.finale === 'done') return;
    const ctx = this.ctx;
    const sb = this.snowball;
    this.finaleT += dt;
    const tip = this.woolly.trunkTip(this.tmp);
    if (this.finale === 'catch') {
      const k = Math.min(1, this.finaleT / 1.1);
      const e = easeInOutSine(k);
      const target = this.tmp2.copy(tip).addScaledVector(UPV, sb.R * 0.8);
      const p = this.tmp2.lerpVectors(this.catchFrom, target, e);
      p.y += Math.sin(k * Math.PI) * 2.2;
      sb.placeAt(p, 2, dt);
      if (k >= 1) {
        this.finale = 'juggle';
        this.finaleT = 0;
        this.woolly.startJuggle();
        ctx.sfx('sfx_snow_poof', { pos: sb.pos });
        ctx.banner('Woolly caught it!', 'Look at him juggle!', 2.5);
      }
    } else if (this.finale === 'juggle') {
      const bounce = Math.abs(Math.sin(this.finaleT * 3.6));
      const p = this.tmp2.copy(tip);
      p.y += sb.R * 0.8 + bounce * 1.9;
      sb.placeAt(p, 4, dt);
      if (bounce < 0.08 && this.cooled('jug', 0.5)) {
        ctx.sfx('sfx_snow_poof', { pos: sb.pos, volume: 0.6 });
        ctx.fx.puff(sb.pos.clone().setY(sb.pos.y - sb.R), 0xf6f3f6, 6, 0.9);
      }
      if (this.finaleT > 3.6) {
        this.finale = 'toss';
        this.finaleT = 0;
        this.woolly.startToss();
        sb.launch(new THREE.Vector3(0, 15, 0));
        ctx.sfx('sfx_mammoth_trumpet', { pos: this.woolly.position, volume: 1, rate: 1.08, range: 90 });
        ctx.focusOn(sb.pos.clone().add(new THREE.Vector3(0, 9, 0)), 2.4);
      }
    } else if (this.finale === 'toss') {
      if (sb.flight(dt)) {
        sb.burst();
        this.finale = 'done';
        this.auroraTarget = 0.85;
        ctx.shake(0.06);
        ctx.objectives.complete('woolly');
        this.woolly.celebrate();
        this.woolly.watch = null;
        this.woolly.eager = false;
        ctx.say('ace_woolly_done', 2);
        const c = sb.pos.clone();
        this.later(0.6, () => ctx.fx.celebrate(c.clone().add(new THREE.Vector3(-3, -2, 0)), 1.4));
        this.later(1.2, () => ctx.fx.celebrate(c.clone().add(new THREE.Vector3(3, -3, 1)), 1.4));
        this.later(1.8, () => ctx.fx.hearts(this.woolly.position.clone().add(new THREE.Vector3(0, 7, 0)), 8));
      }
    }
  }

  // ================================================================ update

  update(dt: number, t: number): void {
    const ctx = this.ctx;
    // Timers.
    for (let i = this.timers.length - 1; i >= 0; i--) {
      this.timers[i].t -= dt;
      if (this.timers[i].t <= 0) {
        const f = this.timers[i].fn;
        this.timers.splice(i, 1);
        f();
      }
    }
    for (const p of this.penguins) p.update(dt, t);
    for (const s of this.seals) s.update(dt, t);
    for (const h of this.hares) h.update(dt, t);
    for (const f of this.foxes) f.update(dt, t);
    this.woolly.update(dt, t);
    this.snowball.update(dt, t);
    this.updateFinale(dt);
    // A friendly glint on the giant snowball while it's waiting for Ace.
    const sb = this.snowball;
    if (sb.enabled && (sb.state === 'rest' || sb.state === 'roll') && this.cooled('sbglint', 1.4)) {
      ctx.fx.sparkle(sb.pos.clone().add(new THREE.Vector3(0, sb.R + 0.5, 0)), 6, [0xffffff, 0xd6eef3], 1.1);
    }
    for (const c of this.crystals) c.update(dt, t);
    this.course.update(dt, t);
    this.updateCoursePuffs();
    for (const tr of this.trees) tr.cool -= dt;
    this.updateLanterns(dt, t);
    this.updatePlayerSurface(dt);
    this.updateBallsInWater();
    this.updateSnowballPush(dt);
    this.updateBlasterNags(dt);
    // Sky life.
    this.aurora.material.uniforms.uTime.value = t;
    const au = this.aurora.material.uniforms.uStrength;
    au.value = damp(au.value, this.auroraTarget + Math.sin(t * 0.3) * 0.03, 0.6, dt);
    this.clouds.rotation.y += dt * 0.003;
    // Diamond dust: tiny glints on the snow near Ace.
    this.dustT -= dt;
    if (this.dustT <= 0) {
      this.dustT = 0.07;
      const pl = ctx.player.position;
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 12;
      const x = pl.x + Math.cos(a) * r;
      const z = pl.z + Math.sin(a) * r;
      this.tmp.set(x, L.height(x, z) + 0.05 + Math.random() * 1.5, z);
      if (!L.inLagoonWater(x, z)) ctx.fx.glow.emit(this.tmp, { count: 1, shape: Shape.Sparkle, size: 0.14, sizeEnd: 0.02, speed: 0.05, life: 0.7, color: 0xfff6ea, alpha: 0.6, fadeIn: 0.3, spinSpeed: 1 });
    }
  }

  private updateCoursePuffs(): void {
    const ctx = this.ctx;
    this.courseTargets.forEach((tg, i) => {
      if (tg.popped && !this.coursePopped[i]) {
        ctx.fx.puff(tg.group.position, 0xf6f3f6, 10, 1.1);
        ctx.fx.soft.emit(tg.group.position, { count: 12, shape: Shape.Dot, size: 0.16, sizeEnd: 0.08, speed: 3, life: 0.9, gravity: 5, color: 0xffffff, dir: new THREE.Vector3(0, 1, 0), spread: 0.8 });
        ctx.sfx('sfx_snow_poof', { pos: tg.group.position, volume: 0.6 });
      }
      this.coursePopped[i] = tg.popped;
    });
  }

  private updateLanterns(dt: number, t: number): void {
    const ctx = this.ctx;
    for (const l of this.lanterns) {
      if (!l.lit) {
        // A soft cool shimmer so they're easy to spot.
        if (Math.random() < dt * 0.6) ctx.fx.glow.emit(l.pos, { count: 1, shape: Shape.Sparkle, size: 0.4, sizeEnd: 0.05, speed: 0, life: 0.6, color: 0xd6eef3, alpha: 0.45, fadeIn: 0.3 });
        continue;
      }
      l.litT += dt;
      const flick = 2.2 + Math.sin(t * 7 + l.pos.x) * 0.2 + Math.sin(t * 13 + l.pos.z) * 0.12;
      l.model.flameMat.emissiveIntensity = Math.min(1, l.litT * 2) * flick;
      l.model.flame.scale.setScalar(0.16 * (1 + Math.sin(t * 9 + l.pos.x) * 0.06));
      if (Math.random() < dt * 2.2) ctx.fx.glow.emit(l.pos, { count: 1, shape: Shape.Dot, size: 1.5, sizeEnd: 1.2, speed: 0, life: 0.9, color: 0xf7c48e, alpha: 0.16, fadeIn: 0.4 });
    }
  }

  /** Slippery pond, the penguin slide, and a kind splash-back from the icy lagoon. */
  private updatePlayerSurface(dt: number): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    const p = pl.position;
    const ext = pl.externalVel;
    const gh = L.height(p.x, p.z);
    const grounded = p.y - gh < 0.08;
    // Frozen pond: Ace glides a little (momentum carries).
    if (grounded && L.onPond(p.x, p.z)) {
      ext.x += pl.velocity.x * 1.7 * dt;
      ext.z += pl.velocity.z * 1.7 * dt;
      const m = Math.hypot(ext.x, ext.z);
      if (m > 3.2) {
        ext.x *= 3.2 / m;
        ext.z *= 3.2 / m;
      }
      const sp = Math.hypot(pl.velocity.x + ext.x, pl.velocity.z + ext.z);
      if (sp > 2 && Math.random() < dt * 10) ctx.fx.trail(this.tmp.set(p.x, gh + 0.05, p.z), 0xffffff, 0.12, 0.5);
      if (!this.iceHinted && Math.hypot(ext.x, ext.z) > 1.2) {
        this.iceHinted = true;
        ctx.say('ace_whee', 1);
        ctx.cheer('Slippery ice! Wheee!');
      }
    }
    // Penguin slide: slide down the chute like a penguin!
    const sp = L.project(p.x, p.z, L.slideLine);
    if (grounded && sp.d < 0.95 && sp.s > 0.01 && sp.s < 0.985) {
      const along = ext.x * sp.tx + ext.z * sp.tz;
      if (along < 7.5) {
        ext.x += sp.tx * 11 * dt;
        ext.z += sp.tz * 11 * dt;
      }
      // Gently keep Ace in the trough.
      if (this.slideCheer <= 0 && along > 3) {
        this.slideCheer = 6;
        ctx.say('ace_whee', 0);
        ctx.cheer('Penguin slide!');
      }
      if (Math.random() < dt * 14) ctx.fx.trail(this.tmp.set(p.x, gh + 0.05, p.z), 0xf6f8fc, 0.16, 0.6);
    }
    this.slideCheer -= dt;
    // Icy lagoon: Ace hops floes, but a slip into the water pops them back to the shore.
    if (L.inLagoonWater(p.x, p.z) && p.y < L.WATER_Y + 0.05) {
      ctx.fx.splash(this.tmp.set(p.x, L.WATER_Y, p.z), 1.2);
      ctx.sfx('sfx_splash', { pos: this.tmp });
      pl.spawn(this.lastSafe.clone().setY(this.lastSafe.y + 0.3), pl.yaw, pl.pitch);
      ctx.cheer('Brrr! Chilly toes!');
      if (this.cooled('splash', 8)) ctx.hint('Hop from floe to floe - or bounce balls from the shore!', 4);
    } else if (pl.onGround && !L.inLagoonWater(p.x, p.z)) {
      const lagoonD = Math.hypot(p.x - L.LAGOON.x, p.z - L.LAGOON.z);
      // Remember a safe spot (a little back from the water's edge when on shore).
      if (lagoonD > L.LAGOON.r + 0.8 || L.onFloe(p.x, p.z, -0.3)) this.lastSafe.copy(p);
    }
  }

  private updateBallsInWater(): void {
    const ctx = this.ctx;
    const balls = ctx.projectiles.balls;
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i];
      if (b.heldBy || !b.alive) continue;
      if (b.pos.y < L.WATER_Y + 0.12 && L.inLagoonWater(b.pos.x, b.pos.z)) {
        ctx.fx.splash(this.tmp.set(b.pos.x, L.WATER_Y, b.pos.z), 0.6);
        ctx.sfx('sfx_splash', { pos: this.tmp, volume: 0.5 });
        ctx.projectiles.removeBall(b, false);
      }
    }
  }

  private updateSnowballPush(dt: number): void {
    const sb = this.snowball;
    const p = this.ctx.player.position;
    const dx = sb.pos.x - p.x;
    const dz = sb.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < sb.R + 0.6 && p.y < sb.pos.y + sb.R * 0.5) {
      this.tmp.set(dx / d, 0, dz / d);
      sb.nudge(this.tmp, dt);
    }
  }

  private updateBlasterNags(dt: number): void {
    const ctx = this.ctx;
    this.blasterNag -= dt;
    if (this.blasterNag > 0) return;
    this.blasterNag = 2;
    const cur = ctx.objectives.current()?.def.id;
    const pl = ctx.player.position;
    if (cur === 'penguins' && ctx.hasAbility('bigBubble') && ctx.blaster !== 'bubble') {
      const near = this.penguins.some((pg) => !pg.isHome && pg.position.distanceTo(pl) < 14);
      if (near && this.cooled('nag-bubble', 14)) ctx.hint('Press [1] for the Bubble Wand, then hold [Click] for a BIG bubble!', 4);
    }
    if (cur === 'seals' && ctx.hasBlaster('boing') && ctx.blaster !== 'boing' && ctx.blaster !== 'glow') {
      if (Math.hypot(pl.x - L.LAGOON.x, pl.z - L.LAGOON.z) < 16 && this.cooled('nag-boing', 14)) ctx.hint('Seals love balls! Press [2] for the Boing Ball.', 4);
    }
    if (cur === 'lanterns' && ctx.hasBlaster('glow') && ctx.blaster !== 'glow') {
      const near = this.lanterns.some((l) => !l.lit && l.pos.distanceTo(pl) < 14);
      if (near && this.cooled('nag-glow', 14)) ctx.hint('Press [4] for the Glow Ball to light the lanterns!', 4);
    }
    if (cur === 'woolly' && ctx.hasBlaster('boing') && (ctx.blaster === 'bubble' || ctx.blaster === 'glow')) {
      if (sbNear(this.snowball, pl) && this.cooled('nag-ball', 14)) ctx.hint('Press [2] for Boing Balls (or [3] for the Fizz Fountain) to push the snowball!', 4);
    }
  }

  override dispose(): void {
    this.timers.length = 0;
  }
}

function sbNear(sb: Snowball, p: THREE.Vector3): boolean {
  return sb.pos.distanceTo(p) < 18;
}
