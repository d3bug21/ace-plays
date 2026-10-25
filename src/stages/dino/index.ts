import * as THREE from 'three';
import type { StageMeta } from '../index';
import { Stage, type StageContext, type StageEnvironment, type StageInfo, type ObjectiveDef } from '../types';
import { Noise, Rng, clamp, smoothstep, wrapAngle } from '../../core/math';
import { makeTerrain, distToPath } from '../../kit/terrain';
import { geo, mat, mergeStatic, part } from '../../kit/kit';
import { makeClouds } from '../../fx/Environment';
import { Collectible, PopTarget, TargetCourse } from '../../gameplay/Helpers';
import type { HitInfo } from '../../gameplay/Hit';
import { Chirper, Lulu, Peeker, Ptero, Stego, Trike } from './creatures';
import { bakeWorldGeometry, collapse, vcMat } from './bake';
import * as props from './props';

const P = props.P;

const info: StageInfo = {
  id: 'dino',
  name: 'Dino Valley',
  tagline: 'Friendly dinosaurs, big and small! Find their eggs and help Lulu the long-neck.',
  map: { x: 40, y: 42 },
  accent: '#c99a5b',
  icon: 'dino',
  musicId: 'mus_dino',
  ambienceId: 'amb_dino',
  introNarration: 'nar_dino_intro',
  introAce: 'ace_dino_intro',
  mode: 'walk',
  reward: { blaster: 'fizz', title: 'Fizz Fountain unlocked!', text: 'A fizzy stream of tiny bubbles. Press 3 to use it.' },
  footstep: 'sfx_step_grass',
};

const objectives: ObjectiveDef[] = [
  { id: 'eggs', kind: 'main', label: 'Find the lost dino eggs', icon: 'egg', target: 4, hint: 'Look for little glints around the valley' },
  { id: 'nest', kind: 'main', label: 'Bring the eggs to the big nest', icon: 'egg', target: 1, hint: 'Mama Chirp is waiting by her nest' },
  { id: 'chirpers', kind: 'main', label: 'Bubble the lost chirpers home', icon: 'dino', target: 5, hint: 'A bubble floats them back to the nest' },
  { id: 'lulu', kind: 'main', label: "Cure Lulu's hiccups", icon: 'longneck', target: 5, hint: 'Land bubbles on her nose' },
  { id: 'gems', kind: 'treasure', label: 'Find amber gems', icon: 'gem', target: 5 },
  { id: 'fruitpop', kind: 'challenge', label: 'Fern Fruit Pop: 12 in 45s', icon: 'clock', target: 1 },
];

export const meta: StageMeta = { info, objectives, introColors: ['#c9ad7d', '#5b5a3c'] };

export function create(): Stage {
  return new DinoStage();
}

// ------------------------------------------------------------------ layout
const BC = new THREE.Vector2(0, 6); // bounds centre
const BR = 52;
const RW = 2.6; // river half width
const WATER_Y = -0.22;
const RIVER: [number, number][] = [[-45, -2], [-36, 0], [-24, 4], [-12, 6], [-4, 4], [6, 0], [16, -1], [28, 2], [40, 8], [52, 12], [66, 15]];
const POOL = new THREE.Vector2(-44.5, -2);
const POOL_R = 4.6;
const BLUFF = new THREE.Vector2(-57, -2);
const ALCOVE = new THREE.Vector2(-49.6, -2);
const PATHS: [number, number][][] = [
  [[0, 56], [0, 44], [-3, 34], [-4, 22], [-4, 12], [-4, 7.5]],
  [[-4, 0.5], [-3, -6], [-4, -16], [-2, -26], [0, -34], [0, -40]],
  [[-3.5, 28], [6, 26], [16, 28], [24, 30]],
  [[24, 30], [26, 20], [24, 8], [24, -4], [22, -12], [24, -20], [28, -26], [32, -30]],
  [[-3, -8], [8, -10], [18, -13], [22, -12]],
  [[-4, 14], [-14, 16], [-26, 18], [-36, 10], [-41, 3]],
  [[-4, -15], [-14, -19], [-21, -23]],
];
const NEST = new THREE.Vector3(-10, 0, 34);
const NEST_R = 3.2;
const GLADE = new THREE.Vector3(0, 0, -38);
const LULU_SPOT = new THREE.Vector3(0, 0, -56);
const GROVE = new THREE.Vector3(33, 0, 23);
const PAD = new THREE.Vector3(24, 0, 30);
const LOOKOUT = new THREE.Vector3(32, 0, -30);
const MUSH = new THREE.Vector3(-25, 0, -27);
const SHELF = new THREE.Vector3(34.5, 0, 41);
const ARCH = new THREE.Vector3(10, 0, -0.4);
const SPAWN = new THREE.Vector3(0, 0, 52);

const terrace = (v: number, step: number): number => {
  const t = v / step;
  const f = t - Math.floor(t);
  return (Math.floor(t) + smoothstep(0.3, 0.7, f)) * step;
};

interface Fruit { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; alive: boolean }

class DinoStage extends Stage {
  readonly info = info;
  readonly objectives = objectives;
  readonly env: StageEnvironment = {
    sky: { top: '#93bfd0', horizon: '#f4e4c6', bottom: '#dcc69c', sunColor: '#fff0d2', sunSize: 1.3 },
    fog: { color: '#ece0c6', density: 0.006 },
    hemi: { sky: '#fbf0dc', ground: '#a3956e', intensity: 1.3 },
    sun: { color: '#ffe9c8', intensity: 2.6, dir: [0.55, 0.8, 0.3], shadows: true },
    exposure: 1.0,
    bloom: { strength: 0.22, radius: 0.5, threshold: 0.9 },
    weather: { kind: 'pollen', density: 0.3, color: '#fff3d6' },
  };
  readonly spawn = { pos: SPAWN.clone(), yaw: 0 };
  override challengePar = 45;
  private noise = new Noise(77);
  private rng = new Rng(2024);
  private chirpers: Chirper[] = [];
  private lost: Chirper[] = [];
  private hatchlings: Chirper[] = [];
  private mama!: Chirper;
  private trikes: Trike[] = [];
  private stegos: Stego[] = [];
  private pteros: Ptero[] = [];
  private peeker!: Peeker;
  private lulu!: Lulu;
  private eggs: Collectible[] = [];
  private gems: Collectible[] = [];
  private nestEggs: THREE.Group[] = [];
  private course!: TargetCourse;
  private hatchT = -1;
  private hatched = 0;
  private river!: THREE.Mesh;
  private riverTex!: THREE.Texture;
  private fallTex!: THREE.Texture;
  private falls: THREE.Mesh[] = [];
  private clouds!: THREE.Object3D;
  private puffs!: THREE.InstancedMesh;
  private puffAge: number[] = [];
  private volcanoTop = new THREE.Vector3(48, 52, -185);
  private vents: THREE.Vector3[] = [];
  private ventT = 0;
  private fallT = 0;
  private fruitTrees: THREE.Vector3[] = [];
  private fruits: Fruit[] = [];
  private luluCollider!: { kind: 'sphere'; center: THREE.Vector3; r: number };
  private hintShown = new Set<string>();
  private wrongHintT = -99;
  private eggLineSaid = false;
  private chirperLineSaid = false;
  private trikeLineSaid = false;
  private luluArrived = false;
  private camOverride: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private tmp = new THREE.Vector3();
  private dragonflies: { g: THREE.Group; wings: THREE.Mesh; base: THREE.Vector3; ph: number }[] = [];

  // ---------------------------------------------------------------- terrain
  pathDist(x: number, z: number): number {
    let d = Infinity;
    for (const p of PATHS) d = Math.min(d, distToPath(x, z, p));
    return d;
  }

  riverDist(x: number, z: number): number {
    return distToPath(x, z, RIVER);
  }

