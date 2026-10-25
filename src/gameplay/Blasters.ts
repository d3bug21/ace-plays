import * as THREE from 'three';
import type { BlasterId } from '../core/Save';
import { clamp, damp, easeOutBack } from '../core/math';
import type { Player } from '../core/Player';
import type { Input } from '../core/Input';
import { createBubbleMaterial, bubbleGeometry } from '../fx/BubbleMaterial';
import { geo, mat, part } from '../kit/kit';
import type { HitRegistry, ProjectileKind } from './Hit';
import type { Projectiles } from './Projectiles';

export interface BlasterDef {
  id: BlasterId;
  slot: number;
  name: string;
  desc: string;
  /** Muted accent colour used in the HUD. */
  color: string;
  icon: string;
  /** Seconds between shots while the trigger is held. */
  interval: number;
  kind: ProjectileKind;
}

export const BLASTERS: BlasterDef[] = [
  { id: 'bubble', slot: 1, name: 'Bubble Wand', desc: 'Blows wobbly bubbles that wrap little critters in a floaty hug.', color: '#7fb8b4', icon: 'bubble', interval: 0.22, kind: 'bubble' },
  { id: 'boing', slot: 2, name: 'Boing Ball', desc: 'Launches bouncy balls that boing off walls, ring bells and boop big friends.', color: '#e39a85', icon: 'ball', interval: 0.36, kind: 'ball' },
  { id: 'fizz', slot: 3, name: 'Fizz Fountain', desc: 'A fizzy stream of tiny bubbles that pushes, puffs and tickles.', color: '#a9c7e3', icon: 'fizz', interval: 0.045, kind: 'fizz' },
  { id: 'glow', slot: 4, name: 'Glow Ball', desc: 'Squishy glowing balls that stick where they land and light up the dark.', color: '#9fd8c9', icon: 'glow', interval: 0.55, kind: 'glow' },
];

export const blasterDef = (id: BlasterId): BlasterDef => BLASTERS.find((b) => b.id === id)!;

const SKIN = 0xeec4a2;
const SLEEVE = 0xe2b45e;
const CUFF = 0xf6efe2;

interface Model {
  group: THREE.Group;
  muzzle: THREE.Object3D;
  anim: (dt: number, t: number, fireKick: number, charge: number) => void;
}

function handAndSleeve(): THREE.Group {
  const g = new THREE.Group();
  const skin = mat(SKIN, { rough: 0.7 });
  const sleeve = mat(SLEEVE, { rough: 0.9 });
  const cuff = mat(CUFF, { rough: 0.9 });
  // Fist wrapping the grip.
  g.add(part(geo.sphere(20), skin, [0, -0.05, 0.02], [0.055, 0.05, 0.065], [0, 0, 0], false));
  // Fingers (four little bumps).
  for (let i = 0; i < 4; i++) g.add(part(geo.sphere(12), skin, [-0.035, -0.02 - i * 0.022, 0.035 + Math.sin(i) * 0.004], [0.022, 0.017, 0.024], [0, 0, 0], false));
  // Thumb on top.
  g.add(part(geo.capsule(1), skin, [0.01, 0.005, -0.005], [0.018, 0.018, 0.018], [0.4, 0, -1.2], false));
  // Cuff + sleeve going back towards the camera.
  g.add(part(geo.cyl(1, 1, 18), cuff, [0.03, -0.09, 0.12], [0.06, 0.05, 0.06], [1.2, 0, 0.15], false));
  g.add(part(geo.cyl(1, 1.15, 18), sleeve, [0.05, -0.13, 0.3], [0.068, 0.32, 0.07], [1.25, 0, 0.15], false));
  return g;
}

