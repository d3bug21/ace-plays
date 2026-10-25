import * as THREE from 'three';
import type { StageMeta } from '../index';
import { Stage, type StageContext, type StageEnvironment, type StageInfo, type ObjectiveDef } from '../types';
import { Rng, damp, lerp } from '../../core/math';
import { geo, mat, part } from '../../kit/kit';
import { Collectible, TargetCourse } from '../../gameplay/Helpers';
import {
  CANYON,
  DOME,
  GARDEN,
  GROVE,
  NOOK,
  PAL,
  TrenchWorld,
  darkness,
  fakeLight,
  inGrove,
  resetFakeLights,
  updateClam,
  type FakeLight,
  type WorldParts,
} from './world';
import { Dumbo, Glim, Jelly, LanternSchool, blinkFace, jellyModel, swayTime } from './creatures';
import { LanternCoral } from './lanterns';
import { Ollie } from './ollie';

const info: StageInfo = {
  id: 'trench',
  name: 'Twilight Trench',
  tagline: 'Deep, deep down where tiny lights glow. Follow Glim and light up the dark!',
  map: { x: 77, y: 45 },
  accent: '#7d8fc4',
  icon: 'angler',
  musicId: 'mus_trench',
  ambienceId: 'amb_trench',
  introNarration: 'nar_trench_intro',
  introAce: 'ace_trench_intro',
  mode: 'swim',
  reward: { ability: 'bigBubble', title: 'Big Bubble unlocked!', text: 'Hold the button with the Bubble Wand to blow a BIG bubble.' },
  footstep: undefined,
};

const objectives: ObjectiveDef[] = [
  { id: 'follow', kind: 'main', label: 'Follow Glim through the dark', icon: 'angler', target: 1, hint: 'Stay close to her little light' },
  { id: 'lanterns', kind: 'main', label: 'Light the lantern corals', icon: 'lantern', target: 6, hint: 'Throw Glow Balls at the sleepy buds' },
  { id: 'ollie', kind: 'main', label: "Tickle shy Ollie's arm-tips", icon: 'octopus', target: 8, hint: 'Bubbles or fizz on the glowing tips' },
  { id: 'pearls', kind: 'treasure', label: 'Find glow pearls', icon: 'pearl', target: 5 },
  { id: 'rush', kind: 'challenge', label: 'Jelly Glow Rush: pop 9 in 50s', icon: 'jelly', target: 1 },
];

export const meta: StageMeta = { info, objectives, introColors: ['#3c5778', '#141e33'] };

export function create(): Stage {
  return new TrenchStage();
}

const LANTERN_SPOTS: [number, number, number][] = [
  // x, z, stalk height
  [-5, -11, 1.5],
  [10, -15, 1.9],
  [15.5, -27, 1.6],
  [-14.5, -21, 1.8],
  [-7, -37.5, 1.5],
  [8, -40, 2.0],
];
const LANTERN_WARM = ['#ffdca0', '#ffd2b8', '#ffe8b0', '#ffd6a8', '#ffdcc0', '#ffe2a4'];

const BASE_FOG = new THREE.Color(PAL.fog);
const DARK_FOG = new THREE.Color(PAL.fogDark);
const LIT_FOG = new THREE.Color(PAL.fogLit);

class TrenchStage extends Stage {
  readonly info = info;
  readonly objectives = objectives;
  readonly env: StageEnvironment = {
    sky: null,
    background: PAL.fog,
    fog: { color: PAL.fog, density: 0.034 },
    hemi: { sky: '#6582b8', ground: '#1c2236', intensity: 0.75 },
    sun: { color: '#a4b6ea', intensity: 0.55, dir: [0.2, 1, 0.15], shadows: false },
    ambient: { color: '#34486f', intensity: 0.4 },
    exposure: 1.05,
    bloom: { strength: 0.55, radius: 0.55, threshold: 0.62 },
    underwater: { surfaceY: null, tint: '#1d3350', snow: 1.5, shafts: 0.2 },
  };
  readonly spawn = { pos: new THREE.Vector3(0, 0, 68), yaw: 0 };
  override challengePar = 50;

