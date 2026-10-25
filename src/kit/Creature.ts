import * as THREE from 'three';
import { bubbleGeometry, createBubbleMaterial, releaseBubbleMaterial } from '../fx/BubbleMaterial';
import { clamp, damp, dampAngle, easeOutBack } from '../core/math';
import type { Hittable, HitInfo, HitResponse, ProjectileKind } from '../gameplay/Hit';
import type { StageContext } from '../stages/types';
import { blobShadow } from './kit';

export type CreatureSize = 'small' | 'medium' | 'big' | 'huge';

export interface CreatureOptions {
  name: string;
  size: CreatureSize;
  /** Hit sphere radius (be generous!). */
  radius: number;
  /** Hit centre height above root origin. */
  centerY: number;
  /** Which projectile kinds this creature reacts to (default: all). */
  accepts?: ProjectileKind[];
  /** Can little bubbles wrap it? Defaults to true for small creatures. */
  bubbleable?: boolean;
  /** Can a big (charged) bubble wrap it? Defaults to true for small/medium. */
  bigBubbleable?: boolean;
  /** Ground-dwelling creatures snap to the terrain. */
  grounded?: boolean;
  /** Draw a soft blob shadow under it. */
  shadow?: number;
  /** Sound when it giggles (default sfx_giggle). */
  giggleSfx?: string;
  label?: string;
}

type ReactionKind = 'none' | 'bubbled' | 'giggle' | 'puff' | 'spin' | 'custom';

/**
 * Base class for every friendly creature. Subclasses build their model under
 * `body` (which receives squash/stretch and reaction poses), implement
 * `behave()` (movement) and `animate()` (procedural animation).
 *
 * Built-in playful reactions:
 *  - bubbleWrap(): floats up inside a big wobbly bubble, spins gently, giggles,
 *    then the bubble pops into sparkles and it drifts back down happily.
 *  - giggleBounce(): squash-and-stretch hop with hearts.
 *  - puffUp(): swells round (puffer fish!) then deflates.
 *  - happySpin(): a delighted twirl.
 */
export abstract class Creature implements Hittable {
  readonly root = new THREE.Group();
  /** Model goes here; reactions scale/rotate this group. */
  readonly body = new THREE.Group();
  readonly opts: CreatureOptions;
  protected ctx: StageContext;
  hitRadius: number;
  active = true;
  aimAssist = 1;
  label?: string;
  heading = 0;
  /** Smoothed movement speed (for animation). */
  speed = 0;
  readonly vel = new THREE.Vector3();
  reaction: ReactionKind = 'none';
  reactionT = 0;
  reactionDur = 0;
  /** Number of playful hits received. */
  hits = 0;
  /** 0..1 happiness used by some objectives. */
  happiness = 0;
  /** Where a bubble-wrapped creature floats to (optional). */
  floatTarget: THREE.Vector3 | null = null;
  protected bubbleMesh: THREE.Mesh | null = null;
  private bubbleMat: THREE.ShaderMaterial | null = null;
  private floatStart = new THREE.Vector3();
  private floatPeak = new THREE.Vector3();
  private bubbleScale = 1;
  protected squash = 0;
  private puffAmount = 0;
  private spinAmount = 0;
  private shadowMesh: THREE.Mesh | null = null;
  private baseY = 0;
  /** Fired when a reaction finishes (e.g. bubble popped). */
  onReactionEnd: ((kind: ReactionKind) => void) | null = null;
  /** Fired on every playful hit. Return true to suppress the default reaction. */
  onPlayfulHit: ((info: HitInfo) => boolean | void) | null = null;

  constructor(ctx: StageContext, opts: CreatureOptions) {
    this.ctx = ctx;
    this.opts = opts;
    this.hitRadius = opts.radius;
    this.label = opts.label;
    this.root.add(this.body);
    if (opts.shadow) {
      this.shadowMesh = blobShadow(opts.shadow);
      this.ctx.root.add(this.shadowMesh);
    }
    ctx.root.add(this.root);
    ctx.hits.add(this);
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  get isBubbled(): boolean {
    return this.reaction === 'bubbled';
  }

  hitCenter(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.root.position).add(new THREE.Vector3(0, this.opts.centerY * this.root.scale.y, 0));
  }

