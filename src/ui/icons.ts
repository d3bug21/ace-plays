// Friendly rounded icon set (32x32). Icons use currentColor so CSS sets the tint.

const S = (body: string) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const F = 'fill="currentColor" stroke="none"';
const FS = 'fill="currentColor" fill-opacity="0.22"';

const ICONS: Record<string, string> = {
  bubble: S(`<circle cx="15" cy="16" r="10" ${FS}/><path d="M10 12.5a6 6 0 0 1 5-3.2"/><circle cx="25.5" cy="7" r="3" ${FS}/>`),
  ball: S(`<circle cx="16" cy="17" r="10" ${FS}/><path d="M6.5 14c5 3 14 3 19 0M7 21c5 2.6 13 2.6 18 0"/><path d="M12 3.5l1.2 2.4M20 3.5l-1.2 2.4" stroke-width="2"/>`),
  fizz: S(`<path d="M11 6h10v4l2 4v12a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3V14l2-4z" ${FS}/><circle cx="14" cy="21" r="1.6" ${F}/><circle cx="18" cy="17" r="1.3" ${F}/><circle cx="17" cy="24" r="1" ${F}/><path d="M13 2.8h6"/>`),
  glow: S(`<circle cx="16" cy="16" r="6.5" ${F} fill-opacity="0.55"/><circle cx="16" cy="16" r="6.5"/><path d="M16 3v3M16 26v3M3 16h3M26 16h3M6.8 6.8l2.1 2.1M23.1 23.1l2.1 2.1M6.8 25.2l2.1-2.1M23.1 8.9l2.1-2.1"/>`),
  star: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3.2l3.7 7.6 8.3 1.2-6 5.9 1.4 8.3L16 22.3l-7.4 3.9L10 17.9l-6-5.9 8.3-1.2z" fill="currentColor" stroke="rgba(44,59,67,.35)" stroke-width="1.4" stroke-linejoin="round"/><path d="M11.6 12.6l2.2-.3" stroke="#fff" stroke-opacity=".7" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  starEmpty: `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3.2l3.7 7.6 8.3 1.2-6 5.9 1.4 8.3L16 22.3l-7.4 3.9L10 17.9l-6-5.9 8.3-1.2z" fill="rgba(44,59,67,.1)" stroke="rgba(44,59,67,.35)" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  lock: S(`<rect x="7" y="14" width="18" height="13" rx="4" ${FS}/><path d="M11 14v-3a5 5 0 0 1 10 0v3"/><circle cx="16" cy="20.5" r="1.6" ${F}/>`),
  check: S(`<circle cx="16" cy="16" r="12" ${FS}/><path d="M10.5 16.5l3.8 3.8 7.4-8"/>`),
  dot: S(`<circle cx="16" cy="16" r="11"/>`),
  play: S(`<path d="M11 7.5v17a1.5 1.5 0 0 0 2.3 1.3l13-8.5a1.5 1.5 0 0 0 0-2.6l-13-8.5A1.5 1.5 0 0 0 11 7.5z" ${F}/>`),
  pause: S(`<rect x="8" y="6" width="5.5" height="20" rx="2" ${F}/><rect x="18.5" y="6" width="5.5" height="20" rx="2" ${F}/>`),
  gear: S(`<circle cx="16" cy="16" r="4"/><path d="M16 3.5v4M16 24.5v4M3.5 16h4M24.5 16h4M7.2 7.2l2.8 2.8M22 22l2.8 2.8M7.2 24.8L10 22M22 10l2.8-2.8"/><circle cx="16" cy="16" r="8.5" ${FS}/>`),
  map: S(`<path d="M4 8l7-3 10 3 7-3v19l-7 3-10-3-7 3z" ${FS}/><path d="M11 5v19M21 8v19"/>`),
  home: S(`<path d="M5 15L16 5l11 10" /><path d="M8 13v13h16V13" ${FS}/><path d="M13.5 26v-6h5v6"/>`),
  retry: S(`<path d="M25 16a9 9 0 1 1-3-6.7"/><path d="M23 4v6h-6"/>`),
  back: S(`<path d="M19 7l-9 9 9 9"/>`),
  close: S(`<path d="M9 9l14 14M23 9L9 23"/>`),
  mouse: S(`<rect x="9" y="4" width="14" height="24" rx="7" ${FS}/><path d="M16 4v8M9 12h14"/>`),
  keyboard: S(`<rect x="3" y="8" width="26" height="16" rx="3.5" ${FS}/><path d="M8 13h1M12 13h1M16 13h1M20 13h1M24 13h1M10 19h12"/>`),
  speaker: S(`<path d="M5 12h5l7-6v20l-7-6H5z" ${FS}/><path d="M22 11a7 7 0 0 1 0 10M25.5 7.5a12 12 0 0 1 0 17"/>`),
  music: S(`<path d="M12 23V7l14-3v16"/><circle cx="8.5" cy="23" r="3.5" ${FS}/><circle cx="22.5" cy="20" r="3.5" ${FS}/>`),
  voice: S(`<path d="M6 9a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-7l-6 5v-5h-1a2 2 0 0 1-2-2z" ${FS}/><path d="M12 12.5h8M12 16h5"/>`),
  eye: S(`<path d="M3 16s5-8 13-8 13 8 13 8-5 8-13 8S3 16 3 16z" ${FS}/><circle cx="16" cy="16" r="3.5"/>`),
  updown: S(`<path d="M16 4v24M10 10l6-6 6 6M10 22l6 6 6-6"/>`),
  sparkle: S(`<path d="M16 4l2.5 7.5L26 14l-7.5 2.5L16 24l-2.5-7.5L6 14l7.5-2.5z" ${FS}/><path d="M25 22l1 3 3 1-3 1-1 3-1-3-3-1 3-1z"/>`),
  quality: S(`<path d="M4 24l7-9 5 6 4-5 8 8z" ${FS}/><circle cx="22" cy="9" r="3"/>`),
  fullscreen: S(`<path d="M5 12V5h7M20 5h7v7M27 20v7h-7M12 27H5v-7"/>`),
  door: S(`<path d="M8 28V5h13v23" ${FS}/><circle cx="17.5" cy="17" r="1.2" ${F}/><path d="M4 28h24"/>`),
  clock: S(`<circle cx="16" cy="17" r="11" ${FS}/><path d="M16 11v6l4 3M13 3h6"/>`),
  heart: S(`<path d="M16 27S4 19.5 4 11.5A6.5 6.5 0 0 1 16 8a6.5 6.5 0 0 1 12 3.5C28 19.5 16 27 16 27z" ${FS}/>`),
  flag: S(`<path d="M8 28V4"/><path d="M8 5h15l-3.5 5L23 15H8" ${FS}/>`),
  bell: S(`<path d="M8 22V14a8 8 0 0 1 16 0v8l2 3H6z" ${FS}/><path d="M13 27a3 3 0 0 0 6 0M16 3v3"/>`),
  balloon: S(`<ellipse cx="16" cy="12" rx="8" ry="9.5" ${FS}/><path d="M16 21.5l-1.5 2h3zM16 23.5c-2 2 2 3 0 5"/>`),
  bunny: S(`<path d="M12 13c-2-5-2-10 0-10s3 5 2 10M20 13c2-5 2-10 0-10s-3 5-2 10"/><circle cx="16" cy="19" r="8" ${FS}/><circle cx="13" cy="18" r="1" ${F}/><circle cx="19" cy="18" r="1" ${F}/><path d="M15 21.5h2"/>`),
  dog: S(`<circle cx="16" cy="17" r="9" ${FS}/><path d="M8.5 11C5 9 4 14 6 18M23.5 11c3.5-2 4.5 3 2.5 7"/><circle cx="13" cy="16" r="1.2" ${F}/><circle cx="19" cy="16" r="1.2" ${F}/><ellipse cx="16" cy="20" rx="2" ry="1.4" ${F}/>`),
  acorn: S(`<path d="M8 13h16a8 8 0 0 1-8 13 8 8 0 0 1-8-13z" ${FS}/><path d="M7 13c0-4 4-6 9-6s9 2 9 6zM16 7V4"/>`),
  egg: S(`<path d="M16 4c5 0 9 8 9 14a9 9 0 0 1-18 0C7 12 11 4 16 4z" ${FS}/><path d="M11 17l2.5 2 2.5-2 2.5 2 2.5-2"/>`),
  dino: S(`<path d="M5 24c0-6 4-10 10-10h3V8a3 3 0 0 1 6 0v3h2a2 2 0 0 1 0 4h-3v5c0 4-3 6-6 6H8" ${FS}/><circle cx="23" cy="8" r="1" ${F}/><path d="M10 26v2M17 26v2"/>`),
  longneck: S(`<path d="M4 24c2-5 6-6 11-6h3c1-5 1-10 4-12 2-1.5 5 0 5 2.5 0 1.5-1.5 2-3 2-1 3-1 6-1 9 3 1 4 3 4 5H4z" ${FS}/><path d="M9 25v3M20 25v3"/>`),
  gem: S(`<path d="M9 5h14l5 7-12 15L4 12z" ${FS}/><path d="M4 12h24M12 5l-3 7 7 15 7-15-3-7"/>`),
  pearl: S(`<path d="M4 20h24c0 4.5-5.5 8-12 8S4 24.5 4 20z" ${FS}/><path d="M9 20.5l1.5 6M16 20.5v7.5M23 20.5l-1.5 6"/><circle cx="16" cy="13" r="6" ${FS}/><circle cx="14" cy="11" r="1.6" ${F}/>`),
  shell: S(`<path d="M16 26C8 26 4 19 4 14 8 8 12 5 16 5s8 3 12 9c0 5-4 12-12 12z" ${FS}/><path d="M16 26V8M11 25l-3-14M21 25l3-14"/>`),
  turtle: S(`<ellipse cx="15" cy="17" rx="9" ry="7" ${FS}/><path d="M24 15c2-1 4 0 4 2s-2 3-4 2M8 22l-2 3M20 22l2 3M8 12l-2-3M20 12l2-3"/><path d="M11 13l4 4 4-4M15 17v6"/>`),
  shark: S(`<path d="M3 18c5-5 12-7 18-6l3-6 1 7c2 1 3 2 4 4-6 3-15 4-26 1z" ${FS}/><circle cx="23" cy="16" r="1" ${F}/><path d="M11 20c2 0 3 1 4 3"/>`),
  whale: S(`<path d="M4 16c0-5 5-8 12-8 6 0 10 4 10 9h2c0-2 1-4 3-4-1 4-1 6-4 8-4 3-9 4-13 4C8 25 4 21 4 16z" ${FS}/><circle cx="10" cy="15" r="1.2" ${F}/><path d="M12 5c0 2-1 3-2 3M14 4v4"/>`),
  puffer: S(`<circle cx="15" cy="16" r="9" ${FS}/><path d="M15 4v3M15 25v3M3 16h3M8 8l2 2M8 24l2-2M22 8l-2 2M22 24l-2-2M24 16l5-3v6z"/><circle cx="12" cy="14" r="1.2" ${F}/>`),
  angler: S(`<path d="M5 18c0-6 5-9 11-9 5 0 9 3 10 8l3-3v9l-3-3c-1 4-5 7-10 7S5 23 5 18z" ${FS}/><path d="M12 9c0-4 3-6 6-5"/><circle cx="19" cy="5" r="2.2" ${F}/><path d="M8 20l2 1 2-1 2 1"/>`),
  lantern: S(`<path d="M11 8h10l2 4v10l-2 4H11l-2-4V12z" ${FS}/><path d="M13 4h6M16 4v4"/><circle cx="16" cy="17" r="3" ${F}/>`),
  octopus: S(`<path d="M7 16a9 9 0 0 1 18 0v3H7z" ${FS}/><path d="M8 19c-1 4-3 5-4 6M12 19c0 4-1 6-2 8M16 19v9M20 19c0 4 1 6 2 8M24 19c1 4 3 5 4 6"/><circle cx="13" cy="13" r="1.2" ${F}/><circle cx="19" cy="13" r="1.2" ${F}/>`),
  jelly: S(`<path d="M6 15a10 10 0 0 1 20 0c-3 1-6 1.5-10 1.5S9 16 6 15z" ${FS}/><path d="M10 17c0 4 1 6-1 10M14 17c0 4 1 7 0 10M18 17c0 4-1 7 0 10M22 17c0 4-1 6 1 10"/>`),
  penguin: S(`<path d="M16 4c-5 0-8 5-8 12 0 6 3 11 8 11s8-5 8-11c0-7-3-12-8-12z" ${FS}/><path d="M16 10c-3 0-4 4-4 8s1 7 4 7 4-3 4-7-1-8-4-8z"/><path d="M15 9l1 2 1-2M11 27h3M18 27h3"/>`),
  seal: S(`<path d="M5 25c1-8 6-14 13-14 3 0 5 2 5 5 3 1 5 3 5 6l-4 1c-2 2-10 3-19 2z" ${FS}/><circle cx="20" cy="15" r="1.1" ${F}/><circle cx="21" cy="6" r="3"/>`),
  snowflake: S(`<path d="M16 3v26M4.7 9.5l22.6 13M4.7 22.5l22.6-13M13 5l3 3 3-3M13 27l3-3 3 3"/>`),
  mammoth: S(`<path d="M5 24V15c0-5 4-9 10-9h3c5 0 9 4 9 9v2c0 3-1 6-3 7v-4c-1 2-3 3-5 3v2h-4v-3H10v3H6z" ${FS}/><path d="M24 17c0 4-2 8-6 8M20 13c-1 1-3 1-4 0"/>`),
  snowball: S(`<circle cx="16" cy="17" r="10" ${FS}/><path d="M10 13c2-2 4-2.5 6-2.5"/><circle cx="20" cy="20" r="1" ${F}/><circle cx="12" cy="21" r="0.8" ${F}/>`),
  igloo: S(`<path d="M3 25a13 13 0 0 1 26 0z" ${FS}/><path d="M12 25v-4a4 4 0 0 1 8 0v4M7 17h18M5 21h5M22 21h5M12 13l1 4M19 13l-1 4"/>`),
  crab: S(`<ellipse cx="16" cy="19" rx="8" ry="5.5" ${FS}/><path d="M7 15c-3-1-4-4-3-7l3 2M25 15c3-1 4-4 3-7l-3 2M9 23l-3 3M23 23l3 3M13 13v-3M19 13v-3"/>`),
  fish: S(`<path d="M4 16c3-5 8-7 13-7 5 0 8 4 9 7-1 3-4 7-9 7-5 0-10-2-13-7z" ${FS}/><path d="M26 16l3-4v8z"/><circle cx="10" cy="15" r="1.2" ${F}/>`),
  song: S(`<path d="M12 22V8l12-3v14"/><circle cx="9" cy="22" r="3" ${FS}/><circle cx="21" cy="19" r="3" ${FS}/><path d="M4 9c1-1 2-1 3 0"/>`),
  ring: S(`<circle cx="16" cy="16" r="10"/><circle cx="16" cy="16" r="6" ${FS}/>`),
  fruit: S(`<circle cx="16" cy="18" r="9" ${FS}/><path d="M16 9c0-3 2-5 5-5M16 9c-3-2-6-1-7 1"/>`),
  snowman: S(`<circle cx="16" cy="22" r="7" ${FS}/><circle cx="16" cy="11" r="5" ${FS}/><path d="M11 6h10M13 6V3h6v3"/>`),
  bigbubble: S(`<circle cx="15" cy="16" r="12" ${FS}/><path d="M8 11a8 8 0 0 1 6-4.5"/><circle cx="15" cy="16" r="4"/>`),
  wave: S(`<path d="M3 12c3-3 6-3 9 0s6 3 9 0 6-3 8-1M3 19c3-3 6-3 9 0s6 3 9 0 6-3 8-1" />`),
  volcano: S(`<path d="M3 27l8-14h10l8 14z" ${FS}/><path d="M13 13c0-3 1-5 3-5s3 2 3 5M14 6c0-2 1-3 2-3M18 5c1-1 2-1 3 0"/>`),
  mountain: S(`<path d="M2 27L12 10l5 7 4-5 9 15z" ${FS}/><path d="M9.5 14l2.5 2 2-2"/>`),
  cave: S(`<path d="M3 27c0-11 6-20 13-20s13 9 13 20z" ${FS}/><path d="M11 27c0-5 2-9 5-9s5 4 5 9"/>`),
  meadow: S(`<path d="M3 27c4-5 9-7 13-7s9 2 13 7z" ${FS}/><path d="M12 20v-6"/><circle cx="12" cy="10" r="5" ${FS}/><circle cx="23" cy="9" r="3"/><circle cx="20" cy="16" r="1.6" ${F}/>`),
  trophy: S(`<path d="M10 5h12v6a6 6 0 0 1-12 0z" ${FS}/><path d="M10 7H6a4 4 0 0 0 4 5M22 7h4a4 4 0 0 1-4 5M16 17v5M11 27h10M12 22h8v5h-8z"/>`),
  space: S(`<rect x="3" y="11" width="26" height="10" rx="3" ${FS}/>`),
  wasd: S(`<rect x="12" y="4" width="8" height="8" rx="2"/><rect x="3" y="14" width="8" height="8" rx="2"/><rect x="12" y="14" width="8" height="8" rx="2"/><rect x="21" y="14" width="8" height="8" rx="2"/>`),
  swap: S(`<path d="M6 11h17l-4-4M26 21H9l4 4"/><circle cx="6" cy="11" r="1.4" ${F}/><circle cx="26" cy="21" r="1.4" ${F}/>`),
  tap: S(`<path d="M13 17V7.5a2 2 0 0 1 4 0V15l5.2 1.3a2.5 2.5 0 0 1 1.8 2.9L23 25.5a3 3 0 0 1-3 2.5h-5.2a3 3 0 0 1-2.4-1.2L8.6 21.7a1.8 1.8 0 0 1 2.7-2.4z" ${FS}/><path d="M10 6.5a5 5 0 0 1 10 0"/>`),
  drag: S(`<path d="M13 18V9.5a2 2 0 0 1 4 0V16l5 1.2a2.4 2.4 0 0 1 1.8 2.8L23 26a2.6 2.6 0 0 1-2.6 2h-5a3 3 0 0 1-2.4-1.2L9.4 22a1.7 1.7 0 0 1 2.6-2.2z" ${FS}/><path d="M4 9h6M4 9l2.5-2.5M4 9l2.5 2.5M26 9h-5M26 9l-2.5-2.5M26 9l-2.5 2.5"/>`),
  joystick: S(`<circle cx="16" cy="16" r="12" ${FS}/><circle cx="16" cy="16" r="5" ${F}/><path d="M16 3.5v3M16 25.5v3M3.5 16h3M25.5 16h3"/>`),
  jumpbtn: S(`<circle cx="16" cy="16" r="12" ${FS}/><path d="M16 23V10M10.5 15.5L16 10l5.5 5.5"/>`),
  arrows: S(`<path d="M16 4l-4 5h8zM16 28l-4-5h8zM4 16l5-4v8zM28 16l-5-4v8z" ${F}/>`),
};

export function icon(name: string): string {
  return ICONS[name] ?? ICONS.dot;
}

/** Swap keyboard/mouse glyphs for touch glyphs on touch screens. */
export function inputIcon(name: string, touch: boolean): string {
  if (!touch) return name;
  const map: Record<string, string> = { mouse: 'drag', keyboard: 'tap', wasd: 'joystick', arrows: 'joystick', space: 'jumpbtn' };
  return map[name] ?? name;
}

export function hasIcon(name: string): boolean {
  return name in ICONS;
}

/** Inline keycap for hint text. */
export function kbd(label: string): string {
  if (label === 'mouse') return `<span class="kbd">${icon('mouse')}</span>`;
  return `<span class="kbd">${label}</span>`;
}

/** Turn "[W] [A] [S] [D]" style markup into keycaps. */
export function renderKeys(text: string): string {
  return escapeHtml(text).replace(/\[([^\]]+)\]/g, (_m, k: string) => kbd(k));
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
