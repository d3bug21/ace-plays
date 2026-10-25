// Persistent settings + progress (localStorage). Everything is defensive so a
// corrupted or missing save never stops a child from playing.

export type BlasterId = 'bubble' | 'boing' | 'fizz' | 'glow';
export type AbilityId = 'bigBubble';

export interface Settings {
  sensitivity: number; // 0.2 .. 3.0, 1 = default
  invertLook: boolean; // invert up/down look only
  musicVolume: number; // 0..1
  voiceVolume: number;
  sfxVolume: number;
  subtitles: boolean;
  headBob: boolean;
  fov: number; // degrees
  quality: 'fancy' | 'simple';
  hints: boolean;
}

export interface StageProgress {
  completed: boolean;
  stars: boolean[]; // [main, treasures, challenge]
  bestTime: number | null; // best challenge time in seconds
  plays: number;
}

export interface Progress {
  stages: Record<string, StageProgress>;
  blasters: BlasterId[];
  abilities: AbilityId[];
  tutorialSeen: boolean;
  lastStage: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertLook: false,
  musicVolume: 0.55,
  voiceVolume: 0.9,
  sfxVolume: 0.8,
  subtitles: true,
  headBob: true,
  fov: 75,
  quality: 'fancy',
  hints: true,
};

const SETTINGS_KEY = 'acePlays.settings.v1';
const PROGRESS_KEY = 'acePlays.progress.v1';

function freshProgress(): Progress {
  return { stages: {}, blasters: ['bubble'], abilities: [], tutorialSeen: false, lastStage: null };
}

function safeRead<T>(key: string): Partial<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Partial<T>) : null;
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable (private mode); play on regardless */
  }
}

type Listener = () => void;

export class SaveData {
  settings: Settings;
  progress: Progress;
  private listeners: Listener[] = [];
  /** When true nothing is written (used by deterministic probe runs). */
  ephemeral = false;

  constructor(ephemeral = false) {
    this.ephemeral = ephemeral;
    const s = ephemeral ? null : safeRead<Settings>(SETTINGS_KEY);
    this.settings = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
    this.sanitizeSettings();
    const p = ephemeral ? null : safeRead<Progress>(PROGRESS_KEY);
    this.progress = { ...freshProgress(), ...(p ?? {}) };
    if (!Array.isArray(this.progress.blasters) || !this.progress.blasters.includes('bubble')) {
      this.progress.blasters = ['bubble', ...(Array.isArray(this.progress.blasters) ? this.progress.blasters : [])];
    }
    if (!Array.isArray(this.progress.abilities)) this.progress.abilities = [];
    if (!this.progress.stages || typeof this.progress.stages !== 'object') this.progress.stages = {};
  }

  private sanitizeSettings(): void {
    const s = this.settings;
    const num = (v: unknown, d: number, a: number, b: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d;
    s.sensitivity = num(s.sensitivity, 1, 0.2, 3);
    s.musicVolume = num(s.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 1);
    s.voiceVolume = num(s.voiceVolume, DEFAULT_SETTINGS.voiceVolume, 0, 1);
    s.sfxVolume = num(s.sfxVolume, DEFAULT_SETTINGS.sfxVolume, 0, 1);
    s.fov = num(s.fov, 75, 60, 95);
    s.invertLook = !!s.invertLook;
    s.subtitles = s.subtitles !== false;
    s.headBob = s.headBob !== false;
    s.hints = s.hints !== false;
    if (s.quality !== 'simple') s.quality = 'fancy';
  }

  onChange(fn: Listener): void {
    this.listeners.push(fn);
  }

  saveSettings(): void {
    this.sanitizeSettings();
    if (!this.ephemeral) safeWrite(SETTINGS_KEY, this.settings);
    for (const l of this.listeners) l();
  }

  saveProgress(): void {
    if (!this.ephemeral) safeWrite(PROGRESS_KEY, this.progress);
    for (const l of this.listeners) l();
  }

  stage(id: string): StageProgress {
    let sp = this.progress.stages[id];
    if (!sp) {
      sp = { completed: false, stars: [false, false, false], bestTime: null, plays: 0 };
      this.progress.stages[id] = sp;
    }
    if (!Array.isArray(sp.stars) || sp.stars.length !== 3) sp.stars = [false, false, false];
    return sp;
  }

  starCount(id: string): number {
    const sp = this.progress.stages[id];
    return sp ? sp.stars.filter(Boolean).length : 0;
  }

  totalStars(): number {
    let n = 0;
    for (const id of Object.keys(this.progress.stages)) n += this.starCount(id);
    return n;
  }

  hasBlaster(id: BlasterId): boolean {
    return this.progress.blasters.includes(id);
  }

  unlockBlaster(id: BlasterId): boolean {
    if (this.hasBlaster(id)) return false;
    this.progress.blasters.push(id);
    return true;
  }

  hasAbility(id: AbilityId): boolean {
    return this.progress.abilities.includes(id);
  }

  unlockAbility(id: AbilityId): boolean {
    if (this.hasAbility(id)) return false;
    this.progress.abilities.push(id);
    return true;
  }

  resetProgress(): void {
    this.progress = freshProgress();
    this.saveProgress();
  }
}