  accepts(kind: ProjectileKind): boolean {
    if (!this.active) return false;
    if (this.reaction === 'bubbled') return false;
    return !this.opts.accepts || this.opts.accepts.includes(kind);
  }

  canBubble(kind: ProjectileKind): boolean {
    const small = this.opts.size === 'small';
    const medium = this.opts.size === 'medium';
    if (kind === 'bubble') return this.opts.bubbleable ?? small;
    if (kind === 'bigBubble') return this.opts.bigBubbleable ?? (small || medium);
    return false;
  }

  onHit(info: HitInfo): HitResponse {
    this.hits++;
    if (this.onPlayfulHit && this.onPlayfulHit(info) === true) {
      return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
    }
    return this.defaultReaction(info);
  }

  /** Default reaction table - subclasses can override for creature-specific behaviour. */
  protected defaultReaction(info: HitInfo): HitResponse {
    if ((info.kind === 'bubble' || info.kind === 'bigBubble') && this.canBubble(info.kind)) {
      this.bubbleWrap();
      return 'consume';
    }
    if (info.kind === 'fizz') {
      this.tickle(info);
      return 'consume';
    }
    this.giggleBounce();
    return info.kind === 'ball' || info.kind === 'glow' ? 'bounce' : 'consume';
  }

  // ------------------------------------------------------------ reactions

  bubbleWrap(duration = 3.4, height = 1.8): void {
    if (this.reaction === 'bubbled') return;
    this.reaction = 'bubbled';
    this.reactionT = 0;
    this.reactionDur = duration;
    this.floatStart.copy(this.root.position);
    this.floatPeak.copy(this.root.position);
    this.floatPeak.y += height;
    if (!this.bubbleMesh) {
      this.bubbleMat = createBubbleMaterial({ wobble: 0.05, tint: 0xd7edf2 });
      this.bubbleMesh = new THREE.Mesh(bubbleGeometry(), this.bubbleMat);
      this.bubbleMesh.renderOrder = 7;
    }
    this.bubbleScale = this.opts.radius * 1.35;
    this.bubbleMesh.position.set(0, this.opts.centerY, 0);
    this.bubbleMesh.scale.setScalar(0.01);
    this.root.add(this.bubbleMesh);
    this.ctx.sfx('sfx_bubble_wrap', { pos: this.root.position });
    this.ctx.sfx(this.opts.giggleSfx ?? 'sfx_giggle', { pos: this.root.position, volume: 0.9 });
    this.ctx.fx.sparkle(this.hitCenter(new THREE.Vector3()), 8, [0xe9f6f8, 0xfff6e0], 0.8);
  }

  giggleBounce(): void {
    if (this.reaction === 'bubbled') return;
    this.reaction = 'giggle';
    this.reactionT = 0;
    this.reactionDur = 0.9;
    this.squash = 1;
    this.ctx.sfx(this.opts.giggleSfx ?? 'sfx_giggle', { pos: this.root.position });
    this.ctx.fx.hearts(this.hitCenter(new THREE.Vector3()).add(new THREE.Vector3(0, this.opts.radius * 0.8, 0)), 2);
  }

  puffUp(amount = 0.6, dur = 2.6, sfx = 'sfx_puffer_puff'): void {
    if (this.reaction === 'bubbled') return;
    this.reaction = 'puff';
    this.reactionT = 0;
    this.reactionDur = dur;
    this.puffAmount = amount;
    if (sfx) this.ctx.sfx(sfx, { pos: this.root.position });
  }

  happySpin(): void {
    if (this.reaction === 'bubbled') return;
    this.reaction = 'spin';
    this.reactionT = 0;
    this.reactionDur = 1.1;
    this.spinAmount = 0;
    this.ctx.fx.hearts(this.hitCenter(new THREE.Vector3()).add(new THREE.Vector3(0, this.opts.radius, 0)), 3);
  }

