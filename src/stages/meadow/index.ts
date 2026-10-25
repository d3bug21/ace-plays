import * as THREE from 'three';
import type { StageMeta } from '../index';
import { Stage, type StageContext, type StageEnvironment, type StageInfo, type ObjectiveDef } from '../types';
import { Noise, Rng, smoothstep } from '../../core/math';
import { makeTerrain, scatter, distToPath } from '../../kit/terrain';
import { geo, mat, mergeStatic, part } from '../../kit/kit';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeClouds } from '../../fx/Environment';
import { Collectible, PopTarget, TargetCourse, Zone, balloonModel } from '../../gameplay/Helpers';
import type { Hittable, HitInfo, HitResponse } from '../../gameplay/Hit';
import { Bunny, Duck, Biscuit } from './creatures';
import * as props from './props';

const P = props.P;

const info: StageInfo = {
  id: 'meadow',
  name: 'Bubble Park',
  tagline: 'Learn to bubble and bounce in the sunny park, then play fetch with Biscuit, the biggest, fluffiest dog around!',
  map: { x: 17, y: 78 },
  accent: '#7fae84',
  icon: 'meadow',
  musicId: 'mus_meadow',
  ambienceId: 'amb_meadow',
  introNarration: 'nar_meadow_intro',
  introAce: 'ace_meadow_intro',
  mode: 'walk',
  footstep: 'sfx_step_grass',
};

const objectives: ObjectiveDef[] = [
  { id: 'look', kind: 'main', label: 'Look around', icon: 'mouse', target: 1, hint: 'Move the mouse to look around' },
  { id: 'walk', kind: 'main', label: 'Walk to the red flag', icon: 'flag', target: 1, hint: 'Use W A S D or the arrow keys' },
  { id: 'jump', kind: 'main', label: 'Jump over the log', icon: 'space', target: 1, hint: 'Press Space to jump' },
  { id: 'balloons', kind: 'main', label: 'Pop the balloons with bubbles', icon: 'balloon', target: 3, hint: 'Click to blow bubbles' },
  { id: 'bunny', kind: 'main', label: 'Bubble a bunny', icon: 'bunny', target: 1, hint: 'Bubbles give bunnies a floaty ride' },
  { id: 'boing', kind: 'main', label: 'Find the Boing Ball blaster', icon: 'ball', target: 1, hint: 'It is by the swings' },
  { id: 'bell', kind: 'main', label: 'Ring the big bell with a ball', icon: 'bell', target: 1, hint: 'Press 2 for the Boing Ball' },
  { id: 'fetch', kind: 'main', label: 'Play fetch with Biscuit', icon: 'dog', target: 3, hint: 'Bounce balls near Biscuit' },
  { id: 'acorns', kind: 'treasure', label: 'Find golden acorns', icon: 'acorn', target: 5 },
  { id: 'dash', kind: 'challenge', label: 'Balloon Dash: pop 10 in 45s', icon: 'clock', target: 1 },
];

export const meta: StageMeta = { info, objectives, introColors: ['#9fc18f', '#3e6250'] };

export function create(): Stage {
  return new MeadowStage();
}

const PATH: [number, number][] = [[0, 36], [0, 18], [0, 9], [1, 0], [-2, -8], [0, -18], [0, -28]];
const POND = new THREE.Vector2(-16, 4);
const POND_R = 7;
const WATER_Y = -0.35;

