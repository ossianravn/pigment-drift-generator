// Pigment Drift runtime — a tiny, dependency-free custom element that paints a
// live watercolor background. Built to public/embed/pigment-drift.min.js.
//
//   <pigment-drift config='{"seed":4127,...}' poster="still.webp"></pigment-drift>
//   <script src="pigment-drift.min.js" defer></script>
//
// Attributes: config (JSON), poster (image URL shown until the first frame or if
// WebGL is unavailable), still (no animation), phase (0..1, the moment for still),
// fps (default 30), quality (render scale 0.25..1, default 0.75), max-dpr (default 1.5).
// It pauses off-screen and in background tabs, and respects prefers-reduced-motion.

import { type DriftConfig, sanitizeConfig } from '../engine/params';
import { DriftRenderer } from '../engine/renderer';

export { VERSION } from './version';

/** Max pixels drawn per animated frame (~1460×910). */
const PIXEL_BUDGET = 1.33e6;

export interface MountOptions {
  still?: boolean;
  phase?: number;
  fps?: number;
  quality?: number;
  maxDpr?: number;
  poster?: string;
}

const STYLE = `
:host { display: block; position: relative; overflow: hidden; background: var(--pd-paper, transparent) center / cover no-repeat; }
:host([hidden]) { display: none; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; opacity: 0; transition: opacity .6s ease; }
canvas.ready { opacity: 1; }
`;

const num = (v: string | null | undefined, fallback: number) => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : fallback;
};

class Controller {
  private renderer: DriftRenderer | null = null;
  private config: DriftConfig;
  private opts: Required<Omit<MountOptions, 'poster'>> & { poster?: string };
  private raf = 0;
  private start = performance.now();
  private lastFrame = 0;
  private visible = true;
  private dirty = true;
  private ro: ResizeObserver;
  private io: IntersectionObserver;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private onVis = () => this.schedule();
  private onReduced = () => this.schedule();

  constructor(private host: HTMLElement, private canvas: HTMLCanvasElement, config: unknown, options: MountOptions = {}) {
    this.config = sanitizeConfig(config);
    this.opts = {
      still: options.still ?? false,
      phase: options.phase ?? 0,
      fps: Math.min(60, Math.max(1, options.fps ?? 30)),
      quality: Math.min(1, Math.max(0.25, options.quality ?? 0.75)),
      maxDpr: Math.min(3, Math.max(0.5, options.maxDpr ?? 1.5)),
      poster: options.poster,
    };
    this.applyPoster();
    this.init();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.raf);
      canvas.classList.remove('ready');
    });
    canvas.addEventListener('webglcontextrestored', () => this.init());
    this.ro = new ResizeObserver(() => {
      this.dirty = true;
      this.schedule();
    });
    this.ro.observe(host);
    this.io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      this.schedule();
    });
    this.io.observe(host);
    document.addEventListener('visibilitychange', this.onVis);
    this.reduced.addEventListener?.('change', this.onReduced);
  }

  get animating(): boolean {
    return !this.opts.still && !this.reduced.matches && this.config.motion + this.config.flow > 0;
  }

  update(config?: unknown, options?: MountOptions): void {
    if (config !== undefined) {
      this.config = sanitizeConfig(config);
      this.renderer?.setConfig(this.config);
      this.applyPoster();
    }
    if (options) Object.assign(this.opts, options);
    this.dirty = true;
    this.schedule();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.io.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
    this.reduced.removeEventListener?.('change', this.onReduced);
    this.renderer?.dispose();
    this.renderer = null;
  }

  private init(): void {
    try {
      this.renderer = new DriftRenderer(this.canvas);
      this.renderer.setConfig(this.config);
      this.dirty = true;
      this.schedule();
    } catch {
      this.renderer = null; // No WebGL2: the poster / paper color stays visible.
    }
  }

  private applyPoster(): void {
    this.host.style.setProperty('--pd-paper', this.config.paper);
    if (this.opts.poster) this.host.style.backgroundImage = `url("${this.opts.poster.replace(/"/g, '%22')}")`;
  }

  private schedule(): void {
    cancelAnimationFrame(this.raf);
    if (!this.renderer || document.hidden || !this.visible) return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    const r = this.renderer;
    if (!r || r.isContextLost) return;
    const animating = this.animating;
    if (animating && now - this.lastFrame < 1000 / this.opts.fps - 2) {
      this.raf = requestAnimationFrame((t) => this.frame(t));
      return;
    }
    if (animating || this.dirty) {
      const rect = this.host.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio || 1, this.opts.maxDpr);
      // Stills get full quality: they only render once per resize. Animation stays
      // within a pixel budget — soft watercolor upscales invisibly.
      const area = Math.max(1, rect.width * rect.height * dpr * dpr);
      const scale = animating ? Math.min(this.opts.quality, Math.sqrt(PIXEL_BUDGET / area)) : 1;
      r.setSize(rect.width * dpr * scale, rect.height * dpr * scale);
      const phase = animating ? ((now - this.start) / 1000 / this.config.loop) % 1 : this.opts.phase;
      r.draw({ phase, pixelRatio: dpr * scale });
      this.canvas.classList.add('ready');
      this.dirty = false;
      this.lastFrame = now;
    }
    if (animating) this.raf = requestAnimationFrame((t) => this.frame(t));
  }
}

/** Mounts a live background into any element (the element should be positioned). */
export function mount(target: HTMLElement, config: unknown, options: MountOptions = {}) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
  target.prepend(canvas);
  const ctl = new Controller(target, canvas, config, options);
  return {
    update: (cfg?: unknown, opts?: MountOptions) => ctl.update(cfg, opts),
    destroy: () => {
      ctl.destroy();
      canvas.remove();
    },
  };
}

class PigmentDriftElement extends HTMLElement {
  static observedAttributes = ['config', 'still', 'phase', 'fps', 'quality', 'max-dpr', 'poster'];
  private ctl: Controller | null = null;
  private canvas: HTMLCanvasElement;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.canvas = document.createElement('canvas');
    root.append(style, this.canvas);
  }

  connectedCallback(): void {
    if (!this.hasAttribute('aria-hidden')) this.setAttribute('aria-hidden', 'true');
    this.ctl = new Controller(this, this.canvas, this.readConfig(), this.readOptions());
  }

  disconnectedCallback(): void {
    this.ctl?.destroy();
    this.ctl = null;
  }

  attributeChangedCallback(name: string): void {
    if (!this.ctl) return;
    this.ctl.update(name === 'config' ? this.readConfig() : undefined, this.readOptions());
  }

  private readConfig(): unknown {
    const attr = this.getAttribute('config');
    const inline = this.querySelector('script[type="application/json"]')?.textContent;
    try {
      return JSON.parse(attr ?? inline ?? '{}');
    } catch {
      console.warn('<pigment-drift>: config is not valid JSON, using defaults.');
      return {};
    }
  }

  private readOptions(): MountOptions {
    return {
      still: this.hasAttribute('still'),
      phase: num(this.getAttribute('phase'), 0),
      fps: num(this.getAttribute('fps'), 30),
      quality: num(this.getAttribute('quality'), 0.75),
      maxDpr: num(this.getAttribute('max-dpr'), 1.5),
      poster: this.getAttribute('poster') ?? undefined,
    };
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('pigment-drift')) {
  customElements.define('pigment-drift', PigmentDriftElement);
}