  /** Fizz tickles: small wiggles and the occasional giggle. */
  tickle(info: HitInfo): void {
    this.squash = Math.min(1, this.squash + 0.15);
    this.happiness = Math.min(1, this.happiness + 0.02);
    if (Math.random() < 0.08) this.ctx.sfx(this.opts.giggleSfx ?? 'sfx_giggle', { pos: this.root.position, volume: 0.6 });
    // Gentle push away from the stream.
    this.vel.addScaledVector(info.dir, 0.25);
  }

  /** Called every frame by the stage. */
  update(dt: number, t: number): void {
    this.updateReaction(dt, t);
    if (this.reaction !== 'bubbled') this.behave(dt, t);
    this.animate(dt, t);
    // Squash & stretch on the body.
    this.squash = damp(this.squash, 0, 7, dt);
    const sq = Math.sin(this.squash * Math.PI) * 0.25 * this.squash;
    const puff = this.reaction === 'puff' ? this.puffAmount * Math.sin(Math.min(1, this.reactionT / 0.25) * Math.PI * 0.5) * (this.reactionT > this.reactionDur - 0.5 ? (this.reactionDur - this.reactionT) / 0.5 : 1) : 0;
    this.body.scale.set(1 + sq + puff, 1 - sq + puff, 1 + sq + puff);
    if (this.shadowMesh) {
      const gh = this.ctx.physics.groundHeight(this.root.position.x, this.root.position.z);
      this.shadowMesh.position.set(this.root.position.x, gh + 0.03, this.root.position.z);
      const h = Math.max(0, this.root.position.y - gh);
      const s = clamp(1 - h / 8, 0.2, 1);
      this.shadowMesh.scale.setScalar(s);
      (this.shadowMesh.material as THREE.MeshBasicMaterial).opacity = 0.28 * s;
    }
  }