class MeadowStage extends Stage {
  readonly info = info;
  readonly objectives = objectives;
  readonly env: StageEnvironment = {
    sky: { top: '#86b9d2', horizon: '#eee6d2', bottom: '#cfc7b1', sunColor: '#fff0cf', sunSize: 1.4 },
    fog: { color: '#e6e5d4', density: 0.0075 },
    hemi: { sky: '#f3f0e4', ground: '#8ea283', intensity: 1.35 },
    sun: { color: '#fff1da', intensity: 2.5, dir: [0.45, 0.85, 0.35], shadows: true },
    exposure: 1.0,
    bloom: { strength: 0.22, radius: 0.5, threshold: 0.9 },
    weather: { kind: 'pollen', density: 0.25, color: '#fffbe8' },
  };
  readonly spawn = { pos: new THREE.Vector3(0, 0, 32), yaw: 0 };
  private noise = new Noise(42);
  private rng = new Rng(7);
  private zones: Zone[] = [];
  private balloons: PopTarget[] = [];
  private bunnies: Bunny[] = [];
  private ducks: Duck[] = [];
  private biscuit!: Biscuit;
  private acorns: Collectible[] = [];
  private course!: TargetCourse;
  private flagG!: THREE.Group;
  private bell!: THREE.Group;
  private bellSwing = 0;
  private swings: THREE.Group[] = [];
  private pickup: { group: THREE.Group; gun: THREE.Group; taken: boolean } | null = null;
  private lookAccum = 0;
  private lastYaw = 0;
  private lastPitch = 0;
  private stepT = 0;
  private butterflies: { g: THREE.Group; base: THREE.Vector3; ph: number; wings: THREE.Mesh[] }[] = [];
  private clouds!: THREE.Group;
  private hintShown = new Set<string>();
  private switchHinted = false;
  private bellHint = 0;
  private lily: THREE.InstancedMesh | null = null;
  private waterTime = { value: 0 };

  height = (x: number, z: number): number => {
    const n = this.noise;
    let h = n.fbm2(x * 0.025, z * 0.025, 3) * 1.6 + n.n2(x * 0.08, z * 0.08) * 0.15;
    // Keep the play path gentle.
    const dp = distToPath(x, z, PATH);
    h *= 0.35 + 0.65 * smoothstep(2, 9, dp);
    // Rolling boundary hills.
    const r = Math.hypot(x, z);
    h += smoothstep(44, 62, r) * 7 + smoothstep(56, 70, r) * 6;
    // Pond bowl.
    const pd = Math.hypot(x - POND.x, z - POND.y);
    h -= (1 - smoothstep(POND_R - 3, POND_R + 1.5, pd)) * 1.3;
    // Little hill with a treasure on top.
    h += Math.max(0, 1 - Math.hypot(x - 22, z + 16) / 7) ** 2 * 3.2;
    return h;
  };