  private world!: TrenchWorld;
  private parts!: WorldParts;
  private rng = new Rng(4242);
  private glim!: Glim;
  private jellies: Jelly[] = [];
  private dumbos: Dumbo[] = [];
  private schools: LanternSchool[] = [];
  private lanterns: LanternCoral[] = [];
  private ollie!: Ollie;
  private pearls: Collectible[] = [];
  private course!: TargetCourse;
  private rushModels: ReturnType<typeof jellyModel>[] = [];
  private timers: { at: number; fn: () => void }[] = [];
  private hemi: THREE.HemisphereLight | null = null;
  private ambient: THREE.AmbientLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private litSmooth = 0;
  private envDark = 0;
  private envGrove = 0;
  private jellySaid = false;
  private gardenHinted = false;
  private waitHintT = -99;
  private nextLanternSay = 0;
  private entryGlow!: FakeLight;
  private gardenGlow!: FakeLight;
  private ollieStarted = false;
  private ollieDone = false;
  private tmp = new THREE.Vector3();

  build(ctx: StageContext): void {
    this.ctx = ctx;
    resetFakeLights();
    this.world = new TrenchWorld();
    const H = this.world.height;
    ctx.physics.groundHeight = H;
    ctx.physics.waterSurface = null;
    ctx.physics.ceiling = this.world.ceilingAt;
    ctx.physics.boundsCenter.set(0, 0);
    ctx.physics.boundsRadius = 80;
    this.spawn.pos.y = H(this.spawn.pos.x, this.spawn.pos.z) + 1.4;
    this.parts = this.world.build(ctx, this.rng);

    // Find the environment lights so the mood can follow Ace from zone to zone.
    ctx.scene.traverse((o) => {
      if (o === ctx.root) return;
      if ((o as THREE.HemisphereLight).isHemisphereLight && !this.hemi) this.hemi = o as THREE.HemisphereLight;
      if ((o as THREE.AmbientLight).isAmbientLight && !this.ambient) this.ambient = o as THREE.AmbientLight;
      if ((o as THREE.DirectionalLight).isDirectionalLight && !this.sun) this.sun = o as THREE.DirectionalLight;
    });

    // Soft "little light" on the entry ledge and in the jelly garden.
    this.entryGlow = fakeLight();
    this.entryGlow.set(new THREE.Vector3(-3, H(-3, 62) + 2.5, 62), '#8fe0e6', 0.55, 13);
    this.gardenGlow = fakeLight();
    this.gardenGlow.set(new THREE.Vector3(GARDEN.x, H(GARDEN.x, GARDEN.z) + 3, GARDEN.z), '#d8b8ee', 0.55, 14);
    const groveGlow = fakeLight();
    groveGlow.set(new THREE.Vector3(GROVE.x, H(GROVE.x, GROVE.z) + 2, GROVE.z - 4), '#9ff0d0', 0.18, 22);

    // --- Glim and her path through the Dark Stretch.
    const glimStart = new THREE.Vector3(0, H(0, 57) + 2.2, 57);
    this.glim = new Glim(ctx, glimStart);
    this.glim.hoverAt.copy(glimStart);
    const raw: [number, number][] = [[0, 56], ...CANYON.slice(1), [0, -15]];
    const path: THREE.Vector3[] = [];
    for (let i = 0; i < raw.length - 1; i++) {
      const [ax, az] = raw[i];
      const [bx, bz] = raw[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.round(len / 3));
      for (let k = 0; k < steps; k++) {
        const u = k / steps;
        const x = lerp(ax, bx, u);
        const z = lerp(az, bz, u);
        path.push(new THREE.Vector3(x, H(x, z) + 2.4, z));
      }
    }
    path.push(new THREE.Vector3(0, H(0, -15) + 3, -15));
    this.glim.path = path;
    this.glim.onPing = () => {
      if (ctx.objectives.isCurrent('follow') && ctx.time - this.waitHintT > 14) {
        this.waitHintT = ctx.time;
        ctx.hint('Glim is waiting for you! Swim towards her little light.', 4);
      }
    };

    // --- Lantern corals.
    LANTERN_SPOTS.forEach(([x, z, h], i) => {
      const l = new LanternCoral(ctx, new THREE.Vector3(x, H(x, z) - 0.1, z), h, LANTERN_WARM[i]);
      l.onLit = () => this.onLanternLit();
      l.onWrongHit = (kind) => {
        if (kind === 'glow') return;
        ctx.hint(ctx.hasBlaster('glow') ? 'Lantern corals wake up with a Glow Ball! Press [4]' : 'Lantern corals need a Glow Ball!', 4);
      };
      this.lanterns.push(l);
    });
    // Kind fallback: a glow ball landing close to a lantern also lights it.
    ctx.projectiles.onBallImpact((ball) => {
      if (!ball.glow) return;
      this.lightNear(ball.pos);
    });

    // --- Ollie in his cave.
    this.ollie = new Ollie(ctx, this.parts.domeY + 0.8, DOME.z);
    const tipSpots: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      const a = lerp(-1.25, 1.25, i / 7);
      const R = 6.5 + (i % 2) * 3.2 + Math.sin(i * 1.7) * 0.6;
      const x = Math.sin(a) * R;
      const z = DOME.z + DOME.r + Math.cos(a) * R - 1.5;
      tipSpots.push(new THREE.Vector3(x, H(x, z) + 1.0 + (i % 3) * 0.9, z));
    }
    this.ollie.peekTips = tipSpots;
    this.ollie.onTickle = (_tip, fresh) => this.onOllieTickle(fresh);
    this.ollie.onMantleHit = () => {
      if (ctx.objectives.isCurrent('ollie') && ctx.time - this.waitHintT > 6) {
        this.waitHintT = ctx.time;
        ctx.hint('Ollie is ticklish on his glowing arm-tips!', 3.5);
      }
    };

