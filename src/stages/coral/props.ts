import * as THREE from 'three';
import { geo, mat, part } from '../../kit/kit';
import { clamp, damp, easeOutBack } from '../../core/math';
import type { StageContext } from '../types';
import type { Hittable, HitInfo, HitResponse, ProjectileKind } from '../../gameplay/Hit';
import { C, bake } from './shared';

const tmp = new THREE.Vector3();

function shellGeometry(top: boolean): THREE.BufferGeometry {
  // Scallop half: a dome with soft radial ribs fanning from the hinge (at -Z).
  const g = new THREE.SphereGeometry(1, 36, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const fan = Math.atan2(x, z + 1.05);
    const rib = 1 + Math.abs(Math.cos(fan * 9)) * 0.06 * (1 - y);
    // Squash the scallop edge into a gentle wave.
    p.setXYZ(i, x * rib, y * (top ? 1 : 0.8), z * rib);
  }
  if (!top) g.scale(1, -1, 1);
  g.computeVertexNormals();
  return g;
}

let SHELL_TOP: THREE.BufferGeometry | null = null;
let SHELL_BOT: THREE.BufferGeometry | null = null;
export function resetPropCaches(): void {
  SHELL_TOP = null;
  SHELL_BOT = null;
}

export function pearlModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(part(geo.sphere(24), mat(C.pearl, { rough: 0.18, metal: 0.15, emissive: 0xf6e6d0, emissiveIntensity: 0.35 }), [0, 0, 0], 0.2, [0, 0, 0], false));
  g.add(part(geo.sphere(10), mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.8 }), [-0.07, 0.08, 0.13], 0.045, [0, 0, 0], false));
  return g;
}

/**
 * A giant clam that hides a pearl. Bubble it, boop it, or swim right up to it
 * and it opens with a sparkle.
 */
export class Clam implements Hittable {
  readonly group = new THREE.Group();
  private lid = new THREE.Group();
  private pearl: THREE.Group;
  hitRadius = 1.0;
  active = true;
  aimAssist = 0.8;
  label = 'Clam';
  opened = false;
  private openK = 0;
  private glintT = Math.random() * 2;
  private breathe = Math.random() * 6;
  onOpen: ((c: Clam) => void) | null = null;

  constructor(private ctx: StageContext, pos: THREE.Vector3, rotY = 0, color = C.clam) {
    if (!SHELL_TOP) SHELL_TOP = shellGeometry(true);
    if (!SHELL_BOT) SHELL_BOT = shellGeometry(false);
    const shellM = mat(color, { rough: 0.55 });
    const inner = mat(0xf7ecf0, { rough: 0.35, emissive: 0xf1dde6, emissiveIntensity: 0.15 });
    const bot = new THREE.Group();
    const b = new THREE.Mesh(SHELL_BOT, shellM);
    b.scale.set(0.62, 0.3, 0.55);
    b.position.y = 0.3;
    b.castShadow = true;
    bot.add(b);
    bot.add(part(geo.cyl(1, 1, 24), inner, [0, 0.31, 0], [0.56, 0.03, 0.49], [0, 0, 0], false));
    this.group.add(bake(bot, true, false, 0.45));
    this.lid.position.set(0, 0.3, -0.5);
    const lidG = new THREE.Group();
    const t = new THREE.Mesh(SHELL_TOP, shellM);
    t.scale.set(0.62, 0.32, 0.55);
    t.position.z = 0.5;
    lidG.add(t);
    lidG.add(part(geo.cyl(1, 1, 24), inner, [0, 0.01, 0.5], [0.56, 0.02, 0.49], [0, 0, 0], false));
    this.lid.add(bake(lidG, true, false, 0.45));
    this.group.add(this.lid);
    this.pearl = pearlModel();
    this.pearl.position.set(0, 0.42, 0.05);
    this.pearl.scale.setScalar(0.8);
    this.group.add(this.pearl);
    this.group.position.copy(pos);
    this.group.rotation.y = rotY;
    ctx.root.add(this.group);
    ctx.hits.add(this);
  }

  hitCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.group.position).add(tmp.set(0, 0.35, 0));
  }

  accepts(_k: ProjectileKind): boolean {
    return !this.opened;
  }

  onHit(info: HitInfo): HitResponse {
    this.open();
    return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.active = false;
    this.ctx.sfx('sfx_clam_open', { pos: this.group.position, volume: 1 });
    this.ctx.fx.sparkle(this.hitCenter(new THREE.Vector3()).add(tmp.set(0, 0.3, 0)), 16, [0xfff3d6, 0xf6e3ee, 0xe3f4f8], 1);
    this.ctx.fx.pop(this.hitCenter(new THREE.Vector3()), 1.4);
    this.onOpen?.(this);
    this.ctx.hits.remove(this);
  }

  /** The world-space spot where the pearl floats up to once the clam opens. */
  pearlSpot(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.group.position).add(tmp.set(0, 0.95, 0));
  }

  hidePearl(): void {
    this.pearl.visible = false;
  }

  update(dt: number, t: number): void {
    // Closed clams breathe a little (lid lifts a crack) and glint so they can be spotted.
    const target = this.opened ? 1 : 0.06 + Math.max(0, Math.sin(t * 0.8 + this.breathe)) * 0.1;
    this.openK = damp(this.openK, target, this.opened ? 5 : 3, dt);
    this.lid.rotation.x = -this.openK * 1.15;
    if (!this.opened) {
      this.glintT -= dt;
      if (this.glintT <= 0) {
        this.glintT = 1.8;
        const p = this.group.position.clone().add(tmp.set(0, 0.45, 0.2).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.group.rotation.y));
        this.ctx.fx.glow.emit(p, { count: 1, shape: 1, size: 0.75, sizeEnd: 0.05, speed: 0, life: 0.7, color: 0xfff0d8, alpha: 0.6, fadeIn: 0.3 });
      }
      const pl = this.ctx.player.position;
      const dx = pl.x - this.group.position.x;
      const dz = pl.z - this.group.position.z;
      const dy = pl.y + 0.4 - this.group.position.y;
      if (dx * dx + dz * dz + dy * dy < 1.6 * 1.6) this.open();
    }
    this.pearl.rotation.y += dt;
  }
}

/** Floating bubble ring for the Ring Swim course. */
export function bubbleRingModel(): THREE.Group {
  const g = new THREE.Group();
  const band = mat(0xd6efe9, { rough: 0.3, emissive: 0xbfe6df, emissiveIntensity: 0.55 });
  const bead = mat(0xfbf6ea, { rough: 0.25, emissive: 0xf7ecd2, emissiveIntensity: 0.55 });
  const st = new THREE.Group();
  st.add(part(geo.torus(0.06, Math.PI * 2, 48), band, [0, 0, 0], 1.45, [0, 0, 0], false));
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    st.add(part(geo.sphere(10), bead, [Math.cos(a) * 1.45, Math.sin(a) * 1.45, 0], i % 2 ? 0.1 : 0.15, [0, 0, 0], false));
  }
  g.add(bake(st, false, false));
  return g;
}

/** A bubbling sand vent. Swim into the stream for a gentle lift. */
export class BubbleVent {
  readonly group = new THREE.Group();
  private t = Math.random() * 3;
  private announced = false;
  constructor(private ctx: StageContext, readonly pos: THREE.Vector3, rngRock: THREE.Object3D) {
    this.group.add(rngRock);
    this.group.position.copy(pos);
    ctx.root.add(this.group);
  }
  update(dt: number): void {
    this.t -= dt;
    while (this.t <= 0) {
      this.t += 0.05;
      const p = tmp.copy(this.pos);
      p.x += (Math.random() - 0.5) * 0.4;
      p.z += (Math.random() - 0.5) * 0.4;
      p.y += 0.5;
      this.ctx.fx.soft.emit(p, { count: 1, shape: 3, size: 0.09 + Math.random() * 0.12, sizeEnd: 0.18, speed: 1.6, life: 4.2, drag: 0.2, gravity: -1.2, color: 0xf2fbfb, alpha: 0.7, dir: new THREE.Vector3(0, 1, 0), spread: 0.08, wobble: 1, fadeIn: 0 });
    }
    const pl = this.ctx.player;
    const dx = pl.position.x - this.pos.x;
    const dz = pl.position.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.7 && pl.position.y < this.pos.y + 10) {
      pl.externalVel.y = clamp(pl.externalVel.y + dt * 14 * (1 - d / 1.7), 0, 5);
      if (!this.announced) {
        this.announced = true;
        this.ctx.cheer('Bubble lift!');
        this.ctx.say('ace_whee', 0);
      }
    } else if (d > 4) this.announced = false;
  }
}

/** Small pop-in helper used by the stage for appearing things. */
export function popIn(obj: THREE.Object3D, k: number, base = 1): void {
  obj.scale.setScalar(Math.max(0.001, easeOutBack(clamp(k, 0, 1)) * base));
}