  height = (x: number, z: number): number => {
    const n = this.noise;
    let h = n.fbm2(x * 0.022, z * 0.022, 3) * 1.3 + n.n2(x * 0.09, z * 0.09) * 0.15;
    const dp = this.pathDist(x, z);
    h *= 0.3 + 0.7 * smoothstep(1.5, 7, dp);
    // Lookout hill on the volcano path.
    const dl = Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z);
    h += (1 - smoothstep(0, 10, dl)) * 4.4;
    // Gentle nest knoll and a flat glade.
    const dn = Math.hypot(x - NEST.x, z - NEST.z);
    h = h + (0.35 - h) * (1 - smoothstep(5, 9, dn));
    const dg = Math.hypot(x - GLADE.x, z - GLADE.z);
    h = h + (0.2 - h) * (1 - smoothstep(5, 11, dg)) * 0.8;
    // River + pool.
    const dr = this.riverDist(x, z);
    const dpool = Math.hypot(x - POOL.x, z - POOL.y);
    const near = Math.max(1 - smoothstep(RW + 1, RW + 7, dr), 1 - smoothstep(POOL_R + 1, POOL_R + 5, dpool));
    h = h + (0.12 - h) * near;
    const bedK = Math.max(1 - smoothstep(RW - 1.4, RW + 0.6, dr), 1 - smoothstep(POOL_R - 1.6, POOL_R + 0.5, dpool));
    h -= bedK * 0.78;
    // Sandstone cliffs ringing the valley, opening to a back meadow in the north.
    const dx = x - BC.x;
    const dz = z - BC.y;
    const r = Math.hypot(dx, dz);
    const a = Math.atan2(dz, dx);
    const north = Math.exp(-((wrapAngle(a + Math.PI / 2) / 0.8) ** 2));
    const R = 55 + north * 19 + n.n2(Math.cos(a) * 2.2, Math.sin(a) * 2.2) * 3;
    const e = r - R;
    let cliff = smoothstep(-3, 7, e) * (11 + n.n2(a * 3, 1.7) * 3) * (1 - north * 0.6) + smoothstep(9, 30, e) * 13 * (1 - north * 0.55);
    cliff *= smoothstep(RW - 0.5, RW + 9, dr) * 0.85 + 0.15 * (1 - bedK);
    h += terrace(cliff, 2.6);
    // The waterfall bluff with a little grotto carved behind the falls.
    const db = Math.hypot(x - BLUFF.x, (z - BLUFF.y) * 0.75);
    h += terrace((1 - smoothstep(5.5, 8, db)) * 9.6, 2.4);
    const ak = (1 - smoothstep(1.15, 1.7, Math.abs(x - ALCOVE.x))) * (1 - smoothstep(2.4, 3.1, Math.abs(z - ALCOVE.y)));
    h = h + (0.25 - h) * ak;
    return h;
  };

  build(ctx: StageContext): void {
    this.ctx = ctx;
    const root = ctx.root;
    const rng = this.rng;
    ctx.physics.groundHeight = this.height;
    ctx.physics.boundsCenter.copy(BC);
    ctx.physics.boundsRadius = BR;
    this.spawn.pos.y = this.height(SPAWN.x, SPAWN.z);
    const H = (x: number, z: number) => this.height(x, z);

    this.buildTerrain(root);
    this.buildWater(root);
    const statics = new THREE.Group();
    this.buildVegetation(root, statics);
    this.buildLandmarks(root, statics);
    // Merge every static prop into a single vertex-coloured mesh.
    const cellsG = new Map<string, THREE.Group>();
    for (const ch of [...statics.children]) {
      const key = `${Math.floor(ch.position.x / 40)},${Math.floor(ch.position.z / 40)}`;
      let g = cellsG.get(key);
      if (!g) cellsG.set(key, (g = new THREE.Group()));
      g.add(ch);
    }
    for (const g of cellsG.values()) {
      const sg = bakeWorldGeometry(g);
      if (!sg) continue;
      sg.computeBoundingSphere();
      const m = new THREE.Mesh(sg, vcMat(0.9));
      m.castShadow = true;
      m.receiveShadow = true;
      root.add(m);
    }
    this.buildVolcano(root);
    this.clouds = mergeStatic(makeClouds(12, 170, 70, 0xfffaf0, 9), false, false);
    root.add(this.clouds);

    // ------------------------------------------------------------ creatures
    const tints = [0xeeb48f, 0xe9cf86, 0xb9cfa0, 0xf0c9a4, 0xe3a07f];
    this.mama = new Chirper(ctx, new THREE.Vector3(NEST.x + 4.6, H(NEST.x + 4.6, NEST.z - 1), NEST.z - 1), { tint: 0xe6a983, crest: 0xc97c5d, mode: 'mama', scale: 2.3 });
    this.chirpers.push(this.mama);
    const lostSpots: [number, number, number][] = [[13, 20, 4], [16, 23, 4], [-27, -13, 4], [-22, -11, 4], [-36, 8, 3.5]];
    lostSpots.forEach(([x, z, area], i) => {
      const c = new Chirper(ctx, new THREE.Vector3(x, H(x, z), z), { tint: tints[i], crest: i % 2 ? 0xd98b6a : 0xc98a64, mode: 'lost', area });
      this.setupChirper(c);
      this.lost.push(c);
      this.chirpers.push(c);
    });
    // Trikes in the north-east meadow (one is a baby).
    const trikeSpots: [number, number, number][] = [[20, -16, 1], [26, -20, 1], [23, -23, 0.62]];
    trikeSpots.forEach(([x, z, s], i) => {
      const t = new Trike(ctx, new THREE.Vector3(x, H(x, z), z), { body: [0xd99c74, 0xcf9f7a, 0xe6ad8a][i], frill: [0xefd08a, 0xf0dba6, 0xefc18e][i], scale: s });
      t.onBoop = () => {
        if (!this.trikeLineSaid) {
          this.trikeLineSaid = true;
          ctx.say('ace_trike', 1);
        } else if (Math.random() < 0.4) ctx.cheer(rng.pick(['Boop!', 'Wiggle wiggle!', 'Happy trike!']));
      };
      this.trikes.push(t);
    });
    this.stegos.push(new Stego(ctx, new THREE.Vector3(-29, H(-29, 23), 23)));
    this.stegos.push(new Stego(ctx, new THREE.Vector3(-34, H(-34, 15), 15), { body: 0xa3b38a, plates: [0xf0c48a, 0xe39a7e] }));
    this.pteros.push(new Ptero(ctx, new THREE.Vector3(0, 0, 4), 17, 9.5, 1));
    this.pteros.push(new Ptero(ctx, new THREE.Vector3(26, 0, 14), 11, 8, -1, { body: 0xc9a98a, wing: 0xefdcc0, tip: 0xe39a7e }));
    this.pteros.push(new Ptero(ctx, new THREE.Vector3(-24, 0, -6), 13, 10.5, 1, { body: 0xd8bf9c, wing: 0xf2e3c8, tip: P.butter, scale: 1.25 }));
    const logPos = new THREE.Vector3(-9.5, 0, -16);
    this.peeker = new Peeker(ctx, new THREE.Vector3(logPos.x + 1.95, H(logPos.x, logPos.z) + 0.55, logPos.z), Math.PI / 2);
    // Lulu.
    this.lulu = new Lulu(ctx, [new THREE.Vector3(-20, 0, -61), new THREE.Vector3(20, 0, -61)], LULU_SPOT);
    this.luluCollider = ctx.physics.add({ kind: 'sphere', center: new THREE.Vector3(0, -100, 0), r: 2.6 });
    this.lulu.onCalm = (n) => {
      if (!ctx.objectives.isCurrent('lulu')) return;
      ctx.objectives.add('lulu');
      if (n < 5) {
        ctx.cheer(['Hic... gone!', 'Ahhh, better!', 'Two more!', 'One more!'][n - 1] ?? 'Nice!');
        if (n === 4) ctx.say('ace_one_more', 0);
      }
    };
    this.lulu.onHiccup = () => this.dropFruit();
    this.lulu.onWrongHit = () => {
      if (ctx.time - this.wrongHintT > 6) {
        this.wrongHintT = ctx.time;
        ctx.hint('Balls just make Lulu giggle - try gentle bubbles! Press [1]', 4);
      }
    };
    this.lulu.onArrived = () => this.luluArrives();

    // --------------------------------------------------------- collectibles
    const eggSpots: [number, number, number][] = [[-13, 10, P.peach], [-31, 26.5, 0xb9cfa0], [17.5, -7.5, P.butter], [-19.5, -20.5, 0xe39a7e]];
    for (const [x, z, col] of eggSpots) {
      const model = props.eggModel(col);
      collapse(model, { shadow: true });
      const e = new Collectible(ctx, new THREE.Vector3(x, H(x, z) + 0.55, z), model, {
        objective: 'eggs',
        cheer: 'A dino egg!',
        sfx: 'sfx_collect',
        color: 0xfff0d6,
        spin: false,
        onCollect: () => {
          if (!this.eggLineSaid) {
            this.eggLineSaid = true;
            ctx.say('ace_egg', 1);
          } else ctx.say('ace_found', 0);
        },
      });
      e.aimAssist = 0;
      this.eggs.push(e);
    }
    const gemSpots: THREE.Vector3[] = [
      new THREE.Vector3(SHELF.x + 0.6, 0, SHELF.z + 0.6), // on the sandstone ledge
      new THREE.Vector3(ARCH.x, 0, ARCH.z), // under the rock arch, on a rock in the river
      new THREE.Vector3(ALCOVE.x - 0.2, 0, ALCOVE.y), // behind the waterfall
      new THREE.Vector3(LOOKOUT.x + 0.8, 0, LOOKOUT.z - 0.8), // volcano lookout
      new THREE.Vector3(MUSH.x, 0, MUSH.z), // on top of the giant mushroom
    ];
    const gemY = [this.shelfTop + 0.75, 0.95, 0.25 + 0.8, H(LOOKOUT.x + 0.8, LOOKOUT.z - 0.8) + 0.9, this.mushTop + 0.7];
    gemSpots.forEach((p, i) => {
      p.y = gemY[i];
      const model = props.gemModel();
      collapse(model, { shadow: true, rough: 0.3 });
      this.gems.push(new Collectible(ctx, p, model, { objective: 'gems', say: 'ace_found', cheer: 'Amber gem!', color: 0xffd28a }));
    });

    // ------------------------------------------------------------ challenge
    const fruitTargets: { pos: THREE.Vector3; model: () => THREE.Object3D }[] = [];
    for (let i = 0; i < 12; i++) {
      const a = -1.25 + (i / 11) * 2.6 + (i % 2) * 0.12;
      const r = 5 + (i % 3) * 2.6 + rng.range(-0.6, 0.6);
      const x = GROVE.x + Math.cos(a) * r - 2;
      const z = GROVE.z + Math.sin(a) * r;
      const y = H(x, z) + 1.2 + ((i * 7) % 4) * 0.75;
      fruitTargets.push({
        pos: new THREE.Vector3(x, y, z),
        model: () => {
          const m = props.fruitPodModel(i);
          collapse(m, { shadow: true, rough: 0.5 });
          return m;
        },
      });
    }
    this.course = new TargetCourse(ctx, {
      objective: 'fruitpop',
      pad: PAD.clone(),
      par: 45,
      title: 'Fern Fruit Pop',
      intro: 'nar_challenge',
      targets: fruitTargets,
      padColor: 0xeeb48f,
    });

    // Ambient dragonflies over the river.
    const dfBody = mat(0x7fa7a2, { rough: 0.5 });
    const dfWing = mat(0xeaf3f0, { rough: 0.3, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const b = new THREE.Group();
      b.add(part(geo.capsule(1), dfBody, [0, 0, 0], [0.03, 0.12, 0.03], [Math.PI / 2, 0, 0], false));
      b.add(part(geo.sphere(8), dfBody, [0, 0, 0.2], 0.05, [0, 0, 0], false));
      g.add(b);
      collapse(b);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.1), dfWing);
      w.rotation.x = -Math.PI / 2;
      w.position.z = 0.1;
      g.add(w);
      const k = (i + 0.5) / 6;
      const idx = Math.floor(k * (RIVER.length - 2)) + 1;
      const [rx, rz] = RIVER[idx];
      const base = new THREE.Vector3(rx, 0.6 + rng.range(0, 0.6), rz);
      root.add(g);
      this.dragonflies.push({ g, wings: w, base, ph: rng.range(0, 10) });
    }

    // Fruit pool (shaken from trees by Lulu's hiccups).
    const fm = mat(P.peach, { rough: 0.55 });
    for (let i = 0; i < 8; i++) {
      const mesh = part(geo.sphere(12), fm, [0, -50, 0], 0.2);
      mesh.visible = false;
      root.add(mesh);
      this.fruits.push({ mesh, vel: new THREE.Vector3(), life: 0, alive: false });
    }
  }

  private shelfTop = 0;
  private clumps: [number, number][] = [];
  private mushTop = 0;

  private setupChirper(c: Chirper): void {
    const ctx = this.ctx;
    c.planFloat = (ch) => {
      if (ch.mode !== 'lost' || !ctx.objectives.isCurrent('chirpers')) return null;
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(0, 1.3);
      const x = NEST.x + Math.cos(a) * r;
      const z = NEST.z + Math.sin(a) * r;
      if (!this.chirperLineSaid) {
        this.chirperLineSaid = true;
        ctx.say('ace_chirper', 1);
      }
      return new THREE.Vector3(x, this.height(x, z) + 0.9, z);
    };
    c.onArrive = (ch) => {
      if (ch.mode !== 'lost') return;
      ch.goHome(NEST, NEST_R - 1.2);
      ctx.fx.hearts(ch.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 4);
      ctx.fx.sparkle(ch.position.clone().add(new THREE.Vector3(0, 0.6, 0)), 12, [0xfff0d0, 0xe9f6f8], 1);
      this.mama.hop(2.2);
      this.mama.chirp(0.8);
      for (const h of this.hatchlings) h.hop(2.6);
      if (ctx.objectives.isCurrent('chirpers')) {
        ctx.objectives.add('chirpers');
        const n = ctx.objectives.get('chirpers')!.count;
        if (n < 5) ctx.cheer(n === 4 ? 'One more chirper!' : 'Home safe!');
      }
    };
  }

  // -------------------------------------------------------------- builders
  private buildTerrain(root: THREE.Group): void {
    const n = this.noise;
    const cA = new THREE.Color(P.grass);
    const cB = new THREE.Color(P.grassDeep);
    const cC = new THREE.Color(P.grassLight);
    const cDry = new THREE.Color(0xcdc18f);
    const cPath = new THREE.Color(P.path);
    const cSand = new THREE.Color(P.sand);
    const cBed = new THREE.Color(0xb3ad8e);
    const strata = [new THREE.Color(P.cliffSand), new THREE.Color(P.cliffOchre), new THREE.Color(P.cliffCream), new THREE.Color(P.cliffSand), new THREE.Color(P.cliffPeach), new THREE.Color(P.cliffOchre)];
    const cTop = new THREE.Color(0xb9b780);
    const sc = new THREE.Color();
    const t = makeTerrain({
      size: 230,
      segments: 220,
      center: [0, -10],
      height: this.height,
      color: (x, z, h, out) => {
        const v = n.n2(x * 0.07 + 11, z * 0.07) * 0.5 + 0.5;
        out.copy(cA).lerp(cB, v * 0.6);
        const dry = smoothstep(0.45, 0.85, n.n2(x * 0.03 - 5, z * 0.03 + 9) * 0.5 + 0.5);
        out.lerp(cDry, dry * 0.4).lerp(cC, smoothstep(0.6, 0.95, v) * 0.3);
        const dp = this.pathDist(x, z);
        out.lerp(cPath, (1 - smoothstep(1.0, 2.3, dp)) * 0.9);
        const dr = Math.min(this.riverDist(x, z), Math.hypot(x - POOL.x, z - POOL.y) - (POOL_R - RW));
        out.lerp(cSand, (1 - smoothstep(RW + 0.2, RW + 2.4, dr)) * 0.85);
        out.lerp(cBed, 1 - smoothstep(RW - 1.2, RW - 0.2, dr));
        // Cliffs: soft sandstone strata; flat mesa tops get dry grass.
        const e = 0.8;
        const sx = this.height(x + e, z) - this.height(x - e, z);
        const sz = this.height(x, z + e) - this.height(x, z - e);
        const slope = Math.hypot(sx, sz) / (2 * e);
        if (h > 1.4) {
          const b = h * 0.4 + n.n2(x * 0.03, z * 0.03) * 0.35;
          const i0 = ((Math.floor(b) % strata.length) + strata.length) % strata.length;
          const f = smoothstep(0.55, 1, b - Math.floor(b));
          sc.copy(strata[i0]).lerp(strata[(i0 + 1) % strata.length], f);
          const steep = smoothstep(0.35, 0.8, slope);
          const k = smoothstep(1.4, 3.0, h);
          out.lerp(sc, k * steep);
          out.lerp(cTop, k * (1 - steep) * 0.55);
        }
      },
    });
    root.add(t);
  }

  private buildWater(root: THREE.Group): void {
    // River ribbon along the polyline.
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < RIVER.length - 1; i++) {
      const [ax, az] = RIVER[i];
      const [bx, bz] = RIVER[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.ceil(len / 1.2);
      for (let k = 0; k < steps; k++) pts.push(new THREE.Vector2(ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps));
    }
    pts.push(new THREE.Vector2(...RIVER[RIVER.length - 1]));
    const hw = RW + 1.6;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const tx = b.x - a.x;
      const tz = b.y - a.y;
      const tl = Math.hypot(tx, tz) || 1;
      const nx = -tz / tl;
      const nz = tx / tl;
      if (i > 0) dist += p.distanceTo(pts[i - 1]);
      pos.push(p.x + nx * hw, WATER_Y, p.y + nz * hw, p.x - nx * hw, WATER_Y, p.y - nz * hw);
      uv.push(0, dist / 7, 1, dist / 7);
      if (i > 0) {
        const o = (i - 1) * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) {
      // Flip the winding so the ribbon faces up.
      for (let i = 0; i < idx.length; i += 3) {
        const t = idx[i + 1];
        idx[i + 1] = idx[i + 2];
        idx[i + 2] = t;
      }
      g.setIndex(idx);
    }
    const nn = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0);
    this.riverTex = props.waterTexture('#f4fbf8', '#9cc9c4');
    this.riverTex.repeat.set(1, 1);
    const wm = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.riverTex, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.86 });
    this.river = new THREE.Mesh(g, wm);
    this.river.receiveShadow = true;
    root.add(this.river);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(POOL_R + 1.2, 40), wm);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(POOL.x, WATER_Y + 0.005, POOL.y);
    pool.receiveShadow = true;
    root.add(pool);
    // Waterfall: upper fall onto a rock lip, lower curtain into the pool.
    this.fallTex = props.waterTexture('#ffffff', '#b9dcd6', true);
    const fm = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.fallTex, roughness: 0.3, transparent: true, opacity: 0.88, emissive: 0x9fc8c2, emissiveIntensity: 0.25, side: THREE.DoubleSide, depthWrite: false });
    const upper = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 4.3, 1, 4), fm);
    upper.position.set(-50.7, 7.15, ALCOVE.y);
    upper.rotation.y = Math.PI / 2;
    const lower = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.3, 1, 4), fm);
    lower.position.set(-48.05, 2.3, ALCOVE.y);
    lower.rotation.y = Math.PI / 2;
    // A slight forward bulge on the lower curtain.
    const lp = lower.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < lp.count; i++) {
      const y = lp.getY(i);
      lp.setZ(i, Math.sin(((y + 2.65) / 5.3) * Math.PI) * 0.25);
    }
    lower.geometry.computeVertexNormals();
    this.falls.push(upper, lower);
    root.add(upper, lower);
  }

  private buildVegetation(root: THREE.Group, statics: THREE.Group): void {
    const ctx = this.ctx;
    const rng = this.rng;
    const H = (x: number, z: number) => this.height(x, z);
    const blocked = (x: number, z: number, pad = 0): boolean => {
      if (this.pathDist(x, z) < 2.4 + pad) return true;
      if (this.riverDist(x, z) < RW + 1.2 + pad) return true;
      if (Math.hypot(x - POOL.x, z - POOL.y) < POOL_R + 1.5 + pad) return true;
      if (Math.hypot(x - NEST.x, z - NEST.z) < 7 + pad) return true;
      if (Math.hypot(x - GLADE.x, z - GLADE.z) < 8 + pad) return true;
      if (Math.hypot(x - PAD.x, z - PAD.z) < 4 + pad) return true;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 6 + pad) return true;
      if (Math.hypot(x - SHELF.x, z - SHELF.z) < 6 + pad) return true;
      if (Math.hypot(x - MUSH.x, z - MUSH.z) < 5 + pad) return true;
      if (Math.hypot(x - LOOKOUT.x, z - LOOKOUT.z) < 4 + pad) return true;
      if (x < -45 && Math.abs(z - ALCOVE.y) < 7) return true;
      if (Math.abs(x) < 6 && z < -38 && z > -54) return true; // Lulu's gap
      // Clear sight lines: from the challenge pad into the grove, and from the lookout to the volcano.
      const px = x - PAD.x;
      const pz = z - PAD.z;
      const along = px * 0.96 - pz * 0.28;
      if (along > 0 && along < 9 && Math.abs(px * 0.28 + pz * 0.96) < 1.5 + along * 0.25) return true;
      const lx = x - LOOKOUT.x;
      const lz = z - LOOKOUT.z;
      const la = lx * 0.103 - lz * 0.995;
      if (la > -2 && la < 40 && Math.abs(lx * 0.995 + lz * 0.103) < 4 + la * 0.45) return true;
      return false;
    };
    const rFromC = (x: number, z: number) => Math.hypot(x - BC.x, z - BC.y);
    const inNorth = (x: number, z: number) => Math.exp(-((wrapAngle(Math.atan2(z - BC.y, x - BC.x) + Math.PI / 2) / 0.8) ** 2));

    // --- Grass tufts.
    const blade = new THREE.ConeGeometry(0.04, 0.42, 3);
    blade.translate(0, 0.21, 0);
    const blades: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 4; k++) {
      const b = blade.clone();
      b.rotateZ((k - 1.5) * 0.3);
      b.rotateY(k * 1.7);
      b.translate((k - 1.5) * 0.04, 0, (k % 2) * 0.04);
      blades.push(b.toNonIndexed());
    }
    const tuft = mergeGeometriesSafe(blades);
    scatterC(root, tuft, mat(0xffffff, { rough: 1 }), 5200, (_i, d, c) => {
        const x = rng.range(-60, 60);
        const z = rng.range(-56, 62);
        if (rFromC(x, z) > 54 || this.pathDist(x, z) < 1.5 || this.riverDist(x, z) < RW + 0.3 || Math.hypot(x - POOL.x, z - POOL.y) < POOL_R + 0.5) return false;
        const h = H(x, z);
        if (h > 2.5) return false;
        d.position.set(x, h - 0.02, z);
        d.rotation.set(0, rng.range(0, 6), 0);
        d.scale.set(rng.range(0.8, 1.3), rng.range(0.6, 1.4), rng.range(0.8, 1.3));
        c.set(rng.pick([0x97ad74, 0xa6b97e, 0xb3bb82, 0x8aa36c])).multiplyScalar(rng.range(0.92, 1.05));
        return true;
      });

    // --- Giant ferns (instanced, two shapes).
    const fernSpots: [number, number, number][] = [];
    for (let i = 0; i < 70; i++) {
      // Dense in the fern grove (challenge area).
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * 13;
      fernSpots.push([GROVE.x + Math.cos(a) * r, GROVE.z + Math.sin(a) * r * 0.8, rng.range(1.1, 2.0)]);
    }
    // Clumps of ferns all over the valley floor (feels lush, leaves open lawns between).
    this.clumps = [];
    for (let k = 0; k < 34; k++) {
      const cx = rng.range(-48, 48);
      const cz = rng.range(-44, 54);
      if (rFromC(cx, cz) > 50) continue;
      this.clumps.push([cx, cz]);
      const n = rng.int(7, 13);
      for (let i = 0; i < n; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * 4.5;
        fernSpots.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r, rng.range(0.8, 1.7) * (1 - r / 9)]);
      }
    }
    for (let i = 0; i < 140; i++) fernSpots.push([rng.range(-55, 55), rng.range(-50, 58), rng.range(0.5, 1.2)]);
    // Along the river banks.
    for (let i = 0; i < 60; i++) {
      const k = rng.next() * (RIVER.length - 1.01);
      const s = Math.floor(k);
      const f = k - s;
      const [ax, az] = RIVER[s];
      const [bx, bz] = RIVER[s + 1];
      const side = rng.chance(0.5) ? 1 : -1;
      const tl = Math.hypot(bx - ax, bz - az);
      fernSpots.push([ax + (bx - ax) * f + (-(bz - az) / tl) * side * (RW + rng.range(2.2, 4)), az + (bz - az) * f + ((bx - ax) / tl) * side * (RW + rng.range(2.2, 4)), rng.range(0.7, 1.3)]);
    }
    const fernGeos = [props.fernGeometry(rng), props.fernGeometry(rng)];
    for (let gi = 0; gi < 2; gi++) {
      scatterC(root, fernGeos[gi], vcMat(0.9, true), fernSpots.length, (i, d, c) => {
          if (i % 2 !== gi) return false;
          const [x, z, s] = fernSpots[i];
          if (rFromC(x, z) > 55 || blocked(x, z, -0.6)) return false;
          if (H(x, z) > 3) return false;
          d.position.set(x, H(x, z) - 0.05, z);
          d.rotation.set(rng.range(-0.08, 0.08), rng.range(0, 6), rng.range(-0.08, 0.08));
          d.scale.setScalar(s);
          c.setRGB(1, 1, 1).multiplyScalar(rng.range(0.9, 1.08));
          return true;
        }, false);
    }

    // --- Cycads and tree ferns (instanced, with colliders).
    const cycad = props.cycadGeometry(rng);
    const cycadSpots: [number, number, number][] = [[-15, 9, 1.1], [-11, 13, 0.9], [-33, 27, 1.2], [-27, 28, 1.0], [15, -6, 1.1], [-17, -22, 1.2], [-22, -17, 1.0]];
    for (let i = 0; i < 24; i++) cycadSpots.push([rng.range(-50, 50), rng.range(-44, 54), rng.range(0.8, 1.35)]);
    for (const [cx, cz] of this.clumps) {
      for (let i = 0; i < 2; i++) cycadSpots.push([cx + rng.range(-4, 4), cz + rng.range(-4, 4), rng.range(0.9, 1.4)]);
    }
    scatterC(root, cycad, vcMat(0.9, true), cycadSpots.length, (i, d, c) => {
        const [x, z, s] = cycadSpots[i];
        if (i >= 7 && (rFromC(x, z) > 50 || blocked(x, z, 0.5))) return false;
        if (H(x, z) > 2.5) return false;
        d.position.set(x, H(x, z) - 0.05, z);
        d.rotation.y = rng.range(0, 6);
        d.scale.setScalar(s);
        c.setRGB(1, 1, 1).multiplyScalar(rng.range(0.92, 1.06));
        ctx.physics.add({ kind: 'cylinder', x, z, r: 0.42 * s, yMin: -5, yMax: H(x, z) + 1.6 * s, tag: 'tree' });
        return true;
      }, true);
    const tfGeos = [props.treeFernGeometry(rng, 3.6), props.treeFernGeometry(rng, 4.6)];
    const tfSpots: [number, number, number][] = [[19, -9, 1], [GROVE.x + 4, GROVE.z - 5, 1.2], [GROVE.x + 2, GROVE.z + 8, 1.1], [GROVE.x + 8, GROVE.z + 3, 1.15]];
    for (let i = 0; i < 26; i++) tfSpots.push([rng.range(-50, 50), rng.range(-44, 54), rng.range(0.85, 1.25)]);
    for (const [cx, cz] of this.clumps) if (rng.chance(0.6)) tfSpots.push([cx + rng.range(-3, 3), cz + rng.range(-3, 3), rng.range(0.9, 1.3)]);
    // Treeline in the north (with Lulu's gap).
    for (let i = 0; i < 22; i++) {
      const a = -Math.PI / 2 + rng.range(-0.95, 0.95);
      const r = rng.range(46, 54);
      tfSpots.push([BC.x + Math.cos(a) * r, BC.y + Math.sin(a) * r, rng.range(1.0, 1.4)]);
    }
    for (let gi = 0; gi < 2; gi++) {
      scatterC(root, tfGeos[gi], vcMat(0.9, true), tfSpots.length, (i, d, c) => {
          if (i % 2 !== gi) return false;
          const [x, z, s] = tfSpots[i];
          if (i >= 4 && blocked(x, z, 0.5)) return false;
          if (rFromC(x, z) > 58 || H(x, z) > 3) return false;
          d.position.set(x, H(x, z) - 0.05, z);
          d.rotation.y = rng.range(0, 6);
          d.scale.setScalar(s);
          c.setRGB(1, 1, 1).multiplyScalar(rng.range(0.92, 1.06));
          if (rFromC(x, z) < BR + 1) ctx.physics.add({ kind: 'cylinder', x, z, r: 0.3 * s, yMin: -5, yMax: 30, tag: 'tree' });
          return true;
        }, true);
    }

    // --- Horsetails by the water.
    const ht = props.horsetailGeometry(rng);
    scatterC(root, ht, vcMat(0.9), 120, (_i, d) => {
      const k = rng.next() * (RIVER.length - 1.01);
      const s = Math.floor(k);
      const f = k - s;
      const [ax, az] = RIVER[s];
      const [bx, bz] = RIVER[s + 1];
      const side = rng.chance(0.5) ? 1 : -1;
      const tl = Math.hypot(bx - ax, bz - az);
      const off = RW + rng.range(0.2, 1.8);
      const x = ax + (bx - ax) * f + (-(bz - az) / tl) * side * off;
      const z = az + (bz - az) * f + ((bx - ax) / tl) * side * off;
      if (this.pathDist(x, z) < 3 || rFromC(x, z) > 54) return false;
      d.position.set(x, H(x, z) - 0.05, z);
      d.rotation.y = rng.range(0, 6);
      d.scale.setScalar(rng.range(0.55, 1.05));
      return true;
    });
    

    // --- Trees (merged statics).
    const addTree = (g: THREE.Object3D, x: number, z: number, r: number) => {
      g.position.set(x, H(x, z) - 0.1, z);
      g.rotation.y = rng.range(0, 6);
      statics.add(g);
      if (rFromC(x, z) < BR + 2) ctx.physics.add({ kind: 'cylinder', x, z, r, yMin: -5, yMax: 40, tag: 'tree' });
    };
    // North treeline of monkey-puzzles that Lulu peeks over.
    for (let i = 0; i < 30; i++) {
      const a = -Math.PI / 2 + ((i + rng.range(-0.3, 0.3)) / 29 - 0.5) * 2.1;
      const r = rng.range(47, 56);
      const x = BC.x + Math.cos(a) * r;
      const z = BC.y + Math.sin(a) * r;
      if (blocked(x, z)) continue;
      if (H(x, z) > 3) continue;
      const s = rng.range(0.95, 1.15);
      addTree(props.araucaria(rng, s), x, z, 0.38 * s);
    }
    // A few behind Lulu's meadow to frame her.
    for (const [x, z, s] of [[-34, -66, 1.2], [-26, -72, 1.1], [30, -70, 1.2], [38, -62, 1.05], [-42, -58, 1.0], [12, -76, 1.15], [-10, -78, 1.1]] as [number, number, number][]) {
      addTree(props.araucaria(rng, s), x, z, 0.4 * s);
    }
    // Mossy round trees around the valley edge and in a few groves.
    for (let i = 0; i < 46; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(44, 52);
      const x = BC.x + Math.cos(a) * r;
      const z = BC.y + Math.sin(a) * r;
      if (inNorth(x, z) > 0.5 || blocked(x, z, 1) || H(x, z) > 2.5) continue;
      const s = rng.range(1.0, 1.45);
      addTree(props.mossyTree(rng, s), x, z, 0.45 * s);
    }
    const groveTrees: [number, number, number][] = [[-18, 30, 1.2], [8, 40, 1.1], [14, 18, 1.25], [-24, 4, 1.3], [-30, -24, 1.2], [8, -24, 1.15], [-36, 30, 1.1], [40, 0, 1.2], [36, -14, 1.1], [-8, 44, 1.05], [12, 50, 1.2], [-40, -16, 1.1]];
    for (const [x, z, s] of groveTrees) {
      if (blocked(x, z, -1)) continue;
      addTree(props.mossyTree(rng, s), x, z, 0.45 * s);
    }
    // Fruit trees around Lulu's glade.
    for (const [x, z] of [[-9.5, -34], [9.5, -35], [-12, -42], [12, -42.5]] as [number, number][]) {
      addTree(props.mossyTree(rng, 1.15, true), x, z, 0.5);
      this.fruitTrees.push(new THREE.Vector3(x, H(x, z), z));
    }

    // --- Boulders.
    for (let i = 0; i < 55; i++) {
      const x = rng.range(-54, 54);
      const z = rng.range(-46, 60);
      const r = rFromC(x, z);
      if (r > 55 || blocked(x, z, -0.5)) continue;
      const s = r > 44 ? rng.range(1.0, 2.2) : rng.range(0.35, 1.1);
      const b = props.boulder(rng, s);
      b.position.add(new THREE.Vector3(x, H(x, z) - 0.15 * s, z));
      statics.add(b);
      if (s > 0.8) ctx.physics.add({ kind: 'cylinder', x, z, r: 0.75 * s, yMin: -5, yMax: H(x, z) + s * 0.6 });
    }
  }

  private buildLandmarks(root: THREE.Group, statics: THREE.Group): void {
    const ctx = this.ctx;
    const rng = this.rng;
    const H = (x: number, z: number) => this.height(x, z);
    const ph = ctx.physics;
    const at = (g: THREE.Object3D, x: number, z: number, y = H(x, z), ry = 0) => {
      g.position.set(x, y, z);
      g.rotation.y = ry;
      statics.add(g);
      return g;
    };

    // Big nest + a soft sandy ring around it.
    const nest = props.bigNest(rng, NEST_R);
    at(nest, NEST.x, NEST.z, H(NEST.x, NEST.z) - 0.05);
    NEST.y = H(NEST.x, NEST.z);
    ph.add({ kind: 'cylinder', x: NEST.x, z: NEST.z, r: NEST_R + 0.55, yMin: -5, yMax: NEST.y + 3 });
    // Eggs that will appear in the nest (hidden until delivered).
    for (let i = 0; i < 4; i++) {
      const g = props.eggModel([P.peach, 0xb9cfa0, P.butter, 0xe39a7e][i]);
      collapse(g, { shadow: true });
      const a = (i / 4) * Math.PI * 2 + 0.4;
      g.position.set(NEST.x + Math.cos(a) * 1.1, NEST.y + 0.42, NEST.z + Math.sin(a) * 1.1);
      g.visible = false;
      root.add(g);
      this.nestEggs.push(g);
    }
    const sign = props.signpost('Nest Hollow');
    sign.position.set(NEST.x + 5.5, H(NEST.x + 5.5, NEST.z + 3.5), NEST.z + 3.5);
    sign.rotation.y = 0.5;
    root.add(sign);

    // Stepping stones across the river on the main path.
    const stones: [number, number][] = [[-4.1, 6.6], [-4.5, 5.2], [-3.8, 3.8], [-4.4, 2.4], [-3.9, 1.1]];
    for (const [x, z] of stones) {
      const s = props.steppingStone(rng, 0.62);
      at(s, x, z, WATER_Y + 0.14);
      ph.add({ kind: 'box', min: new THREE.Vector3(x - 0.5, -3, z - 0.5), max: new THREE.Vector3(x + 0.5, WATER_Y + 0.14, z + 0.5), walkable: true });
    }
    // Log bridge on the east path.
    const bridge = new THREE.Group();
    bridge.add(part(geo.cyl(1, 1, 14), mat(P.trunk), [0, 0, 0], [0.55, 11, 0.55], [Math.PI / 2, 0, 0]));
    bridge.add(part(geo.box(0.05), mat(0xc9a77a), [0, 0.5, 0], [1.1, 0.12, 10.6]));
    for (let i = 0; i < 6; i++) bridge.add(part(geo.sphere(8), mat(P.moss), [rng.range(-0.3, 0.3), 0.45, -4.5 + i * 1.8], [0.25, 0.1, 0.3]));
    const bz = 1.2;
    at(bridge, 24.2, bz, 0.25);
    ph.add({ kind: 'box', min: new THREE.Vector3(23.6, -3, bz - 5.3), max: new THREE.Vector3(24.8, 0.81, bz + 5.3), walkable: true });

    // Rock arch over the river with a little rock island beneath.
    const arch = props.rockArch(rng, 4.6, 4.2);
    at(arch, ARCH.x, ARCH.z, 0.0, Math.PI / 2);
    for (const s of [-1, 1]) ph.add({ kind: 'cylinder', x: ARCH.x, z: ARCH.z + s * 4.6, r: 1.05, yMin: -5, yMax: 2.5 });
    const island = props.boulder(rng, 0.85, P.stone);
    island.position.y -= 0.25;
    at(island, ARCH.x, ARCH.z, WATER_Y);
    ph.add({ kind: 'box', min: new THREE.Vector3(ARCH.x - 0.6, -3, ARCH.z - 0.6), max: new THREE.Vector3(ARCH.x + 0.6, 0.12, ARCH.z + 0.6), walkable: true });

    // Waterfall rock lip and the stone behind the upper fall.
    const lip = new THREE.Group();
    lip.add(part(geo.box(0.12), mat(P.cliffOchre), [0, 0, 0], [3.9, 1.0, 5.2]));
    lip.add(part(geo.box(0.12), mat(P.cliffSand), [0.2, 0.5, 0], [3.3, 0.3, 4.8]));
    lip.add(part(geo.sphere(10), mat(P.moss), [1.0, 0.75, 1.8], [0.8, 0.2, 0.6]));
    lip.add(part(geo.sphere(10), mat(P.moss), [0.6, 0.75, -2.1], [0.7, 0.2, 0.5]));
    for (const [lx, lz, ls] of [[0.6, 2.4, 0.9], [0.9, -2.5, 1.0], [-0.8, 2.6, 1.1], [-0.6, -2.7, 0.9]] as [number, number, number][]) {
      const b = props.boulder(rng, ls, P.cliffSand);
      b.position.set(lx, -0.3, lz);
      lip.add(b);
    }
    at(lip, -49.9, ALCOVE.y, 4.7);
    ph.add({ kind: 'box', min: new THREE.Vector3(-51.8, 4.2, ALCOVE.y - 2.6), max: new THREE.Vector3(-47.9, 5.4, ALCOVE.y + 2.6) });
    // Back wall of the grotto (keeps Ace from wandering up into the rock).
    ph.add({ kind: 'box', min: new THREE.Vector3(-54, -5, ALCOVE.y - 3.4), max: new THREE.Vector3(-50.8, 14, ALCOVE.y + 3.4) });
    for (const sz of [-1, 1]) ph.add({ kind: 'box', min: new THREE.Vector3(-51, -5, ALCOVE.y + (sz > 0 ? 2.7 : -4.4)), max: new THREE.Vector3(-48.4, 14, ALCOVE.y + (sz > 0 ? 4.4 : -2.7)) });
    for (const [x, z, s] of [[-46.5, 2.8, 1.1], [-46.8, -6.6, 1.3], [-41, -6.4, 0.8], [-40.5, 2.6, 0.7]] as [number, number, number][]) {
      const b = props.boulder(rng, s);
      at(b, x, z, H(x, z) - 0.2);
    }

    // Sandstone ledge (south-east) with climbable steps.
    const g0 = H(SHELF.x, SHELF.z);
    this.shelfTop = g0 + 3.3;
    const shelf = new THREE.Group();
    shelf.add(part(geo.box(0.1), mat(P.cliffSand), [0, (this.shelfTop - g0) / 2 - 0.5, 0], [4.4, this.shelfTop - g0 + 1, 3.6]));
    shelf.add(part(geo.box(0.1), mat(P.cliffCream), [0, this.shelfTop - g0 - 0.12, 0], [4.6, 0.3, 3.8]));
    shelf.add(part(geo.sphere(10), mat(P.moss), [1.2, this.shelfTop - g0 + 0.05, -1.0], [0.9, 0.18, 0.7]));
    at(shelf, SHELF.x, SHELF.z, g0);
    ph.add({ kind: 'box', min: new THREE.Vector3(SHELF.x - 2.25, -5, SHELF.z - 1.85), max: new THREE.Vector3(SHELF.x + 2.25, this.shelfTop, SHELF.z + 1.85), walkable: true });
    const steps: [number, number, number, number][] = [[SHELF.x - 4.4, SHELF.z - 2.4, 1.05, 2.0], [SHELF.x - 2.3, SHELF.z - 3.9, 2.15, 1.9]];
    for (const [x, z, top, w] of steps) {
      const gb = H(x, z);
      const blk = new THREE.Group();
      blk.add(part(geo.box(0.12), mat(rng.pick([P.cliffSand, P.cliffOchre])), [0, (g0 + top - gb) / 2 - 0.3, 0], [w, g0 + top - gb + 0.6, w]));
      at(blk, x, z, gb);
      ph.add({ kind: 'box', min: new THREE.Vector3(x - w / 2, -5, z - w / 2), max: new THREE.Vector3(x + w / 2, g0 + top, z + w / 2), walkable: true });
    }

    // Giant mushroom grove (north-west): climb the little ones to reach the top.
    const mush: [number, number, number, number, number][] = [
      [MUSH.x, MUSH.z, 3.4, 2.1, P.terra],
      [MUSH.x + 2.9, MUSH.z + 1.9, 2.25, 1.15, P.peach],
      [MUSH.x + 4.4, MUSH.z + 4.2, 1.1, 1.0, P.butter],
      [MUSH.x - 3.2, MUSH.z + 1.5, 1.4, 0.9, P.peach],
      [MUSH.x - 1.5, MUSH.z - 3.0, 0.8, 0.6, P.butter],
    ];
    for (const [x, z, h, r, col] of mush) {
      const gb = H(x, z);
      at(props.giantMushroom(h, r, col), x, z, gb);
      ph.add({ kind: 'cylinder', x, z, r: r * 0.3, yMin: -5, yMax: gb + h });
      const half = r * 0.72;
      ph.add({ kind: 'box', min: new THREE.Vector3(x - half, gb + h - 0.4, z - half), max: new THREE.Vector3(x + half, gb + h + 0.25, z + half), walkable: true });
      if (h === 3.4) this.mushTop = gb + h + 0.25;
    }

    // Hollow log for Pip the peeker.
    const logC = new THREE.Vector3(-9.5, 0, -16);
    at(props.hollowLog(3.6, 0.55), logC.x, logC.z, H(logC.x, logC.z) - 0.05);
    ph.add({ kind: 'box', min: new THREE.Vector3(logC.x - 1.8, -5, logC.z - 0.55), max: new THREE.Vector3(logC.x + 1.8, H(logC.x, logC.z) + 1.05, logC.z + 0.55), walkable: true });

    // Volcano lookout: steam vents and a sign.
    for (const [dx, dz] of [[-2.2, 1.5], [2.0, 2.4], [-0.6, -2.6]] as [number, number][]) {
      const x = LOOKOUT.x + dx;
      const z = LOOKOUT.z + dz;
      at(props.ventRing(rng), x, z, H(x, z) - 0.05);
      this.vents.push(new THREE.Vector3(x, H(x, z) + 0.2, z));
    }
    const vs = props.signpost('Volcano View');
    vs.position.set(LOOKOUT.x - 3.5, H(LOOKOUT.x - 3.5, LOOKOUT.z + 3.5), LOOKOUT.z + 3.5);
    vs.rotation.y = 0.9;
    root.add(vs);

    // Stumps and logs dotted about for charm.
    for (const [x, z, h, r] of [[-20, 38, 0.7, 0.7], [16, 34, 0.5, 0.55], [-36, -2, 0.6, 0.6], [6, -18, 0.55, 0.6]] as [number, number, number, number][]) {
      at(props.stump(h, r), x, z, H(x, z) - 0.05);
      ph.add({ kind: 'cylinder', x, z, r, yMin: -5, yMax: H(x, z) + h });
    }
  }

  private buildVolcano(root: THREE.Group): void {
    const prof: [number, number][] = [[95, -8], [80, 0], [60, 8], [42, 20], [28, 34], [19, 44], [14, 50], [12.5, 52.5], [10, 52], [7, 49]];
    const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 48);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const haze = new THREE.Color(this.env.sky!.horizon);
    const low = new THREE.Color(0xb6bb98);
    const mid = new THREE.Color(0xc7ad96);
    const top = new THREE.Color(0xb59f90);
    const rim = new THREE.Color(0xe6b496);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const k = clamp(y / 52, 0, 1);
      c.copy(low).lerp(mid, smoothstep(0.1, 0.5, k)).lerp(top, smoothstep(0.6, 0.9, k));
      c.lerp(rim, smoothstep(0.95, 1.0, k));
      // Soft gullies.
      const ang = Math.atan2(z, x);
      c.multiplyScalar(0.94 + Math.sin(ang * 9) * 0.04 * k);
      c.lerp(haze, 0.42);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, fog: false, emissive: haze, emissiveIntensity: 0.18 });
    const v = new THREE.Mesh(g, m);
    v.position.set(48, -2, -185);
    root.add(v);
    this.volcanoTop.set(48, 50, -185);
    // Slow, friendly cream puffs.
    const pm = new THREE.MeshStandardMaterial({ color: 0xfbf1e0, roughness: 1, fog: false, emissive: 0xf6e6cc, emissiveIntensity: 0.45, transparent: true, opacity: 0.92 });
    this.puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), pm, 9);
    this.puffs.frustumCulled = false;
    for (let i = 0; i < 9; i++) this.puffAge.push(i / 9);
    root.add(this.puffs);
  }

  // ------------------------------------------------------------- moments
  private dropFruit(): void {
    if (!this.fruitTrees.length) return;
    for (let n = 0; n < 2; n++) {
      const f = this.fruits.find((x) => !x.alive);
      if (!f) return;
      const tr = this.rng.pick(this.fruitTrees);
      const a = this.rng.range(0, Math.PI * 2);
      f.mesh.position.set(tr.x + Math.cos(a) * 1.6, tr.y + 4.4, tr.z + Math.sin(a) * 1.6);
      f.vel.set(this.rng.range(-0.5, 0.5), 0, this.rng.range(-0.5, 0.5));
      f.life = 6;
      f.alive = true;
      f.mesh.visible = true;
      f.mesh.scale.setScalar(0.2);
      this.ctx.fx.puff(f.mesh.position, 0xb9c58e, 4, 0.8);
    }
  }

  private luluArrives(): void {
    const ctx = this.ctx;
    if (this.luluArrived) return;
    this.luluArrived = true;
    ctx.banner('Lulu has the hiccups!', 'Land 5 bubbles on her nose', 3.5);
    ctx.focusOn(this.lulu.nose(new THREE.Vector3()), 2.2);
    ctx.narrate('nar_dino_lulu', () => ctx.say('ace_lulu', 1));
    ctx.hint(ctx.blaster === 'bubble' ? 'Walk up close and blow bubbles at Lulu\'s nose!' : 'Press [1] for the Bubble Wand, then blow bubbles at Lulu\'s nose!', 8);
  }

  override begin(): void {
    this.showStepHint();
  }

  override onObjectiveComplete(id: string): void {
    const ctx = this.ctx;
    if (id === 'eggs') {
      ctx.cheer('All four eggs!');
      ctx.banner('All the eggs!', 'Take them home to Mama Chirp', 3);
    }
    if (id === 'nest') {
      this.hatchT = 0;
      this.hatched = 0;
      for (const e of this.nestEggs) {
        e.visible = true;
        ctx.fx.sparkle(e.position, 8, [0xfff0d6, 0xffffff], 0.7);
      }
      this.mama.hop(2.4);
      this.mama.chirp(0.9);
      ctx.focusOn(NEST.clone().add(new THREE.Vector3(0, 0.6, 0)), 1.8);
    }
    if (id === 'chirpers') {
      ctx.banner('Every chirper is home!', 'Mama Chirp is so happy', 3);
      ctx.fx.celebrate(NEST.clone().add(new THREE.Vector3(0, 2, 0)), 1);
      ctx.say('ace_yay', 1);
      // Lulu heard the commotion...
      this.lulu.startHiccupMoment();
      ctx.sfx('sfx_longneck_call', { volume: 0.8 });
    }
    if (id === 'lulu') {
      const n = this.lulu.nose(new THREE.Vector3());
      this.lulu.sing();
      ctx.banner('Hiccups all gone!', 'Lulu sings a happy song', 4);
      ctx.fx.celebrate(n, 2);
      ctx.fx.hearts(n, 8);
      ctx.say('ace_lulu_done', 2);
      ctx.focusOn(n, 2.5);
      ctx.hint(null);
      // The whole valley joins in.
      for (const p of this.pteros) p.loop();
      for (const c of this.chirpers) c.hop(2.6);
      for (const t of this.trikes) t.boop(true);
      ctx.showHomeBubble(new THREE.Vector3(GLADE.x + 5, 0, GLADE.z + 7));
      let k = 0;
      ctx.onUpdate((dt) => {
        k += dt;
        if (k > 4.2 && k - dt <= 4.2) ctx.focusOn(this.lulu.nose(new THREE.Vector3()), 2);
        if (k > 1.5 && k < 6 && Math.random() < dt * 3) ctx.fx.celebrate(this.lulu.nose(new THREE.Vector3()).add(new THREE.Vector3(0, 1.5, 0)), 0.6);
        return k < 6.5;
      });
    }
    if (id === 'gems') ctx.say('ace_treasure_all', 1);
    this.showStepHint();
  }

  private showStepHint(): void {
    const ctx = this.ctx;
    const cur = ctx.objectives.current();
    if (!cur) {
      ctx.hint(null);
      return;
    }
    const first = !this.hintShown.has(cur.def.id);
    this.hintShown.add(cur.def.id);
    if (!first) return;
    const hints: Record<string, string> = {
      eggs: 'Find 4 lost dino eggs - look for soft glints in the ferns!',
      nest: 'Bring the eggs home to the big nest by Mama Chirp',
      chirpers: '[Click] to blow bubbles at the lost baby chirpers - they float home to the nest!',
      lulu: 'Lulu is coming! Head to the glade in the north',
    };
    const h = hints[cur.def.id];
    if (h) ctx.hint(h, 9);
  }

  // ---------------------------------------------------------------- update
  update(dt: number, t: number): void {
    const ctx = this.ctx;
    const pl = ctx.player.position;
    // Nest delivery.
    if (ctx.objectives.isCurrent('nest') && Math.hypot(pl.x - NEST.x, pl.z - NEST.z) < NEST_R + 4) {
      ctx.objectives.complete('nest');
      ctx.cheer('Home sweet nest!');
    }
    // Safety net: if Lulu's moment is current she should be heading over.
    if (ctx.objectives.isCurrent('lulu') && this.lulu.state === 'amble') this.lulu.startHiccupMoment();
    // Hatching.
    if (this.hatchT >= 0) {
      this.hatchT += dt;
      for (let i = 0; i < this.nestEggs.length; i++) {
        const e = this.nestEggs[i];
        if (!e.visible) continue;
        const wob = Math.min(1, this.hatchT / 1.2);
        e.rotation.z = Math.sin(t * 18 + i) * 0.18 * wob;
        e.rotation.x = Math.cos(t * 15 + i * 2) * 0.1 * wob;
        if (this.hatchT > 1.8 + i * 0.6) {
          e.visible = false;
          this.hatched++;
          const p = e.position.clone();
          ctx.sfx('sfx_egg_hatch', { pos: p, volume: 1 });
          ctx.fx.puff(p, 0xf6ecd8, 10, 0.9);
          ctx.fx.sparkle(p, 12, [0xfff0d0, 0xffffff], 0.9);
          ctx.fx.hearts(p.clone().add(new THREE.Vector3(0, 0.5, 0)), 3);
          const baby = new Chirper(ctx, new THREE.Vector3(p.x, NEST.y + 0.1, p.z), { tint: [0xf0c9a4, 0xc4d6a8, 0xefd89a, 0xeab394][i], crest: 0xd98b6a, mode: 'home', scale: 0.7, area: NEST_R - 1.2 });
          baby.goHome(NEST, NEST_R - 1.2);
          baby.hop(3);
          this.hatchlings.push(baby);
          this.chirpers.push(baby);
          if (this.hatched === 4) {
            this.hatchT = -1;
            ctx.cheer('Baby chirpers!');
            ctx.say('ace_happy', 1);
          }
        }
      }
    }
    for (const c of this.chirpers) c.update(dt, t);
    for (const c of this.trikes) c.update(dt, t);
    for (const c of this.stegos) c.update(dt, t);
    for (const c of this.pteros) c.update(dt, t);
    this.peeker.update(dt, t);
    this.lulu.update(dt, t);
    this.luluCollider.center.copy(this.lulu.root.position).add(this.tmp.set(0, 4.8, 0));
    for (const e of this.eggs) e.update(dt, t);
    for (const g of this.gems) g.update(dt, t);
    this.course.update(dt, t);
    // Water flow.
    this.riverTex.offset.y -= dt * 0.12;
    this.fallTex.offset.y += dt * 0.9;
    // Waterfall spray (only when near enough to see it).
    const nearFall = Math.hypot(pl.x - ALCOVE.x, pl.z - ALCOVE.y) < 45;
    this.fallT -= dt;
    if (nearFall && this.fallT <= 0) {
      this.fallT = 0.09;
      const z = ALCOVE.y + this.rng.range(-1.5, 1.5);
      ctx.fx.soft.emit(this.tmp.set(-47.9, WATER_Y + 0.1, z), { count: 2, shape: 0, size: 0.35, sizeEnd: 0.9, speed: 1.2, life: 1.1, color: 0xf4fbfa, alpha: 0.45, dir: new THREE.Vector3(0.5, 1, 0), spread: 0.6, gravity: -0.3 });
      if (this.rng.chance(0.4)) ctx.fx.soft.emit(this.tmp.set(-48.1, WATER_Y + 0.15, z), { count: 2, shape: 3, size: 0.1, sizeEnd: 0.05, speed: 2.5, life: 0.6, color: 0xe3f4f7, dir: new THREE.Vector3(0.6, 1, 0), spread: 0.4, gravity: 8 });
      if (this.rng.chance(0.3)) ctx.fx.soft.emit(this.tmp.set(-50.2, 5.3, ALCOVE.y + this.rng.range(-1.2, 1.2)), { count: 1, shape: 0, size: 0.3, sizeEnd: 0.7, speed: 0.8, life: 0.9, color: 0xf4fbfa, alpha: 0.4, dir: new THREE.Vector3(1, 0.6, 0), spread: 0.5, gravity: -0.2 });
    }
    // Steam vents at the lookout.
    this.ventT -= dt;
    if (this.ventT <= 0 && Math.hypot(pl.x - LOOKOUT.x, pl.z - LOOKOUT.z) < 50) {
      this.ventT = 0.35;
      const v = this.rng.pick(this.vents);
      ctx.fx.soft.emit(v, { count: 1, shape: 0, size: 0.5, sizeEnd: 1.8, speed: 1.1, life: 3, color: 0xfbf4e8, alpha: 0.32, dir: new THREE.Vector3(0.1, 1, 0), spread: 0.2, gravity: -0.4, wobble: 0.4 });
    }
    // Volcano puffs.
    const d = new THREE.Object3D();
    for (let i = 0; i < this.puffAge.length; i++) {
      this.puffAge[i] += dt / 26;
      if (this.puffAge[i] > 1) this.puffAge[i] -= 1;
      const a = this.puffAge[i];
      const grow = 3 + a * 13;
      const fade = smoothstep(0, 0.08, a) * (1 - smoothstep(0.75, 1, a));
      d.position.set(this.volcanoTop.x + a * 26 + Math.sin(i * 2.3) * 3, this.volcanoTop.y + a * 40 + Math.sin(t * 0.3 + i) * 0.8, this.volcanoTop.z + Math.cos(i * 1.7) * 3);
      d.scale.set(grow * fade, grow * 0.8 * fade, grow * fade);
      d.updateMatrix();
      this.puffs.setMatrixAt(i, d.matrix);
    }
    this.puffs.instanceMatrix.needsUpdate = true;
    this.clouds.rotation.y += dt * 0.004;
    // Falling fruit.
    for (const f of this.fruits) {
      if (!f.alive) continue;
      f.life -= dt;
      f.vel.y -= 12 * dt;
      f.mesh.position.addScaledVector(f.vel, dt);
      const gh = this.height(f.mesh.position.x, f.mesh.position.z) + 0.2;
      if (f.mesh.position.y < gh) {
        f.mesh.position.y = gh;
        if (f.vel.y < -2) {
          f.vel.y *= -0.38;
          f.vel.x *= 0.8;
          f.vel.z *= 0.8;
          ctx.fx.puff(f.mesh.position, 0xe9dfcf, 3, 0.5);
          ctx.sfx('sfx_ball_boing', { pos: f.mesh.position, volume: 0.25, rate: 0.7 });
        } else {
          f.vel.y = 0;
          f.vel.multiplyScalar(Math.exp(-2 * dt));
        }
      }
      if (f.life < 0.5) f.mesh.scale.setScalar(0.2 * Math.max(0.01, f.life / 0.5));
      if (f.life <= 0) {
        f.alive = false;
        f.mesh.visible = false;
      }
    }
    // Dragonflies.
    for (const df of this.dragonflies) {
      const tt = t * 0.6 + df.ph;
      df.g.position.set(df.base.x + Math.sin(tt) * 3.5 + Math.sin(tt * 3.1) * 0.4, df.base.y + Math.sin(tt * 2.3) * 0.25, df.base.z + Math.cos(tt * 0.8) * 2.2);
      df.g.rotation.y = Math.atan2(Math.cos(tt) * 3.5, -Math.sin(tt * 0.8) * 1.8);
      df.wings.scale.x = 0.7 + Math.abs(Math.sin(t * 40 + df.ph)) * 0.3;
    }
    // Remind about bubbles near Lulu if the player keeps using balls.
    if (this.camOverride) {
      ctx.camera.position.copy(this.camOverride.pos);
      ctx.camera.lookAt(this.camOverride.look);
    }
  }

  override dispose(): void {
    this.riverTex?.dispose();
    this.fallTex?.dispose();
  }

  // ------------------------------------------------------- dev/test hooks
  /** Deterministic helpers for automated checks (window.__acePlays.stage.debug). */
  readonly debug = {
    tp: (x: number, z: number, yaw?: number) => {
      const p = this.ctx.player;
      p.position.set(x, this.height(x, z) + 0.05, z);
      p.velocity.set(0, 0, 0);
      if (yaw !== undefined) p.yaw = yaw;
    },
    cam: (px: number, py: number, pz: number, lx: number, ly: number, lz: number) => {
      this.camOverride = { pos: new THREE.Vector3(px, py, pz), look: new THREE.Vector3(lx, ly, lz) };
    },
    camOff: () => {
      this.camOverride = null;
    },
    eggs: () => {
      for (const e of this.eggs) e.collect();
    },
    nest: () => this.debug.tp(NEST.x + 6, NEST.z + 1, Math.PI / 2),
    chirpers: () => {
      for (const c of this.lost) {
        if (c.mode !== 'lost' || c.isBubbled) continue;
        c.onHit({ kind: 'bubble', point: c.position.clone(), dir: new THREE.Vector3(0, 0, 1), speed: 10, power: 0.6 } as HitInfo);
      }
    },
    lulu: () => this.lulu.debugCalm(),
    gems: () => {
      for (const g of this.gems) g.collect();
    },
    fruit: () => {
      this.debug.tp(PAD.x, PAD.z);
      let k = 0;
      this.ctx.onUpdate((dt) => {
        k += dt;
        if (k > 3.6) {
          const targets = (this.course as unknown as { targets: PopTarget[] }).targets;
          for (const tg of targets) tg.pop();
          return false;
        }
        return true;
      });
    },
    state: () => ({
      lulu: this.lulu.state,
      calms: this.lulu.calms,
      lost: this.lost.map((c) => c.mode),
      objectives: this.ctx.objectives.list.map((o) => `${o.def.id}:${o.count}/${o.def.target}${o.done ? '!' : ''}`),
    }),
  };
}

