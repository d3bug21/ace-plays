// Device / browser detection used for mobile-only niceties (rotate prompt,
// compact HUD, touch glyphs). Desktop browsers and the Electron app never
// match `isHandheld`.

export interface DeviceInfo {
  /** Running inside the Ace Plays! desktop (Electron) app. */
  desktopApp: boolean;
  /** Phone or tablet browser (incl. iPadOS that reports itself as a Mac). */
  handheld: boolean;
  /** iPhone / iPad / iPod (incl. iPadOS desktop-mode UA). */
  ios: boolean;
  android: boolean;
  /** Social / in-app browser (Facebook, Instagram, TikTok, ...). */
  inApp: boolean;
  /** Friendly name of the in-app browser, when known. */
  inAppName: string | null;
  /** Primary input is touch. */
  touchPrimary: boolean;
}

const IN_APP: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i, 'Facebook'],
  [/Messenger|MessengerForiOS|Orca-Android/i, 'Messenger'],
  [/Instagram/i, 'Instagram'],
  [/musical_ly|TikTok|BytedanceWebview|trill/i, 'TikTok'],
  [/Snapchat/i, 'Snapchat'],
  [/\bLine\//i, 'LINE'],
  [/MicroMessenger/i, 'WeChat'],
  [/LinkedInApp/i, 'LinkedIn'],
  [/Twitter|TwitterAndroid/i, 'X'],
  [/Pinterest/i, 'Pinterest'],
];

export function detectDevice(nav: Navigator = navigator, win: Window = window): DeviceInfo {
  const ua = nav.userAgent || '';
  const desktopApp = !!(win as unknown as { acePlaysDesktop?: { isDesktop?: boolean } }).acePlaysDesktop?.isDesktop || /Electron\//.test(ua);
  const maxTouch = typeof nav.maxTouchPoints === 'number' ? nav.maxTouchPoints : 0;
  const coarse = !!win.matchMedia?.('(pointer: coarse)').matches;
  const noHover = !!win.matchMedia?.('(hover: none)').matches;
  // iPadOS 13+ Safari reports a Mac user agent; it is the only "Mac" with multi-touch.
  const ipadOS = /Macintosh/.test(ua) && maxTouch > 0;
  const ios = /iPhone|iPad|iPod/i.test(ua) || ipadOS;
  const android = /Android/i.test(ua);
  const androidWebView = android && /; wv\)/.test(ua);
  let inAppName: string | null = null;
  for (const [re, name] of IN_APP) {
    if (re.test(ua)) {
      inAppName = name;
      break;
    }
  }
  if (!inAppName && androidWebView) inAppName = 'an app';
  const inApp = inAppName !== null;
  const mobileUA = /Mobi|iPhone|iPad|iPod|Android|Silk|Kindle|PlayBook|BlackBerry|Opera Mini|IEMobile|webOS/i.test(ua);
  // A touch-first device even if the UA hides it (e.g. "request desktop site").
  const touchFirst = maxTouch > 0 && coarse && noHover;
  const handheld = !desktopApp && (mobileUA || ipadOS || inApp || touchFirst);
  return { desktopApp, handheld, ios, android, inApp, inAppName, touchPrimary: !desktopApp && (coarse || (maxTouch > 0 && handheld)) };
}