    // --- Jellyfish, dumbo octopuses, lanternfish.
    const jellySpots: [number, number, number, number, number][] = [
      // x, z, yOff, colour, area
      [-6, 60, 3.5, 0, 4],
      [7, 64, 4.5, 2, 4],
      [-29, 60, 4, 1, 6],
      [-6, -20, 4.5, 3, 8],
      [8, -30, 6, 0, 8],
      [-4, -32, 3.5, 1, 8],
    ];
    for (const [x, z, y, c, area] of jellySpots) {
      const g = H(x, z);
      const j = new Jelly(ctx, new THREE.Vector3(x, g + y, z), c, area, [g + 2.2, g + 7], 1);
      j.onGlow = () => {
        if (!this.jellySaid) {
          this.jellySaid = true;
          ctx.say('ace_jelly', 1);
        }
      };
      this.jellies.push(j);
    }
    for (const [x, z, tint] of [[-9, -27, '#e8b3a8'], [6, -21, '#d9b6e4']] as [number, number, string][]) {
      this.dumbos.push(new Dumbo(ctx, new THREE.Vector3(x, H(x, z) + 3, z), tint));
    }
    this.schools.push(new LanternSchool(ctx, new THREE.Vector3(2, H(2, 62) + 4.5, 62), [5, 1, 3], 34, '#9fe9ee', 0.16));
    this.schools.push(new LanternSchool(ctx, new THREE.Vector3(-2, H(-2, -24) + 5, -24), [10, 2, 9], 56, '#a6f2cf', 0.09));
    this.schools.push(new LanternSchool(ctx, new THREE.Vector3(GARDEN.x, H(GARDEN.x, GARDEN.z) + 5, GARDEN.z), [5, 1.5, 5], 30, '#d6c4f6', 0.14));

    // --- Glow pearls (treasure).
    const pearlSpots = [
      new THREE.Vector3(9.2, H(9.2, 63.5) + 0.75, 63.5), // under the little arch
      this.parts.clamPos.clone().add(new THREE.Vector3(0, 0.5, 0)), // inside the giant clam
      new THREE.Vector3(this.parts.column.x, this.parts.column.top + 0.9, this.parts.column.z), // atop the tube-worm column
      new THREE.Vector3(NOOK.x - 1.2, H(NOOK.x - 1.2, NOOK.z) + 0.8, NOOK.z), // Dark Stretch nook
      new THREE.Vector3(0.5, H(0.5, -62.6) + 1.0, -62.6), // behind Ollie's cave
    ];
    for (const p of pearlSpots) {
      this.pearls.push(new Collectible(ctx, p, pearlModel(), { objective: 'pearls', say: 'ace_found', cheer: 'Glow pearl!', color: '#efe4ff', glint: 1.3 }));
    }