function bubbleWandModel(): Model {
  const g = new THREE.Group();
  const body = mat(0xf1eadb, { rough: 0.55 });
  const teal = mat(0x6fa8a3, { rough: 0.5 });
  const dark = mat(0x40585e, { rough: 0.6 });
  // Chunky rounded body.
  g.add(part(geo.box(0.35), body, [0, 0, -0.05], [0.09, 0.1, 0.28], [0, 0, 0], false));
  g.add(part(geo.box(0.35), teal, [0, -0.06, 0.0], [0.06, 0.11, 0.07], [0.3, 0, 0], false)); // grip
  g.add(part(geo.cyl(1, 1, 18), teal, [0, 0, -0.21], [0.045, 0.06, 0.045], [Math.PI / 2, 0, 0], false));
  // Glass soap tank on top with sloshing liquid.
  const tankGlass = new THREE.MeshStandardMaterial({ color: 0xdff1f3, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.35 });
  const tank = part(geo.sphere(20), tankGlass, [0, 0.085, -0.02], [0.06, 0.06, 0.06], [0, 0, 0], false);
  const liquid = part(geo.sphere(16), mat(0xa9d8dc, { rough: 0.2, emissive: 0x5c9ea3, emissiveIntensity: 0.15 }), [0, 0.072, -0.02], [0.05, 0.035, 0.05], [0, 0, 0], false);
  g.add(liquid, tank);
  g.add(part(geo.torus(0.25), dark, [0, 0.085, -0.02], [0.06, 0.06, 0.06], [Math.PI / 2, 0, 0], false));
  // Wand ring + soap film at the front.
  const ringG = new THREE.Group();
  ringG.position.set(0, 0.01, -0.28);
  ringG.add(part(geo.torus(0.16, Math.PI * 2, 28), teal, [0, 0, 0], [0.055, 0.055, 0.055], [0, 0, 0], false));
  const filmMat = createBubbleMaterial({ wobble: 0.02, opacity: 0.9 });
  const film = new THREE.Mesh(bubbleGeometry(), filmMat);
  film.scale.set(0.05, 0.05, 0.006);
  film.renderOrder = 3;
  ringG.add(film);
  g.add(ringG);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, -0.33);
  g.add(muzzle);
  const hand = handAndSleeve();
  hand.position.set(0, -0.02, -0.005);
  g.add(hand);
  return {
    group: g,
    muzzle,
    anim: (dt, t, kick, charge) => {
      // Soap film bulges when blowing and inflates while charging a big bubble.
      const bulge = 0.006 + kick * 0.05 + charge * 0.09;
      film.scale.z = damp(film.scale.z, bulge, 18, dt);
      const cs = 0.05 + charge * 0.06;
      film.scale.x = film.scale.y = damp(film.scale.x, cs, 10, dt);
      film.position.z = -film.scale.z * 0.6;
      liquid.rotation.z = Math.sin(t * 2.2) * 0.12 + kick * 0.3;
      liquid.position.y = 0.072 + Math.sin(t * 3.1) * 0.002;
    },
  };
}

function boingModel(): Model {
  const g = new THREE.Group();
  const coral = mat(0xe39a85, { rough: 0.55 });
  const cream = mat(0xf3ecdf, { rough: 0.55 });
  const dark = mat(0x47565c, { rough: 0.6 });
  const metal = mat(0xc9cfd2, { rough: 0.35, metal: 0.3 });
  // Barrel tube.
  g.add(part(geo.cyl(1, 1, 22), cream, [0, 0.01, -0.15], [0.06, 0.26, 0.06], [Math.PI / 2, 0, 0], false));
  g.add(part(geo.sphere(18), coral, [0, 0.01, -0.02], [0.062, 0.062, 0.04], [0, 0, 0], false));
  g.add(part(geo.torus(0.3, Math.PI * 2, 24), coral, [0, 0.01, -0.29], [0.068, 0.068, 0.068], [0, 0, 0], false));
  
  // Visible spring coil on the side.
  const spring = new THREE.Group();
  for (let i = 0; i < 6; i++) spring.add(part(geo.torus(0.2, Math.PI * 2, 14), metal, [0, 0, -i * 0.022], [0.028, 0.028, 0.028], [0, 0, 0], false));
  spring.position.set(0.072, -0.02, -0.05);
  g.add(spring);
  // Hopper with balls on top.
  g.add(part(geo.cyl(1, 0.8, 18), coral, [0, 0.085, -0.06], [0.05, 0.06, 0.05], [0, 0, 0], false));
  const hopperBalls = new THREE.Group();
  const cols = [0xf3ead8, 0xefcf7b, 0x9fc3d9];
  for (let i = 0; i < 3; i++) hopperBalls.add(part(geo.sphere(14), mat(cols[i], { rough: 0.4 }), [Math.cos(i * 2.1) * 0.022, 0.12 + i * 0.012, -0.06 + Math.sin(i * 2.1) * 0.022], 0.024, [0, 0, 0], false));
  g.add(hopperBalls);
  // Grip.
  g.add(part(geo.box(0.35), coral, [0, -0.06, 0.0], [0.055, 0.11, 0.065], [0.3, 0, 0], false));
  // Ball waiting in the muzzle.
  const ready = part(geo.sphere(16), mat(0xe9a593, { rough: 0.4 }), [0, 0.01, -0.27], 0.045, [0, 0, 0], false);
  g.add(ready);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.01, -0.34);
  g.add(muzzle);
  const hand = handAndSleeve();
  hand.position.set(0, -0.02, -0.005);
  g.add(hand);
  return {
    group: g,
    muzzle,
    anim: (dt, t, kick) => {
      spring.scale.z = damp(spring.scale.z, 1 - kick * 0.6, 20, dt);
      ready.scale.setScalar(damp(ready.scale.x, kick > 0.5 ? 0.001 : 0.045, 12, dt));
      hopperBalls.rotation.y += dt * (0.5 + kick * 6);
      void t;
    },
  };
}

