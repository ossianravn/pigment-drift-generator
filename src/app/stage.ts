// The live preview: a full-page canvas that can also show the piece framed
// as a phone (or as a desktop screen when you're on a phone), with an
// adaptive render loop that keeps animation smooth on modest GPUs.

import { DriftRenderer, WebGLUnavailableError } from '../engine/renderer';
import type { Device, Store } from './store';

/** CSS viewport each framed preview emulates, so grain and shapes match the real device. */
export const EMULATED: Record<Device, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const SMALL_SCREEN = '(max-width: 760px)';
/** Pixels drawn per frame while animating: ~1600×1000 on desktops, less on phones. */
const PIXEL_BUDGET = { desktop: 1.6e6, phone: 0.9e6 };

export class Stage {
  renderer: DriftRenderer | null = null;
  private canvas: HTMLCanvasElement;
  private frame: HTMLElement;
  private app: HTMLElement;
  private label: HTMLElement;
  private dirty = true;
  /** Adaptive multiplier on the animation pixel budget (drops on slow GPUs). */
  private quality = 1;
  private slowFrames = 0;
  private fastFrames = 0;
  private ema = 16;
  private last = 0;
  private lastDraw = 0;
  private hqTimer = 0;
  private emuWidth = 0;
  private onPhase: (phase: number) => void;
  private small = matchMedia(SMALL_SCREEN);

  constructor(private store: Store, onPhase: (phase: number) => void) {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.frame = document.getElementById('frame')!;
    this.app = document.getElementById('app')!;
    this.label = document.getElementById('frameLabel')!;
    this.onPhase = onPhase;

    try {
      this.renderer = new DriftRenderer(this.canvas);
      this.renderer.setConfig(store.state.config);
    } catch (err) {
      if (!(err instanceof WebGLUnavailableError)) console.error(err);
      document.getElementById('fallback')!.hidden = false;
      return;
    }

    this.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.renderer = new DriftRenderer(this.canvas);
      this.renderer.setConfig(this.store.state.config);
      this.invalidate();
    });

    store.subscribe((state, changed) => {
      if (changed.has('config')) {
        this.renderer?.setConfig(state.config);
        this.invalidate();
      }
      if (changed.has('device') || changed.has('panelOpen') || changed.has('immersive')) this.layout();
      if (changed.has('phase') || changed.has('mode')) this.invalidate();
    });

    addEventListener('resize', () => this.layout());
    this.small.addEventListener('change', () => this.layout());
    this.layout();
    requestAnimationFrame((t) => this.tick(t));
  }

  /** The device that fills the whole page natively on this screen. */
  get nativeDevice(): Device {
    return this.small.matches ? 'mobile' : 'desktop';
  }

  get isFramed(): boolean {
    return !this.store.state.immersive && this.store.state.device !== this.nativeDevice;
  }

  invalidate(): void {
    this.dirty = true;
  }

  layout(): void {
    const { device, panelOpen } = this.store.state;
    const framed = this.isFramed;
    this.app.dataset.device = device;
    this.app.dataset.framed = String(framed);
    const vw = innerWidth;
    const vh = innerHeight;

    if (!framed) {
      Object.assign(this.frame.style, { left: '0px', top: '0px', width: `${vw}px`, height: `${vh}px` });
      this.emuWidth = vw;
      this.label.textContent = '';
    } else {
      const emu = EMULATED[device];
      const small = this.small.matches;
      const panelW = !small && panelOpen ? Math.min(380, vw * 0.32) + 24 : 0;
      const top = small ? 84 : 120;
      const bottom = small ? 150 : 100;
      const availW = vw - panelW - 48;
      const availH = vh - top - bottom;
      const s = Math.min(availW / emu.width, availH / emu.height);
      const w = Math.round(emu.width * s);
      const h = Math.round(emu.height * s);
      const left = Math.round((vw - panelW - w) / 2);
      const topPx = Math.round(top + (availH - h) / 2);
      Object.assign(this.frame.style, { left: `${left}px`, top: `${topPx}px`, width: `${w}px`, height: `${h}px` });
      this.emuWidth = emu.width;
      this.label.textContent = `${emu.width} × ${emu.height}`;
    }
    this.invalidate();
  }

  /**
   * Moving previews render within a pixel budget and are upscaled — soft watercolor
   * hides it, and it keeps animation smooth on integrated GPUs. Stills render at full
   * resolution once you stop editing.
   */
  private resizeBuffer(hq: boolean): void {
    if (!this.renderer) return;
    const rect = this.frame.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const full = rect.width * rect.height * dpr * dpr;
    const budget = this.small.matches ? PIXEL_BUDGET.phone : PIXEL_BUDGET.desktop;
    const scale = hq ? 1 : Math.min(1, Math.sqrt(budget / Math.max(1, full))) * this.quality;
    this.renderer.setSize(rect.width * dpr * scale, rect.height * dpr * scale);
  }

  private draw(hq: boolean): void {
    if (!this.renderer || this.renderer.isContextLost) return;
    this.resizeBuffer(hq);
    const pixelRatio = this.canvas.width / Math.max(1, this.emuWidth);
    this.renderer.draw({ phase: this.store.state.phase, pixelRatio });
  }

  private tick(now: number): void {
    requestAnimationFrame((t) => this.tick(t));
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const { mode, config } = this.store.state;

    if (mode === 'moving' && !document.hidden) {
      // Cap at ~60fps: high-refresh displays don't need twice the GPU work for a slow drift.
      if (now - this.lastDraw < 15.5) {
        this.last = now - dt * 1000;
        return;
      }
      this.lastDraw = now;
      const phase = (this.store.state.phase + dt / config.loop) % 1;
      this.store.state.phase = phase; // hot path: skip listeners, the stage owns playback
      this.onPhase(phase);
      this.adapt(dt * 1000);
      this.draw(false);
      return;
    }

    if (this.dirty) {
      this.dirty = false;
      // While editing a still, draw fast; sharpen to full resolution once idle.
      this.draw(false);
      clearTimeout(this.hqTimer);
      this.hqTimer = window.setTimeout(() => {
        if (this.store.state.mode === 'still') this.draw(true);
      }, 160);
    }
  }

  /** Trims the budget when frames run long for a while; restores it when there's headroom. */
  private adapt(frameMs: number): void {
    if (frameMs <= 0) return;
    this.ema = this.ema * 0.92 + frameMs * 0.08;
    if (this.ema > 34) {
      this.fastFrames = 0;
      if (++this.slowFrames > 30 && this.quality > 0.6) {
        this.quality = Math.max(0.6, this.quality * 0.9);
        this.slowFrames = 0;
      }
    } else if (this.ema < 20) {
      this.slowFrames = 0;
      if (++this.fastFrames > 120 && this.quality < 1) {
        this.quality = Math.min(1, this.quality * 1.1);
        this.fastFrames = 0;
      }
    }
  }
}