    // --- Jelly Glow Rush (challenge) in the jelly garden.
    const rushTargets: THREE.Vector3[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const r = 3.5 + (i % 3) * 2.3;
      const x = GARDEN.x - 1 + Math.cos(a) * r;
      const z = GARDEN.z + Math.sin(a) * r * 0.9;
      rushTargets.push(new THREE.Vector3(x, H(x, z) + 2.2 + ((i * 5) % 4) * 1.3, z));
    }
    const cols = ['#cbb6f4', '#f3b8cf', '#9fe6ea', '#b7c9f6'];
    this.course = new TargetCourse(ctx, {
      objective: 'rush',
      pad: new THREE.Vector3(GARDEN.x + 7.5, 0, GARDEN.z + 0.5),
      par: 50,
      title: 'Jelly Glow Rush',
      intro: 'nar_challenge',
      padColor: 0xbfa8ec,
      targets: rushTargets.map((pos, i) => ({
        pos,
        model: () => {
          const m = jellyModel(cols[i % cols.length], 1.15, true);
          this.rushModels.push(m);
          return m.group;
        },
      })),
    });
  }

  // ----------------------------------------------------------- objectives

  override begin(): void {
    const ctx = this.ctx;
    if (!ctx.hasBlaster('glow')) ctx.grantBlaster('glow', false);
    ctx.narrate('nar_trench_glim');
    ctx.hint('Follow Glim\'s little light! [Space] swims up, [Shift] swims down', 7);
  }

  private later(sec: number, fn: () => void): void {
    this.timers.push({ at: this.ctx.time + sec, fn });
  }

  private litCount(): number {
    return this.lanterns.filter((l) => l.lit).length;
  }

  private lightNear(p: THREE.Vector3): void {
    for (const l of this.lanterns) {
      if (l.lit) continue;
      const b = l.group.position;
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      const near = dx * dx + dz * dz < 2.5 * 2.5 && Math.abs(p.y - b.y) < 3.5;
      if (near || p.distanceTo(l.headWorld) < 2.0) {
        l.light();
        return;
      }
    }
  }

  private onLanternLit(): void {
    const ctx = this.ctx;
    const n = this.litCount();
    if (ctx.objectives.isCurrent('lanterns')) ctx.objectives.set('lanterns', n);
    this.glim.sparkle();
    if (n < 6) {
      ctx.cheer(['It\'s glowing!', 'So pretty!', 'Lantern lit!', 'Glow-tastic!', 'One more glow!'][Math.min(4, n - 1)]);
      if (n === 1 || ctx.time > this.nextLanternSay) {
        ctx.say('ace_lantern', 0);
        this.nextLanternSay = ctx.time + 12;
      }
    }
  }

  private onOllieTickle(fresh: boolean): void {
    const ctx = this.ctx;
    if (!fresh || !ctx.objectives.isCurrent('ollie')) return;
    const n = this.ollie.tickledCount;
    ctx.objectives.set('ollie', n);
    if (n < 8) ctx.cheer(['Tickle tickle!', 'He\'s giggling!', 'Coochie-coo!', 'Wiggly!', 'More tickles!', 'Hee hee!', 'Just one more!'][n - 1]);
    if (n === 7) ctx.say('ace_one_more', 0);
  }

  override onObjectiveComplete(id: string): void {
    const ctx = this.ctx;
    if (id === 'follow') {
      ctx.cheer('Through the dark!');
      this.glim.mode = 'guide';
      ctx.fx.sparkle(this.glim.bulbWorld, 16, ['#ffe6a6', '#fff8e8'], 1.1);
      this.later(1.8, () => {
        ctx.objectives.set('lanterns', this.litCount());
        ctx.hint(ctx.blaster === 'glow' ? 'Throw Glow Balls at the sleepy lantern corals!' : 'Press [4] for the Glow Ball, then wake up the sleepy lantern corals!', 7);
      });
    }
    if (id === 'lanterns') {
      ctx.banner('The grove is glowing!', 'Look how pretty it is now', 2.4);
      ctx.fx.celebrate(ctx.player.eyePosition(new THREE.Vector3()).add(ctx.player.viewForward(new THREE.Vector3()).multiplyScalar(4)), 1);
      ctx.say('ace_lantern', 1);
      this.later(2.6, () => this.startOllie());
    }
    if (id === 'ollie') this.finishOllie();
  }

  private startOllie(): void {
    if (this.ollieStarted) return;
    this.ollieStarted = true;
    const ctx = this.ctx;
    this.ollie.peek();
    ctx.narrate('nar_trench_ollie');
    const eye = this.tmp.set(0, this.parts.domeY + 3.8, DOME.z + DOME.r - 1);
    ctx.focusOn(eye.clone(), 3);
    this.glim.hoverAt.set(-3, this.parts.domeY + 5, DOME.z + DOME.r + 4);
    this.later(1.8, () => {
      ctx.banner('Big friend: Ollie!', 'He\'s shy in the dark... tickle his glowing arm-tips!', 3.6);
    });
    this.later(4.5, () => ctx.say('ace_ollie', 1));
    this.later(5.5, () => ctx.hint('Tickle all 8 glowing arm-tips with bubbles [1] or fizz [3]!', 8));
    ctx.objectives.set('ollie', this.ollie.tickledCount);
  }

  private finishOllie(): void {
    if (this.ollieDone) return;
    this.ollieDone = true;
    const ctx = this.ctx;
    this.ollie.celebrate();
    ctx.hint(null);
    const c = this.ollie.root.position.clone().add(new THREE.Vector3(0, 2, 3));
    ctx.focusOn(c, 2.2);
    ctx.fx.celebrate(c, 1.8);
    ctx.banner('Ollie is giggling!', 'You helped a shy friend feel happy', 3.5);
    ctx.shake(0.04);
    this.later(1.2, () => ctx.fx.celebrate(this.ollie.root.position.clone().add(new THREE.Vector3(0, 4, 2)), 1.4));
    this.later(2.2, () => ctx.say('ace_ollie_done', 2));
    // Home Bubble beside Ace (not inside Ollie's hug zone).
    this.later(1.6, () => {
      const pl = ctx.player;
      const right = pl.viewRight(new THREE.Vector3());
      const p = pl.position.clone().addScaledVector(right, 5).add(new THREE.Vector3(0, 0, 3));
      const o = this.ollie.root.position;
      const away = new THREE.Vector3(p.x - o.x, 0, p.z - o.z);
      if (away.length() < 10) p.addScaledVector(away.normalize(), 10 - Math.hypot(p.x - o.x, p.z - o.z));
      p.y = this.world.height(p.x, p.z) + 0.6;
      ctx.showHomeBubble(p);
    });
    this.glim.hoverAt.set(2, this.parts.domeY + 4, DOME.z + DOME.r + 8);
  }

  // ----------------------------------------------------------- per frame

  update(dt: number, t: number): void {
    const ctx = this.ctx;
    const pl = ctx.player;
    this.keepInTrench();

    // Timers.
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (t >= this.timers[i].at) {
        const fn = this.timers[i].fn;
        this.timers.splice(i, 1);
        fn();
      }
    }

    // Follow Glim.
    const g = this.glim;
    if (g.mode === 'idle' && ctx.objectives.isCurrent('follow')) {
      const d = g.position.distanceTo(pl.position);
      if (d < 9 || pl.position.z < 52) {
        g.mode = 'lead';
        ctx.say('ace_glim', 1);
      }
    }
    if (ctx.objectives.isCurrent('follow')) {
      const gd = Math.hypot(pl.position.x - GROVE.x, pl.position.z - GROVE.z);
      if (gd < GROVE.r - 4 && pl.position.z < -8) ctx.objectives.complete('follow');
    }
    if (g.mode === 'guide' && !this.ollieStarted) {
      // Glim hovers by the nearest sleepy lantern to show the way.
      let best: LanternCoral | null = null;
      let bd = Infinity;
      for (const l of this.lanterns) {
        if (l.lit) continue;
        const d = l.group.position.distanceTo(pl.position);
        if (d < bd) {
          bd = d;
          best = l;
        }
      }
      if (best) g.hoverAt.copy(best.headWorld).add(this.tmp.set(0, 1.4, 0));
    }

    // Glow balls resting near a lantern wake it too.
    for (const b of ctx.projectiles.balls) {
      if (b.glow && b.alive && (b.stuck || b.vel.lengthSq() < 1)) this.lightNear(b.pos);
    }

    // Creatures and props.
    swayTime.value = t;
    g.update(dt, t);
    for (const j of this.jellies) j.update(dt, t);
    for (const d of this.dumbos) d.update(dt, t);
    for (const s of this.schools) s.update(dt, t);
    for (const l of this.lanterns) l.update(dt, t);
    this.ollie.update(dt, t);
    for (const p of this.pearls) p.update(dt, t);
    this.course.update(dt, t);
    for (const m of this.rushModels) {
      const c = Math.sin(t * 2.6 + m.group.id);
      m.bell.scale.set(1 + c * 0.08, 1 - c * 0.12, 1 + c * 0.08);
      blinkFace(m.face, t + m.group.id, false);
    }
    this.parts.worms.update(dt, t, pl.position);
    const cp = this.parts.clamPos;
    updateClam(this.parts.clam, t, Math.hypot(pl.position.x - cp.x, pl.position.z - cp.z) < 5);
    this.parts.haloField.update(t, (ctx.fx.glow.material.uniforms.uScale.value as number) ?? 400);

    // Jelly garden hint.
    if (!this.gardenHinted && !ctx.objectives.isDone('rush') && Math.hypot(pl.position.x - GARDEN.x, pl.position.z - GARDEN.z) < GARDEN.r + 2) {
      this.gardenHinted = true;
      ctx.hint('The Jelly Garden! Swim down onto the glowing pad to start the Jelly Glow Rush.', 5);
    }

    this.updateMood(dt, t);
  }

  /** The heightfield walls rise past the ceiling: slide Ace back into open water. */
  private keepInTrench(): void {
    const pl = this.ctx.player;
    const p = pl.position;
    const H = this.world.height;
    let moved = false;
    for (let it = 0; it < 10; it++) {
      const h = H(p.x, p.z);
      if (h <= this.world.ceilingAt(p.x, p.z) - 2.1) break;
      const limit = this.world.ceilingAt(p.x, p.z) - 2.1;
      const e = 0.4;
      const gx = H(p.x + e, p.z) - H(p.x - e, p.z);
      const gz = H(p.x, p.z + e) - H(p.x, p.z - e);
      const gl = Math.hypot(gx, gz) || 1;
      const step = Math.min(0.5, (h - limit) * 0.1 + 0.05);
      p.x -= (gx / gl) * step;
      p.z -= (gz / gl) * step;
      moved = true;
    }
    if (moved) {
      const floor = H(p.x, p.z) + 0.25;
      if (p.y < floor) p.y = floor;
      pl.syncCamera(0, this.ctx.settings.headBob);
    }
  }

  /** Zone-based mood: the Dark Stretch is deep and dark; the grove wakes up as lanterns glow. */
  private updateMood(dt: number, t: number): void {
    const ctx = this.ctx;
    const p = ctx.player.position;
    const lit = this.litCount() / 6;
    this.litSmooth = damp(this.litSmooth, lit, 1.2, dt);
    this.envDark = damp(this.envDark, darkness(p.x, p.z), 1.6, dt);
    this.envGrove = damp(this.envGrove, inGrove(p.x, p.z), 1.6, dt);
    const dark = this.envDark;
    const grove = this.envGrove * this.litSmooth;
    const fog = ctx.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color.copy(BASE_FOG).lerp(DARK_FOG, dark).lerp(LIT_FOG, grove * 0.75);
      fog.density = lerp(lerp(0.034, 0.052, dark), 0.027, grove);
      if (ctx.scene.background instanceof THREE.Color) ctx.scene.background.copy(fog.color);
    }
    if (this.hemi) this.hemi.intensity = lerp(0.75, 0.34, dark) + grove * 0.45;
    if (this.ambient) this.ambient.intensity = lerp(0.4, 0.16, dark) + grove * 0.2;
    if (this.sun) this.sun.intensity = lerp(0.55, 0.1, dark) + grove * 0.15;
    // Grove flora wakes up with the lanterns.
    const gain = 0.35 + this.litSmooth * 0.75;
    for (const pm of this.parts.plantMeshes) {
      if (!pm.grove) continue;
      (pm.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 * gain;
    }
    if (Math.abs(gain - this.lastGain) > 0.01) {
      this.lastGain = gain;
      const hf = this.parts.haloField;
      hf.setGain((i) => (this.haloIsGrove(i) ? gain : 1));
    }
    this.entryGlow.setStrength(0.55 + Math.sin(t * 0.8) * 0.05);
    this.gardenGlow.setStrength(0.55 + Math.sin(t * 0.7 + 1) * 0.05);
  }

  private lastGain = -1;
  private groveHaloIdx: Set<number> | null = null;
  private haloIsGrove(i: number): boolean {
    if (!this.groveHaloIdx) {
      this.groveHaloIdx = new Set();
      const pos = this.parts.haloField.points.geometry.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k++) if (pos.getZ(k) < 0) this.groveHaloIdx.add(k);
    }
    return this.groveHaloIdx.has(i);
  }

  override dispose(): void {
    this.glim?.dispose();
    resetFakeLights();
  }
}

/** A soft glow pearl resting in a tiny shell cup. */
function pearlModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(geo.sphere(24), mat('#f6f0ff', { rough: 0.2, emissive: '#dccff6', emissiveIntensity: 0.55 }), [0, 0.05, 0], 0.22, [0, 0, 0], false));
  g.add(part(geo.sphere(8), mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.8 }), [-0.07, 0.14, 0.15], 0.05, [0, 0, 0], false));
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), mat('#c9b3dd', { rough: 0.5, side: THREE.DoubleSide }));
  shell.position.y = 0.12;
  g.add(shell);
  return g;
}