function fizzModel(): Model {
  const g = new THREE.Group();
  const blue = mat(0xa9c7e3, { rough: 0.5 });
  const cream = mat(0xf3ecdf, { rough: 0.55 });
  const dark = mat(0x45535e, { rough: 0.6 });
  // Bottle body with fizzing bubbles inside.
  const glass = new THREE.MeshStandardMaterial({ color: 0xe4f0f6, roughness: 0.05, transparent: true, opacity: 0.32 });
  g.add(part(geo.capsule(1.6), glass, [0, 0.03, -0.08], [0.06, 0.06, 0.06], [Math.PI / 2, 0, 0], false));
  const soda = part(geo.capsule(1.6), mat(0xcfe3ef, { rough: 0.2, emissive: 0x7aa3bf, emissiveIntensity: 0.12 }), [0, 0.02, -0.08], [0.05, 0.05, 0.05], [Math.PI / 2, 0, 0], false);
  g.add(soda);
  const inner = new THREE.Group();
  const bm = mat(0xffffff, { rough: 0.1, emissive: 0xffffff, emissiveIntensity: 0.3 });
  for (let i = 0; i < 10; i++) inner.add(part(geo.sphere(8), bm, [Math.sin(i * 2.4) * 0.025, 0, -0.17 + i * 0.019], 0.007, [0, 0, 0], false));
  inner.position.y = 0.02;
  g.add(inner);
  // Nozzle cap.
  g.add(part(geo.cyl(0.6, 1, 18), blue, [0, 0.03, -0.25], [0.04, 0.07, 0.04], [Math.PI / 2, 0, 0], false));
  g.add(part(geo.cyl(1, 1, 14), cream, [0, 0.03, -0.3], [0.018, 0.04, 0.018], [Math.PI / 2, 0, 0], false));
  // Pump handle on top.
  g.add(part(geo.box(0.3), blue, [0, 0.105, -0.04], [0.035, 0.05, 0.11], [0, 0, 0], false));
  g.add(part(geo.box(0.35), blue, [0, -0.05, 0.0], [0.055, 0.11, 0.065], [0.3, 0, 0], false));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.33);
  g.add(muzzle);
  const hand = handAndSleeve();
  hand.position.set(0, -0.02, -0.005);
  g.add(hand);
  return {
    group: g,
    muzzle,
    anim: (dt, t, kick) => {
      inner.children.forEach((c, i) => {
        const p = (t * (0.6 + kick * 2.5) + i * 0.1) % 1;
        c.position.z = -0.17 + p * 0.19;
        c.position.y = Math.sin(t * 7 + i) * 0.008;
      });
      soda.scale.x = soda.scale.y = 0.05 + kick * 0.003;
      void dt;
    },
  };
}

