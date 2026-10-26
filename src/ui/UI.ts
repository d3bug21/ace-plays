import { icon, renderKeys, escapeHtml, inputIcon } from './icons';
import type { SaveData, BlasterId, Settings } from '../core/Save';
import type { StageInfo, ObjectiveDef } from '../stages/types';
import type { ObjectiveState } from '../gameplay/Objectives';
import { BLASTERS } from '../gameplay/Blasters';

type Fn = () => void;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export interface StageCardData {
  info: StageInfo;
  objectives: ObjectiveDef[];
  unlocked: boolean;
  stars: boolean[];
  lockedBy: string | null;
  bestTime: number | null;
}

export interface ResultsData {
  info: StageInfo;
  stars: [boolean, boolean, boolean];
  newStars: [boolean, boolean, boolean];
  objectives: ObjectiveState[];
  reward: { title: string; text: string; icon: string } | null;
  newWorld: string | null;
  bestTime: number | null;
  hasNext: boolean;
}

/** Sound hooks for UI feedback. */
export interface UISounds {
  click(): void;
  hover(): void;
  back(): void;
}

export class UI {
  readonly root: HTMLElement;
  private screen: HTMLElement | null = null;
  private modalStack: HTMLElement[] = [];
  hud: HTMLElement | null = null;
  private hudEls: Record<string, HTMLElement> = {};
  private captionTimer = 0;
  private hintTimer = 0;
  private bannerTimer = 0;
  private blasterNameTimer = 0;
  private save: SaveData;
  sounds: UISounds | null = null;
  /** Touch-screen players get touch wording in hints. */
  touchMode = false;
  onSettingsChanged: (() => void) | null = null;
  /** Desktop (Electron) bridge if present. */
  private desktop = (window as unknown as { acePlaysDesktop?: { isDesktop: boolean; toggleFullscreen(): Promise<boolean>; quit(): Promise<void> } }).acePlaysDesktop;