/**
 * Like kit scatter(), but splits the instances into spatial cells so each
 * chunk can be frustum-culled (main view and shadow pass).
 */
function scatterC(
  root: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
  place: (i: number, dummy: THREE.Object3D, color: THREE.Color) => boolean,
  castShadow = false,
  cell = 46,
): void {
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const cells = new Map<string, { m: THREE.Matrix4; c: THREE.Color }[]>();
  let anyColor = false;
  for (let i = 0; i < count; i++) {
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    color.setRGB(1, 1, 1);
    if (!place(i, dummy, color)) continue;
    dummy.updateMatrix();
    if (color.r !== 1 || color.g !== 1 || color.b !== 1) anyColor = true;
    const key = `${Math.floor(dummy.position.x / cell)},${Math.floor(dummy.position.z / cell)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push({ m: dummy.matrix.clone(), c: color.clone() });
  }
  for (const list of cells.values()) {
    const inst = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((it, k) => {
      inst.setMatrixAt(k, it.m);
      if (anyColor) inst.setColorAt(k, it.c);
    });
    inst.castShadow = castShadow;
    inst.receiveShadow = true;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.computeBoundingSphere();
    root.add(inst);
  }
}

function mergeGeometriesSafe(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const pos: number[] = [];
  for (const g of list) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