  private updateReaction(dt: number, t: number): void {
    if (this.reaction === 'none') return;
    this.reactionT += dt;
    const k = this.reactionT / this.reactionDur;
    if (this.reaction === 'bubbled' && this.bubbleMesh) {
      const grow = easeOutBack(Math.min(1, this.reactionT / 0.35));
      this.bubbleMesh.scale.setScalar(this.bubbleScale * grow * (1 + Math.sin(t * 6) * 0.03));
      // Float up and gently towards the float target, spinning slowly.
      const rise = Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5);
      const target = this.floatTarget;
      if (target) {
        this.root.position.lerpVectors(this.floatStart, target, Math.min(1, k * 1.05));
        this.root.position.y += Math.sin(k * Math.PI) * 1.2 + rise * 0.6;
      } else {
        this.root.position.lerpVectors(this.floatStart, this.floatPeak, rise);
        this.root.position.y += Math.sin(t * 2) * 0.08;
      }
      this.body.rotation.z = Math.sin(t * 2.2) * 0.25;
      this.heading += dt * 1.2;
      this.root.rotation.y = this.heading;
      if (Math.random() < dt * 1.5) this.ctx.fx.hearts(this.hitCenter(new THREE.Vector3()), 1);
      if (this.reactionT >= this.reactionDur) {
        const c = this.hitCenter(new THREE.Vector3());
        this.ctx.fx.pop(c, this.bubbleScale * 1.6);
        this.ctx.fx.sparkle(c, 10, [0xfff3d6, 0xe3f4f8], 0.9);
        this.ctx.sfx('sfx_big_pop', { pos: c });
        this.root.remove(this.bubbleMesh);
        this.body.rotation.z = 0;
        if (target) this.floatStart.copy(this.root.position);
        this.baseY = this.root.position.y;
        this.endReaction('bubbled');
      }
      return;
    }
    if (this.reaction === 'spin') {
      this.spinAmount = easeOutBack(Math.min(1, k)) * Math.PI * 2;
      this.body.rotation.y = this.spinAmount;
      if (k >= 1) {
        this.body.rotation.y = 0;
        this.endReaction('spin');
      }
      return;
    }
    if (this.reaction === 'giggle') {
      // Little hop.
      this.body.position.y = Math.sin(Math.min(1, k) * Math.PI) * this.opts.radius * 0.35;
      if (k >= 1) {
        this.body.position.y = 0;
        this.endReaction('giggle');
      }
      return;
    }
    if (k >= 1) this.endReaction(this.reaction);
  }

  private endReaction(kind: ReactionKind): void {
    this.reaction = 'none';
    this.reactionT = 0;
    if (this.onReactionEnd) this.onReactionEnd(kind);
  }

  /** After a float, grounded creatures settle back to the ground (used in behave). */
  protected settleToGround(dt: number): void {
    if (!this.opts.grounded) return;
    const gh = this.ctx.physics.groundHeight(this.root.position.x, this.root.position.z);
    if (this.root.position.y > gh + 0.01) {
      this.vel.y -= 14 * dt;
      this.root.position.y += this.vel.y * dt;
      if (this.root.position.y <= gh) {
        this.root.position.y = gh;
        if (this.vel.y < -3) {
          this.squash = 0.8;
          this.ctx.fx.puff(this.root.position, 0xe9dfcf, 4, 0.6);
        }
        this.vel.y = 0;
      }
    } else {
      this.root.position.y = gh;
      this.vel.y = 0;
    }
    void this.baseY;
  }

  /** Turn smoothly towards a heading (radians, 0 = +Z forward for models facing +Z). */
  protected turnTowards(target: number, rate: number, dt: number): void {
    this.heading = dampAngle(this.heading, target, rate, dt);
    this.root.rotation.y = this.heading;
  }

  /** Angle from this creature towards a world XZ point (models face +Z). */
  protected angleTo(x: number, z: number): number {
    return Math.atan2(x - this.root.position.x, z - this.root.position.z);
  }

  distanceToPlayer(): number {
    return this.root.position.distanceTo(this.ctx.player.position);
  }

  /** Movement / AI. Not called while bubble-wrapped. */
  protected abstract behave(dt: number, t: number): void;
  /** Procedural animation (legs, tails, fins). Always called. */
  protected abstract animate(dt: number, t: number): void;

  dispose(): void {
    this.ctx.hits.remove(this);
    if (this.bubbleMat) releaseBubbleMaterial(this.bubbleMat);
    this.root.removeFromParent();
    this.shadowMesh?.removeFromParent();
  }
}

/**
 * Simple wander helper: picks random points inside a circle and walks there,
 * pausing to look around. Works on the XZ plane (grounded) or in 3D (swimmers).
 */
export class Wander {
  target = new THREE.Vector3();
  pause = 0;
  constructor(
    public center: THREE.Vector3,
    public radius: number,
    public speed: number,
    public rng: () => number,
    public yRange: [number, number] | null = null,
    public pauseRange: [number, number] = [0.6, 2.5],
  ) {
    this.pick();
  }

  pick(): void {
    const a = this.rng() * Math.PI * 2;
    const r = Math.sqrt(this.rng()) * this.radius;
    this.target.set(this.center.x + Math.cos(a) * r, this.center.y, this.center.z + Math.sin(a) * r);
    if (this.yRange) this.target.y = this.yRange[0] + this.rng() * (this.yRange[1] - this.yRange[0]);
  }

  /** Returns desired velocity towards the current target (zero when pausing). */
  step(pos: THREE.Vector3, dt: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.pause > 0) {
      this.pause -= dt;
      return out.set(0, 0, 0);
    }
    out.subVectors(this.target, pos);
    if (!this.yRange) out.y = 0;
    const d = out.length();
    if (d < 0.6) {
      this.pause = this.pauseRange[0] + this.rng() * (this.pauseRange[1] - this.pauseRange[0]);
      this.pick();
      return out.set(0, 0, 0);
    }
    const slow = Math.min(1, d / 1.5);
    return out.multiplyScalar((this.speed * slow) / d);
  }
}