  constructor(root: HTMLElement, save: SaveData) {
    this.root = root;
    this.save = save;
    // Global keyboard handling for menus (Escape closes the top modal).
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      const top = this.modalStack[this.modalStack.length - 1];
      if (top && top.dataset.escClose === '1') {
        const opened = Number(top.dataset.openedAt || 0);
        if (performance.now() - opened < 350) return; // ignore the key that opened it
        e.preventDefault();
        (top as unknown as { _close?: Fn })._close?.();
      }
    });
  }

  get isDesktop(): boolean {
    return !!this.desktop?.isDesktop;
  }

  private bindSounds(container: HTMLElement): void {
    container.querySelectorAll<HTMLElement>('button, .map-node').forEach((b) => {
      b.addEventListener('mouseenter', () => this.sounds?.hover());
      b.addEventListener('click', () => this.sounds?.click());
    });
  }

  // ------------------------------------------------------------ screens

  private setScreen(s: HTMLElement | null): void {
    const old = this.screen;
    if (old) {
      old.classList.remove('show');
      window.setTimeout(() => old.remove(), 380);
    }
    this.screen = s;
    if (s) {
      this.root.appendChild(s);
      requestAnimationFrame(() => s.classList.add('show'));
      this.bindSounds(s);
    }
  }

  clearScreen(): void {
    this.setScreen(null);
  }

  showBoot(onStart: Fn): void {
    const s = el('div', 'screen boot');
    s.innerHTML = `<div class="logo-small">Ace Plays<span style="color:var(--butter)">!</span></div><div class="tap">Click anywhere to start</div><div class="loading">Bubbles, bouncy balls and friendly creatures</div>`;
    let started = false;
    const go = () => {
      if (started) return;
      started = true;
      s.removeEventListener('click', go);
      window.removeEventListener('keydown', key);
      onStart();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') go();
    };
    // Start on 'click' (not pointerdown): a touch tap's follow-up click must not
    // land on the freshly shown title's Play button and skip the title screen.
    s.addEventListener('click', go);
    window.addEventListener('keydown', key);
    this.setScreen(s);
  }

  showTitle(o: { onPlay: Fn; onSettings: Fn; onControls: Fn; hasProgress: boolean; onReset: Fn }): void {
    const s = el('div', 'screen title');
    s.innerHTML = `
      <div class="logo">Ace Plays<span class="bang">!</span><span class="sub">A bubbly, bouncy adventure</span></div>
      <div class="title-buttons">
        <button class="btn primary big" data-a="play">${icon('play')} ${o.hasProgress ? 'Keep Playing' : 'Play'}</button>
        <div class="title-row">
          <button class="btn" data-a="controls">${icon(this.touchMode ? 'tap' : 'keyboard')} How to Play</button>
          <button class="btn" data-a="settings">${icon('gear')} Settings</button>
          ${this.isDesktop ? `<button class="btn" data-a="quit">${icon('door')} Quit</button>` : ''}
        </div>
      </div>
      <div class="corner">${o.hasProgress ? `<button class="btn small ghost" data-a="reset">${icon('retry')} New game</button>` : ''}</div>
      <div class="app-version">v${__APP_VERSION__}</div>`;
    s.querySelector('[data-a=play]')!.addEventListener('click', o.onPlay);
    s.querySelector('[data-a=settings]')!.addEventListener('click', o.onSettings);
    s.querySelector('[data-a=controls]')!.addEventListener('click', o.onControls);
    s.querySelector('[data-a=quit]')?.addEventListener('click', () => void this.desktop?.quit());
    s.querySelector('[data-a=reset]')?.addEventListener('click', () => {
      this.confirm('Start a brand new adventure?', 'Your stars and blasters will be reset.', 'Start fresh', o.onReset);
    });
    this.setScreen(s);
    window.setTimeout(() => (s.querySelector('[data-a=play]') as HTMLElement | null)?.focus(), 400);
  }

  private mapRelayout: (() => void) | null = null;

  /** Re-fit layout-sensitive screens after a viewport change. */
  relayout(): void {
    this.mapRelayout?.();
  }

  showMap(o: { cards: StageCardData[]; current: string; totalStars: number; onPlay: (id: string) => void; onBack: Fn; onSettings: Fn }): void {
    const s = el('div', 'screen map');
    s.innerHTML = `<div class="map-frame">${mapArt(o.cards)}</div>
      <div class="map-top">
        <button class="icon-btn" data-a="back" aria-label="Back to title">${icon('back')}</button>
        <div class="map-title">${icon('map')} <span class="mt-long">Adventure Map</span><span class="mt-short">Map</span></div>
        <div class="map-top-right">
          <div class="star-total" title="Stars collected">${icon('star')} <span>${o.totalStars} / ${o.cards.length * 3}</span></div>
          <button class="icon-btn" data-a="settings" aria-label="Settings">${icon('gear')}</button>
        </div>
      </div>`;
    const frame = s.querySelector('.map-frame') as HTMLElement;
    const header = s.querySelector('.map-top') as HTMLElement;
    const card = el('div', 'panel stage-card');
    s.appendChild(card);
    const nodes: HTMLElement[] = [];
    let selIndex = 0;
    const select = (c: StageCardData, focusPlay = false) => {
      selIndex = o.cards.indexOf(c);
      nodes.forEach((n) => n.classList.toggle('sel', n.dataset.id === c.info.id));
      card.style.setProperty('--card-accent', c.info.accent);
      const goals = c.objectives.filter((x) => x.kind === 'main');
      const tre = c.objectives.find((x) => x.kind === 'treasure');
      const ch = c.objectives.find((x) => x.kind === 'challenge');
      const li = (got: boolean, ic: string, text: string) => `<li class="${got ? 'got' : ''}" title="${escapeHtml(text)}" aria-label="${escapeHtml(text)}${got ? ' (star earned)' : ''}">${got ? icon('star') : icon('starEmpty')}<span>${icon(ic).replace('<svg', '<svg class="li-ic" style="color:' + c.info.accent + '"')}${escapeHtml(text)}</span></li>`;
      card.innerHTML = `
        <div class="card-head">
          <button class="icon-btn card-nav" data-a="prev" aria-label="Previous world">${icon('back')}</button>
          <h2>${icon(c.info.icon)} <span>${escapeHtml(c.info.name)}</span></h2>
          <button class="icon-btn card-nav next" data-a="next" aria-label="Next world">${icon('back')}</button>
        </div>
        <div class="card-body">
          ${c.unlocked ? '' : `<div class="lock-note">${icon('lock')} <span>Finish ${escapeHtml(c.lockedBy ?? 'the last world')} to open this world!</span></div>`}
          <p class="tagline">${escapeHtml(c.info.tagline)}</p>
          <ul>
            ${li(c.stars[0], goals[goals.length - 1]?.icon ?? 'flag', 'Finish the adventure')}
            ${tre ? li(c.stars[1], tre.icon, tre.label) : ''}
            ${ch ? li(c.stars[2], ch.icon, ch.label + (c.bestTime ? ` (best ${c.bestTime.toFixed(1)}s)` : '')) : ''}
          </ul>
        </div>
        <div class="card-actions"><button class="btn primary" data-a="go" ${c.unlocked ? '' : 'disabled'}>${icon(c.unlocked ? 'play' : 'lock')} ${c.unlocked ? (c.stars[0] ? 'Play again' : "Let's go!") : 'Locked'}</button></div>`;
      card.classList.add('show');
      const go = card.querySelector('[data-a=go]') as HTMLButtonElement;
      go.addEventListener('click', () => c.unlocked && o.onPlay(c.info.id));
      go.addEventListener('mouseenter', () => this.sounds?.hover());
      go.addEventListener('click', () => this.sounds?.click());
      const step = (d: number) => {
        this.sounds?.click();
        select(o.cards[(selIndex + d + o.cards.length) % o.cards.length], false);
      };
      card.querySelector('[data-a=prev]')!.addEventListener('click', () => step(-1));
      card.querySelector('[data-a=next]')!.addEventListener('click', () => step(1));
      if (focusPlay && c.unlocked) go.focus({ preventScroll: true });
      token.style.left = `${c.info.map.x}%`;
      token.style.top = `${c.info.map.y}%`;
      layout();
    };
    const token = el('div', 'ace-token', aceTokenSvg());
    for (const c of o.cards) {
      const n = el('button', `map-node ${c.unlocked ? '' : 'locked'} ${c.info.id === o.current ? 'current' : ''}`);
      n.dataset.id = c.info.id;
      n.style.left = `${c.info.map.x}%`;
      n.style.top = `${c.info.map.y}%`;
      n.style.setProperty('--node-accent', c.info.accent);
      n.setAttribute('aria-label', `${c.info.name}${c.unlocked ? '' : ' (locked)'}`);
      n.innerHTML = `<div class="disc">${c.unlocked ? icon(c.info.icon) : icon('lock')}</div><div class="label">${escapeHtml(c.info.name)}</div><div class="stars">${c.stars.map((x) => (x ? icon('star') : icon('starEmpty'))).join('')}</div>`;
      n.querySelectorAll('.stars svg').forEach((sv) => ((sv as SVGElement).style.color = 'var(--star)'));
      n.addEventListener('click', () => select(c, true));
      n.addEventListener('dblclick', () => c.unlocked && o.onPlay(c.info.id));
      frame.appendChild(n);
      nodes.push(n);
    }
    frame.appendChild(token);
    s.querySelector('[data-a=back]')!.addEventListener('click', o.onBack);
    s.querySelector('[data-a=settings]')!.addEventListener('click', o.onSettings);

    // Fit the map into the space the card and header leave free, so no node,
    // label or star row is ever covered (any viewport, any selection).
    const safe = el('div', 'safe-probe');
    s.appendChild(safe);
    const layout = () => {
      const W = s.clientWidth;
      const H = s.clientHeight;
      if (!W || !H) return;
      const cs = getComputedStyle(safe);
      const sl = parseFloat(cs.paddingLeft) || 0;
      const sr = parseFloat(cs.paddingRight) || 0;
      const sb = parseFloat(cs.paddingBottom) || 0;
      const top = header.offsetTop + header.offsetHeight + 6;
      const landscape = W > H;
      let ax: number, ay: number, aw: number, ah: number;
      if (landscape) {
        const cw = Math.round(Math.min(360, Math.max(232, W * 0.33)));
        // Side column: as tall as its content, never taller than the free height.
        Object.assign(card.style, { left: 'auto', right: `${sr + 10}px`, top: `${top}px`, bottom: 'auto', width: `${cw}px`, maxHeight: `${H - top - sb - 10}px` });
        card.classList.add('side');
        ax = sl + 8;
        ay = top;
        aw = W - cw - sl - sr - 30;
        ah = H - top - sb - 8;
      } else {
        Object.assign(card.style, { left: `${sl + 10}px`, right: `${sr + 10}px`, top: 'auto', bottom: `${sb + 10}px`, width: 'auto', maxHeight: `${Math.round(H * 0.46)}px` });
        card.classList.remove('side');
        ax = sl + 6;
        ay = top;
        aw = W - sl - sr - 12;
        ah = H - top - card.offsetHeight - sb - 18;
      }
      // Fit so every node *block* (disc + label + stars, centred on its anchor) lies
      // inside the free area: the art may extend under the card, nodes never do.
      const xs = o.cards.map((c) => c.info.map.x / 100);
      const ys = o.cards.map((c) => c.info.map.y / 100);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const fit = (bw0: number, bhExtra: number) => {
        let disc = 64;
        let fw = 0;
        for (let k = 0; k < 3; k++) {
          const bw = Math.max(disc, bw0);
          const bh = disc + bhExtra;
          const byW = (aw - bw - 8) / (x1 - x0);
          const byH = ((ah - bh - 8) / (y1 - y0)) * (5 / 3);
          fw = Math.max(140, Math.min(byW, byH, 1500));
          disc = Math.round(Math.max(44, Math.min(88, fw * 0.085)));
        }
        // Would any two node blocks overlap at this size?
        const bw = Math.max(disc, bw0) + 4;
        const bh = disc + bhExtra + 4;
        let crowded = false;
        for (let i = 0; i < xs.length; i++)
          for (let j = i + 1; j < xs.length; j++)
            if (Math.abs(xs[i] - xs[j]) * fw < bw && Math.abs(ys[i] - ys[j]) * fw * 0.6 < bh) crowded = true;
        return { disc, fw, crowded };
      };
      const apply = (ff: { disc: number; fw: number }, mode: 'full' | 'names' | 'discs') => {
        frame.classList.toggle('compact-nodes', mode === 'discs');
        frame.classList.toggle('names-only', mode === 'names');
        frame.style.setProperty('--disc', `${ff.disc}px`);
        frame.style.width = `${ff.fw}px`;
        frame.style.height = `${ff.fw * 0.6}px`;
        frame.style.left = `${ax + aw / 2 - ((x0 + x1) / 2) * ff.fw}px`;
        frame.style.top = `${ay + ah / 2 - ((y0 + y1) / 2) * ff.fw * 0.6}px`;
      };
      const touching = () => {
        const boxes = nodes.map((n) => n.getBoundingClientRect());
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i], c = boxes[j];
            if (a.left < c.right + 2 && c.left < a.right + 2 && a.top < c.bottom + 2 && c.top < a.bottom + 2) return true;
          }
        return false;
      };
      // Full nodes (disc + name + stars) -> names without stars -> discs only, using
      // the real measured boxes; the card always shows the full details.
      let f = fit(110, 56);
      apply(f, 'full');
      if (touching()) {
        f = fit(110, 30);
        apply(f, 'names');
        if (touching()) {
          f = fit(46, 2);
          apply(f, 'discs');
        }
      }
      const { disc, fw } = f;
      void disc;
      const fh = fw * 0.6;
      frame.style.setProperty('--disc', `${disc}px`);
      frame.style.width = `${fw}px`;
      frame.style.height = `${fh}px`;
      frame.style.left = `${ax + aw / 2 - ((x0 + x1) / 2) * fw}px`;
      // Card: drop the flavour tagline when space is tight so goals + lock reason always fit.
      const body = card.querySelector('.card-body') as HTMLElement | null;
      if (body) {
        card.classList.remove('tight', 'tighter');
        if (body.scrollHeight > body.clientHeight + 1) card.classList.add('tight');
        // Very short screens: goals become a row of star + icon chips (each keeps its label for screen readers).
        if (body.scrollHeight > body.clientHeight + 1) card.classList.add('tighter');
      }
      frame.style.top = `${ay + ah / 2 - ((y0 + y1) / 2) * fh}px`;
      frame.style.transform = 'none';
    };
    this.mapRelayout = () => {
      if (!s.isConnected) {
        this.mapRelayout = null;
        return;
      }
      layout();
    };
    this.setScreen(s);
    const cur = o.cards.find((c) => c.info.id === o.current) ?? o.cards[0];
    select(cur, true);
    requestAnimationFrame(layout);
  }

  showIntro(info: StageInfo, objectives: ObjectiveDef[], colors: [string, string], onGo: Fn): { ready: () => void } {
    const s = el('div', 'screen intro');
    s.style.setProperty('--intro-a', colors[0]);
    s.style.setProperty('--intro-b', colors[1]);
    const mains = objectives.filter((o) => o.kind === 'main');
    const goals = [mains[mains.length - 1], ...objectives.filter((o) => o.kind !== 'main')].filter(Boolean);
    s.innerHTML = `
      <div class="world">A new adventure</div>
      <h1>${icon(info.icon)}${escapeHtml(info.name)}</h1>
      <p>${escapeHtml(info.tagline)}</p>
      <div class="goals">${goals.map((g) => `<div class="goal">${icon(inputIcon(g.icon, this.touchMode))} ${escapeHtml(g.label)}</div>`).join('')}</div>
      <div class="go"><span class="loading-dots">Getting everything ready...</span></div>`;
    this.setScreen(s);
    return {
      ready: () => {
        const go = s.querySelector('.go') as HTMLElement;
        go.innerHTML = `<button class="btn primary big" data-a="go">${icon('play')} Let's go!</button>`;
        const b = go.querySelector('button')!;
        b.addEventListener('click', onGo);
        b.addEventListener('mouseenter', () => this.sounds?.hover());
        b.focus();
        const key = (e: KeyboardEvent) => {
          if (e.code === 'Enter' || e.code === 'Space') {
            window.removeEventListener('keydown', key);
            e.preventDefault();
            onGo();
          }
        };
        window.addEventListener('keydown', key);
        b.addEventListener('click', () => window.removeEventListener('keydown', key));
      },
    };
  }

  showResults(r: ResultsData, o: { onNext: Fn; onReplay: Fn; onMap: Fn }): void {
    const s = el('div', 'screen results');
    const n = r.stars.filter(Boolean).length;
    const title = n === 3 ? 'Superstar!' : n === 2 ? 'Fantastic!' : 'Stage clear!';
    const labels = ['Adventure done', r.objectives.find((x) => x.def.kind === 'treasure')?.def.label ?? 'Treasures', r.objectives.find((x) => x.def.kind === 'challenge')?.def.label ?? 'Challenge'];
    s.innerHTML = `
      <div class="panel res-panel">
        <h2>${title}</h2>
        <p class="res-sub">${escapeHtml(r.info.name)}</p>
        <div class="res-stars">${r.stars.map((g, i) => `<div class="rs" data-i="${i}">${icon('star')}<span>${escapeHtml(labels[i])}</span></div>`).join('')}</div>
        <ul class="res-list">${r.objectives
          .filter((x) => x.def.kind !== 'main')
          .map((x) => `<li>${x.done ? icon('check') : icon('dot')}<span>${escapeHtml(x.def.label)} - ${x.count}/${x.def.target}${x.def.kind === 'challenge' && r.bestTime ? ` · best ${r.bestTime.toFixed(1)}s` : ''}</span></li>`)
          .join('')}</ul>
        ${r.reward ? `<div class="res-reward">${icon(r.reward.icon)}<div><b>${escapeHtml(r.reward.title)}</b><span>${escapeHtml(r.reward.text)}</span></div></div>` : ''}
        ${r.newWorld ? `<div class="res-reward" style="animation-delay:1.8s">${icon('map')}<div><b>New world unlocked!</b><span>${escapeHtml(r.newWorld)} is waiting on the map.</span></div></div>` : ''}
        <div class="res-actions">
          <button class="btn" data-a="replay">${icon('retry')} Play again</button>
          <button class="btn" data-a="map">${icon('map')} Map</button>
          ${r.hasNext ? `<button class="btn primary" data-a="next">${icon('play')} Next world</button>` : ''}
        </div>
      </div>`;
    s.querySelectorAll('.res-stars svg').forEach((sv) => ((sv as SVGElement).style.color = 'var(--star)'));
    s.querySelector('[data-a=replay]')!.addEventListener('click', o.onReplay);
    s.querySelector('[data-a=map]')!.addEventListener('click', o.onMap);
    s.querySelector('[data-a=next]')?.addEventListener('click', o.onNext);
    this.setScreen(s);
    // Stars pop in one by one.
    r.stars.forEach((g, i) => {
      if (!g) return;
      window.setTimeout(() => {
        s.querySelector(`.rs[data-i="${i}"]`)?.classList.add('got');
        this.onStarShown?.(i);
      }, 600 + i * 450);
    });
    window.setTimeout(() => {
      ((s.querySelector('[data-a=next]') ?? s.querySelector('[data-a=map]')) as HTMLElement | null)?.focus({ preventScroll: true });
      const panel = s.querySelector('.res-panel') as HTMLElement | null;
      if (panel) panel.scrollTop = 0;
    }, 500);
  }

  onStarShown: ((i: number) => void) | null = null;
  /** Touch: a blaster slot was tapped. */
  onSlotTap: ((id: BlasterId) => void) | null = null;

  /** Gentle wobble on a locked slot (no error tone). */
  nudgeSlot(id: BlasterId): void {
    const el = this.hudEls['blaster-bar']?.querySelector(`.bslot[data-id="${id}"]`) as HTMLElement | null;
    if (!el) return;
    el.classList.remove('nudge');
    void el.offsetWidth;
    el.classList.add('nudge');
  }

  showEnding(onDone: Fn): void {
    this.setHudVisible(false);
    const s = el('div', 'screen ending');
    s.innerHTML = `<h1>${icon('trophy').replace('<svg', '<svg style="width:1em;height:1em;vertical-align:-0.12em;color:var(--butter)"')} You did it!</h1><p>Ace visited every world and made so many new friends. Thanks for playing!</p><button class="btn primary big">${icon('map')} Back to the map</button>`;
    s.querySelector('button')!.addEventListener('click', onDone);
    this.setScreen(s);
  }

  // ------------------------------------------------------------- modals

  private openModal(inner: HTMLElement, escClose: boolean, onClose?: Fn): HTMLElement {
    const bg = el('div', 'modal-bg');
    bg.appendChild(inner);
    bg.dataset.escClose = escClose ? '1' : '0';
    bg.dataset.openedAt = String(performance.now());
    (bg as unknown as { _close: Fn })._close = () => {
      this.closeModal(bg);
      onClose?.();
    };
    this.root.appendChild(bg);
    this.modalStack.push(bg);
    this.bindSounds(bg);
    window.setTimeout(() => (inner.querySelector('input, button') as HTMLElement | null)?.focus({ preventScroll: true }), 60);
    return bg;
  }

  closeModal(bg: HTMLElement): void {
    const i = this.modalStack.indexOf(bg);
    if (i >= 0) this.modalStack.splice(i, 1);
    bg.remove();
  }

  closeAllModals(): void {
    for (const m of [...this.modalStack]) m.remove();
    this.modalStack.length = 0;
  }

  get modalOpen(): boolean {
    return this.modalStack.length > 0;
  }

  showPause(o: { onResume: Fn; onRestart: Fn; onMap: Fn; onSettings: Fn; onControls: Fn; onFinish: Fn | null; stageName: string }): HTMLElement {
    const m = el('div', 'panel modal');
    m.innerHTML = `<h2>${icon('pause')} Paused</h2>
      <p style="margin:-6px 0 4px;color:var(--ink-soft)">${escapeHtml(o.stageName)} - take a breather!</p>
      <div class="stack">
        <button class="btn primary" data-a="resume">${icon('play')} Keep playing</button>
        ${o.onFinish ? `<button class="btn" data-a="finish">${icon('home')} Finish stage</button>` : ''}
        <button class="btn" data-a="settings">${icon('gear')} Settings</button>
        <button class="btn" data-a="controls">${icon(this.touchMode ? 'tap' : 'keyboard')} How to play</button>
        <button class="btn" data-a="restart">${icon('retry')} Start this world again</button>
        <button class="btn" data-a="map">${icon('map')} Back to the map</button>
      </div>`;
    const bg = this.openModal(m, true, o.onResume);
    const close = (fn: Fn) => () => {
      this.closeModal(bg);
      fn();
    };
    m.querySelector('[data-a=resume]')!.addEventListener('click', close(o.onResume));
    m.querySelector('[data-a=finish]')?.addEventListener('click', close(o.onFinish ?? (() => undefined)));
    m.querySelector('[data-a=restart]')!.addEventListener('click', close(o.onRestart));
    m.querySelector('[data-a=map]')!.addEventListener('click', close(o.onMap));
    m.querySelector('[data-a=settings]')!.addEventListener('click', o.onSettings);
    m.querySelector('[data-a=controls]')!.addEventListener('click', o.onControls);
    return bg;
  }

  confirm(title: string, text: string, yes: string, onYes: Fn): void {
    const m = el('div', 'panel modal');
    m.innerHTML = `<h2>${escapeHtml(title)}</h2><p style="margin:0;color:var(--ink-soft);font-size:1.1rem">${escapeHtml(text)}</p><div class="row"><button class="btn" data-a="no">${icon('back')} Not now</button><button class="btn primary" data-a="yes">${escapeHtml(yes)}</button></div>`;
    const bg = this.openModal(m, true);
    m.querySelector('[data-a=no]')!.addEventListener('click', () => this.closeModal(bg));
    m.querySelector('[data-a=yes]')!.addEventListener('click', () => {
      this.closeModal(bg);
      onYes();
    });
  }

  showControls(): void {
    if (this.touchMode) return this.showTouchControls();
    const m = el('div', 'panel modal');
    const keys = (...k: string[]) => `<div class="keys">${k.map((x) => (x.startsWith('<') ? x : `<span class="kbd">${x}</span>`)).join('')}</div>`;
    m.innerHTML = `<h2>${icon(this.touchMode ? 'tap' : 'keyboard')} How to play</h2>
      <div class="controls-grid">
        ${keys('<span class="kbd">' + icon('mouse') + '</span>')}<div class="what">Move the mouse to look around</div>
        ${keys('Click')}<div class="what">Blow bubbles / launch balls (hold to keep going)</div>
        ${keys('W', 'A', 'S', 'D')}<div class="what">Walk forward, left, back, right</div>
        ${keys('↑', '←', '↓', '→')}<div class="what">Arrow keys walk too</div>
        ${keys('Space')}<div class="what">Jump · underwater: swim up</div>
        ${keys('Shift', 'C')}<div class="what">Underwater: swim down</div>
        ${keys('1', '2', '3', '4')}<div class="what">Pick a blaster (or Q / E, or the mouse wheel)</div>
        ${keys('Esc', 'P')}<div class="what">Pause</div>
        ${keys('H')}<div class="what">Show or hide hints</div>
      </div>
      <p style="margin:4px 0 0;color:var(--ink-soft)">Ace always moves the way he is looking - even when swimming! Aim near a friend and your shot helps you out.</p>
      <div class="row"><button class="btn primary" data-a="ok">${icon('check')} Got it!</button></div>`;
    const bg = this.openModal(m, true);
    m.querySelector('[data-a=ok]')!.addEventListener('click', () => this.closeModal(bg));
  }

  private showTouchControls(): void {
    const m = el('div', 'panel modal');
    const row = (ic: string, label: string, what: string) => `<div class="keys"><span class="kbd">${icon(ic)}</span>${label ? `<span class="kbd">${escapeHtml(label)}</span>` : ''}</div><div class="what">${escapeHtml(what)}</div>`;
    m.innerHTML = `<h2>${icon('tap')} How to play</h2>
      <div class="controls-grid">
        ${row('joystick', 'Left side', 'Drag on the left side to walk (or swim) the way Ace is looking')}
        ${row('drag', 'Right side', 'Drag on the right side to look around')}
        ${row('bubble', '', 'Hold the bubble button to blow bubbles - slide your thumb to aim at the same time (push to the edge to keep turning)')}
        ${row('ball', '1-4', 'Tap a blaster in the bottom bar to pick it')}
        ${row('jumpbtn', 'Jump', 'Jump - underwater it swims up')}
        ${row('updown', 'Down', 'Underwater: swim down')}
        ${row('retry', '', 'Swap blasters')}
        ${row('pause', '', 'Pause')}
        ${row('star', '', 'Tap the goals card to see all your goals')}
      </div>
      <p style="margin:4px 0 0;color:var(--ink-soft)">Turn your device sideways for the best view. Aim near a friend and your shot helps you out!</p>
      <div class="row"><button class="btn primary" data-a="ok">${icon('check')} Got it!</button></div>`;
    const bg = this.openModal(m, true);
    m.querySelector('[data-a=ok]')!.addEventListener('click', () => this.closeModal(bg));
  }

  showSettings(onClose?: Fn): void {
    const s = this.save.settings;
    const m = el('div', 'panel modal');
    const slider = (id: keyof Settings, label: string, ic: string, min: number, max: number, step: number, fmt: (v: number) => string, desc = '') => `
      <div class="setting"><label for="s-${id}">${icon(ic)} ${label}</label><span class="val" data-v="${id}">${fmt(s[id] as number)}</span>
      ${desc ? `<div class="desc">${desc}</div>` : ''}
      <div class="slider-row"><input id="s-${id}" type="range" min="${min}" max="${max}" step="${step}" value="${s[id]}" data-k="${id}"></div></div>`;
    const toggle = (id: keyof Settings, label: string, ic: string, desc = '') => `
      <div class="setting"><label for="s-${id}">${icon(ic)} ${label}</label><input id="s-${id}" class="toggle" type="checkbox" data-k="${id}" ${s[id] ? 'checked' : ''}>
      ${desc ? `<div class="desc">${desc}</div>` : ''}</div>`;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    m.innerHTML = `<h2>${icon('gear')} Settings</h2>
      ${this.touchMode ? slider('sensitivity', 'Look sensitivity', 'drag', 0.2, 3, 0.05, (v) => v.toFixed(2) + 'x', 'How fast Ace looks around when you drag on the screen.') : slider('sensitivity', 'Mouse sensitivity', 'mouse', 0.2, 3, 0.05, (v) => v.toFixed(2) + 'x', 'How fast Ace looks around when you move the mouse.')}
      ${toggle('invertLook', 'Invert look up/down', 'updown', this.touchMode ? 'When on, dragging up makes Ace look down. Left and right are never changed.' : 'When on, moving the mouse up makes Ace look down. Left and right are never changed.')}
      ${slider('musicVolume', 'Music volume', 'music', 0, 1, 0.05, pct)}
      ${slider('voiceVolume', 'Voices volume', 'voice', 0, 1, 0.05, pct)}
      ${slider('sfxVolume', 'Effects volume', 'speaker', 0, 1, 0.05, pct)}
      ${toggle('subtitles', 'Subtitles', 'voice', 'Show words when Ace or the narrator talks.')}
      ${toggle('hints', 'Helpful hints', 'sparkle')}
      ${toggle('headBob', 'Head bob', 'eye', 'Turn off for a steadier camera.')}
      ${slider('fov', 'Field of view', 'eye', 60, 95, 1, (v) => `${v}°`)}
      <div class="setting"><label>${icon('quality')} Graphics</label><div class="seg" data-k="quality"><button data-q="fancy" class="${s.quality === 'fancy' ? 'on' : ''}">Fancy</button><button data-q="simple" class="${s.quality === 'simple' ? 'on' : ''}">Simple</button></div><div class="desc">Simple is smoother on older computers.</div></div>
      ${this.isDesktop || document.fullscreenEnabled ? `<div class="setting"><label>${icon('fullscreen')} Full screen</label><button class="btn small" data-a="fs">Toggle</button></div>` : ''}
      <div class="row"><button class="btn primary" data-a="done">${icon('check')} Done</button></div>`;
    const bg = this.openModal(m, true, onClose);
    const update = (input: HTMLInputElement) => {
      const k = input.dataset.k as keyof Settings;
      if (input.type === 'checkbox') (s as unknown as Record<string, unknown>)[k] = input.checked;
      else {
        const v = Number(input.value);
        (s as unknown as Record<string, unknown>)[k] = v;
        const p = ((v - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
        input.style.setProperty('--p', `${p}%`);
        const lab = m.querySelector(`[data-v="${k}"]`);
        if (lab) lab.textContent = k === 'sensitivity' ? v.toFixed(2) + 'x' : k === 'fov' ? `${v}°` : pct(v);
      }
      this.save.saveSettings();
      this.onSettingsChanged?.();
    };
    m.querySelectorAll<HTMLInputElement>('input').forEach((i) => {
      if (i.type === 'range') i.style.setProperty('--p', `${((Number(i.value) - Number(i.min)) / (Number(i.max) - Number(i.min))) * 100}%`);
      i.addEventListener('input', () => update(i));
      i.addEventListener('change', () => {
        update(i);
        this.sounds?.click();
      });
    });
    m.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        s.quality = b.dataset.q === 'simple' ? 'simple' : 'fancy';
        m.querySelectorAll('[data-q]').forEach((x) => x.classList.toggle('on', x === b));
        this.save.saveSettings();
        this.onSettingsChanged?.();
      }),
    );
    m.querySelector('[data-a=fs]')?.addEventListener('click', () => {
      if (this.desktop) void this.desktop.toggleFullscreen();
      else if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen().catch(() => undefined);
    });
    m.querySelector('[data-a=done]')!.addEventListener('click', () => {
      this.closeModal(bg);
      onClose?.();
    });
  }

  // ---------------------------------------------------------------- HUD

  buildHud(info: StageInfo): void {
    this.destroyHud();
    const h = el('div', 'hud');
    h.style.setProperty('--accent', info.accent);
    h.innerHTML = `
      <div class="helmet"></div>
      <div class="crosshair"><div class="charge"></div><div class="ring"></div><div class="dot"></div></div>
      <div class="aim-label"></div>
      <div class="panel objectives"></div>
      <div class="panel stars-hud">${icon('starEmpty')}${icon('starEmpty')}${icon('starEmpty')}</div>
      <div class="panel timer">${icon('clock')}<span class="t">0.0</span><span class="lbl"></span></div>
      <div class="blaster-name"></div>
      <div class="panel blaster-bar"></div>
      <div class="panel hint"></div>
      <div class="panel caption"><div class="who"></div><div class="text"></div></div>
      <div class="panel click-to-look">${icon('mouse')} Click to look around with the mouse</div>
      <div class="panel msg" aria-live="polite"></div>
      <div class="cheers"></div>
      <div class="banners"></div>`;
    this.root.insertBefore(h, this.root.firstChild);
    this.hud = h;
    // Touch screens: the goals card is compact; tap it to see every goal for a few seconds.
    const obj = h.querySelector('.objectives') as HTMLElement;
    let collapse = 0;
    const toggle = (e: Event) => {
      if (!this.touchMode) return;
      e.preventDefault();
      e.stopPropagation();
      obj.classList.toggle('expanded');
      window.clearTimeout(collapse);
      if (obj.classList.contains('expanded')) collapse = window.setTimeout(() => obj.classList.remove('expanded'), 6000);
    };
    obj.addEventListener('touchstart', toggle, { passive: false });
    obj.addEventListener('click', toggle);
    // Touch screens: tap a blaster slot to switch (same as pressing 1-4).
    const bar = h.querySelector('.blaster-bar') as HTMLElement;
    bar.addEventListener('touchstart', (e) => {
      if (!this.touchMode) return;
      const slot = (e.target as HTMLElement).closest('.bslot') as HTMLElement | null;
      e.preventDefault();
      e.stopPropagation();
      if (slot?.dataset.id) this.onSlotTap?.(slot.dataset.id as BlasterId);
    }, { passive: false });
    this.msgBanner = this.msgCaption = this.msgHint = null;
    for (const k of ['helmet', 'crosshair', 'aim-label', 'objectives', 'stars-hud', 'timer', 'blaster-name', 'blaster-bar', 'hint', 'caption', 'click-to-look', 'cheers', 'banners', 'msg']) {
      this.hudEls[k] = h.querySelector('.' + k) as HTMLElement;
    }
  }

  destroyHud(): void {
    this.hud?.remove();
    this.hud = null;
    this.hudEls = {};
  }

  setHudVisible(v: boolean): void {
    if (this.hud) this.hud.style.display = v ? '' : 'none';
  }

  renderObjectives(stageName: string, stageIcon: string, list: ObjectiveState[], flashId?: string): void {
    const box = this.hudEls.objectives;
    if (!box) return;
    const current = list.find((o) => o.def.kind === 'main' && !o.done);
    const mains = list.filter((o) => o.def.kind === 'main');
    const allMain = mains.every((o) => o.done);
    const row = (o: ObjectiveState, cls: string) =>
      `<div class="obj ${cls} ${o.done ? 'done' : ''} ${flashId === o.def.id ? 'flash' : ''}">${o.done ? icon('check') : icon(inputIcon(o.def.icon, this.touchMode))}<span>${escapeHtml(o.def.label)}</span>${o.def.target > 1 ? `<span class="count">${o.count}/${o.def.target}</span>` : o.done ? '' : ''}</div>`;
    let html = `<div class="obj-stage">${icon(stageIcon)} ${escapeHtml(stageName)}</div>`;
    if (current) html += row(current, 'main');
    else if (allMain) html += `<div class="obj main">${icon('home')}<span>Hop into the Home Bubble!</span></div>`;
    const extras = list.filter((o) => o.def.kind !== 'main');
    if (extras.length) html += '<div class="obj-sep"></div>' + extras.map((o) => row(o, '')).join('');
    const doneExtras = extras.filter((o) => o.done).length;
    html += `<span class="obj-toggle" aria-hidden="true"><span class="co">+${extras.length - doneExtras > 0 ? extras.length - doneExtras : ''}</span><span class="ex">−</span></span>`;
    box.innerHTML = html;
    box.setAttribute('aria-label', 'Goals - tap to show all');
  }

  setStars(stars: boolean[]): void {
    const b = this.hudEls['stars-hud'];
    if (!b) return;
    b.innerHTML = stars.map((s) => (s ? icon('star') : icon('starEmpty'))).join('');
    b.querySelectorAll('svg').forEach((sv, i) => {
      (sv as SVGElement).style.color = 'var(--star)';
      if (stars[i]) sv.classList.add('got');
    });
  }

  renderBlasters(unlocked: BlasterId[], current: BlasterId): void {
    const bar = this.hudEls['blaster-bar'];
    if (!bar) return;
    bar.innerHTML = BLASTERS.map(
      (b) => `<div class="bslot ${unlocked.includes(b.id) ? '' : 'locked'} ${b.id === current ? 'active' : ''}" data-id="${b.id}" role="button" aria-label="${escapeHtml(b.name)}${unlocked.includes(b.id) ? '' : ' (not found yet)'}" style="--slot:${b.color}" title="${escapeHtml(b.name)}"><span class="key">${b.slot}</span>${unlocked.includes(b.id) ? icon(b.icon) : icon('lock')}</div>`,
    ).join('');
  }

  flashBlasterName(name: string): void {
    const n = this.hudEls['blaster-name'];
    if (!n) return;
    n.textContent = name;
    n.classList.add('show');
    window.clearTimeout(this.blasterNameTimer);
    this.blasterNameTimer = window.setTimeout(() => n.classList.remove('show'), 1400);
  }

  setCrosshair(onTarget: boolean, label: string | null, charge: number, firing: boolean): void {
    const c = this.hudEls.crosshair;
    if (!c) return;
    c.classList.toggle('on', onTarget);
    c.classList.toggle('charging', charge > 0.02);
    c.classList.toggle('fire', firing);
    c.style.setProperty('--c', String(charge));
    const l = this.hudEls['aim-label'];
    if (l) {
      if (label) l.textContent = label;
      l.classList.toggle('show', !!label);
    }
  }

  setCrosshairVisible(v: boolean): void {
    const c = this.hudEls.crosshair;
    if (c) c.style.display = v ? '' : 'none';
  }

  setTimer(seconds: number | null, label = ''): void {
    const t = this.hudEls.timer;
    if (!t) return;
    if (seconds === null) {
      t.classList.remove('show');
      return;
    }
    t.classList.add('show');
    t.classList.toggle('low', seconds <= 5);
    (t.querySelector('.t') as HTMLElement).textContent = seconds.toFixed(1);
    (t.querySelector('.lbl') as HTMLElement).textContent = label;
  }

  cheer(text: string): void {
    const box = this.hudEls.cheers;
    if (!box) return;
    if (box.childElementCount > 1) box.firstElementChild?.remove();
    const c = el('div', 'cheer', escapeHtml(text));
    box.appendChild(c);
    window.setTimeout(() => c.remove(), 1150);
  }

  // Touch screens use ONE message slot for banners, captions and hints, shown in
  // priority order (banner > caption > hint) so they never stack on each other or
  // cover the middle of a small screen. Desktop keeps the separate placements.
  private msgBanner: { title: string; sub: string; until: number } | null = null;
  private msgCaption: { speaker: 'ace' | 'narrator'; text: string; start: number; until: number } | null = null;
  private msgHint: { html: string; until: number } | null = null;
  private msgTimer = 0;

  private refreshMsg(): void {
    const m = this.hudEls.msg;
    if (!m) return;
    const now = performance.now();
    if (this.msgBanner && now >= this.msgBanner.until) this.msgBanner = null;
    if (this.msgCaption && now >= this.msgCaption.until) this.msgCaption = null;
    if (this.msgHint && now >= this.msgHint.until) this.msgHint = null;
    window.clearTimeout(this.msgTimer);
    let html = '';
    let kind = '';
    if (this.msgBanner) {
      kind = 'banner';
      html = `<b>${escapeHtml(this.msgBanner.title)}</b>${this.msgBanner.sub ? `<span>${escapeHtml(this.msgBanner.sub)}</span>` : ''}`;
    } else if (this.msgCaption && now >= this.msgCaption.start) {
      kind = 'caption';
      const c = this.msgCaption;
      html = `<i class="who ${c.speaker}">${c.speaker === 'ace' ? 'A' : icon('voice')}</i><span>${escapeHtml(c.text)}</span>`;
    } else if (this.msgHint && !(this.msgCaption && now < this.msgCaption.start && !this.msgBanner)) {
      kind = 'hint';
      html = `<span>${this.msgHint.html}</span>`;
    }
    m.className = `panel msg ${kind ? 'show kind-' + kind : ''}`;
    if (html) m.innerHTML = html;
    const capStart = this.msgCaption && this.msgCaption.start > now ? this.msgCaption.start : Infinity;
    const next = Math.min(this.msgBanner?.until ?? Infinity, this.msgCaption?.until ?? Infinity, this.msgHint?.until ?? Infinity, capStart);
    if (Number.isFinite(next)) this.msgTimer = window.setTimeout(() => this.refreshMsg(), Math.max(30, next - now + 10));
  }

  banner(title: string, sub = '', seconds = 2.6): void {
    if (this.touchMode && this.hudEls.msg) {
      this.msgBanner = { title, sub: touchWording(sub), until: performance.now() + seconds * 1000 };
      this.refreshMsg();
      return;
    }
    const box = this.hudEls.banners;
    if (!box) return;
    box.innerHTML = '';
    const b = el('div', 'panel banner', `<h3>${escapeHtml(title)}</h3>${sub ? `<p>${escapeHtml(sub)}</p>` : ''}`);
    box.appendChild(b);
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      b.classList.add('out');
      window.setTimeout(() => b.remove(), 400);
    }, seconds * 1000);
  }

  hint(text: string | null, seconds = 0): void {
    if (this.touchMode && this.hudEls.msg) {
      this.msgHint = text && this.save.settings.hints ? { html: renderKeys(touchWording(text)), until: seconds > 0 ? performance.now() + seconds * 1000 : Infinity } : null;
      this.refreshMsg();
      return;
    }
    const h = this.hudEls.hint;
    if (!h) return;
    window.clearTimeout(this.hintTimer);
    if (!text || !this.save.settings.hints) {
      h.classList.remove('show');
      return;
    }
    h.innerHTML = renderKeys(text);
    h.classList.add('show');
    if (seconds > 0) this.hintTimer = window.setTimeout(() => h.classList.remove('show'), seconds * 1000);
  }

  caption(speaker: 'ace' | 'narrator', text: string, duration: number): void {
    if (!this.save.settings.subtitles) return;
    if (this.touchMode && this.hudEls.msg) {
      // Kids read Ace's lines: a caption that arrives during a banner waits until the banner ends.
      const now = performance.now();
      const start = this.msgBanner && this.msgBanner.until > now ? this.msgBanner.until : now;
      this.msgCaption = { speaker, text, start, until: start + Math.max(1600, duration * 1000 + 500) };
      this.refreshMsg();
      return;
    }
    const c = this.hudEls.caption;
    if (!c) return;
    const who = c.querySelector('.who') as HTMLElement;
    who.className = `who ${speaker}`;
    who.innerHTML = speaker === 'ace' ? 'A' : icon('voice');
    (c.querySelector('.text') as HTMLElement).textContent = text;
    c.classList.add('show');
    window.clearTimeout(this.captionTimer);
    this.captionTimer = window.setTimeout(() => c.classList.remove('show'), Math.max(1600, duration * 1000 + 500));
  }

  setHelmet(on: boolean): void {
    this.hudEls.helmet?.classList.toggle('show', on);
  }

  setClickToLook(on: boolean): void {
    this.hudEls['click-to-look']?.classList.toggle('show', on);
  }

  unlockToast(title: string, text: string, ic: string): void {
    if (!this.hud) return;
    const t = el('div', 'panel toast-unlock', `${icon(ic)}<div><h3 style="margin:0;font-size:1.6rem">${escapeHtml(title)}</h3><p style="margin:4px 0 0;color:var(--ink-soft);font-size:1.05rem">${escapeHtml(text)}</p></div>`);
    this.hud.appendChild(t);
    window.setTimeout(() => {
      t.classList.add('out');
      t.style.transition = 'opacity .4s';
      t.style.opacity = '0';
      window.setTimeout(() => t.remove(), 450);
    }, 3600);
  }

  // --------------------------------------------------------- transitions

  /** Bubble wipe: covers the screen, runs `mid`, then reveals. */
  wipe(mid: () => void | Promise<void>, color = '#f3ecdd'): Promise<void> {
    return new Promise((resolve) => {
      const w = el('div', 'wipe in');
      w.style.setProperty('--wipe', color);
      const W = window.innerWidth;
      const H = window.innerHeight;
      const R = Math.hypot(W, H) * 0.32;
      const spots = [
        [0.2, 0.25], [0.75, 0.2], [0.5, 0.55], [0.15, 0.8], [0.85, 0.75], [0.45, 0.1], [0.55, 0.95], [0.95, 0.4], [0.05, 0.45],
      ];
      spots.forEach(([x, y], i) => {
        const b = el('div', 'b');
        b.style.left = `${x * W - R}px`;
        b.style.top = `${y * H - R}px`;
        b.style.width = b.style.height = `${R * 2}px`;
        b.style.animationDelay = `${i * 0.035}s`;
        w.appendChild(b);
      });
      this.root.appendChild(w);
      window.setTimeout(async () => {
        await mid();
        w.classList.remove('in');
        w.classList.add('out');
        window.setTimeout(() => {
          w.remove();
          resolve();
        }, 700);
      }, 650);
    });
  }
}