  build(ctx: StageContext): void {
    this.ctx = ctx;
    const root = ctx.root;
    const rng = this.rng;
    ctx.physics.groundHeight = this.height;
    ctx.physics.boundsRadius = 54;
    this.spawn.pos.y = this.height(0, 32);

    // --- Terrain
    const cA = new THREE.Color(P.grass);
    const cB = new THREE.Color(P.grassDeep);
    const cC = new THREE.Color(P.grassLight);
    const cPath = new THREE.Color(P.path);
    const cSand = new THREE.Color(0xd9cfb5);
    root.add(
      makeTerrain({
        size: 150,
        segments: 150,
        height: this.height,
        color: (x, z, h, out) => {
          const v = this.noise.n2(x * 0.06 + 10, z * 0.06) * 0.5 + 0.5;
          out.copy(cA).lerp(cB, v * 0.6).lerp(cC, smoothstep(2, 7, h) * 0.5);
          const dp = distToPath(x, z, PATH);
          out.lerp(cPath, 1 - smoothstep(1.1, 2.0, dp));
          const pd = Math.hypot(x - POND.x, z - POND.y);
          out.lerp(cSand, (1 - smoothstep(POND_R - 0.5, POND_R + 1.2, pd)) * 0.8);
        },
      }),
    );
    // Pond water.
    const waterMat = new THREE.MeshStandardMaterial({ color: P.water, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.86 });
    // Gentle animated sparkle ripples on the pond surface.
    waterMat.onBeforeCompile = (sh) => {
      sh.uniforms.uT = this.waterTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;').replace('#include <project_vertex>', '#include <project_vertex>\nvWXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;\nuniform float uT;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float rip = sin(vWXZ.x * 2.1 + uT * 1.3) * sin(vWXZ.y * 1.7 - uT * 1.1) + sin((vWXZ.x - vWXZ.y) * 3.3 + uT * 0.9) * 0.5;
          totalEmissiveRadiance += vec3(0.9, 0.97, 1.0) * smoothstep(1.05, 1.4, rip) * 0.35;`);
    };
    const water = new THREE.Mesh(new THREE.CircleGeometry(POND_R + 0.8, 40), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(POND.x, WATER_Y, POND.y);
    water.receiveShadow = true;
    root.add(water);
    this.lily = scatter(new THREE.CircleGeometry(0.45, 10, 0.3, Math.PI * 1.8).rotateX(-Math.PI / 2), mat(0x8fb07c, { rough: 0.8, side: THREE.DoubleSide }), 14, (i, d) => {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(1, POND_R - 1);
      d.position.set(POND.x + Math.cos(a) * r, WATER_Y + 0.02, POND.y + Math.sin(a) * r);
      d.rotation.y = rng.range(0, 6);
      d.scale.setScalar(rng.range(0.7, 1.3));
      void i;
      return true;
    });
    root.add(this.lily);
    // Reeds around the pond.
    root.add(
      scatter(geo.cone(5), mat(0x7f9f6c, { rough: 0.9 }), 60, (_i, d) => {
        const a = rng.range(0, Math.PI * 2);
        const r = POND_R + rng.range(-0.5, 0.8);
        const x = POND.x + Math.cos(a) * r;
        const z = POND.y + Math.sin(a) * r;
        d.position.set(x, this.height(x, z) + 0.4, z);
        d.scale.set(0.05, rng.range(0.7, 1.3), 0.05);
        d.rotation.set(rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15));
        return true;
      }),
    );

    // --- Grass tufts & flowers (instanced)
    // Soft grass tufts: three slim blades fanned out, one instanced draw.
    const blade = new THREE.ConeGeometry(0.035, 0.34, 3);
    blade.translate(0, 0.17, 0);
    const blades: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 3; k++) {
      const b = blade.clone();
      b.rotateZ((k - 1) * 0.35);
      b.rotateY(k * 2.1);
      b.translate((k - 1) * 0.04, 0, (k % 2) * 0.03);
      blades.push(b.toNonIndexed());
    }
    const tuftGeo = mergeGeometries(blades)!;
    root.add(
      scatter(tuftGeo, mat(0xffffff, { rough: 1 }), 6000, (_i, d, c) => {
        const x = rng.range(-56, 56);
        const z = rng.range(-56, 56);
        if (Math.hypot(x, z) > 58 || distToPath(x, z, PATH) < 1.6 || Math.hypot(x - POND.x, z - POND.y) < POND_R + 0.6) return false;
        d.position.set(x, this.height(x, z) - 0.02, z);
        d.rotation.set(0, rng.range(0, 6), 0);
        d.scale.set(rng.range(0.7, 1.2), rng.range(0.6, 1.3), rng.range(0.7, 1.2));
        c.set(rng.chance(0.5) ? 0x9ab984 : 0xa9c48b).multiplyScalar(rng.range(0.92, 1.06));
        return true;
      }),
    );
    // Little flowers: a stem, five petals and a butter centre.
    const flowerParts: THREE.BufferGeometry[] = [];
    const stem = new THREE.CylinderGeometry(0.012, 0.014, 0.3, 4).translate(0, 0.15, 0).toNonIndexed();
    flowerParts.push(stem);
    for (let k = 0; k < 5; k++) {
      const pe = new THREE.SphereGeometry(0.055, 6, 4).scale(1, 0.35, 0.6).translate(0.06, 0.31, 0).rotateY((k / 5) * Math.PI * 2).toNonIndexed();
      flowerParts.push(pe);
    }
    const flowerHead = mergeGeometries(flowerParts.slice(1))!;
    const flowerCols = [0xf6efe2, 0xefd27f, 0xe7aa9c, 0xc9d9e8, 0xd8c7e3];
    const centers = [[-8, 26], [9, 24], [-10, 12], [12, 8], [-6, -4], [14, -10], [-12, -22], [10, -26]];
    const flowerSpots: { x: number; z: number; s: number; c: number; r: number }[] = [];
    for (let i = 0; i < 700; i++) {
      const [bx, bz] = centers[i % centers.length];
      const x = bx + rng.range(-3.5, 3.5);
      const z = bz + rng.range(-3.5, 3.5);
      if (distToPath(x, z, PATH) < 1.8) continue;
      flowerSpots.push({ x, z, s: rng.range(0.8, 1.35), c: rng.pick(flowerCols), r: rng.range(0, 6) });
    }
    root.add(
      scatter(stem, mat(0x86a874, { rough: 1 }), flowerSpots.length, (i, d) => {
        const f = flowerSpots[i];
        d.position.set(f.x, this.height(f.x, f.z), f.z);
        d.scale.setScalar(f.s);
        return true;
      }),
    );
    root.add(
      scatter(flowerHead, mat(0xffffff, { rough: 0.8 }), flowerSpots.length, (i, d, c) => {
        const f = flowerSpots[i];
        d.position.set(f.x, this.height(f.x, f.z), f.z);
        d.scale.setScalar(f.s);
        d.rotation.y = f.r;
        c.set(f.c);
        return true;
      }),
    );
    root.add(
      scatter(new THREE.SphereGeometry(0.035, 6, 4).translate(0, 0.32, 0), mat(0xf0c75e, { rough: 0.7 }), flowerSpots.length, (i, d) => {
        const f = flowerSpots[i];
        d.position.set(f.x, this.height(f.x, f.z), f.z);
        d.scale.setScalar(f.s);
        return true;
      }),
    );

    // --- Trees, bushes, fences, benches, lamps (merged for speed)
    const statics = new THREE.Group();
    const treeSpots: [number, number, number][] = [];
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2 + rng.range(-0.05, 0.05);
      const r = rng.range(42, 52);
      treeSpots.push([Math.cos(a) * r, Math.sin(a) * r, rng.range(1, 1.5)]);
    }
    treeSpots.push([-9, 18, 1.1], [10, 15, 1.2], [-24, -6, 1.3], [-20, 16, 1.2], [18, 20, 1], [20, -2, 1.2], [-14, -14, 1.1], [12, -18, 1.25], [-8, -34, 1.3], [9, -36, 1.1]);
    for (const [x, z, s] of treeSpots) {
      const t = props.tree(rng, s);
      t.position.set(x, this.height(x, z) - 0.1, z);
      t.rotation.y = rng.range(0, 6);
      statics.add(t);
      ctx.physics.add({ kind: 'cylinder', x, z, r: 0.45 * s, yMin: -5, yMax: 30, tag: 'tree' });
    }
    for (let i = 0; i < 40; i++) {
      const x = rng.range(-40, 40);
      const z = rng.range(-40, 40);
      if (distToPath(x, z, PATH) < 3 || Math.hypot(x - POND.x, z - POND.y) < POND_R + 1.5 || Math.hypot(x, z - 32) < 5) continue;
      const b = props.bush(rng, rng.range(0.8, 1.4));
      b.position.set(x, this.height(x, z), z);
      statics.add(b);
    }
    // Fence along the edge of the lawn (decorative ring).
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const r = 40;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) < 4 && z > 0) continue; // entrance gap behind spawn
      const f = props.fenceSegment(6.9);
      f.position.set(x, this.height(x, z), z);
      f.rotation.y = -a + Math.PI / 2;
      statics.add(f);
    }
    for (const [x, z, ry] of [[-4, 24, 0.4], [5, 5, -1.2], [-6, -14, 1.3], [8, -22, -0.5]] as [number, number, number][]) {
      const b = props.bench();
      b.position.set(x, this.height(x, z), z);
      b.rotation.y = ry;
      statics.add(b);
      ctx.physics.add({ kind: 'cylinder', x, z, r: 0.8, yMin: -2, yMax: this.height(x, z) + 0.9 });
    }
    for (const [x, z] of [[3.2, 22], [-3, 14], [3.5, -4], [-3, -22]] as [number, number][]) {
      const l = props.lamp();
      l.position.set(x, this.height(x, z), z);
      statics.add(l);
      ctx.physics.add({ kind: 'cylinder', x, z, r: 0.15, yMin: -2, yMax: 10 });
    }
    const pic = props.picnic();
    pic.position.set(-5, this.height(-5, 30), 30);
    pic.rotation.y = 0.3;
    statics.add(pic);
    // Sign by the spawn.
    const sign = new THREE.Group();
    sign.add(part(geo.box(0.1), mat(P.wood), [0, 0.7, 0], [0.12, 1.4, 0.12]));
    sign.add(part(geo.box(0.15), mat(P.cream), [0, 1.35, 0], [1.4, 0.6, 0.1]));
    sign.position.set(3.5, this.height(3.5, 33), 33);
    sign.rotation.y = -0.4;
    statics.add(sign);
    root.add(mergeStatic(statics));

    // Stepping stones across the pond edge.
    for (let i = 0; i < 5; i++) {
      const x = POND.x + 5 + i * 0.9;
      const z = POND.y + 4.5 - i * 1.1;
      root.add(part(geo.sphere(12), mat(P.stone), [x, this.height(x, z) + 0.05, z], [0.5, 0.15, 0.45]));
    }

    // --- Playground
    const sw = props.swingSet();
    sw.group.position.set(-9, this.height(-9, -10), -10);
    sw.group.rotation.y = 0.5;
    root.add(sw.group);
    this.swings = sw.swings;
    ctx.physics.add({ kind: 'box', min: new THREE.Vector3(-12, -2, -11.5), max: new THREE.Vector3(-11.4, 4, -10.5) });
    const sl = props.slide();
    sl.position.set(11, this.height(11, -6), -6);
    sl.rotation.y = -0.8;
    root.add(sl);
    ctx.physics.add({ kind: 'cylinder', x: 11, z: -6, r: 1.0, yMin: -2, yMax: this.height(11, -6) + 2.2 });

    // --- Tutorial pieces
    this.flagG = props.flag(P.coral);
    this.flagG.position.set(0, this.height(0, 18), 18);
    root.add(this.flagG);
    this.zones.push(
      new Zone(ctx, new THREE.Vector3(0, 0, 18), 2.6, () => {
        if (ctx.objectives.isCurrent('walk')) {
          ctx.objectives.complete('walk');
          ctx.fx.sparkle(this.flagG.position.clone().add(new THREE.Vector3(0, 2.6, 0)), 14);
          ctx.cheer('You made it!');
        }
      }, false),
    );
    // Log + bushes at its ends (encourage jumping).
    const logLen = 9;
    const lg = props.log(logLen);
    lg.position.set(0, this.height(0, 12), 12);
    root.add(lg);
    ctx.physics.add({ kind: 'box', min: new THREE.Vector3(-logLen / 2, -2, 11.6), max: new THREE.Vector3(logLen / 2, this.height(0, 12) + 0.72, 12.4), walkable: true, tag: 'log' });
    for (const s of [-1, 1]) {
      const b = props.bush(rng, 1.6);
      b.position.set(s * (logLen / 2 + 0.8), this.height(s * 5, 12), 12);
      root.add(b);
      ctx.physics.add({ kind: 'cylinder', x: s * (logLen / 2 + 0.8), z: 12, r: 1.1, yMin: -2, yMax: 3 });
    }
    this.zones.push(
      new Zone(ctx, new THREE.Vector3(0, 0, 9.2), 4.5, () => {
        if (ctx.objectives.isCurrent('jump')) {
          ctx.objectives.complete('jump');
          ctx.cheer('Great jump!');
          ctx.say('ace_whee', 1);
        }
      }, false),
    );
    // Balloons.
    const bpos = [new THREE.Vector3(-4, 2.6, 1), new THREE.Vector3(0.5, 3.3, -2), new THREE.Vector3(5, 2.4, 0.5)];
    const bcol = [P.coral, P.butter, P.teal];
    bpos.forEach((p, i) => {
      p.y += this.height(p.x, p.z);
      const b = new PopTarget(ctx, p, balloonModel(bcol[i]), {
        kinds: ['bubble', 'bigBubble', 'ball', 'fizz', 'glow'],
        radius: 0.75,
        onPop: () => {
          if (ctx.objectives.isCurrent('balloons')) ctx.objectives.add('balloons');
          ctx.say('ace_poppop', 0);
        },
      });
      b.label = 'Balloon';
      this.balloons.push(b);
    });
    // Bunnies.
    const bunnyTints = [0xe8dccb, 0xcdbba5, 0xf3eee6, 0xd9c7b0, 0xe8dccb];
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Vector3(9 + rng.range(-3, 3), 0, -3 + rng.range(-3, 3));
      p.y = this.height(p.x, p.z);
      const b = new Bunny(ctx, p, bunnyTints[i]);
      b.onReactionEnd = (k) => {
        if (k === 'bubbled' && ctx.objectives.isCurrent('bunny')) {
          ctx.objectives.complete('bunny');
          ctx.say('ace_bunny', 1);
        }
      };
      this.bunnies.push(b);
    }
    // Ducks on the pond.
    for (let i = 0; i < 5; i++) {
      const d = new Duck(ctx, new THREE.Vector3(POND.x, 0, POND.y), i < 2 ? 4 : 2 + i * 0.3, WATER_Y, i >= 2);
      this.ducks.push(d);
    }
    // Boing Ball pickup by the swings.
    const ped = props.boingPedestal();
    ped.group.position.set(-5, this.height(-5, -11), -11);
    root.add(ped.group);
    ctx.physics.add({ kind: 'cylinder', x: -5, z: -11, r: 0.6, yMin: -2, yMax: this.height(-5, -11) + 0.9 });
    this.pickup = { ...ped, taken: ctx.hasBlaster('boing') };
    if (this.pickup.taken) ped.gun.visible = false;
    // Bell.
    const bf = props.bellFrame();
    bf.group.position.set(0, this.height(0, -19), -19);
    root.add(bf.group);
    this.bell = bf.bell;
    ctx.physics.add({ kind: 'cylinder', x: -1.3, z: -19, r: 0.25, yMin: -2, yMax: 8 });
    ctx.physics.add({ kind: 'cylinder', x: 1.3, z: -19, r: 0.25, yMin: -2, yMax: 8 });
    const bellHit: Hittable = {
      hitRadius: 0.85,
      active: true,
      aimAssist: 1,
      label: 'Big bell',
      hitCenter: (out) => this.bell.getWorldPosition(out).add(new THREE.Vector3(0, -0.55, 0)),
      onHit: (hit: HitInfo): HitResponse => this.onBellHit(hit),
    };
    ctx.hits.add(bellHit);
    // Biscuit + doghouse.
    const dh = props.doghouse();
    dh.position.set(5, this.height(5, -33), -33);
    dh.rotation.y = -0.3;
    root.add(dh);
    ctx.physics.add({ kind: 'box', min: new THREE.Vector3(3.5, -2, -34.6), max: new THREE.Vector3(6.5, this.height(5, -33) + 2.4, -31.4) });
    this.biscuit = new Biscuit(ctx, new THREE.Vector3(0, this.height(0, -29), -29));
    this.biscuit.nap();
    this.biscuit.onFetch = () => {
      if (ctx.objectives.isCurrent('fetch')) {
        ctx.objectives.add('fetch');
        const n = ctx.objectives.get('fetch')!.count;
        if (n < 3) ctx.cheer(n === 1 ? 'Fetch! Good boy!' : 'One more throw!');
        else {
          this.biscuit.celebrate();
          ctx.fx.celebrate(this.biscuit.position.clone().add(new THREE.Vector3(0, 2.5, 0)), 1.4);
          ctx.say('ace_biscuit_done', 2);
          ctx.banner('Biscuit loves you!', 'Best fetch ever!', 3);
        }
      } else ctx.cheer('Biscuit fetched it!');
    };

    // Golden acorns (treasures) - each tucked somewhere fun to find.
    const acornSpots = [
      new THREE.Vector3(22, 0, -16), // top of the little hill
      new THREE.Vector3(POND.x - 5.5, 0, POND.y - 3), // far side of the pond
      new THREE.Vector3(11.8, 0, -4.2), // under the slide
      new THREE.Vector3(7.5, 0, -34.5), // behind the doghouse
      new THREE.Vector3(-20, 0, 24), // by the big tree near the entrance
    ];
    for (const p of acornSpots) {
      p.y = this.height(p.x, p.z) + 0.9;
      this.acorns.push(new Collectible(ctx, p, props.acornModel(), { objective: 'acorns', say: 'ace_found', cheer: 'Golden acorn!', color: 0xf6dc90 }));
    }

    // Balloon Dash challenge (east lawn).
    const dashTargets: THREE.Vector3[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 1.6 - 0.4;
      const r = 6 + (i % 3) * 2.5;
      const x = 24 + Math.cos(a) * r;
      const z = 12 + Math.sin(a) * r;
      dashTargets.push(new THREE.Vector3(x, this.height(x, z) + 1.8 + (i % 2) * 1.2, z));
    }
    this.course = new TargetCourse(ctx, {
      objective: 'dash',
      pad: new THREE.Vector3(16, 0, 18),
      par: 45,
      title: 'Balloon Dash',
      intro: 'nar_challenge',
      targets: dashTargets.map((pos, i) => ({ pos, model: () => balloonModel([P.coral, P.butter, P.teal, P.lilac][i % 4]) })),
    });

    // Butterflies (ambient life).
    const wingM = [mat(0xf2e3c4, { side: THREE.DoubleSide }), mat(0xd8c7e3, { side: THREE.DoubleSide }), mat(0xc9d9e8, { side: THREE.DoubleSide })];
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group();
      const wings: THREE.Mesh[] = [];
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.CircleGeometry(0.12, 8), wingM[i % 3]);
        w.geometry.translate(s * 0.12, 0, 0);
        g.add(w);
        wings.push(w);
      }
      g.add(part(geo.capsule(1), mat(0x5a5048), [0, 0, 0], [0.015, 0.04, 0.015], [Math.PI / 2, 0, 0], false));
      const base = new THREE.Vector3(rng.range(-30, 30), 0, rng.range(-30, 30));
      base.y = this.height(base.x, base.z) + rng.range(0.8, 2);
      root.add(g);
      this.butterflies.push({ g, base, ph: rng.range(0, 10), wings });
    }
    this.clouds = makeClouds(14, 160, 55);
    root.add(this.clouds);
  }

  private onBellHit(hit: HitInfo): HitResponse {
    const ctx = this.ctx;
    if (hit.kind === 'ball' || hit.kind === 'glow') {
      this.bellSwing = Math.min(1.2, this.bellSwing + 0.6 + hit.power * 0.4);
      ctx.sfx('sfx_bell', { pos: this.bell.getWorldPosition(new THREE.Vector3()), volume: 1, jitter: 0.02 });
      ctx.fx.notes(this.bell.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.5, 0)), 4);
      ctx.shake(0.05);
      if (ctx.objectives.isCurrent('bell')) {
        ctx.objectives.complete('bell');
        ctx.say('ace_ding', 2);
      }
      return 'bounce';
    }
    if (hit.kind === 'bubble' && ctx.objectives.isCurrent('bell') && ctx.time - this.bellHint > 6) {
      this.bellHint = ctx.time;
      ctx.hint(ctx.hasBlaster('boing') ? 'Bubbles are too soft for the bell! Press [2] for the Boing Ball.' : 'Bubbles are too soft for the bell!', 4);
    }
    return 'consume';
  }

  override begin(): void {
    const ctx = this.ctx;
    // Tutorial skips steps the player has clearly already learned on a replay.
    if (ctx.probe) return;
    if (ctx.hasBlaster('boing') && this.pickup?.taken) {
      // Replay: fast-forward the basics so returning players get straight to the fun.
      for (const id of ['look', 'walk', 'jump']) ctx.objectives.complete(id);
    }
    this.showStepHint();
  }

  override onObjectiveComplete(id: string): void {
    const ctx = this.ctx;
    if (id === 'balloons') ctx.cheer('All popped!');
    if (id === 'boing') {
      ctx.narrate('nar_tut_switch');
    }
    if (id === 'bell') {
      // Wake Biscuit for the big friend moment.
      this.after(1.2, () => {
        this.biscuit.wake();
        this.biscuit.fetchEnabled = true;
        ctx.narrate('nar_big_friend');
        ctx.focusOn(this.biscuit.position.clone().add(new THREE.Vector3(0, 2, 0)), 2.2);
        ctx.banner('Big friend: Biscuit!', 'Bounce balls near him to play fetch', 3.5);
        this.after(1.5, () => ctx.say('ace_biscuit', 1));
      });
    }
    this.showStepHint();
  }

  /** Pause-aware delayed call. */
  private after(sec: number, fn: () => void): void {
    let t = sec;
    this.ctx.onUpdate((dt) => {
      t -= dt;
      if (t > 0) return true;
      fn();
      return false;
    });
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
    const hints: Record<string, [string, string | null]> = {
      look: ['Move the [mouse] to look around', 'nar_tut_look'],
      walk: ['Walk to the red flag with [W] [A] [S] [D] or the arrow keys', 'nar_tut_move'],
      jump: ['Press [Space] to jump over the log!', 'nar_tut_jump'],
      balloons: ['[Click] to blow bubbles - pop the balloons!', 'nar_tut_fire'],
      bunny: ['Bubbles are gentle - blow one at a bunny!', 'nar_tut_bunny'],
      boing: ['Find the Boing Ball blaster by the swings', null],
      bell: ['Press [2] for the Boing Ball, then bounce a ball off the big bell!', 'nar_tut_bell'],
      fetch: ['Bounce balls near Biscuit - he will bring them back!', 'nar_tut_biscuit'],
    };
    const h = hints[cur.def.id];
    if (!h) return;
    ctx.hint(h[0]);
    if (first && h[1]) ctx.narrate(h[1]);
  }

  update(dt: number, t: number): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    // Look-around tutorial step.
    if (ctx.objectives.isCurrent('look')) {
      this.lookAccum += Math.abs(pl.yaw - this.lastYaw) + Math.abs(pl.pitch - this.lastPitch);
      if (this.lookAccum > 1.6 || t > 14) {
        ctx.objectives.complete('look');
        ctx.cheer('Nice looking!');
      }
    }
    this.lastYaw = pl.yaw;
    this.lastPitch = pl.pitch;
    // Boing Ball pickup.
    if (this.pickup && !this.pickup.taken) {
      const gp = this.pickup.group.position;
      this.pickup.gun.rotation.y = t * 1.5;
      this.pickup.gun.position.y = 1.5 + Math.sin(t * 2) * 0.1;
      if (Math.random() < dt * 3) ctx.fx.sparkle(gp.clone().add(new THREE.Vector3(0, 1.5, 0)), 2, [0xf6c8b9, 0xfff1dc], 0.5);
      if (Math.hypot(pl.position.x - gp.x, pl.position.z - gp.z) < 1.8) {
        this.pickup.taken = true;
        this.pickup.gun.visible = false;
        ctx.fx.celebrate(gp.clone().add(new THREE.Vector3(0, 1.5, 0)), 0.8);
        ctx.grantBlaster('boing', false);
        ctx.say('ace_newblaster', 2);
        if (ctx.objectives.isCurrent('boing')) ctx.objectives.complete('boing');
      }
    } else if (ctx.objectives.isCurrent('boing') && ctx.hasBlaster('boing')) ctx.objectives.complete('boing');
    // Remind about switching once the bell is the goal.
    if (ctx.objectives.isCurrent('bell') && ctx.blaster !== 'boing' && !this.switchHinted && t > 3) {
      this.switchHinted = true;
      ctx.hint('Press [2] (or [Q] / [E]) to switch to the Boing Ball!');
    }
    if (ctx.objectives.isCurrent('bell') && ctx.blaster === 'boing' && this.switchHinted) {
      this.switchHinted = false;
      ctx.hint('Now bounce a ball off the big bell!');
    }

    for (const z of this.zones) z.update();
    // Forgiving tutorial: reaching a later spot completes the earlier basics.
    const pz = pl.position.z;
    const nearFlag = Math.hypot(pl.position.x, pz - 18) < 2.8;
    if (nearFlag || pz < 15) {
      if (ctx.objectives.isCurrent('look')) ctx.objectives.complete('look');
      if (ctx.objectives.isCurrent('walk')) ctx.objectives.complete('walk');
    }
    if (pz < 10.5 && ctx.objectives.isCurrent('jump')) {
      ctx.objectives.complete('jump');
      ctx.cheer('Great jump!');
    }
    for (const b of this.balloons) b.update(dt, t);
    for (const b of this.bunnies) b.update(dt, t);
    for (const d of this.ducks) d.update(dt, t);
    this.biscuit.update(dt, t);
    for (const a of this.acorns) a.update(dt, t);
    this.course.update(dt, t);
    props.animateFlag(this.flagG, t);
    // Bell swing.
    this.bellSwing *= Math.exp(-1.2 * dt);
    this.bell.rotation.x = Math.sin(t * 6) * this.bellSwing * 0.5;
    this.swings.forEach((s, i) => (s.rotation.x = Math.sin(t * 1.3 + i * 1.7) * 0.12));
    for (const b of this.butterflies) {
      const tt = t + b.ph;
      b.g.position.set(b.base.x + Math.sin(tt * 0.4) * 3, b.base.y + Math.sin(tt * 1.7) * 0.4, b.base.z + Math.cos(tt * 0.33) * 3);
      b.g.rotation.y = Math.atan2(Math.cos(tt * 0.4) * 1.2, -Math.sin(tt * 0.33));
      const flap = Math.sin(tt * 16) * 0.9;
      b.wings[0].rotation.y = flap;
      b.wings[1].rotation.y = -flap;
    }
    this.clouds.rotation.y += dt * 0.004;
    this.waterTime.value = t;
    // Occasional duck splashes.
    this.stepT += dt;
    void this.stepT;
  }
}
