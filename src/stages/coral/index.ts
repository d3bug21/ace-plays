import * as THREE from 'three';
import type { StageMeta } from '../index';
import { Stage, type StageContext, type StageEnvironment, type StageInfo, type ObjectiveDef } from '../types';
import { Rng } from '../../core/math';
import { geo, mat, mergeStatic, part } from '../../kit/kit';
import { Collectible, TargetCourse } from '../../gameplay/Helpers';
import { createBubbleMaterial, releaseBubbleMaterial } from '../../fx/BubbleMaterial';
import { C, cmat, clearMaterialCaches, fishUniforms, paintStatic, sway } from './shared';
import * as W from './world';
import { L, SURFACE, seabed } from './world';
import { BabyTurtle, Clownfish, Crab, GliderTurtle, MamaTurtle, Puffer, Shark } from './creatures';
import { BubbleRing, SongBubble, Whale } from './whale';
import { FishSchool } from './fish';
import { BubbleVent, Clam, bubbleRingModel, pearlModel, resetPropCaches } from './props';

const info: StageInfo = {
  id: 'coral',
  name: 'Coral Cove',
  tagline: 'Dive into a sunny lagoon of puffer fish, playful sharks, baby turtles and a singing whale.',
  map: { x: 58, y: 72 },
  accent: '#5fa3a8',
  icon: 'fish',
  musicId: 'mus_coral',
  ambienceId: 'amb_underwater',
  introNarration: 'nar_coral_intro',
  introAce: 'ace_coral_intro',
  mode: 'swim',
  reward: { blaster: 'glow', title: 'Glow Ball unlocked!', text: 'Squishy glowing balls that light up the dark. Press 4 to use it.' },
  footstep: undefined,
};

const objectives: ObjectiveDef[] = [
  { id: 'puffers', kind: 'main', label: 'Puff up the puffer fish', icon: 'puffer', target: 3, hint: 'Blow bubbles at the round little fish' },
  { id: 'sharks', kind: 'main', label: 'Boop the circling sharks', icon: 'shark', target: 3, hint: 'A ball or a bubble makes them spin!' },
  { id: 'turtles', kind: 'main', label: 'Lead baby turtles to Mama', icon: 'turtle', target: 4, hint: 'Follow the bubble trails to find them' },
  { id: 'whale', kind: 'main', label: "Pop Mama Mo's song bubbles", icon: 'whale', target: 6, hint: 'Pop the glowing note bubbles' },
  { id: 'pearls', kind: 'treasure', label: 'Find hidden pearls', icon: 'pearl', target: 5 },
  { id: 'rings', kind: 'challenge', label: 'Ring Swim: 10 rings in 60s', icon: 'ring', target: 1 },
];

export const meta: StageMeta = { info, objectives, introColors: ['#6fb0b0', '#24515c'] };

export function create(): Stage {
  return new CoralStage();
}

interface Timer {
  t: number;
  fn: () => void;
}

class CoralStage extends Stage {
  readonly info = info;
  readonly objectives = objectives;
  readonly env: StageEnvironment = {
    sky: null,
    fog: { color: '#66aeb0', density: 0.021 },
    hemi: { sky: '#d9f1ea', ground: '#b9a57f', intensity: 1.1 },
    sun: { color: '#fff0d4', intensity: 1.75, dir: [0.35, 1, 0.25], shadows: true },
    ambient: { color: '#8fc6c2', intensity: 0.2 },
    exposure: 0.95,
    bloom: { strength: 0.24, radius: 0.5, threshold: 0.9 },
    underwater: { surfaceY: SURFACE, tint: '#8fd0c9', snow: 1, shafts: 1 },
    background: '#66aeb0',
  };
  readonly spawn = { pos: new THREE.Vector3(L.spawn[0], 0, L.spawn[1]), yaw: 0 };
  override challengePar = 60;

  private rng = new Rng(2026);
  private timers: Timer[] = [];
  private puffers: Puffer[] = [];
  private puffed = new Set<Puffer>();
  private sharks: Shark[] = [];
  private booped = new Set<Shark>();
  private clowns: Clownfish[] = [];
  private crabs: Crab[] = [];
  private gliders: GliderTurtle[] = [];
  mama!: MamaTurtle;
  babies: BabyTurtle[] = [];
  whale!: Whale;
  private songBubbles: SongBubble[] = [];
  private songMat!: THREE.ShaderMaterial;
  private fishBubbleMat!: THREE.ShaderMaterial;
  private songPops = 0;
  private finaleRing: BubbleRing | null = null;
  private schools: FishSchool[] = [];
  clams: Clam[] = [];
  private pearls: Collectible[] = [];
  course!: TargetCourse;
  private vents: BubbleVent[] = [];
  private trail: THREE.Vector3[] = [];
  private homeCount = 0;
  private hinted = new Set<string>();
  private firstBegin = true;
  private sharkY: number[] = [];
  private followers: BabyTurtle[] = [];