/** Rewrite keyboard/mouse hint wording for on-screen touch controls. */
function touchWording(t: string): string {
  return t
    .replace(/Move the \[mouse\] to look around/g, 'Drag on the right side to look around')
    .replace(/\[W\] \[A\] \[S\] \[D\] or the arrow keys/g, 'the joystick on the left')
    .replace(/\[W\] swims where you look/g, 'The joystick swims where you look')
    .replace(/([Hh]old) \[Click\]/g, '$1 the bubble button')
    .replace(/\[Click\] to blow bubbles/g, 'Hold the bubble button and slide to aim')
    .replace(/\[Click\]/g, 'Hold the bubble button')
    .replace(/\[Space\]/g, '[Jump]')
    .replace(/\[Shift\]/g, '[Down]')
    .replace(/Press \[2\] \(or \[Q\] \/ \[E\]\)/g, 'Tap the swap button')
    .replace(/Press \[\d\]/g, 'Tap the swap button')
    .replace(/\[Q\] \/ \[E\]|\[Q\]|\[E\]/g, '[swap button]')
    .replace(/\[1\]/g, '[Bubble Wand]')
    .replace(/\[2\]/g, '[Boing Ball]')
    .replace(/\[3\]/g, '[Fizz Fountain]')
    .replace(/\[4\]/g, '[Glow Ball]')
    .replace(/\[C\]/g, '[Down]')
    .replace(/\[mouse\]/g, 'finger')
    // Plain (non-keycap) wording used in banners and goal hints.
    .replace(/Move the mouse to look around/g, 'Drag on the right side to look around')
    .replace(/Use W A S D or the arrow keys/g, 'Use the joystick on the left')
    .replace(/Press Space to jump/g, 'Tap Jump to jump')
    .replace(/Click to blow bubbles/g, 'Hold the bubble button and slide to aim')
    .replace(/Press 2 for the Boing Ball/g, 'Tap the swap button for the Boing Ball');
}

