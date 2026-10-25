import * as THREE from 'three';
import manifestJson from './manifest.json';

// WebAudio mixer with separate music / voice / effects buses.
// All audio is bundled locally (generated with ElevenLabs at build time).
// If a file is missing the game keeps running: voices still show subtitles and
// effects fall back to tiny synthesized blips so feedback never disappears.

export type AudioKind = 'voice' | 'sfx' | 'music' | 'ambience';

export interface AudioEntry {
  id: string;
  kind: AudioKind;
  file: string;
  group: string;
  speaker?: 'ace' | 'narrator';
  text?: string;
  prompt?: string;
  duration?: number;
  loop?: boolean;
  variants?: number;
  volume?: number;
}

interface Manifest {
  entries: AudioEntry[];
}

const manifest = manifestJson as unknown as Manifest;

export interface SfxOptions {
  pos?: THREE.Vector3;
  volume?: number;
  rate?: number;
  /** Random pitch variation (fraction, default 0.06). */
  jitter?: number;
  /** Max audible distance for positional sounds. */
  range?: number;
}

export interface VoiceOptions {
  /** Higher priority lines interrupt or jump the queue. 0 = chatter, 1 = normal, 2 = story. */
  priority?: number;
  /** Do not queue: drop if something is already speaking. */
  dropIfBusy?: boolean;
  onEnd?: () => void;
}

type SubtitleFn = (speaker: 'ace' | 'narrator', text: string, duration: number) => void;

interface VoiceJob {
  id: string;
  priority: number;
  onEnd?: () => void;
}

export class AudioManager {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private voiceBus!: GainNode;
  private sfxBus!: GainNode;
  private sfxFilter!: BiquadFilterNode;
  private duck!: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private missing = new Set<string>();
  readonly entries = new Map<string, AudioEntry>();
  private musicNow: { id: string; src: AudioBufferSourceNode | null; gain: GainNode; timer?: number } | null = null;
  private ambNow: { id: string; src: AudioBufferSourceNode | null; gain: GainNode } | null = null;
  private voiceQueue: VoiceJob[] = [];
  private voicePlaying: { job: VoiceJob; src: AudioBufferSourceNode | null; endAt: number } | null = null;
  private lastPlayed = new Map<string, number>();
  private variantCursor = new Map<string, number>();
  onSubtitle: SubtitleFn | null = null;
  private volumes = { music: 0.55, voice: 0.9, sfx: 0.8 };
  readonly listenerPos = new THREE.Vector3();
  readonly listenerFwd = new THREE.Vector3(0, 0, -1);
  readonly listenerRight = new THREE.Vector3(1, 0, 0);
  private underwater = false;
  private baseUrl: string;
  /** Disable all output (deterministic probe runs). */
  muted = false;

  constructor() {
    for (const e of manifest.entries) this.entries.set(e.id, e);
    this.baseUrl = new URL('./', document.baseURI).href;
  }