function glowModel(): Model {
  const g = new THREE.Group();
  const frame = mat(0x5d7a7e, { rough: 0.55 });
  const cream = mat(0xf3ecdf, { rough: 0.55 });
  // Lantern cage with a glowing orb inside.
  const orbMat = new THREE.MeshStandardMaterial({ color: 0xc6f3ea, emissive: 0x9fe8de, emissiveIntensity: 2.2, roughness: 0.3 });
  const orb = part(geo.sphere(20), orbMat, [0, 0.04, -0.12], 0.05, [0, 0, 0], false);
  g.add(orb);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.add(part(geo.cyl(1, 1, 8), frame, [Math.cos(a) * 0.065, 0.04 + Math.sin(a) * 0.065, -0.12], [0.008, 0.16, 0.008], [Math.PI / 2, 0, 0], false));
  }
  g.add(part(geo.torus(0.12, Math.PI * 2, 24), frame, [0, 0.04, -0.2], [0.068, 0.068, 0.068], [0, 0, 0], false));
  g.add(part(geo.torus(0.12, Math.PI * 2, 24), frame, [0, 0.04, -0.04], [0.068, 0.068, 0.068], [0, 0, 0], false));
  g.add(part(geo.cyl(0.7, 1, 18), cream, [0, 0.04, -0.25], [0.045, 0.08, 0.045], [Math.PI / 2, 0, 0], false));
  g.add(part(geo.box(0.35), frame, [0, -0.045, 0.0], [0.055, 0.11, 0.065], [0.3, 0, 0], false));
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, -0.32);
  g.add(muzzle);
  const hand = handAndSleeve();
  hand.position.set(0, -0.02, -0.005);
  g.add(hand);
  return {
    group: g,
    muzzle,
    anim: (dt, t, kick) => {
      orbMat.emissiveIntensity = 1.8 + Math.sin(t * 3) * 0.4 + kick * 1.5;
      orb.scale.setScalar(damp(orb.scale.x, kick > 0.4 ? 0.02 : 0.05, 8, dt));
    },
  };
}

/**
 * Owns the viewmodel scene and translates trigger input into projectiles.
 */
export class BlasterRig {
  readonly scene = new THREE.Scene();
  private root = new THREE.Group();
  private models = new Map<BlasterId, Model>();
  current: BlasterId = 'bubble';
  private switchT = 1;
  private cooldown = 0;
  private kick = 0;
  private charge = 0;
  private charging = false;
  private chargeSoundPlayed = false;
  private holdT = 0;
  readonly hemi: THREE.HemisphereLight;
  readonly key: THREE.DirectionalLight;
  bigBubbleEnabled = false;
  onFire: ((id: BlasterId) => void) | null = null;
  onSwitch: ((id: BlasterId) => void) | null = null;
  onChargeStart: (() => void) | null = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  visible = true;

  constructor() {
    this.hemi = new THREE.HemisphereLight(0xf4f1ea, 0x6d7b72, 1.6);
    this.key = new THREE.DirectionalLight(0xfff4e2, 1.6);
    this.key.position.set(0.5, 1, 0.6);
    this.scene.add(this.hemi, this.key, this.root);
    const makers: Record<BlasterId, () => Model> = { bubble: bubbleWandModel, boing: boingModel, fizz: fizzModel, glow: glowModel };
    for (const id of Object.keys(makers) as BlasterId[]) {
      const m = makers[id]();
      m.group.visible = false;
      m.group.scale.setScalar(0.6);
      this.root.add(m.group);
      this.models.set(id, m);
    }
    this.models.get('bubble')!.group.visible = true;
  }

  select(id: BlasterId, instant = false): void {
    if (id === this.current && this.switchT >= 1) return;
    this.models.get(this.current)!.group.visible = false;
    this.current = id;
    this.models.get(id)!.group.visible = true;
    this.switchT = instant ? 1 : 0;
    this.cooldown = instant ? 0 : 0.18;
    this.charging = false;
    this.charge = 0;
    if (this.onSwitch && !instant) this.onSwitch(id);
  }

