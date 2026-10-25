import * as THREE from 'three';
import type { AudioManager, SfxOptions } from '../audio/AudioManager';
import type { Player, MoveMode } from '../core/Player';
import type { PhysicsWorld } from '../core/Physics';
import type { Rng } from '../core/math';
import type { Effects } from '../fx/Particles';
import type { HitRegistry } from '../gameplay/Hit';
import type { ObjectiveTracker } from '../gameplay/Objectives';
import type { AbilityId, BlasterId, Settings } from '../core/Save';
import type { Projectiles } from '../gameplay/Projectiles';

/** Static description of a stage, shown on the map and used for unlocks. */
export interface StageInfo {
  id: string;
  name: string;
  /** One-line, kid-friendly description for the map card. */
  tagline: string;
  /** Map node position in percent of the map art (0..100). */
  map: { x: number; y: number };
  /** Accent colour for UI chrome on this stage (muted!). */
  accent: string;
  /** Icon name from ui/icons.ts for the map node. */
  icon: string;
  musicId: string;
  ambienceId: string | null;
  /** Narrator intro voice id and Ace's reaction id. */
  introNarration: string;
  introAce: string;
  /** Movement mode for the whole stage. */
  mode: MoveMode;
  /** Unlocked when this stage is first completed. */
  reward?: { blaster?: BlasterId; ability?: AbilityId; title: string; text: string };
  /** Footstep sound id for walking stages. */
  footstep?: string;
}

export type ObjectiveKind = 'main' | 'treasure' | 'challenge';

export interface ObjectiveDef {
  id: string;
  kind: ObjectiveKind;
  /** Short HUD label, e.g. "Find dino eggs". Counter is appended automatically. */
  label: string;
  /** Icon name from ui/icons.ts. */
  icon: string;
  /** How many to complete (1 for single tasks). */
  target: number;
  /** Main objectives are revealed in order: a step is shown once all earlier ones are done. */
  hint?: string;
}

/** Lighting / atmosphere settings applied by the renderer when the stage starts. */
export interface StageEnvironment {
  /** Sky gradient (top, horizon, ground) - ignored underwater. */
  sky: { top: string; horizon: string; bottom: string; sunColor?: string; sunSize?: number } | null;
  fog: { color: string; density: number };
  hemi: { sky: string; ground: string; intensity: number };
  sun: { color: string; intensity: number; dir: [number, number, number]; shadows: boolean };
  ambient?: { color: string; intensity: number };
  exposure: number;
  bloom: { strength: number; radius: number; threshold: number };
  /** Underwater look: tinted fog, caustics, light shafts, marine snow, muffled audio. */
  underwater?: { surfaceY: number | null; tint: string; snow: number; shafts: number };
  /** Optional gentle falling particles (snow, pollen, leaves). */
  weather?: { kind: 'snow' | 'pollen' | 'leaves' | 'motes'; density: number; color: string };
  /** Background colour when no sky is drawn. */
  background?: string;
}

/** Everything the running game exposes to a stage. */
export interface StageContext {
  readonly scene: THREE.Scene;
  /** Root group for this stage's content; cleared automatically on exit. */
  readonly root: THREE.Group;
  readonly camera: THREE.PerspectiveCamera;
  readonly player: Player;
  readonly physics: PhysicsWorld;
  readonly fx: Effects;
  readonly hits: HitRegistry;
  readonly projectiles: Projectiles;
  readonly objectives: ObjectiveTracker;
  readonly audio: AudioManager;
  readonly settings: Settings;
  readonly rng: Rng;
  /** Seconds since the stage started (pauses with the game). */
  readonly time: number;
  /** True while the game is in deterministic probe mode (skip cinematics/randomness where possible). */
  readonly probe: boolean;

  /** Play a sound effect, optionally positional. */
  sfx(id: string, opts?: SfxOptions): void;
  /** Ace says a line (short reactions are dropped if Ace is already talking). */
  say(id: string, priority?: number): void;
  /** Narrator line (story priority, queued). */
  narrate(id: string, onEnd?: () => void): void;
  /** Friendly floating cheer text near the crosshair, e.g. "Pop-tastic!". */
  cheer(text?: string): void;
  /** Big centred banner for moments ("Big Friend!", "Challenge!"). */
  banner(title: string, subtitle?: string, seconds?: number): void;
  /** Contextual hint card (bottom). Pass null to clear. Keys in [brackets] render as keycaps. */
  hint(text: string | null, seconds?: number): void;
  /** Smoothly turn Ace's view towards a point for a short cinematic beat. */
  focusOn(point: THREE.Vector3, seconds?: number): void;
  /** Gentle camera shake (kept tiny). */
  shake(amount: number): void;
  /** Borrow a pooled point light (returns null when none left). Call release() when done. */
  borrowLight(): PooledLight | null;
  /** Register a per-frame callback (removed on stage exit). Return false to unregister. */
  onUpdate(fn: (dt: number, t: number) => boolean | void): void;
  /** Ask the game to show the Home Bubble (finish portal) near a position. */
  showHomeBubble(near?: THREE.Vector3): void;
  /** Is a blaster/ability unlocked in the save? */
  hasBlaster(id: BlasterId): boolean;
  hasAbility(id: AbilityId): boolean;
  /** Grant a blaster mid-stage (tutorial pickup). */
  grantBlaster(id: BlasterId, select?: boolean): void;
  /** Currently selected blaster. */
  readonly blaster: BlasterId;
  /** Show/hide the challenge timer in the HUD (seconds remaining, or null to hide). */
  setTimer(seconds: number | null, label?: string): void;
  /** Report a finished challenge time (kept as best time in the save). */
  recordChallengeTime(seconds: number): void;
  /** Lock/unlock the blaster trigger (e.g. during a cinematic beat). */
  setFireEnabled(on: boolean): void;
}

export interface PooledLight {
  light: THREE.PointLight;
  release(): void;
}

/** A playable stage. One instance is created each time the stage is entered. */
export abstract class Stage {
  abstract readonly info: StageInfo;
  abstract readonly objectives: ObjectiveDef[];
  abstract readonly env: StageEnvironment;
  /** Where Ace starts. */
  abstract readonly spawn: { pos: THREE.Vector3; yaw: number };
  /** Optional par time label for the challenge (shown on results). */
  challengePar?: number;
  protected ctx!: StageContext;

  /** Build the world. Called once; add everything under ctx.root. */
  abstract build(ctx: StageContext): void;
  /** Per-frame update while playing. */
  abstract update(dt: number, t: number): void;
  /** Called after build when the intro is done and play begins. */
  begin(): void {}
  /** Called when an objective is completed. */
  onObjectiveComplete(_id: string): void {}
  /** Cleanup beyond ctx.root disposal (timers, DOM). */
  dispose(): void {}
}

export type StageFactory = () => Stage;
