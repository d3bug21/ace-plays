import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { AudioManager } from '../audio/AudioManager';
import { Input } from './Input';
import { Player } from './Player';
import { PhysicsWorld } from './Physics';
import { Rng, damp, dampAngle, clamp } from './math';
import { SaveData, type BlasterId, type AbilityId } from './Save';
import { Effects } from '../fx/Particles';
import { Environment } from '../fx/Environment';
import { tickBubbleMaterials, createBubbleMaterial, bubbleGeometry } from '../fx/BubbleMaterial';
import { HitRegistry, type Hittable, type ProjectileKind } from '../gameplay/Hit';
import { ObjectiveTracker } from '../gameplay/Objectives';
import { Projectiles } from '../gameplay/Projectiles';
import { BlasterRig, BLASTERS, blasterDef } from '../gameplay/Blasters';
import { UI, type StageCardData } from '../ui/UI';
import { MenuScene } from '../ui/MenuScene';
import { TouchControls } from '../ui/Touch';
import { RotatePrompt, showInAppTip, showHomeScreenTip } from '../ui/RotatePrompt';
import { detectDevice, type DeviceInfo } from './Device';
import { STAGES, stageIndex } from '../stages';
import type { Stage, StageContext, PooledLight } from '../stages/types';
import { disposeTree } from '../kit/kit';
import type { SfxOptions } from '../audio/AudioManager';

type State = 'boot' | 'title' | 'map' | 'intro' | 'playing' | 'paused' | 'results' | 'ending';

const HIT_CHEERS: Record<ProjectileKind, string[]> = {
  bubble: ['Bubble buddy!', 'Pop-tastic!', 'Floaty!', 'Sweet as!', 'Bubbly!'],
  bigBubble: ['Mega bubble!', 'Whoa, BIG!', 'Up you go!'],
  ball: ['Boing!', 'Boop!', 'Bouncy!', 'Nice bounce!', 'Choice!'],
  glow: ['Glowy!', 'So bright!', 'Shiny!'],
  fizz: ['Fizzy!', 'Tickle tickle!', 'Fizz-tastic!'],
};
const KEYBOARD_NARRATION = new Set(['nar_tut_look', 'nar_tut_move', 'nar_tut_jump', 'nar_tut_fire', 'nar_tut_switch', 'nar_coral_swim']);
const ACE_REACTIONS = ['ace_woohoo', 'ace_yay', 'ace_hehe', 'ace_nice', 'ace_super', 'ace_cool', 'ace_awesome', 'ace_whee'];

class HomeBubble {
  readonly group = new THREE.Group();
  private mat = createBubbleMaterial({ wobble: 0.03, tint: 0xf3e8c8, glow: 0.12 });
  private ring: THREE.Mesh;
  active = true;
  constructor(pos: THREE.Vector3) {
    const b = new THREE.Mesh(bubbleGeometry(), this.mat);
    b.scale.setScalar(1.7);
    b.position.y = 1.7;
    b.renderOrder = 8;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.08, 10, 48), new THREE.MeshStandardMaterial({ color: 0xf0cb6c, emissive: 0xf0cb6c, emissiveIntensity: 0.6 }));
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.y = 0.08;
    // A tiny house icon floating inside so it reads as "go home".
    const house = new THREE.Group();
    const hm = new THREE.MeshStandardMaterial({ color: 0xfbf6ec, emissive: 0xfbf6ec, emissiveIntensity: 0.35 });
    const roof = new THREE.MeshStandardMaterial({ color: 0xe0907c, emissive: 0xe0907c, emissiveIntensity: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), hm);
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.4, 4), roof);
    top.position.y = 0.45;
    top.rotation.y = Math.PI / 4;
    house.add(body, top);
    house.position.y = 1.7;
    house.name = 'house';
    this.group.add(b, this.ring, house);
    this.group.position.copy(pos);
  }
  update(dt: number, t: number): void {
    this.ring.rotation.z += dt * 0.6;
    const house = this.group.getObjectByName('house');
    if (house) {
      house.rotation.y += dt;
      house.position.y = 1.7 + Math.sin(t * 2) * 0.12;
    }
    this.group.scale.setScalar(Math.min(1, this.group.scale.x + dt * 2));
  }
}

export class Game {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly save: SaveData;
  readonly audio = new AudioManager();
  readonly input: Input;
  readonly player: Player;
  readonly physics = new PhysicsWorld();
  readonly fx = new Effects();
  readonly env: Environment;
  readonly hits = new HitRegistry();
  readonly objectives = new ObjectiveTracker();
  readonly projectiles: Projectiles;
  readonly rig = new BlasterRig();
  readonly ui: UI;
  readonly menu = new MenuScene();
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private vmPass: RenderPass;
  state: State = 'boot';
  stage: Stage | null = null;
  private stageId: string | null = null;
  private stageRoot = new THREE.Group();
  private ctx: StageContext | null = null;
  private stageTime = 0;
  private updaters: ((dt: number, t: number) => boolean | void)[] = [];
  private rng = new Rng(1234);
  private last = 0;
  private time = 0;
  private home: HomeBubble | null = null;
  private mainDoneHandled = false;
  private focus: { yaw: number; pitch: number; t: number } | null = null;
  private shakeAmt = 0;
  private fireEnabled = true;
  private lastReaction = 0;
  private lastCheer = 0;
  private breathT = 0;
  private pauseModal: HTMLElement | null = null;
  private challengeBest: number | null = null;
  readonly probe: boolean;
  private lastLockLoss = 0;
  private onTarget = false;
  private firingFlash = 0;
  private ready = false;
  private touch: TouchControls | null = null;
  readonly device: DeviceInfo;
  private rotate: RotatePrompt | null = null;
  private lastRotateLine = -999;
  private uiRoot: HTMLElement;