  /** Per-frame: follow the camera, animate, and fire when the trigger is held. */
  update(dt: number, t: number, cam: THREE.PerspectiveCamera, player: Player, input: Input, proj: Projectiles, hits: HitRegistry, canFire: boolean): void {
    this.root.position.copy(cam.position);
    this.root.quaternion.copy(cam.quaternion);
    const model = this.models.get(this.current)!;
    this.switchT = Math.min(1, this.switchT + dt / 0.32);
    this.cooldown -= dt;
    const def = blasterDef(this.current);

    // ------- firing
    const held = canFire && input.mouseDown;
    if (this.current === 'bubble' && this.bigBubbleEnabled) {
      if (held) {
        this.holdT += dt;
        if (this.holdT > 0.28) {
          if (!this.charging) {
            this.charging = true;
            this.chargeSoundPlayed = false;
            if (this.onChargeStart) this.onChargeStart();
          }
          this.charge = Math.min(1, this.charge + dt / 0.75);
        }
      } else {
        if (this.holdT > 0) {
          if (this.charging && this.charge > 0.35) this.shoot('bigBubble', model, cam, player, proj, hits);
          else if (this.cooldown <= 0) this.shoot('bubble', model, cam, player, proj, hits);
        }
        this.holdT = 0;
        this.charging = false;
        this.charge = damp(this.charge, 0, 12, dt);
      }
    } else if (held && this.cooldown <= 0 && this.switchT > 0.6) {
      this.shoot(def.kind, model, cam, player, proj, hits);
      this.cooldown = def.interval;
    }
    void this.chargeSoundPlayed;

    // ------- animation
    this.kick = damp(this.kick, 0, this.current === 'fizz' ? 6 : 9, dt);
    const bob = player.bobOffset();
    const equip = easeOutBack(this.switchT);
    const swimOffset = player.mode === 'swim' ? Math.sin(t * 1.4) * 0.01 : 0;
    const g = model.group;
    // Narrow (portrait) screens: tuck the blaster inwards so it stays in view.
    const narrowK = Math.max(0.5, Math.min(1, cam.aspect / 1.3));
    g.position.set(
      0.215 * narrowK + player.swayX + bob.x,
      -0.2 - (1 - equip) * 0.25 + player.swayY - bob.y + swimOffset - this.charge * 0.02,
      -0.44 + this.kick * 0.035,
    );
    g.rotation.set(this.kick * 0.18 + (1 - equip) * -0.6 + player.swayY * 1.5 + 0.04, 0.15 + player.swayX * 1.2, player.swayX * 0.8 + Math.sin(t * 1.1) * 0.006);
    if (this.charging) {
      g.position.x += Math.sin(t * 40) * 0.0015 * this.charge;
    }
    model.anim(dt, t, this.kick, this.charge);
    this.root.visible = this.visible;
  }

  private shoot(kind: ProjectileKind, model: Model, cam: THREE.PerspectiveCamera, player: Player, proj: Projectiles, hits: HitRegistry): void {
    // Aim point straight ahead, with gentle aim assist towards friendly targets.
    const origin = cam.getWorldPosition(this.tmp);
    const fwd = player.viewForward(this.tmp2);
    model.muzzle.updateWorldMatrix(true, false);
    const muzzle = new THREE.Vector3().setFromMatrixPosition(model.muzzle.matrixWorld);
    // Projectiles start between the eye and muzzle so they never spawn inside walls.
    const start = origin.clone().lerp(muzzle, 0.75).addScaledVector(fwd, 0.15);
    const isBall = kind === 'ball' || kind === 'glow';
    const assist = hits.aimTarget(origin, fwd, kind, kind === 'fizz' ? 9 : 42, kind === 'fizz' ? 6 : kind === 'bigBubble' ? 9 : 7);
    let aimPoint = origin.clone().addScaledVector(fwd, isBall ? 22 : 18);
    if (assist) aimPoint = assist.center.clone();
    const dir = aimPoint.clone().sub(start).normalize();
    if (!assist) {
      // No target: still converge on the crosshair line.
      dir.copy(aimPoint).sub(start).normalize();
    }
    const vel = player.velocity;
    if (kind === 'bubble' || kind === 'bigBubble') {
      proj.fireBubble(start, dir, kind === 'bigBubble', vel);
      this.kick = kind === 'bigBubble' ? 1 : 0.55;
      this.charge = 0;
    } else if (kind === 'fizz') {
      proj.fireFizz(start, dir, 2);
      this.kick = Math.min(1, this.kick + 0.18);
    } else {
      const speed = kind === 'glow' ? 14 : 17;
      const g = player.mode === 'swim' ? 4.2 : 15.5;
      let d = dir;
      if (assist || true) {
        // Ballistic solve so the arc lands on the aim point.
        const target = aimPoint;
        const dx = target.x - start.x;
        const dz = target.z - start.z;
        const dy = target.y - start.y;
        const horiz = Math.hypot(dx, dz);
        const v2 = speed * speed;
        const disc = v2 * v2 - g * (g * horiz * horiz + 2 * dy * v2);
        if (disc >= 0 && horiz > 0.5) {
          const ang = Math.atan2(v2 - Math.sqrt(disc), g * horiz);
          // Only correct upwards modestly so free aiming still feels natural.
          const cur = Math.atan2(dy, horiz);
          const useAng = assist ? ang : clamp(ang, cur - 0.02, cur + 0.25);
          d = new THREE.Vector3(dx / horiz * Math.cos(useAng), Math.sin(useAng), dz / horiz * Math.cos(useAng));
        }
      }
      proj.fireBall(start, d, kind === 'glow', speed, vel);
      this.kick = 1;
    }
    if (this.onFire) this.onFire(this.current);
  }

  get charging01(): number {
    return this.charge;
  }
}
