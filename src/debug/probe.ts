import type { Game } from '../core/Game';

// Directional-control verification adapter. It drives the REAL production
// game: reset() loads the actual tutorial stage and places Ace with the normal
// spawn routine; sample() reads Ace's real body position and camera basis.
// Keyboard input arrives through the same window listeners players use.

export function installDirectionalProbe(game: Game): void {
  const probe = {
    schemaVersion: '1.0' as const,
    reset(): Promise<void> {
      game.probeReset();
      // Let one real animation frame run so the camera/world sync to the new state.
      return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    },
    sample() {
      return game.probeSample();
    },
  };
  Object.defineProperty(window, '__ONESHOT_DIRECTIONAL_CONTROL_PROBE__', { value: Object.freeze(probe), configurable: true });
}