  constructor(container: HTMLElement, probe: boolean) {
    this.probe = probe;
    this.save = new SaveData(probe);
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    this.canvas.tabIndex = -1;
    container.appendChild(this.canvas);
    const uiRoot = document.createElement('div');
    uiRoot.id = 'ui';
    container.appendChild(uiRoot);
    this.uiRoot = uiRoot;
    this.device = detectDevice();

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: probe });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(this.save.settings.fov, 1, 0.05, 700);
    this.scene.add(this.camera);
    this.env = new Environment(this.scene);
    this.scene.add(this.stageRoot);
    this.scene.add(this.fx.group);
    this.player = new Player(this.camera);
    this.input = new Input(this.canvas);

    this.projectiles = new Projectiles({
      physics: this.physics,
      hits: this.hits,
      fx: this.fx,
      sfx: (id, o) => this.audio.sfx(id, o),
      borrowLight: () => this.env.borrowLight(),
      get underwater() {
        return game().player.mode === 'swim';
      },
      onTargetHit: (kind, target) => this.onTargetHit(kind, target),
    });
    const game = () => this;
    this.scene.add(this.projectiles.group);

    // Composer: world, then the blaster viewmodel on top (own depth), then gentle bloom.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.vmPass = new RenderPass(this.rig.scene, this.camera);
    this.vmPass.clear = false;
    this.vmPass.clearDepth = true;
    this.composer.addPass(this.vmPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.35, 0.6, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.ui = new UI(uiRoot, this.save);
    this.ui.sounds = {
      click: () => this.audio.sfx('sfx_ui_click', { jitter: 0.02 }),
      hover: () => this.audio.sfx('sfx_ui_hover', { jitter: 0.04, volume: 0.6 }),
      back: () => this.audio.sfx('sfx_ui_back'),
    };
    this.ui.onSettingsChanged = () => this.applySettings();
    this.ui.onStarShown = () => this.audio.sfx('sfx_star', { jitter: 0 });
    this.audio.onSubtitle = (who, text, dur) => this.ui.caption(who, text, dur);
    this.audio.muted = probe;

    this.wirePlayerEvents();
    this.wireInput();
    const setupTouch = () => {
      if (this.touch) return;
      this.touch = new TouchControls(uiRoot, this.input);
      this.ui.touchMode = true;
      document.body.classList.add('touch');
      this.ui.onSlotTap = (id) => {
        if (this.state !== 'playing') return;
        if (this.save.hasBlaster(id)) this.rig.select(id);
        else {
          this.ui.nudgeSlot(id);
          this.ui.flashBlasterName('Keep exploring to find this one!');
          this.audio.sfx('sfx_ui_hover', { volume: 0.8 });
        }
      };
      this.touch.onPause = () => this.pause();
      this.touch.onBlasterCycle = () => {
        const owned = BLASTERS.filter((b) => this.save.hasBlaster(b.id));
        const i = owned.findIndex((b) => b.id === this.rig.current);
        if (owned.length > 1) this.rig.select(owned[(i + 1) % owned.length].id);
      };
      this.syncTouch();
    };
    if (!probe && (this.device.touchPrimary || window.matchMedia?.('(pointer: coarse)').matches)) setupTouch();
    // Phones/tablets: friendly "turn sideways" helper (never on desktop or in the desktop app).
    if (!probe && this.device.handheld && !this.device.desktopApp) {
      this.rotate = new RotatePrompt(uiRoot, this.device);
      this.rotate.onShow = () => {
        if (this.state === 'playing') this.pause();
        if (this.audio.ready && this.time - this.lastRotateLine > 25) {
          this.lastRotateLine = this.time;
          this.audio.voice('ace_rotate', { priority: 1, dropIfBusy: true });
        }
      };
    }
    window.addEventListener('touchstart', setupTouch, { once: true, passive: true });
    window.addEventListener('resize', this.queueResize);
    window.addEventListener('orientationchange', this.queueResize);
    document.addEventListener('fullscreenchange', this.queueResize);
    window.visualViewport?.addEventListener('resize', this.queueResize);
    window.visualViewport?.addEventListener('scroll', this.queueResize);
    this.resize();
    this.applySettings();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- setup

  private wirePlayerEvents(): void {
    this.player.onJump = () => this.audio.sfx('sfx_jump', { volume: 0.7 });
    this.player.onLand = (impact) => {
      if (impact > 4) this.audio.sfx('sfx_land', { volume: Math.min(1, impact / 12) });
      if (impact > 9) this.fx.puff(this.player.position.clone().add(new THREE.Vector3(0, 0.05, 0)), 0xe9dfcf, 5, 0.7);
    };
    this.player.onStep = () => {
      const id = this.stage?.info.footstep ?? 'sfx_step_grass';
      this.audio.sfx(id, { volume: 0.55, jitter: 0.1 });
    };
    this.player.onSwimStroke = () => this.audio.sfx('sfx_swim', { volume: 0.5, jitter: 0.1 });
    this.rig.onFire = (id) => {
      this.firingFlash = 0.08;
      const sfx = id === 'bubble' ? 'sfx_bubble_shoot' : id === 'boing' ? 'sfx_ball_shoot' : id === 'fizz' ? 'sfx_fizz_shoot' : 'sfx_glow_shoot';
      this.audio.sfx(sfx, { volume: id === 'fizz' ? 0.35 : 0.75, jitter: 0.08 });
    };
    this.rig.onSwitch = (id) => {
      this.audio.sfx('sfx_ui_click', { rate: 1.3 });
      this.ui.renderBlasters(this.save.progress.blasters, id);
      this.ui.flashBlasterName(blasterDef(id).name);
    };
    this.rig.onChargeStart = () => this.audio.sfx('sfx_charge', { volume: 0.6 });
  }

  private wireInput(): void {
    this.input.onPause = () => this.pause();
    this.input.onPointerLockLost = () => {
      this.lastLockLoss = performance.now();
      if (this.state === 'playing') this.pause();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing' && !this.probe) this.pause();
    });
  }

  applySettings(): void {
    const s = this.save.settings;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.audio.setVolumes(s.musicVolume, s.voiceVolume, s.sfxVolume);
    const dpr = Math.min(window.devicePixelRatio || 1, s.quality === 'fancy' ? 2 : 1);
    this.renderer.setPixelRatio(dpr);
    this.fx.density = s.quality === 'fancy' ? 1 : 0.6;
    this.resize();
    if (this.stage) this.env.apply(this.stage.env, this.scene, this.renderer, s.quality);
    if (!s.hints) this.ui.hint(null);
  }

  private resizeQueued = false;

  /** Coalesce many viewport events into one resize per frame. */
  private queueResize = (): void => {
    if (this.resizeQueued) return;
    this.resizeQueued = true;
    requestAnimationFrame(() => {
      this.resizeQueued = false;
      this.resize();
    });
  };

  /**
   * Size everything from the *visual* viewport, so mobile browser toolbars
   * (URL bar, bottom bar) never push the HUD or touch buttons off-screen.
   */
  private resize(): void {
    const vv = window.visualViewport;
    const w = Math.max(1, Math.round(vv?.width ?? window.innerWidth));
    const h = Math.max(1, Math.round(vv?.height ?? window.innerHeight));
    const root = document.documentElement.style;
    root.setProperty('--app-w', `${w}px`);
    root.setProperty('--app-h', `${h}px`);
    // Layout classes from the *visible* size (media queries only see the layout viewport).
    const b = document.body.classList;
    const landscape = w > h;
    b.toggle('landscape', landscape);
    b.toggle('portrait', !landscape);
    b.toggle('vh-short', landscape ? h <= 520 : h <= 700);
    b.toggle('vh-tiny', landscape ? h < 310 : h < 560);
    const app = this.canvas.parentElement;
    if (app) {
      app.style.left = `${Math.round(vv?.offsetLeft ?? 0)}px`;
      app.style.top = `${Math.round(vv?.offsetTop ?? 0)}px`;
    }
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.menu.resize(w, h);
    this.fx.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
    this.ui?.relayout();
  }

  // --------------------------------------------------------------- flow

  start(): void {
    if (this.probe) return;
    this.state = 'boot';
    this.ui.showBoot(() => {
      this.audio.unlock();
      this.tryLandscapeLock();
      this.audio.setVolumes(this.save.settings.musicVolume, this.save.settings.voiceVolume, this.save.settings.sfxVolume);
      void this.audio.preload(['common']);
      this.audio.playMusic('mus_title');
      window.setTimeout(() => this.audio.voice('nar_title', { priority: 2 }), 500);
      this.showTitle();
    });
  }

  /** Android Chrome & co: go full screen and prefer landscape (silently ignored where unsupported). */
  private tryLandscapeLock(): void {
    const d = this.device;
    if (!d.handheld || d.desktopApp || d.ios || !document.fullscreenEnabled) return;
    try {
      const el = document.documentElement;
      void el
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() => (screen.orientation as unknown as { lock?: (o: string) => Promise<void> })?.lock?.('landscape'))
        .catch(() => undefined);
    } catch {
      /* not supported */
    }
  }

  private inAppTipShown = false;

  showTitle(): void {
    this.state = 'title';
    if (!this.inAppTipShown) {
      this.inAppTipShown = true;
      showInAppTip(this.uiRoot, this.device);
      showHomeScreenTip(this.uiRoot, this.device);
    }
    this.menu.setView('title');
    this.audio.playMusic('mus_title');
    this.audio.playAmbience(null);
    const hasProgress = Object.keys(this.save.progress.stages).length > 0;
    this.ui.showTitle({
      hasProgress,
      onPlay: () => {
        if (!this.save.progress.tutorialSeen && !this.save.stage('meadow').completed) {
          this.audio.voice('nar_welcome', { priority: 2 });
          this.enterStage('meadow');
        } else this.ui.wipe(() => this.showMap());
      },
      onSettings: () => this.ui.showSettings(),
      onControls: () => this.ui.showControls(),
      onReset: () => {
        this.save.resetProgress();
        this.showTitle();
      },
    });
    // Portrait: a browser tip sits in the title's button column (above Play) so it can
    // never cover the logo, Ace or the buttons. Landscape keeps the small corner card.
    // Tips belong to the title screen: they leave with it and sit below modals.
    const tip = this.uiRoot.querySelector(':scope > .inapp-tip');
    const titleScreen = this.uiRoot.querySelector('.screen.title');
    const col = titleScreen?.querySelector('.title-buttons');
    if (tip && titleScreen && col) {
      if (document.body.classList.contains('portrait')) {
        tip.classList.add('in-flow');
        col.prepend(tip);
      } else titleScreen.appendChild(tip);
    }
  }

  private stageCards(): StageCardData[] {
    return STAGES.map((entry, i) => {
      const prog = this.save.stage(entry.id);
      const prev = i > 0 ? STAGES[i - 1] : null;
      const unlocked = i === 0 || this.save.stage(prev!.id).completed;
      return { info: entry.info, objectives: entry.objectives, unlocked, stars: prog.stars, lockedBy: prev ? prev.info.name : null, bestTime: prog.bestTime };
    });
  }

  showMap(): void {
    this.state = 'map';
    this.input.gameActive = false;
    this.input.exitLock();
    this.audio.playMusic('mus_map');
    this.audio.playAmbience(null);
    const cards = this.stageCards();
    // Current = first unlocked & incomplete, else last played.
    const firstOpen = cards.find((c) => c.unlocked && !c.stars[0]);
    const current = firstOpen?.info.id ?? this.save.progress.lastStage ?? cards[0].info.id;
    this.ui.showMap({
      cards,
      current,
      totalStars: this.save.totalStars(),
      onPlay: (id) => this.enterStage(id),
      onBack: () => this.ui.wipe(() => this.showTitle()),
      onSettings: () => this.ui.showSettings(),
    });
    if (Math.random() < 0.5) window.setTimeout(() => this.audio.voice('ace_where_next', { priority: 0, dropIfBusy: true }), 900);
  }

  enterStage(id: string): void {
    const entry = STAGES.find((s) => s.id === id);
    if (!entry) return;
    // Tips never block play.
    this.uiRoot.querySelectorAll('.inapp-tip').forEach((t) => t.remove());
    this.input.gameActive = false;
    void this.ui.wipe(() => {
      this.state = 'intro';
      this.unloadStage();
      this.audio.playMusic(null);
      this.audio.clearVoices();
      const intro = this.ui.showIntro(entry.info, entry.objectives, entry.introColors, () => this.beginPlay());
      // Build the world behind the intro card (next frame so the card paints first).
      window.setTimeout(() => {
        this.loadStage(id);
        void Promise.race([this.audio.preload([id]), new Promise((r) => window.setTimeout(r, 6000))]).then(() => {
          if (this.state === 'intro') intro.ready();
        });
        this.audio.playMusic(entry.info.musicId);
        this.audio.voice(entry.info.introNarration, { priority: 2 });
      }, 60);
    }, entry.introColors[1]);
  }

  private loadStage(id: string): void {
    const entry = STAGES.find((s) => s.id === id)!;
    const stage = entry.factory();
    this.stage = stage;
    this.stageId = id;
    this.stageTime = 0;
    this.updaters = [];
    this.mainDoneHandled = false;
    this.home = null;
    this.focus = null;
    this.fireEnabled = true;
    this.challengeBest = this.save.stage(id).bestTime;
    this.physics.clear();
    this.hits.clear();
    this.projectiles.clear();
    this.projectiles.clearListeners();
    this.fx.clear();
    this.objectives.reset(stage.objectives);
    this.rng = new Rng(1234 + stageIndex(id) * 97);
    this.player.mode = stage.info.mode;
    this.env.apply(stage.env, this.scene, this.renderer, this.save.settings.quality);
    this.fx.underwater = stage.info.mode === 'swim';
    this.audio.setUnderwater(stage.info.mode === 'swim');
    this.bloom.strength = stage.env.bloom.strength;
    this.bloom.radius = stage.env.bloom.radius;
    this.bloom.threshold = stage.env.bloom.threshold;
    this.rig.hemi.color.set(stage.env.hemi.sky);
    this.rig.hemi.groundColor.set(stage.env.hemi.ground);
    this.rig.hemi.intensity = 1.2 + stage.env.hemi.intensity * 0.4;
    this.rig.key.color.set(stage.env.sun.color);
    this.rig.key.intensity = Math.max(0.8, Math.min(2.2, stage.env.sun.intensity * 0.7));
    this.ctx = this.makeContext();
    stage.build(this.ctx);
    this.player.spawn(stage.spawn.pos, stage.spawn.yaw);
    this.rig.bigBubbleEnabled = this.save.hasAbility('bigBubble');
    const firstBlaster = this.save.progress.blasters.includes(this.rig.current) ? this.rig.current : 'bubble';
    this.rig.select(firstBlaster, true);
    this.ui.buildHud(stage.info);
    this.ui.setHudVisible(false);
    this.objectives.onChange((o, done) => this.onObjective(o.def.id, done));
    this.refreshHud();
    this.ui.renderBlasters(this.save.progress.blasters, this.rig.current);
    this.ui.setHelmet(stage.info.mode === 'swim');
    this.save.progress.lastStage = id;
    this.save.saveProgress();
  }

  private unloadStage(): void {
    if (this.stage) {
      try {
        this.stage.dispose();
      } catch (e) {
        console.warn('stage dispose', e);
      }
    }
    this.projectiles.clear();
    this.hits.clear();
    this.fx.clear();
    this.env.releaseAllLights();
    for (const c of [...this.stageRoot.children]) {
      this.stageRoot.remove(c);
      disposeTree(c);
    }
    this.stage = null;
    this.ctx = null;
    this.home?.group.removeFromParent();
    this.home = null;
    this.ui.destroyHud();
    this.audio.playAmbience(null);
  }

  private beginPlay(): void {
    if (!this.stage) return;
    void this.ui.wipe(() => {
      this.ui.clearScreen();
      this.ui.setHudVisible(true);
      this.state = 'playing';
      this.input.gameActive = true;
      this.input.releaseAll();
      this.input.requestLock();
      this.audio.playAmbience(this.stage!.info.ambienceId);
      this.audio.voice(this.stage!.info.introAce, { priority: 1 });
      this.stage!.begin();
    }, '#f3ecdd');
    // Pointer lock needs the click gesture itself.
    this.input.requestLock();
  }

  pause(): void {
    if (this.state !== 'playing' || this.probe) return;
    this.state = 'paused';
    this.input.gameActive = false;
    this.input.releaseAll();
    this.input.exitLock();
    this.audio.sfx('sfx_ui_back');
    const mainDone = this.objectives.mainDone();
    this.pauseModal = this.ui.showPause({
      stageName: this.stage?.info.name ?? '',
      onResume: () => this.resume(),
      onRestart: () => this.stageId && this.enterStage(this.stageId),
      onMap: () => {
        this.unloadForMenu();
        void this.ui.wipe(() => this.showMap());
      },
      onSettings: () => this.ui.showSettings(),
      onControls: () => this.ui.showControls(),
      onFinish: mainDone ? () => this.finishStage() : null,
    });
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.ui.closeAllModals();
    this.pauseModal = null;
    this.state = 'playing';
    this.input.gameActive = true;
    this.input.releaseAll();
    this.input.requestLock();
  }

  private unloadForMenu(): void {
    this.state = 'map';
    this.input.gameActive = false;
    this.unloadStage();
  }

  private finishStage(): void {
    if (!this.stage || !this.stageId) return;
    const id = this.stageId;
    const info = this.stage.info;
    const prog = this.save.stage(id);
    const stars = this.objectives.stars();
    const before = [...prog.stars];
    const merged: [boolean, boolean, boolean] = [stars[0] || before[0], stars[1] || before[1], stars[2] || before[2]];
    const newStars: [boolean, boolean, boolean] = [merged[0] && !before[0], merged[1] && !before[1], merged[2] && !before[2]];
    const firstClear = !prog.completed;
    prog.completed = true;
    prog.stars = merged;
    prog.plays++;
    if (this.challengeBest !== null) prog.bestTime = prog.bestTime === null ? this.challengeBest : Math.min(prog.bestTime, this.challengeBest);
    if (id === 'meadow') this.save.progress.tutorialSeen = true;
    let reward: { title: string; text: string; icon: string } | null = null;
    if (info.reward) {
      let isNew = false;
      if (info.reward.blaster) isNew = this.save.unlockBlaster(info.reward.blaster);
      if (info.reward.ability) isNew = this.save.unlockAbility(info.reward.ability) || isNew;
      if (isNew) reward = { title: info.reward.title, text: info.reward.text, icon: info.reward.blaster ? blasterDef(info.reward.blaster).icon : 'bigbubble' };
    }
    const idx = stageIndex(id);
    const next = STAGES[idx + 1];
    const newWorld = firstClear && next ? next.info.name : null;
    this.save.saveProgress();
    const objectivesSnapshot = this.objectives.list.map((o) => ({ ...o }));
    const shownStars = stars; // show what was earned this run
    const allDone = STAGES.every((s) => this.save.stage(s.id).completed);
    this.input.gameActive = false;
    this.input.exitLock();
    this.state = 'results';
    void this.ui.wipe(() => {
      this.unloadStage();
      this.menu.setView('results', { top: info.accent, bottom: '#f3ecdd' });
      const n = shownStars.filter(Boolean).length;
      this.menu.setAcePose(n === 3 ? 'cheer' : n === 2 ? 'jump' : 'thumbs');
      this.audio.playMusic('mus_results');
      this.audio.clearVoices();
      this.audio.voice('nar_stage_clear', { priority: 2 });
      this.audio.voice(n === 3 ? 'nar_three_stars' : n === 2 ? 'nar_two_stars' : 'nar_one_star', { priority: 2 });
      this.audio.voice(n === 3 ? 'ace_three_stars' : n === 2 ? 'ace_two_stars' : 'ace_one_star', { priority: 1 });
      if (reward) this.audio.voice('ace_newblaster', { priority: 1 });
      if (newWorld) this.audio.voice('nar_new_world', { priority: 1 });
      this.ui.showResults(
        { info, stars: shownStars, newStars, objectives: objectivesSnapshot, reward, newWorld, bestTime: this.save.stage(id).bestTime, hasNext: !!next },
        {
          onNext: () => next && this.enterStage(next.id),
          onReplay: () => this.enterStage(id),
          onMap: () =>
            void this.ui.wipe(() => {
              if (allDone && firstClear && !next) this.showEnding();
              else this.showMap();
            }),
        },
      );
      if (allDone && firstClear && !next) window.setTimeout(() => this.audio.voice('nar_all_done', { priority: 2 }), 6000);
    });
  }

  private showEnding(): void {
    this.state = 'ending';
    this.menu.setView('ending');
    this.audio.playMusic('mus_title');
    this.ui.showEnding(() => void this.ui.wipe(() => this.showMap()));
    this.audio.voice('ace_thankyou', { priority: 1 });
  }

  // ------------------------------------------------------------ context

  private makeContext(): StageContext {
    const g = this;
    const ctx: StageContext = {
      scene: this.scene,
      root: this.stageRoot,
      camera: this.camera,
      player: this.player,
      physics: this.physics,
      fx: this.fx,
      hits: this.hits,
      projectiles: this.projectiles,
      objectives: this.objectives,
      audio: this.audio,
      settings: this.save.settings,
      get rng() {
        return g.rng;
      },
      get time() {
        return g.stageTime;
      },
      probe: this.probe,
      sfx: (id: string, o?: SfxOptions) => this.audio.sfx(id, o),
      say: (id: string, priority = 0) => this.audio.voice(id, { priority, dropIfBusy: priority === 0 }),
      narrate: (id: string, onEnd?: () => void) => {
        // Touch players see touch wording in the hint card; skip spoken mouse/keyboard instructions.
        if (this.touch && KEYBOARD_NARRATION.has(id)) {
          onEnd?.();
          return;
        }
        this.audio.voice(id, { priority: 2, onEnd });
      },
      cheer: (text?: string) => {
        this.ui.cheer(text ?? this.rng.pick(['Yay!', 'Sweet as!', 'Woo-hoo!', 'Nice one!']));
      },
      banner: (t: string, s?: string, sec?: number) => this.ui.banner(t, s, sec),
      hint: (t: string | null, sec?: number) => this.ui.hint(t, sec),
      focusOn: (p: THREE.Vector3, sec = 1.6) => {
        if (this.probe) return;
        const eye = this.player.eyePosition(new THREE.Vector3());
        const d = p.clone().sub(eye);
        const yaw = Math.atan2(-d.x, -d.z);
        const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
        this.focus = { yaw, pitch: clamp(pitch, -1.2, 1.2), t: sec };
      },
      shake: (a: number) => {
        this.shakeAmt = Math.min(0.25, this.shakeAmt + a);
      },
      borrowLight: (): PooledLight | null => this.env.borrowLight(),
      onUpdate: (fn) => {
        this.updaters.push(fn);
      },
      showHomeBubble: (near?: THREE.Vector3) => this.spawnHomeBubble(near),
      hasBlaster: (id: BlasterId) => this.save.hasBlaster(id),
      hasAbility: (id: AbilityId) => this.save.hasAbility(id),
      grantBlaster: (id: BlasterId, select = true) => {
        const isNew = this.save.unlockBlaster(id);
        this.save.saveProgress();
        if (isNew) {
          this.audio.sfx('sfx_unlock');
          this.ui.unlockToast(`New blaster: ${blasterDef(id).name}!`, blasterDef(id).desc, blasterDef(id).icon);
        }
        if (select) this.rig.select(id);
        this.ui.renderBlasters(this.save.progress.blasters, this.rig.current);
      },
      get blaster() {
        return g.rig.current;
      },
      setTimer: (sec: number | null, label?: string) => this.ui.setTimer(sec, label),
      recordChallengeTime: (sec: number) => {
        this.challengeBest = this.challengeBest === null ? sec : Math.min(this.challengeBest, sec);
      },
      setFireEnabled: (on: boolean) => {
        this.fireEnabled = on;
      },
    };
    return ctx;
  }

  private onObjective(id: string, justDone: boolean): void {
    this.refreshHud(id);
    if (!justDone || !this.stage) return;
    const o = this.objectives.get(id)!;
    this.audio.sfx(o.def.kind === 'main' ? 'sfx_objective' : 'sfx_star', { jitter: 0 });
    try {
      this.stage.onObjectiveComplete(id);
    } catch (e) {
      console.warn(e);
    }
    if (o.def.kind === 'treasure') {
      this.ui.banner('All treasures found!', 'You earned a star!', 2.6);
      this.audio.voice('nar_treasures', { priority: 1 });
    }
    if (o.def.kind === 'main') {
      const next = this.objectives.current();
      if (next) {
        window.setTimeout(() => {
          if (this.state === 'playing' || this.state === 'paused') this.ui.banner(next.def.label, next.def.hint ?? 'Next goal', 2.8);
        }, 1400);
      }
    }
    if (this.objectives.mainDone() && !this.mainDoneHandled) {
      this.mainDoneHandled = true;
      window.setTimeout(() => {
        if (!this.stage) return;
        this.ui.banner('Stage clear!', 'Explore more, or hop into the Home Bubble', 3.5);
        this.audio.voice('nar_home_bubble', { priority: 2 });
        this.spawnHomeBubble();
      }, 2600);
    }
  }

  private refreshHud(flashId?: string): void {
    if (!this.stage) return;
    this.ui.renderObjectives(this.stage.info.name, this.stage.info.icon, this.objectives.list, flashId);
    this.ui.setStars(this.objectives.stars());
  }

  private spawnHomeBubble(near?: THREE.Vector3): void {
    if (this.home || !this.stage) return;
    const fwd = this.player.moveForward(new THREE.Vector3());
    fwd.y = 0;
    if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1);
    fwd.normalize();
    const p = near ? near.clone() : this.player.position.clone().addScaledVector(fwd, 6);
    this.physics.clampBounds(p, 2);
    if (this.player.mode === 'walk') p.y = this.physics.groundHeight(p.x, p.z);
    else p.y = Math.max(this.physics.groundHeight(p.x, p.z) + 0.5, this.player.position.y - 1);
    this.home = new HomeBubble(p);
    this.home.group.scale.setScalar(0.01);
    this.stageRoot.add(this.home.group);
    this.audio.sfx('sfx_home_bubble');
    this.fx.sparkle(p.clone().add(new THREE.Vector3(0, 1.7, 0)), 24, [0xffe7a8, 0xfff8e8], 1.6);
    this.refreshHud();
  }

  private onTargetHit(kind: ProjectileKind, target: Hittable): void {
    if ((target.aimAssist ?? 1) <= 0) return;
    const now = this.time;
    if (now - this.lastCheer > 1.1 && kind !== 'fizz') {
      this.lastCheer = now;
      if (this.rng.chance(0.55)) this.ui.cheer(this.rng.pick(HIT_CHEERS[kind]));
    }
    if (now - this.lastReaction > 7 && this.rng.chance(0.3) && kind !== 'fizz') {
      this.lastReaction = now;
      this.audio.voice(this.rng.pick(ACE_REACTIONS), { priority: 0, dropIfBusy: true });
    }
  }

  // --------------------------------------------------------------- loop

  private lastTouchState: State | null = null;

  private frame(now: number): void {
    requestAnimationFrame((t) => this.frame(t));
    if (this.touch && this.lastTouchState !== this.state) {
      this.lastTouchState = this.state;
      this.syncTouch();
    }
    const dt = this.last ? Math.min(0.05, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    this.last = now;
    this.time += dt;
    tickBubbleMaterials(this.time);
    try {
      if (this.state === 'playing' || this.state === 'paused' || (this.state === 'intro' && this.stage)) {
        if (this.state === 'playing') this.updatePlaying(dt);
        if (this.state !== 'intro') this.renderWorld();
      } else if (this.state === 'title' || this.state === 'results' || this.state === 'ending' || this.state === 'boot' || this.state === 'map') {
        if (this.state !== 'map') {
          this.menu.update(dt);
          this.renderer.setRenderTarget(null);
          this.renderer.render(this.menu.scene, this.menu.camera);
        }
      }
      this.audio.updateListener(this.camera.position, this.player.viewForward(new THREE.Vector3()), this.player.viewRight(new THREE.Vector3()));
    } catch (e) {
      console.error(e);
    }
    this.input.endFrame();
  }

  private syncTouch(): void {
    if (!this.touch) return;
    this.touch.setVisible(this.state === 'playing');
    this.touch.setSwimming(this.player.mode === 'swim');
  }

  private updatePlaying(dt: number): void {
    const stage = this.stage!;
    this.stageTime += dt;
    const t = this.stageTime;
    const input = this.input;
    const s = this.save.settings;

    // Fire-stick edge-turn adds look before the look step consumes it.
    this.touch?.update(dt);
    // Look (or a short cinematic glance).
    if (this.focus) {
      this.focus.t -= dt;
      this.player.yaw = dampAngle(this.player.yaw, this.focus.yaw, 4, dt);
      this.player.pitch = damp(this.player.pitch, this.focus.pitch, 4, dt);
      this.player.frozen = true;
      if (this.focus.t <= 0) {
        this.focus = null;
        this.player.frozen = false;
      }
    } else this.player.look(input, s, dt);

    // Blaster switching.
    const owned = BLASTERS.filter((b) => this.save.hasBlaster(b.id));
    const pick = (id: BlasterId) => {
      if (this.save.hasBlaster(id)) this.rig.select(id);
      else this.ui.flashBlasterName('Not found yet!');
    };
    if (input.wasPressed('blaster1')) pick('bubble');
    if (input.wasPressed('blaster2')) pick('boing');
    if (input.wasPressed('blaster3')) pick('fizz');
    if (input.wasPressed('blaster4')) pick('glow');
    let cycle = 0;
    if (input.wasPressed('nextBlaster')) cycle = 1;
    if (input.wasPressed('prevBlaster')) cycle = -1;
    if (input.wheel) cycle = input.wheel > 0 ? 1 : -1;
    if (cycle && owned.length > 1) {
      const i = owned.findIndex((b) => b.id === this.rig.current);
      this.rig.select(owned[(i + cycle + owned.length) % owned.length].id);
    }
    if (input.wasPressed('hints')) {
      s.hints = !s.hints;
      this.save.saveSettings();
      this.ui.flashBlasterName(s.hints ? 'Hints on' : 'Hints off');
      if (!s.hints) this.ui.hint(null);
    }

    this.player.update(dt, input, this.physics, s);
    this.rig.bigBubbleEnabled = this.save.hasAbility('bigBubble');
    this.rig.update(dt, t, this.camera, this.player, input, this.projectiles, this.hits, this.fireEnabled && !this.focus);
    this.projectiles.update(dt, t);
    stage.update(dt, t);
    for (let i = this.updaters.length - 1; i >= 0; i--) {
      if (this.updaters[i](dt, t) === false) this.updaters.splice(i, 1);
    }
    if (this.home) {
      this.home.update(dt, t);
      const hp = this.home.group.position;
      const pp = this.player.position;
      if (Math.hypot(hp.x - pp.x, hp.z - pp.z) < 1.9 && Math.abs(pp.y + 0.8 - (hp.y + 1.7)) < 2.4 && this.state === 'playing') {
        this.home = null;
        this.audio.sfx('sfx_whoosh');
        this.finishStage();
        return;
      }
    }

    // Swimming breath bubbles.
    if (this.player.mode === 'swim') {
      this.breathT -= dt;
      if (this.breathT <= 0) {
        this.breathT = 2.6 + Math.random() * 1.5;
        const p = this.player.eyePosition(new THREE.Vector3()).addScaledVector(this.player.viewForward(new THREE.Vector3()), 0.6);
        p.y -= 0.25;
        this.fx.breath(p);
      }
    }

    // Camera shake (tiny) after the body has placed the camera.
    if (this.shakeAmt > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmt * 0.3;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmt * 0.3;
      this.shakeAmt = damp(this.shakeAmt, 0, 6, dt);
    }

    this.fx.update(dt, t);
    this.env.update(dt, t, this.camera, this.player.position);

    // Crosshair feedback.
    const aim = this.hits.aimTarget(this.camera.position, this.player.viewForward(new THREE.Vector3()), null, 40, 3.5);
    this.onTarget = !!aim;
    this.firingFlash = Math.max(0, this.firingFlash - dt);
    this.ui.setCrosshair(this.onTarget, aim && aim.dist < 22 ? aim.target.label ?? null : null, this.rig.charging01, this.firingFlash > 0);
    this.ui.setClickToLook(!input.pointerLocked && !this.probe && !input.usedLook && !this.touch);
  }

  private renderWorld(): void {
    if (this.save.settings.quality === 'fancy') {
      this.composer.render();
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.autoClear = true;
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.rig.scene, this.camera);
      this.renderer.autoClear = true;
    }
  }

  // --------------------------------------------------------------- probe

  /** Deterministic reset into the real production stage + controls (directional probe). */
  probeReset(): void {
    this.ui.closeAllModals();
    this.ui.clearScreen();
    if (this.stageId !== 'meadow' || !this.stage) {
      this.unloadStage();
      this.loadStage('meadow');
    }
    this.ui.setHudVisible(true);
    this.state = 'playing';
    this.input.gameActive = true;
    this.input.releaseAll();
    this.focus = null;
    this.player.frozen = false;
    this.player.mode = 'walk';
    // Open lawn spawn, facing a non-axis direction so world axes cannot hide a sign error.
    const spawn = this.stage!.spawn;
    this.player.spawn(spawn.pos.clone(), 0.6, 0);
    this.ready = true;
  }

  probeSample(): { frame: string; measurement: 'position'; position: [number, number, number]; forward: [number, number, number]; right: [number, number, number] } {
    const p = this.player.position;
    const f = this.player.moveForward(new THREE.Vector3());
    const r = this.player.viewRight(new THREE.Vector3());
    return {
      frame: this.player.mode === 'swim' ? 'player-camera-swim' : 'player-camera',
      measurement: 'position',
      position: [p.x, p.y, p.z],
      forward: [f.x, f.y, f.z],
      right: [r.x, r.y, r.z],
    };
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** Dev helper: jump straight into a stage (?stage=id). */
  devEnter(id: string): void {
    this.audio.unlock();
    this.loadStage(id);
    this.ui.setHudVisible(true);
    this.state = 'playing';
    this.input.gameActive = true;
    this.audio.playMusic(this.stage!.info.musicId);
    this.audio.playAmbience(this.stage!.info.ambienceId);
    this.stage!.begin();
  }
}