// ---------------------------------------------------------------- map art

function aceTokenSvg(): string {
  return `<svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="27" fill="#fbf6ec" stroke="#e2b45e" stroke-width="4"/>
  <circle cx="30" cy="33" r="15" fill="#eec4a2"/><path d="M15 29c0-9 7-14 15-14s15 5 15 14c-5-2-25-2-30 0z" fill="#5f9f99"/><path d="M38 28c5 0 9 1 11 3-4 1-8 0-11-1z" fill="#5f9f99"/>
  <circle cx="25" cy="33" r="2.4" fill="#2b2f36"/><circle cx="35" cy="33" r="2.4" fill="#2b2f36"/><path d="M25 39c3 3 7 3 10 0" stroke="#3b3236" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="21" cy="38" r="2.2" fill="#e9a79a" opacity=".7"/><circle cx="39" cy="38" r="2.2" fill="#e9a79a" opacity=".7"/></svg>`;
}

function mapArt(cards: StageCardData[]): string {
  const pts = cards.map((c) => [c.info.map.x * 10, c.info.map.y * 6] as const);
  let path = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const mx = (x1 + x2) / 2 + (y2 - y1) * 0.18;
    const my = (y1 + y2) / 2 - (x2 - x1) * 0.18;
    const unlocked = cards[i + 1].unlocked;
    path += `<path d="M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}" fill="none" stroke="${unlocked ? '#f6efe2' : 'rgba(246,239,226,.45)'}" stroke-width="7" stroke-linecap="round" stroke-dasharray="2 16"/>`;
  }
  const waves = Array.from({ length: 26 }, (_, i) => {
    const x = (i * 137) % 1000;
    const y = (i * 241) % 600;
    return `<path d="M${x} ${y}c8-6 16-6 24 0s16 6 24 0" stroke="#ffffff" stroke-opacity=".35" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }).join('');
  return `<svg class="mapart" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <defs>
    <radialGradient id="sea" gradientUnits="userSpaceOnUse" cx="500" cy="270" r="720"><stop offset="0" stop-color="#cfe3df"/><stop offset="1" stop-color="#a9cbcd"/></radialGradient>
    <radialGradient id="deep" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#2f4d63"/><stop offset=".7" stop-color="#5d8496"/><stop offset="1" stop-color="#a9cbcd" stop-opacity="0"/></radialGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#1c282e" flood-opacity=".18"/></filter>
  </defs>
  <rect x="-3000" y="-3000" width="7000" height="6600" fill="url(#sea)"/>
  ${waves}
  <!-- Bubble Park -->
  <g filter="url(#soft)"><path d="M70 470c10-60 90-90 160-80s110 50 100 100-70 80-150 75S60 530 70 470z" fill="#b8cf98"/><path d="M95 475c15-40 80-60 135-52s85 35 80 70-60 55-120 50-105-30-95-68z" fill="#a6c487"/>
  <ellipse cx="200" cy="470" rx="26" ry="14" fill="#9fc8cf"/><circle cx="130" cy="450" r="16" fill="#86ad7c"/><circle cx="150" cy="440" r="12" fill="#9dbd8d"/><circle cx="250" cy="505" r="14" fill="#86ad7c"/>
  <circle cx="180" cy="420" r="10" fill="#e9f4f6" fill-opacity=".8" stroke="#fff"/><circle cx="196" cy="405" r="6" fill="#e9f4f6" fill-opacity=".8" stroke="#fff"/></g>
  <!-- Dino Valley -->
  <g filter="url(#soft)"><path d="M250 250c20-70 120-110 200-90s120 80 95 140-100 90-180 80-135-60-115-130z" fill="#d9c08f"/><path d="M280 255c20-50 100-80 160-62s90 60 70 105-80 65-140 58-110-50-90-101z" fill="#b9c78f"/>
  <path d="M400 210l30-55 32 55z" fill="#b28a6a"/><path d="M420 168c-5-12 4-22 14-18 6-10 20-6 20 4" fill="none" stroke="#f3ecdf" stroke-width="6" stroke-linecap="round"/>
  <circle cx="320" cy="250" r="16" fill="#86ad7c"/><circle cx="345" cy="290" r="13" fill="#7fa572"/><path d="M470 280c10-25 30-30 38-20 8-5 18 0 16 10" fill="none" stroke="#7d9a6e" stroke-width="7" stroke-linecap="round"/></g>
  <!-- Coral Cove -->
  <g filter="url(#soft)"><ellipse cx="580" cy="430" rx="120" ry="78" fill="#8fc4c4"/><ellipse cx="580" cy="430" rx="90" ry="56" fill="#a8d4cf"/>
  <path d="M520 440c0-20 10-30 18-30s10 15 6 28M610 420c4-16 16-22 22-16s0 18-8 26" fill="none" stroke="#e7a99a" stroke-width="8" stroke-linecap="round"/><path d="M560 470c-6-14 2-26 10-24s6 16 0 26" fill="none" stroke="#f0cb6c" stroke-width="7" stroke-linecap="round"/>
  <path d="M640 455c10-6 22-4 28 4" fill="none" stroke="#5f7f88" stroke-width="8" stroke-linecap="round"/></g>
  <!-- Twilight Trench -->
  <ellipse cx="770" cy="270" rx="140" ry="100" fill="url(#deep)"/>
  <g><circle cx="740" cy="250" r="5" fill="#bdf2e8"/><circle cx="800" cy="290" r="4" fill="#d8c8f0"/><circle cx="770" cy="230" r="3" fill="#bdf2e8"/><circle cx="820" cy="245" r="3.5" fill="#bdf2e8"/></g>
  <!-- Frosty Peaks -->
  <g filter="url(#soft)"><path d="M520 120c30-60 140-80 210-55s90 70 60 100-120 40-190 30-110-30-80-75z" fill="#e7eef2"/>
  <path d="M560 140l45-70 30 40 25-30 45 60z" fill="#c9d7e2"/><path d="M590 95l15-25 12 18M650 80l10-12 9 12" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M700 150a20 20 0 0 1 40 0z" fill="#f8fbfc" stroke="#c9d7e2" stroke-width="3"/></g>
  ${path}
  </svg>`;
}
