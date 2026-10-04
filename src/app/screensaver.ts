// Screensaver: the artwork alone, fullscreen. Moving the pointer (or tapping, or
// pressing a key) brings back a slim dock with the exit button; it fades away,
// along with the cursor, once you stop.

import type { Mode, Store } from './store';

const IDLE_MS = 2200;

export class Screensaver {
  private idleTimer = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private wentFullscreen = false;
  private modeBefore: Mode = 'moving';
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(private store: Store, private app: HTMLElement, private dock: HTMLElement) {
    for (const type of ['pointermove', 'pointerdown', 'wheel', 'keydown'] as const) {
      addEventListener(type, () => this.wake(), { passive: true });
    }
    // Leaving browser fullscreen (Esc, F11, swipe) leaves the screensaver too.
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.wentFullscreen && this.active) this.exit();
    });
    // Wake locks are dropped while the tab is hidden; take it back on return.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.active) void this.lockScreen();
    });
  }

  get active(): boolean {
    return this.store.state.immersive;
  }

  toggle(): void {
    if (this.active) this.exit();
    else this.enter();
  }

  /** Call from a click or key press: browsers only allow fullscreen from a user gesture. */
  enter({ fullscreen = true } = {}): void {
    if (this.active) return;
    this.modeBefore = this.store.state.mode;
    // A screensaver should move — unless the visitor asked for less motion.
    this.store.set({ immersive: true, mode: this.reducedMotion.matches ? this.modeBefore : 'moving' });
    const root = document.documentElement;
    if (fullscreen && root.requestFullscreen && !document.fullscreenElement) {
      root
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() => (this.wentFullscreen = true))
        .catch(() => {
          /* e.g. iPhone Safari: the in-page view still works */
        });
    }
    void this.lockScreen();
    // Show the dock for a moment so it's clear where the way back is.
    this.wake(1600);
  }

  exit(): void {
    if (!this.active) return;
    clearTimeout(this.idleTimer);
    this.app.dataset.idle = 'false';
    this.store.set({ immersive: false, mode: this.modeBefore });
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    this.wentFullscreen = false;
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  private wake(delay = IDLE_MS): void {
    if (!this.active) return;
    this.app.dataset.idle = 'false';
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      // Stay visible while someone is pointing at, or keyboard-focused in, the dock.
      if (this.dock.matches(':hover') || this.dock.querySelector(':focus-visible')) return this.wake(delay);
      this.app.dataset.idle = 'true';
    }, delay);
  }

  /** Keeps the display awake, like a real screensaver should (where supported). */
  private async lockScreen(): Promise<void> {
    if (this.wakeLock || !('wakeLock' in navigator)) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => (this.wakeLock = null));
    } catch {
      /* denied or unsupported: the animation still runs */
    }
  }
}