  build(ctx: StageContext): void {
    this.ctx = ctx;
    clearMaterialCaches();
    W.resetWorldCaches();
    resetPropCaches();
    const rng = this.rng;
    const root = ctx.root;
    ctx.physics.groundHeight = seabed;
    ctx.physics.boundsRadius = 50;
    ctx.physics.waterSurface = SURFACE;
    this.spawn.pos.y = seabed(L.spawn[0], L.spawn[1]) + 3;
    const phys = ctx.physics;
    const gh = (x: number, z: number) => seabed(x, z);

    // ------------------------------------------------------------ seabed
    root.add(W.makeSeabed());

    // ------------------------------------------------------------ statics
    const statics = new THREE.Group();
    const place = (o: THREE.Object3D, x: number, z: number, y = 0, ry = rng.range(0, 6.28)) => {
      o.position.set(x, gh(x, z) + y, z);
      o.rotation.y = ry;
      statics.add(o);
      return o;
    };
    const coralCols = [C.peach, C.dusty, C.lavender, C.teal, C.cream, C.butter];
    const coral = (x: number, z: number, s: number) => {
      const kind = rng.chance(0.08) ? 4 : rng.int(0, 3);
      const col = rng.pick(coralCols);
      const o = kind === 0 ? W.brainCoral(rng, s * 0.9, col) : kind === 1 ? W.staghorn(rng, s * 1.3, col) : kind === 2 ? W.tableCoral(rng, s, col) : kind === 3 ? W.tubeSponge(rng, s * 1.1, col) : W.leatherCoral(rng, s, col);
      place(o, x, z, -0.05);
      if (s > 1.1 && (kind === 0 || kind === 3)) phys.add({ kind: 'cylinder', x, z, r: s * 0.8, yMin: -5, yMax: gh(x, z) + s * (kind === 0 ? 0.8 : 1.3) });
    };
    const head = (x: number, z: number, s: number) => {
      place(W.coralHead(rng, s, coralCols), x, z, -0.1);
      phys.add({ kind: 'sphere', center: new THREE.Vector3(x, gh(x, z) + s * 0.2, z), r: s * 0.95 });
    };
    // Coral garden near the start (puffer fish live here).
    for (let i = 0; i < 40; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.next()) * 10;
      const x = L.garden[0] + Math.cos(a) * r;
      const z = L.garden[1] + Math.sin(a) * r;
      if (W.keepOut(x, z, 0.5)) continue;
      if (i % 4 === 0) head(x, z, rng.range(1, 1.5));
      else coral(x, z, rng.range(0.7, 1.4));
    }
    // A ring of coral heads around the sandy clearing.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rng.range(-0.1, 0.1);
      const r = rng.range(10.5, 13);
      const x = L.clearing[0] + Math.cos(a) * r;
      const z = L.clearing[1] + Math.sin(a) * r;
      if (Math.hypot(x - L.spawn[0], z - L.spawn[1]) < 7 || W.keepOut(x, z, 0) && Math.hypot(x - L.clearing[0], z - L.clearing[1]) > 9) continue;
      head(x, z, rng.range(1.1, 1.7));
    }
    // Scattered corals and coral heads everywhere else, with the odd boulder.
    for (let i = 0; i < 170; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(8, 44);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (W.keepOut(x, z, 1)) continue;
      if (Math.hypot(x - L.kelp[0], z - L.kelp[1]) < 10) continue;
      const roll = rng.next();
      if (roll < 0.62) coral(x, z, rng.range(0.6, 1.5));
      else if (roll < 0.88) head(x, z, rng.range(0.8, 1.5));
      else {
        const s = rng.range(0.6, 1.6);
        place(W.rock(rng, s, rng.chance(0.5) ? C.rock : C.rockDark), x, z, s * 0.1);
        if (s > 1.1) phys.add({ kind: 'sphere', center: new THREE.Vector3(x, gh(x, z) + s * 0.2, z), r: s * 0.85 });
      }
    }
    // Reef rim: big mossy boulders with coral on top.
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rng.range(-0.05, 0.05);
      const r = rng.range(45, 55);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const s = rng.range(2.4, 4.5);
      place(W.rock(rng, s, rng.chance(0.5) ? C.rock : C.rockDark), x, z, s * 0.2);
      if (rng.chance(0.7)) {
        const c = rng.chance(0.5) ? W.staghorn(rng, rng.range(1, 1.6), rng.pick(coralCols)) : W.brainCoral(rng, rng.range(0.8, 1.3), rng.pick(coralCols));
        place(c, x + rng.range(-0.6, 0.6), z + rng.range(-0.6, 0.6), s * 0.75);
      }
    }
    // Rocks in the kelp forest.
    for (let i = 0; i < 10; i++) {
      const x = L.kelp[0] + rng.range(-10, 10);
      const z = L.kelp[1] + rng.range(-13, 13);
      if (Math.hypot(x - L.kelpClam[0], z - L.kelpClam[1]) < 3) continue;
      const s = rng.range(0.7, 1.5);
      place(W.rock(rng, s), x, z, s * 0.1);
    }

    // Landmarks -------------------------------------------------------
    const sp = W.spire(rng);
    place(sp.group, L.spire[0], L.spire[1], -0.2, 0);
    const spireBase = gh(L.spire[0], L.spire[1]) - 0.2;
    const spireTop = spireBase + sp.top;
    phys.add({ kind: 'cylinder', x: L.spire[0], z: L.spire[1], r: 2.3, yMin: -5, yMax: spireTop - 0.3 });

    const ld = W.ledge(rng);
    const ledgeY = gh(L.ledge[0], L.ledge[1]);
    place(ld.group, L.ledge[0], L.ledge[1], 0, 0);
    phys.add({ kind: 'box', min: new THREE.Vector3(L.ledge[0] - 4.2, ledgeY + ld.slabMin, L.ledge[1] - 2.8), max: new THREE.Vector3(L.ledge[0] + 4.2, ledgeY + ld.slabMax, L.ledge[1] + 2.8) });
    for (const s of [-1, 1]) phys.add({ kind: 'sphere', center: new THREE.Vector3(L.ledge[0] + s * 2.9, ledgeY + 0.8, L.ledge[1]), r: 1.6 });

    const gr = W.grotto(rng);
    const caveY = gh(L.cave[0], L.cave[1]);
    place(gr.group, L.cave[0], L.cave[1], 0, 0);
    for (const b of gr.boulders) phys.add({ kind: 'sphere', center: new THREE.Vector3(L.cave[0] + b.x, caveY + b.y, L.cave[1] + b.z), r: b.r });
    phys.add({ kind: 'box', min: new THREE.Vector3(L.cave[0] - 4.8, caveY + gr.roofMin, L.cave[1] - 4.8), max: new THREE.Vector3(L.cave[0] + 4.8, caveY + gr.roofMax, L.cave[1] + 4.8) });
    // Soft glowing mushrooms inside the grotto.
    for (let i = 0; i < 7; i++) {
      const a = rng.range(Math.PI * 0.6, Math.PI * 1.4);
      const r = rng.range(1.2, 2.0);
      const x = L.cave[0] + Math.sin(a) * r;
      const z = L.cave[1] + Math.cos(a) * r;
      const glow = new THREE.Group();
      glow.add(part(geo.cyl(1, 1, 8), mat(0xe9e3d0), [0, 0.12, 0], [0.04, 0.24, 0.04], [0, 0, 0], false));
      glow.add(part(geo.sphere(12), mat(0xbfeee2, { emissive: 0x9fe8d6, emissiveIntensity: 1.1 }), [0, 0.26, 0], [0.14, 0.08, 0.14], [0, 0, 0], false));
      glow.scale.setScalar(rng.range(0.9, 1.6));
      place(glow, x, z, 0);
    }

    const ar = W.arch(rng);
    const archDir = Math.atan2(-24 - 8, -6 - -24); // travel from ring 6 to ring 8
    place(ar.group, L.arch[0], L.arch[1], 0, archDir);
    ar.group.updateMatrixWorld(true);
    for (const s of ar.stones) {
      const w = s.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), archDir);
      phys.add({ kind: 'sphere', center: new THREE.Vector3(L.arch[0] + w.x, gh(L.arch[0], L.arch[1]) + w.y, L.arch[1] + w.z), r: ar.r });
    }

    const boat = W.sailboat();
    const boatY = gh(L.boat[0], L.boat[1]) - 0.15;
    boat.position.set(L.boat[0], boatY, L.boat[1]);
    boat.rotation.set(0.2, 0, 0.06);
    statics.add(boat);
    boat.updateMatrixWorld(true);
    for (const s of [-1, 1]) phys.add({ kind: 'box', min: new THREE.Vector3(L.boat[0] - 3.4, boatY - 1, L.boat[1] + s * 1.35 - 0.25 + (s > 0 ? -0.25 : 0.2)), max: new THREE.Vector3(L.boat[0] + 2.4, boatY + 1.55, L.boat[1] + s * 1.35 + 0.25 + (s > 0 ? -0.25 : 0.2)) });
    phys.add({ kind: 'box', min: new THREE.Vector3(L.boat[0] - 3.7, boatY - 1, L.boat[1] - 1.1), max: new THREE.Vector3(L.boat[0] - 3.3, boatY + 1.5, L.boat[1] + 1.1) });
    phys.add({ kind: 'box', min: new THREE.Vector3(L.boat[0] + 2.4, boatY - 1, L.boat[1] - 0.8), max: new THREE.Vector3(L.boat[0] + 3.8, boatY + 1.5, L.boat[1] + 0.8) });
    const mastW = boat.localToWorld(new THREE.Vector3(0.6, 0, 0));
    phys.add({ kind: 'cylinder', x: mastW.x, z: mastW.z, r: 0.2, yMin: -5, yMax: boatY + 6.6 });

    const nst = W.nest(rng);
    place(nst, L.nest[0], L.nest[1], 0, 0);
    phys.add({ kind: 'sphere', center: new THREE.Vector3(L.nest[0] - 2.8, gh(L.nest[0], L.nest[1]) + 0.8, L.nest[1] - 2.5), r: 2.1 });

    // Anemone columns (tentacles are instanced below).
    for (const a of L.anemones) {
      const g = new THREE.Group();
      g.add(part(geo.cyl(0.85, 1, 16), cmat(0xe7b7a0, { rough: 0.7 }), [0, 0.28, 0], [0.62, 0.56, 0.62]));
      g.add(part(geo.cyl(1, 1, 16), mat(0xf3d9c8, { rough: 0.6 }), [0, 0.56, 0], [0.55, 0.03, 0.55], [0, 0, 0], false));
      place(g, a[0], a[1], 0, 0);
    }
    // Bake colours, then merge per 26 m chunk so both the camera and the shadow pass can cull.
    paintStatic(statics, 0.85);
    statics.updateMatrixWorld(true);
    const chunks = new Map<string, THREE.Group>();
    for (const child of [...statics.children]) {
      const p = child.getWorldPosition(new THREE.Vector3());
      const key = `${Math.floor(p.x / 26)}|${Math.floor(p.z / 26)}`;
      let grp = chunks.get(key);
      if (!grp) {
        grp = new THREE.Group();
        chunks.set(key, grp);
      }
      grp.attach(child);
    }
    for (const grp of chunks.values()) {
      const merged = mergeStatic(grp, true, true);
      for (const m of merged.children) (m as THREE.Mesh).geometry.computeBoundingSphere();
      root.add(merged);
    }

    // Instanced plants and sand bits.
    const plants = W.makePlants(rng, [L.kelpClam, [-31, -4]]);
    root.add(plants.kelp, plants.grass, ...plants.fans, plants.tentacles);
    for (const m of W.makeSandBits(rng)) root.add(m);

    // Bubble vents.
    for (const v of L.vents) {
      const p = new THREE.Vector3(v[0], gh(v[0], v[1]), v[1]);
      const vr = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const r = W.rock(rng, 0.45, C.rockDark, false);
        r.position.set(Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55);
        vr.add(r);
      }
      this.vents.push(new BubbleVent(ctx, p, mergeStatic(vr, true, true)));
    }

    // ------------------------------------------------------------ creatures
    this.songMat = createBubbleMaterial({ wobble: 0.05, tint: 0xf7ecd2, glow: 0.45 });
    this.fishBubbleMat = createBubbleMaterial({ wobble: 0.05, tint: 0xd7edf2 });
    const schoolDefs = [
      { home: new THREE.Vector3(6, 4.5, 14), count: 34, color: 0xa9c8d8, radius: 9, spread: 2.4, speed: 1, seed: 11 },
      { home: new THREE.Vector3(-22, 6, -6), count: 28, color: 0xead18c, radius: 7, spread: 2.2, speed: 0.9, seed: 23 },
      { home: new THREE.Vector3(18, 5, -18), count: 24, color: 0xe9a892, radius: 8, spread: 2, speed: 1.1, seed: 37 },
      { home: new THREE.Vector3(-6, 3.5, 8), count: 40, color: 0x86c3c4, colors: [0x86c3c4, 0x9dcfd0, 0x7fb6c9], scale: 0.7, radius: 6, spread: 1.6, speed: 1.2, seed: 41 },
      { home: new THREE.Vector3(10, 7, -30), count: 26, color: 0xc7b9de, radius: 9, spread: 2.4, speed: 0.8, seed: 53 },
    ];
    for (const sd of schoolDefs) this.schools.push(new FishSchool(ctx, sd, this.fishBubbleMat));

    const pufferSpots: [number, number, number][] = [
      [4, 2.6, 25], [11, 3, 21], [15, 2.4, 13], [-4, 3.2, 17], [7, 3.8, 9], [-7, 2.6, 27],
    ];
    pufferSpots.forEach(([x, y, z], i) => {
      const p = new Puffer(ctx, new THREE.Vector3(x, gh(x, z) + y, z), i % 3 === 1 ? 0xe2d0a0 : i % 3 === 2 ? 0xe9d2b4 : C.puffer);
      p.onPuffed = (pf) => this.onPuffed(pf);
      this.puffers.push(p);
    });

    for (const a of L.anemones) {
      const base = new THREE.Vector3(a[0], gh(a[0], a[1]) + 0.55, a[1]);
      const n = a === L.anemones[0] || a === L.anemones[3] ? 2 : 1;
      for (let k = 0; k < n; k++) this.clowns.push(new Clownfish(ctx, base, k * Math.PI));
    }

    const crabSpots: [number, number, number][] = [[3, -1, 5], [-6, 5, 4], [22, -17, 3.5], [-21, 23, 3], [13, 27, 3], [-9, -30, 4]];
    for (const [x, z, r] of crabSpots) this.crabs.push(new Crab(ctx, new THREE.Vector3(x, gh(x, z), z), r));

    this.gliders.push(new GliderTurtle(ctx, new THREE.Vector3(0, 0, 0), 30, 9.5, 1, 1.5));
    this.gliders.push(new GliderTurtle(ctx, new THREE.Vector3(6, 0, -6), 22, 6.5, -1, 1.25));

    // Sharks circling the clearing.
    const sharkDefs: [number, number, number, number][] = [
      [12, 5, 1, 0x93abbb],
      [17, 7, -1, 0x9cb3b5],
      [22, 9, 1, 0x8fa5c0],
    ];
    const sc = new THREE.Vector3(L.sharkCenter[0], 0, L.sharkCenter[1]);
    for (const [r, y, d, col] of sharkDefs) {
      const s = new Shark(ctx, sc, r, y, d, col);
      s.onBoop = (sh) => this.onBoop(sh);
      this.sharks.push(s);
      this.sharkY.push(y);
    }

    // Mama Turtle and her four lost babies.
    const nestP = new THREE.Vector3(L.nest[0], gh(L.nest[0], L.nest[1]), L.nest[1]);
    this.mama = new MamaTurtle(ctx, nestP, Math.atan2(L.spawn[0] - L.nest[0], L.spawn[1] - L.nest[1]) - 0.3);
    phys.add({ kind: 'cylinder', x: nestP.x, z: nestP.z, r: 1.9, yMin: -5, yMax: nestP.y + 1.9 });
    const babySpots: [number, number, number][] = [
      [-31, 2.6, -4],
      [31, 2.6, -30],
      [3, 2.6, -37],
      [37, 3.2, 14],
    ];
    const babyShells = [0x9bb59a, 0xa7b88f, 0x8fb0a4, 0xb0b58d];
    babySpots.forEach(([x, y, z], i) => {
      const b = new BabyTurtle(ctx, new THREE.Vector3(x, gh(x, z) + y, z), babyShells[i]);
      b.trailPoint = (back, out) => this.trailPoint(back, out);
      b.canFollow = () => ctx.objectives.isCurrent('turtles');
      b.onStartFollow = (bb) => this.onBabyFollow(bb);
      this.babies.push(b);
    });

    // Mama Mo.
    this.whale = new Whale(ctx);
    this.whale.onPhrase = (mouth, w) => this.spawnSongBubbles(mouth, w);
    this.whale.onRingPass = () => this.onRingPass();

    // Shadows: only the big friends' main bodies cast; little critters use soft blob shadows or none.
    const keepLargest = (root: THREE.Object3D) => {
      let best: THREE.Mesh | null = null;
      let bestN = 0;
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = false;
        const n = m.geometry.attributes.position.count;
        if (n > bestN) {
          bestN = n;
          best = m;
        }
      });
      if (best) (best as THREE.Mesh).castShadow = true;
    };
    for (const c of [...this.puffers, ...this.clowns, ...this.babies, ...this.crabs]) c.root.traverse((o) => ((o as THREE.Mesh).castShadow = false));
    for (const c of [...this.sharks, ...this.gliders, this.mama]) keepLargest(c.root);

    // ------------------------------------------------------------ pearls in clams
    const clamSpots: { p: THREE.Vector3; ry: number; color: number }[] = [
      { p: new THREE.Vector3(L.ledge[0] + 0.4, ledgeY + 0.02, L.ledge[1] + 0.2), ry: 0.3, color: C.clam },
      { p: boat.localToWorld(new THREE.Vector3(-1.4, 0.33, 0)), ry: 0.2, color: 0xd9c2cf },
      { p: new THREE.Vector3(L.spire[0], spireTop - 0.05, L.spire[1]), ry: -2.2, color: 0xcab9da },
      { p: new THREE.Vector3(L.kelpClam[0], gh(L.kelpClam[0], L.kelpClam[1]) - 0.02, L.kelpClam[1]), ry: 1.1, color: 0xc4bcd3 },
      { p: new THREE.Vector3(L.cave[0], caveY + 0.02, L.cave[1] - 0.6), ry: 0, color: 0xd2c0dc },
    ];
    for (const cs of clamSpots) {
      const c = new Clam(ctx, cs.p, cs.ry, cs.color);
      c.onOpen = (cl) => this.onClamOpen(cl);
      this.clams.push(c);
    }

    // ------------------------------------------------------------ Ring Swim
    const route: [number, number, number][] = [
      [10, 3.2, 21],
      [17, 5, 11],
      [25, 9, 2],
      [23, 6, -9],
      [19, 3.4, -19],
      [6, 4.5, -24],
      [L.arch[0], 2.2, L.arch[1]],
      [-24, 4.5, -4],
      [-19, 7.5, 10],
      [-5, 4.5, 23],
    ];
    const pts = route.map(([x, y, z]) => new THREE.Vector3(x, gh(x, z) + y, z));
    const padPos = new THREE.Vector3(L.pad[0], gh(L.pad[0], L.pad[1]) + 0.05, L.pad[1]);
    this.course = new TargetCourse(ctx, {
      objective: 'rings',
      pad: padPos,
      par: 60,
      title: 'Ring Swim',
      intro: 'nar_challenge_rings',
      rings: true,
      padColor: 0x8fd0c4,
      targets: pts.map((p, i) => {
        const prev = i === 0 ? padPos : pts[i - 1];
        const next = i === pts.length - 1 ? p.clone().add(p.clone().sub(prev)) : pts[i + 1];
        const dir = next.clone().sub(prev);
        return { pos: p, model: () => bubbleRingModel(), facing: Math.atan2(dir.x, dir.z) };
      }),
    });

    // Prime Ace's swim trail.
    const sp0 = this.spawn.pos.clone();
    for (let i = 0; i < 6; i++) this.trail.push(sp0.clone());
  }

  // ---------------------------------------------------------------- flow
  override begin(): void {
    const ctx = this.ctx;
    if (ctx.probe) return;
    if (this.firstBegin) {
      this.firstBegin = false;
      ctx.hint('[W] swims where you look · [Space] up · [Shift] down', 9);
      this.later(4.5, () => ctx.narrate('nar_coral_swim'));
      this.later(10, () => this.showStepHint());
    } else this.showStepHint();
  }

  private later(sec: number, fn: () => void): void {
    this.timers.push({ t: sec, fn });
  }

  private showStepHint(): void {
    const ctx = this.ctx;
    const cur = ctx.objectives.current();
    if (!cur) return;
    const hints: Record<string, string> = {
      puffers: 'Blow bubbles at the puffer fish to make them puff up!',
      sharks: ctx.hasBlaster('boing') ? 'Bonk the sharks with a ball - press [2] for the Boing Ball (bubbles work too)!' : 'Boop the sharks with your bubbles - they love it!',
      turtles: 'Find the lost baby turtles - follow their bubble trails, then swim them back to Mama Turtle!',
      whale: "Pop Mama Mo's glowing song bubbles!",
    };
    const h = hints[cur.def.id];
    if (h) ctx.hint(h, 12);
  }

  override onObjectiveComplete(id: string): void {
    const ctx = this.ctx;
    if (id === 'puffers') {
      ctx.cheer('Puff-tastic!');
      this.later(3.2, () => {
        ctx.say('ace_lookthere', 1);
        ctx.focusOn(this.nearestShark().position.clone(), 2);
        this.showStepHint();
      });
    } else if (id === 'sharks') {
      ctx.cheer('Boop-a-licious!');
      this.later(3.2, () => {
        ctx.focusOn(this.mama.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 2);
        this.showStepHint();
      });
    } else if (id === 'turtles') {
      this.mama.celebrate();
      ctx.fx.celebrate(this.mama.position.clone().add(new THREE.Vector3(0, 3, 0)), 1.2);
      ctx.banner('Family together!', 'Mama Turtle is so happy', 3);
      this.later(4, () => this.startWhale());
    } else if (id === 'pearls') {
      ctx.say('ace_treasure_all', 1);
    } else if (id === 'whale') {
      ctx.hint(null);
    }
  }

  private startWhale(): void {
    const ctx = this.ctx;
    this.whale.setPhase('arrive');
    for (let i = 0; i < this.sharks.length; i++) this.sharkY[i] = 3.2 + i * 0.9;
    ctx.narrate('nar_coral_whale');
    ctx.banner('Big friend: Mama Mo!', 'Pop her glowing song bubbles', 3.5);
    ctx.focusOn(this.whale.position.clone(), 2.4);
    this.whale.sing(1);
    this.later(4.5, () => ctx.say('ace_whale', 1));
    this.later(6, () => this.showStepHint());
  }

  private nearestShark(): Shark {
    let best = this.sharks[0];
    let bd = Infinity;
    for (const s of this.sharks) {
      if (this.booped.has(s)) continue;
      const d = s.distanceToPlayer();
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  private onPuffed(p: Puffer): void {
    const ctx = this.ctx;
    if (!ctx.objectives.isCurrent('puffers')) return;
    if (this.puffed.has(p)) return;
    this.puffed.add(p);
    ctx.objectives.add('puffers');
    if (this.puffed.size === 1) ctx.say('ace_puffer', 1);
    else if (this.puffed.size < 3) ctx.cheer(this.puffed.size === 2 ? 'Puff puff!' : 'So round!');
  }

  private onBoop(s: Shark): void {
    const ctx = this.ctx;
    if (!this.booped.has(s) || Math.random() < 0.25) ctx.say('ace_shark', this.booped.size === 0 ? 1 : 0);
    if (!ctx.objectives.isCurrent('sharks')) return;
    if (this.booped.has(s)) {
      ctx.cheer('Spin again!');
      return;
    }
    this.booped.add(s);
    ctx.objectives.add('sharks');
    const left = 3 - this.booped.size;
    if (left > 0) ctx.cheer(left === 1 ? 'One more shark!' : 'Barrel roll!');
  }

  private onBabyFollow(b: BabyTurtle): void {
    const ctx = this.ctx;
    if (!this.followers.includes(b)) this.followers.push(b);
    b.slot = this.followers.indexOf(b);
    ctx.say('ace_turtle', 1);
    ctx.cheer('A baby turtle is following you!');
    if (!this.hinted.has('lead')) {
      this.hinted.add('lead');
      ctx.hint('Swim back to Mama Turtle - the baby will follow you!', 6);
    }
  }

  private onClamOpen(c: Clam): void {
    const ctx = this.ctx;
    c.hidePearl();
    const p = c.pearlSpot(new THREE.Vector3());
    const col = new Collectible(ctx, p, pearlModel(), { objective: 'pearls', say: 'ace_pearl', cheer: 'A shiny pearl!', color: 0xfff1e2, radius: 1.6 });
    this.pearls.push(col);
  }

  private spawnSongBubbles(mouth: THREE.Vector3, w: Whale): void {
    const ctx = this.ctx;
    const alive = this.songBubbles.filter((b) => b.alive).length;
    const n = Math.min(3, 10 - alive);
    const toCenter = new THREE.Vector3().subVectors(w.singCenter, w.position).setY(0).normalize();
    for (let i = 0; i < n; i++) {
      const v = toCenter.clone().multiplyScalar(2.2 + i * 0.6);
      v.x += (Math.random() - 0.5) * 1.5;
      v.z += (Math.random() - 0.5) * 1.5;
      v.y = 0.2 + Math.random() * 0.3 - (mouth.y > 9 ? 0.6 : 0);
      const start = mouth.clone().addScaledVector(toCenter, 2 + i * 0.8);
      start.y -= 0.5;
      this.songBubbles.push(new SongBubble(ctx, start, v, this.songMat, () => this.onSongPop()));
    }
  }

  private onSongPop(): void {
    const ctx = this.ctx;
    // Each pop plays the next note of a little rising tune.
    const tune = [1, 1.122, 1.26, 1.498, 1.682, 2];
    ctx.sfx('sfx_star', { rate: tune[Math.min(this.songPops, tune.length - 1)], jitter: 0, volume: 0.8 });
    if (!ctx.objectives.isCurrent('whale') || this.whale.phase !== 'sing') return;
    this.songPops++;
    if (this.songPops < 6) {
      ctx.objectives.add('whale');
      ctx.cheer(['La la la!', 'A song note!', 'Pretty!', 'Ooh, music!', 'One more!'][this.songPops - 1]);
      return;
    }
    // Sixth note: the grand finale. The last tick of the counter lands when she swims through the ring.
    this.startFinale();
  }

  private startFinale(): void {
    const ctx = this.ctx;
    const w = this.whale;
    for (const b of this.songBubbles) b.fade();
    ctx.banner('All six notes!', 'Look - Mama Mo is dancing!', 3);
    ctx.cheer('Beautiful!');
    w.joyRoll();
    w.sing(1);
    // A ring of bubbles appears in front of Ace, a little above; she glides through it across his view.
    const pl = ctx.player;
    const eye = pl.eyePosition(new THREE.Vector3());
    const fwd = pl.viewForward(new THREE.Vector3()).setY(0);
    if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1);
    fwd.normalize();
    const ring = eye.clone().addScaledVector(fwd, 14);
    ctx.physics.clampBounds(ring, 10);
    ring.y = THREE.MathUtils.clamp(eye.y + 3, seabed(ring.x, ring.z) + 6, SURFACE - 3.4);
    // Her path crosses Ace's view on a diagonal, so the ring reads as a ring and she passes ~10 m away.
    let dir = new THREE.Vector3(-fwd.z, 0, fwd.x).addScaledVector(fwd, -0.85).normalize();
    const dirB = new THREE.Vector3(fwd.z, 0, -fwd.x).addScaledVector(fwd, -0.85).normalize();
    const startA = ring.clone().addScaledVector(dir, -28);
    const startB = ring.clone().addScaledVector(dirB, -28);
    if (startB.distanceTo(w.position) < startA.distanceTo(w.position)) dir = dirB;
    w.ringPos.copy(ring);
    w.passStart.copy(ring).addScaledVector(dir, -26);
    w.passEnd.copy(ring).addScaledVector(dir, 30);
    this.finaleRing = new BubbleRing(ctx, ring, Math.atan2(dir.x, dir.z), 6.2);
    w.setPhase('pass');
    this.later(1.2, () => ctx.focusOn(ring.clone(), 2.5));
    ctx.sfx('sfx_ring_through', { volume: 0.8 });
  }

  private onRingPass(): void {
    const ctx = this.ctx;
    const ring = this.finaleRing;
    const at = ring ? ring.group.position.clone() : this.whale.position.clone();
    ring?.pop();
    ctx.fx.celebrate(at, 2.2);
    ctx.fx.notes(at, 12);
    ctx.fx.hearts(at, 8);
    ctx.sfx('sfx_whale_song', { volume: 1, jitter: 0 });
    ctx.shake(0.06);
    ctx.banner("Mama Mo's song!", 'What a wonderful show', 3.5);
    ctx.say('ace_whale_done', 2);
    ctx.objectives.complete('whale');
    for (let i = 0; i < this.sharks.length; i++) this.sharks[i].boop();
    this.mama.celebrate();
  }

  // ---------------------------------------------------------------- trail
  private recordTrail(): void {
    const p = this.ctx.player.position;
    const last = this.trail[this.trail.length - 1];
    if (last.distanceToSquared(p) > 0.35 * 0.35) {
      this.trail.push(p.clone());
      if (this.trail.length > 160) this.trail.shift();
    }
  }

  private trailPoint(back: number, out: THREE.Vector3): THREE.Vector3 {
    let acc = 0;
    let prev = this.ctx.player.position;
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const q = this.trail[i];
      const d = prev.distanceTo(q);
      if (acc + d >= back) {
        const k = (back - acc) / Math.max(d, 1e-4);
        return out.lerpVectors(prev, q, k).add(new THREE.Vector3(0, 0.5, 0));
      }
      acc += d;
      prev = q;
    }
    return out.copy(prev).add(new THREE.Vector3(0, 0.5, 0));
  }

  // ---------------------------------------------------------------- update
  update(dt: number, t: number): void {
    const ctx = this.ctx;
    sway.uSwayTime.value = t;
    fishUniforms.uFishTime.value = t;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }
    this.recordTrail();
    for (const s of this.schools) s.update(dt, t);
    for (const p of this.puffers) p.update(dt, t);
    for (const c of this.clowns) c.update(dt, t);
    for (const c of this.crabs) c.update(dt, t);
    for (const g of this.gliders) g.update(dt, t);
    for (let i = 0; i < this.sharks.length; i++) {
      const s = this.sharks[i];
      s.y += (this.sharkY[i] - s.y) * Math.min(1, dt * 0.3);
      s.update(dt, t);
    }
    this.mama.update(dt, t);
    this.updateBabies();
    for (const b of this.babies) b.update(dt, t);
    this.whale.update(dt, t);
    this.whaleBump();
    for (let i = this.songBubbles.length - 1; i >= 0; i--) {
      const b = this.songBubbles[i];
      b.update(dt, t);
      if (!b.alive) this.songBubbles.splice(i, 1);
    }
    // Never run dry: while she sings, keep a few song bubbles around.
    if (this.whale.phase === 'sing' && this.songBubbles.length < 2 && ctx.objectives.isCurrent('whale')) {
      this.whale.songT = Math.min(this.whale.songT, 1.5);
    }
    this.finaleRing?.update(dt, t);
    if (this.finaleRing?.burst) this.finaleRing = null;
    for (const c of this.clams) c.update(dt, t);
    for (const p of this.pearls) p.update(dt, t);
    for (const v of this.vents) v.update(dt);
    this.course.update(dt, t);
    this.ringBeacon(dt);
    this.contextHints();
  }

  private beaconT = 0;
  /** While the Ring Swim runs, the next ring sparkles softly so the route is easy to follow. */
  private ringBeacon(dt: number): void {
    if (this.course.state !== 'running') return;
    this.beaconT -= dt;
    if (this.beaconT > 0) return;
    this.beaconT = 0.12;
    const targets = (this.course as unknown as { targets: { popped: boolean; group: THREE.Object3D }[] }).targets;
    const next = targets.find((tg) => !tg.popped);
    if (!next) return;
    const a = Math.random() * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(a) * 1.45, Math.sin(a) * 1.45, 0).applyQuaternion(next.group.quaternion).add(next.group.position);
    this.ctx.fx.glow.emit(p, { count: 1, shape: 1, size: 0.55, sizeEnd: 0.05, speed: 0.4, life: 0.7, color: 0xfff0c8, alpha: 0.7 });
  }

  /** Mama Mo feels solid: Ace is gently nudged away from her body instead of swimming inside it. */
  private whaleBump(): void {
    const w = this.whale;
    const pl = this.ctx.player;
    const eye = pl.eyePosition(new THREE.Vector3());
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(w.root.quaternion);
    const rel = eye.clone().sub(w.position);
    const along = THREE.MathUtils.clamp(rel.dot(f), -7, 6.5);
    const closest = w.position.clone().addScaledVector(f, along);
    const off = eye.sub(closest);
    const d = off.length();
    const rad = along > 3 ? 2.6 : along < -3 ? 1.6 : 2.9;
    if (d < rad + 0.6 && d > 0.001) {
      off.multiplyScalar(1 / d);
      pl.position.addScaledVector(off, (rad + 0.6 - d) * 0.35);
      pl.externalVel.addScaledVector(off, 0.6);
    }
  }

  private updateBabies(): void {
    const ctx = this.ctx;
    const mp = this.mama.position;
    for (const b of this.babies) {
      if (b.state === 'follow' || b.state === 'wait') {
        const d = Math.hypot(b.position.x - mp.x, b.position.z - mp.z);
        const pp = ctx.player.position;
        const aceAtMama = Math.hypot(pp.x - mp.x, pp.z - mp.z) < 7 && Math.abs(pp.y - mp.y) < 8;
        // Forgiving: once Ace brings a follower to Mama, it swims the last bit home itself.
        if ((d < 9 && b.position.y < mp.y + 9) || (b.state === 'follow' && aceAtMama)) {
          b.setState('home');
          b.slot = this.homeCount;
          b.homeSpot.copy(mp);
          this.homeCount++;
          const i = this.followers.indexOf(b);
          if (i >= 0) this.followers.splice(i, 1);
          this.followers.forEach((f, k) => (f.slot = k));
          ctx.sfx('sfx_turtle_chirp', { pos: b.position, volume: 1 });
          ctx.fx.hearts(b.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 4);
          ctx.fx.sparkle(b.position, 12, [0xfff3d6, 0xe3f4f8], 1);
          this.mama.celebrate();
          ctx.objectives.add('turtles');
          const left = 4 - this.homeCount;
          if (left > 0) ctx.cheer(left === 1 ? 'One more baby!' : 'Home with Mama!');
        }
      }
      if (b.state === 'wait' && !this.hinted.has('wait')) {
        this.hinted.add('wait');
        ctx.hint('A baby turtle is waiting for you - look for its bubble trail!', 6);
      }
      if (b.state === 'wait' && b.distanceToPlayer() < 4.5) {
        b.setState('follow');
        ctx.sfx('sfx_turtle_chirp', { pos: b.position });
      }
    }
  }

  private contextHints(): void {
    const ctx = this.ctx;
    if (!this.hinted.has('clam')) {
      for (const c of this.clams) {
        if (!c.opened && c.group.position.distanceTo(ctx.player.position) < 7) {
          this.hinted.add('clam');
          ctx.hint('A giant clam! Bubble it or bonk it to peek inside.', 5);
          break;
        }
      }
    }
    if (!this.hinted.has('pad')) {
      const pp = this.course.pad.position;
      if (ctx.time > 20 && Math.hypot(ctx.player.position.x - pp.x, ctx.player.position.z - pp.z) < 3.5) {
        this.hinted.add('pad');
        ctx.hint('Swim down onto the glowing pad to start the Ring Swim!', 5);
      }
    }
  }

  override dispose(): void {
    for (const s of this.schools) s.dispose();
    if (this.songMat) releaseBubbleMaterial(this.songMat);
    if (this.fishBubbleMat) releaseBubbleMaterial(this.fishBubbleMat);
    if (this.finaleRing && !this.finaleRing.burst) releaseBubbleMaterial(this.finaleRing.mat);
    for (const w of [this.whale, this.mama, ...this.sharks, ...this.puffers, ...this.babies, ...this.crabs, ...this.clowns, ...this.gliders]) w?.dispose();
    this.timers.length = 0;
  }
}