  get ready(): boolean {
    return !!this.ctx;
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.muted) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = 1;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      this.master.connect(comp).connect(c.destination);
      this.duck = c.createGain();
      this.musicBus = c.createGain();
      this.voiceBus = c.createGain();
      this.sfxBus = c.createGain();
      this.sfxFilter = c.createBiquadFilter();
      this.sfxFilter.type = 'lowpass';
      this.sfxFilter.frequency.value = 20000;
      this.musicBus.connect(this.duck).connect(this.master);
      this.voiceBus.connect(this.master);
      this.sfxBus.connect(this.sfxFilter).connect(this.master);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(music: number, voice: number, sfx: number): void {
    this.volumes = { music, voice, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Perceptual curve so the sliders feel even.
    const curve = (v: number) => v * v;
    this.musicBus.gain.setTargetAtTime(curve(this.volumes.music) * 0.9, t, 0.05);
    this.voiceBus.gain.setTargetAtTime(curve(this.volumes.voice) * 1.1, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(curve(this.volumes.sfx), t, 0.05);
  }

  setUnderwater(on: boolean): void {
    this.underwater = on;
    if (!this.ctx) return;
    this.sfxFilter.frequency.setTargetAtTime(on ? 2400 : 20000, this.ctx.currentTime, 0.2);
  }

  // ------------------------------------------------------------------ loading

  private url(file: string): string {
    return new URL(file, this.baseUrl).href;
  }

  private load(id: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(id);
    if (cached) return Promise.resolve(cached);
    if (this.missing.has(id)) return Promise.resolve(null);
    const pending = this.loading.get(id);
    if (pending) return pending;
    const entry = this.entries.get(id);
    if (!entry || !this.ctx) return Promise.resolve(null);
    const ctx = this.ctx;
    const p = fetch(this.url(entry.file))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => {
        this.buffers.set(id, buf);
        this.loading.delete(id);
        return buf;
      })
      .catch(() => {
        this.missing.add(id);
        this.loading.delete(id);
        return null;
      });
    this.loading.set(id, p);
    return p;
  }

  /** Preload every entry in the given groups (e.g. 'common', 'dino'). */
  preload(groups: string[]): Promise<void> {
    if (!this.ctx) return Promise.resolve();
    const jobs: Promise<unknown>[] = [];
    for (const e of this.entries.values()) {
      if (!groups.includes(e.group)) continue;
      if (e.variants && e.variants > 1) {
        for (let i = 1; i <= e.variants; i++) jobs.push(this.loadVariant(e, i));
      } else jobs.push(this.load(e.id));
    }
    return Promise.all(jobs).then(() => undefined);
  }

  private variantId(e: AudioEntry, i: number): string {
    return `${e.id}#${i}`;
  }

  private loadVariant(e: AudioEntry, i: number): Promise<AudioBuffer | null> {
    const vid = this.variantId(e, i);
    if (!this.entries.has(vid)) {
      this.entries.set(vid, { ...e, id: vid, variants: 1, file: e.file.replace(/(\.[a-z0-9]+)$/i, `_${i}$1`) });
    }
    return this.load(vid);
  }

  private resolveId(id: string): string {
    const e = this.entries.get(id);
    if (!e || !e.variants || e.variants <= 1) return id;
    // Shuffle-bag-ish variant rotation avoids repeats.
    const cur = ((this.variantCursor.get(id) ?? Math.floor(Math.random() * e.variants)) % e.variants) + 1;
    this.variantCursor.set(id, cur);
    const vid = this.variantId(e, cur);
    if (!this.entries.has(vid)) void this.loadVariant(e, cur);
    return vid;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  // ---------------------------------------------------------------- playback

  updateListener(pos: THREE.Vector3, fwd: THREE.Vector3, right: THREE.Vector3): void {
    this.listenerPos.copy(pos);
    this.listenerFwd.copy(fwd);
    this.listenerRight.copy(right);
    this.updateVoiceQueue();
  }

  sfx(id: string, o: SfxOptions = {}): void {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const entry = this.entries.get(id);
    // Throttle identical sounds so rapid fire never becomes noise.
    const now = ctx.currentTime;
    const last = this.lastPlayed.get(id) ?? -1;
    if (now - last < 0.035) return;
    this.lastPlayed.set(id, now);
    let vol = (o.volume ?? 1) * (entry?.volume ?? 1);
    let pan = 0;
    if (o.pos) {
      const range = o.range ?? 40;
      const dx = o.pos.x - this.listenerPos.x;
      const dy = o.pos.y - this.listenerPos.y;
      const dz = o.pos.z - this.listenerPos.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > range) return;
      const att = 1 / (1 + (d / (range * 0.22)) ** 2);
      vol *= att;
      if (d > 0.01) pan = Math.max(-1, Math.min(1, (dx * this.listenerRight.x + dz * this.listenerRight.z) / d)) * 0.8;
    }
    if (vol < 0.01) return;
    const rid = this.resolveId(id);
    const buf = this.buffers.get(rid);
    const jitter = o.jitter ?? 0.06;
    const rate = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
    if (!buf) {
      if (!this.missing.has(rid)) {
        void this.load(rid).then((b) => {
          // Late-loaded sounds are dropped rather than played out of sync.
          void b;
        });
      }
      this.synth(id, vol, pan, rate);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(this.sfxBus);
    src.start();
  }

  /** Queue a voice line. Subtitles are shown even when the audio file is missing. */
  voice(id: string, o: VoiceOptions = {}): void {
    if (!this.entries.has(id)) return;
    const job: VoiceJob = { id, priority: o.priority ?? 1, onEnd: o.onEnd };
    const busy = !!this.voicePlaying || this.voiceQueue.length > 0;
    if (o.dropIfBusy && busy) return;
    if (this.voicePlaying && job.priority > this.voicePlaying.job.priority + 0) {
      // Story lines interrupt chatter.
      if (this.voicePlaying.job.priority === 0) this.stopVoice();
    }
    // Keep the queue short: drop stale chatter.
    this.voiceQueue = this.voiceQueue.filter((j) => j.priority > 0 || job.priority === 0);
    this.voiceQueue.push(job);
    this.voiceQueue.sort((a, b) => b.priority - a.priority);
    if (this.voiceQueue.length > 4) this.voiceQueue.length = 4;
    this.updateVoiceQueue();
  }

  get speaking(): boolean {
    return !!this.voicePlaying;
  }

  stopVoice(): void {
    if (this.voicePlaying?.src) {
      try {
        this.voicePlaying.src.onended = null;
        this.voicePlaying.src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.voicePlaying = null;
    this.unduck();
  }

  clearVoices(): void {
    this.voiceQueue = [];
    this.stopVoice();
  }

  private updateVoiceQueue(): void {
    const nowMs = performance.now();
    if (this.voicePlaying && nowMs >= this.voicePlaying.endAt) {
      const done = this.voicePlaying.job;
      this.voicePlaying = null;
      this.unduck();
      if (done.onEnd) done.onEnd();
    }
    if (this.voicePlaying || this.voiceQueue.length === 0) return;
    const job = this.voiceQueue.shift()!;
    const entry = this.entries.get(job.id);
    if (!entry) return;
    const buf = this.buffers.get(job.id);
    const text = entry.text ?? '';
    const speaker = entry.speaker ?? 'ace';
    if (!buf && this.ctx && !this.missing.has(job.id)) {
      // Not loaded yet: load, then retry (keeps order).
      this.voiceQueue.unshift(job);
      this.voicePlaying = { job: { id: '__loading', priority: job.priority }, src: null, endAt: nowMs + 60000 };
      void this.load(job.id).then(() => {
        if (this.voicePlaying && this.voicePlaying.job.id === '__loading') this.voicePlaying = null;
        this.updateVoiceQueue();
      });
      return;
    }
    let dur = text ? Math.max(1.2, text.length * 0.06) : 1.2;
    let src: AudioBufferSourceNode | null = null;
    if (buf && this.ctx && !this.muted) {
      src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = entry.volume ?? 1;
      src.connect(g).connect(this.voiceBus);
      src.start();
      dur = buf.duration;
      this.duckMusic();
    }
    this.voicePlaying = { job, src, endAt: nowMs + dur * 1000 + 120 };
    if (this.onSubtitle && text) this.onSubtitle(speaker, text, dur);
  }

  private duckMusic(): void {
    if (!this.ctx) return;
    this.duck.gain.setTargetAtTime(0.45, this.ctx.currentTime, 0.12);
  }

  private unduck(): void {
    if (!this.ctx) return;
    this.duck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.4);
  }

  playMusic(id: string | null, fade = 1.6): void {
    if (!this.ctx) return;
    if (this.musicNow && this.musicNow.id === id) return;
    const ctx = this.ctx;
    const old = this.musicNow;
    if (old) {
      old.gain.gain.cancelScheduledValues(ctx.currentTime);
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 4);
      const g = old.gain;
      window.setTimeout(() => {
        try {
          g.disconnect();
        } catch {
          /* ok */
        }
      }, fade * 1000 + 600);
      if (old.timer) window.clearTimeout(old.timer);
    }
    this.musicNow = null;
    if (!id) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.musicBus);
    const holder: { id: string; src: AudioBufferSourceNode | null; gain: GainNode; timer?: number } = { id, src: null, gain };
    this.musicNow = holder;
    const entry = this.entries.get(id);
    void this.load(id).then((buf) => {
      if (!buf || this.musicNow !== holder) return;
      gain.gain.setTargetAtTime(entry?.volume ?? 1, ctx.currentTime, fade / 4);
      // Generated tracks are not sample-accurate loops: chain overlapping
      // copies with a gentle crossfade so the music never "clicks" or stops.
      const xf = Math.min(3, buf.duration * 0.1);
      const startCopy = (when: number) => {
        if (this.musicNow !== holder) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const g = ctx.createGain();
        src.connect(g).connect(gain);
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(1, when + xf);
        const end = when + buf.duration;
        g.gain.setValueAtTime(1, end - xf);
        g.gain.linearRampToValueAtTime(0, end);
        src.start(when);
        src.stop(end + 0.05);
        holder.src = src;
        const next = end - xf;
        holder.timer = window.setTimeout(() => startCopy(next), Math.max(0, (next - ctx.currentTime - 1) * 1000));
      };
      startCopy(ctx.currentTime + 0.05);
    });
  }

  playAmbience(id: string | null, volume = 0.6): void {
    if (!this.ctx) return;
    if (this.ambNow && this.ambNow.id === id) return;
    const ctx = this.ctx;
    const old = this.ambNow;
    if (old) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      const s = old.src;
      if (s) window.setTimeout(() => { try { s.stop(); } catch { /* ok */ } }, 2200);
    }
    this.ambNow = null;
    if (!id) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.sfxBus);
    const holder = { id, src: null as AudioBufferSourceNode | null, gain };
    this.ambNow = holder;
    const entry = this.entries.get(id);
    void this.load(id).then((buf) => {
      if (!buf || this.ambNow !== holder) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      src.start();
      holder.src = src;
      gain.gain.setTargetAtTime(volume * (entry?.volume ?? 1), ctx.currentTime, 0.6);
    });
  }

  // ------------------------------------------------------- synth fallbacks

  private synth(id: string, vol: number, pan: number, rate: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.sfxBus);
    const o = ctx.createOscillator();
    let f0 = 600, f1 = 900, dur = 0.08, type: OscillatorType = 'sine', peak = 0.12;
    if (id.includes('pop')) { f0 = 900; f1 = 1500; dur = 0.06; peak = 0.12; }
    else if (id.includes('boing') || id.includes('bounce')) { f0 = 220; f1 = 520; dur = 0.18; type = 'triangle'; peak = 0.1; }
    else if (id.includes('collect') || id.includes('chime') || id.includes('star')) { f0 = 880; f1 = 1320; dur = 0.25; type = 'triangle'; peak = 0.08; }
    else if (id.includes('shoot') || id.includes('blow')) { f0 = 400; f1 = 250; dur = 0.1; peak = 0.06; }
    else if (id.includes('ui')) { f0 = 700; f1 = 760; dur = 0.04; peak = 0.05; }
    else if (id.includes('step')) { f0 = 120; f1 = 90; dur = 0.05; type = 'triangle'; peak = 0.03; }
    else { f0 = 500; f1 = 700; dur = 0.1; peak = 0.05; }
    o.type = type;
    o.frequency.setValueAtTime(f0 * rate, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, f1 * rate), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak * vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Lines that exist in the manifest matching a prefix (for random cheers). */
  idsWithPrefix(prefix: string): string[] {
    const out: string[] = [];
    for (const e of manifest.entries) if (e.id.startsWith(prefix)) out.push(e.id);
    return out;
  }
}
