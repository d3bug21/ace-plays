import type { DeviceInfo } from '../core/Device';
import { escapeHtml, icon } from './icons';

/**
 * "Turn your phone sideways" helper for phones, tablets and in-app browsers.
 * Shows only in portrait, hides itself in landscape, and comes back if the
 * device turns back to portrait. "Play anyway" dismisses it until the next
 * landscape -> portrait turn. Never used on desktop or in the desktop app.
 */
export class RotatePrompt {
  private el: HTMLElement;
  private dismissed = false;
  private shown = false;
  private wasLandscape = false;
  onShow: (() => void) | null = null;
  onHide: (() => void) | null = null;
  enabled = true;

  constructor(parent: HTMLElement, private device: DeviceInfo) {
    const el = document.createElement('div');
    el.className = 'rotate-prompt';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Turn your phone sideways');
    el.innerHTML = `
      <div class="rp-card">
        <div class="rp-art" aria-hidden="true">${rotateArt()}</div>
        <h2>Turn your phone sideways!</h2>
        <p>Ace's adventure looks choice in landscape. Give your phone a wee turn, eh!</p>
        <button class="btn primary" data-a="anyway">${icon('play')} Play anyway</button>
      </div>`;
    parent.appendChild(el);
    this.el = el;
    el.querySelector('[data-a=anyway]')!.addEventListener('click', () => {
      this.dismissed = true;
      this.update();
    });
    const check = () => this.update();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    window.matchMedia?.('(orientation: portrait)').addEventListener?.('change', check);
    screen.orientation?.addEventListener?.('change', check);
    this.update();
  }

  private isPortrait(): boolean {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (window.matchMedia) return window.matchMedia('(orientation: portrait)').matches && h > w;
    return h > w;
  }

  get visible(): boolean {
    return this.shown;
  }

  update(): void {
    const portrait = this.isPortrait();
    if (!portrait) {
      // Turning to landscape resets "Play anyway", so the tip returns next time.
      this.wasLandscape = true;
      this.dismissed = false;
    } else if (this.wasLandscape) {
      this.wasLandscape = false;
    }
    const want = this.enabled && this.device.handheld && !this.device.desktopApp && portrait && !this.dismissed;
    if (want === this.shown) return;
    this.shown = want;
    this.el.classList.toggle('show', want);
    if (want) this.onShow?.();
    else this.onHide?.();
  }
}

/** Small dismissible tip for in-app browsers (Facebook, Instagram, TikTok...). */
export function showInAppTip(parent: HTMLElement, device: DeviceInfo): void {
  if (!device.inApp || device.desktopApp) return;
  try {
    if (sessionStorage.getItem('acePlays.inAppTip') === '1') return;
  } catch {
    /* storage blocked: still show once per page load */
  }
  const where = device.ios ? 'Safari' : 'Chrome';
  const name = device.inAppName && device.inAppName !== 'an app' ? device.inAppName : 'this app';
  const tip = document.createElement('div');
  tip.className = 'inapp-tip panel';
  tip.setAttribute('role', 'note');
  tip.innerHTML = `${icon('sparkle')}<span>Playing inside ${escapeHtml(name)}? For the best sound and full screen, open Ace Plays! in ${where}${device.ios ? ' (tap ••• then "Open in Safari")' : ' (tap ⋮ then "Open in Chrome")'}.</span><button class="icon-btn" aria-label="Close tip">${icon('close')}</button>`;
  parent.appendChild(tip);
  tip.querySelector('button')!.addEventListener('click', () => {
    tip.remove();
    try {
      sessionStorage.setItem('acePlays.inAppTip', '1');
    } catch {
      /* ignore */
    }
  });
}

function rotateArt(): string {
  // A phone (with Ace waving on its screen) that turns from tall to sideways.
  return `<svg viewBox="0 0 220 160" class="rp-svg">
    <defs><linearGradient id="rpsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fc0d6"/><stop offset="1" stop-color="#f5ead3"/></linearGradient><clipPath id="rpscreen"><rect x="-28" y="-48" width="56" height="96" rx="7"/></clipPath></defs>
    <path class="rp-arrow" d="M150 34 a52 52 0 0 1 22 40" fill="none" stroke="#f0cb6c" stroke-width="7" stroke-linecap="round"/>
    <path class="rp-arrow" d="M164 70 l9 10 l7 -13" fill="none" stroke="#f0cb6c" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <g transform="translate(92 82)"><g class="rp-phone">
      <rect x="-34" y="-58" width="68" height="116" rx="14" fill="#2c3b43"/>
      <rect x="-28" y="-48" width="56" height="96" rx="7" fill="url(#rpsky)"/>
      <g clip-path="url(#rpscreen)"><ellipse cx="0" cy="44" rx="40" ry="16" fill="#a9c48f"/>
      <g class="rp-ace">
        <circle cx="0" cy="6" r="15" fill="#eec4a2"/>
        <path d="M-15 3c0-11 7-16 15-16s15 5 15 16c-5-2-25-2-30 0z" fill="#5f9f99"/>
        <circle cx="-5" cy="7" r="2.2" fill="#2b2f36"/><circle cx="5" cy="7" r="2.2" fill="#2b2f36"/>
        <path d="M-5 13c3 3 7 3 10 0" stroke="#3b3236" stroke-width="1.8" fill="none" stroke-linecap="round"/>
        <rect x="-10" y="20" width="20" height="18" rx="7" fill="#e2b45e"/>
        <path class="rp-wave" d="M10 24 l10 -12" stroke="#e2b45e" stroke-width="5" stroke-linecap="round"/>
        <circle cx="22" cy="-18" r="5" fill="#dff1f3" fill-opacity=".6" stroke="#fbf6ec" stroke-width="1.5"/>
      </g></g>
    </g></g>
  </svg>`;
}
