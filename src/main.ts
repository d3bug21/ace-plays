import './styles/main.css';
import { Game } from './core/Game';
import { installDirectionalProbe } from './debug/probe';

const params = new URLSearchParams(location.search);
const probe = params.get('oneshot-directional-probe') === '1';
const app = document.getElementById('app')!;

function showFatal(msg: string): void {
  app.innerHTML = `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#1d2a33;color:#fbf6ec;font:20px Fredoka,system-ui;text-align:center;padding:24px">${msg}</div>`;
}

let game: Game | null = null;
try {
  game = new Game(app, probe);
} catch (e) {
  console.error(e);
  showFatal('Oh no! Ace Plays! needs a computer with 3D graphics (WebGL) turned on.');
}

if (game) {
  if (probe) installDirectionalProbe(game);
  else {
    const dev = params.get('stage');
    if (dev && import.meta.env.DEV) game.devEnter(dev);
    else game.start();
  }
  (window as unknown as { __acePlays?: Game }).__acePlays = import.meta.env.DEV ? game : undefined;
  // Offline support for the web build (versioned per deploy). Never in the desktop app or probe runs.
  if (import.meta.env.PROD && !probe && !game.device.desktopApp && location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    });
  }
}
