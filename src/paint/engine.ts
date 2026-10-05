// The paint studio's WebGL2 engine: a pigment field on a sheet of paper,
// moved by a small fluid sim and rendered in the pigment drift style.

import { hexToLinear, hexToOklab } from '../engine/color';
import type { DriftConfig } from '../engine/params';
import { createRng } from '../engine/params';
import { breathe } from './noise';
import * as SH from './shaders';

/** A painting can hold this many inks at once. */
export const MAX_INKS = 3;

export interface Look {
  paper: string;
  /** One to three inks, each five colors from deepest to palest, like the generator's palettes. */
  inks: string[][];
  layers: number;
  bleed: number;
  drift: number;
  texture: number;
  edges: number;
  hueDrift: number;
  mist: number;
  ridge: number;
  feather: number;
  density: number;
}

export const Kind = { Paint: 0, Water: 1, Lift: 2 } as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

/** A brush movement this frame, in field texels. */
export interface Segment {
  ax: number; ay: number; bx: number; by: number;
  radius: number;
  target: number;
  strength: number;
  kind: Kind;
  /** Which ink (0..2) a paint stroke lays down. */
  slot: number;
  /** Velocity the water is pulled toward (texels/s) and how hard. */
  fx: number; fy: number; coupling: number;
}

/** A drop growing from radius r0 to r1 this frame (field texels). */
export interface Drop {
  x: number; y: number; r0: number; r1: number;
  ink: number;
  kind: Kind;
  /** Which ink (0..2) an ink drop is. */
  slot: number;
}

export interface SheetMeta {
  /** Sheet size in CSS px; the viewport is a window onto its center. */
  width: number;
  height: number;
  /** One "sheet unit" in CSS px: the scale of paper texture and breathing. */
  unit: number;
  seed: [number, number];
}

export interface SavedSheet extends SheetMeta {
  fieldW: number;
  fieldH: number;
  /**
   * Row by row from the bottom. Format 2: four bytes per texel (pigment as 16-bit
   * big-endian, then the second and third inks' shares). Older saves (no format):
   * two bytes per texel, pigment only.
   */
  data: Uint8Array;
  format?: 2;
}

interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number }
interface Prog { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }
interface Format { internal: number; format: number }
/** Per-canvas-size helpers for the look: baked paper and the quarter-res breathing noise. */
interface Aux { w: number; h: number; paper: Target; flow: Target; flowTex: WebGLTexture[]; key: string }

const MAX_SEGS = 16;
const MAX_DROPS = 4;
const VEL_DOWNSCALE = 4;
const PRESSURE_ITERATIONS = 18;
const SETTLE_SECONDS = 1.1;

export class PaintUnavailableError extends Error {}

export class PaintEngine {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  meta!: SheetMeta;
  /** Field texels per CSS px. */
  k = 1;
  fieldW = 0;
  fieldH = 0;
  viewW = 1;
  viewH = 1;
  look!: Look;

  private progs: Record<string, Prog> = {};
  private vao: WebGLVertexArrayObject;
  private rg: Format;
  private r: Format;
  private rgba: Format;
  private aux: Aux | null = null;
  private field!: [Target, Target];
  private vel!: [Target, Target];
  private pressure!: [Target, Target];
  private divergence!: Target;
  private curl!: Target;
  private settleTarget: Target | null = null;
  private settleLeft = 0;
  private undoStack: Target[] = [];
  private redoStack: Target[] = [];
  private pool: Target[] = [];
  private maxSnapshots = 12;
  private historyBytes = 64e6;
  private flowUntil = 0;
  private wetUntil = 0;
  private velDirty = false;
  private maxTexels: number;
  private paperFrom: number[] = [];
  private paperTo: number[] = [];
  private labFrom: number[] = [];
  private labTo: number[] = [];
  private tweenStart = 0;
  private tweenMs = 0;
  private segBuf = new Float32Array(MAX_SEGS * 4);
  private segPBuf = new Float32Array(MAX_SEGS * 4);
  private forceBuf = new Float32Array(MAX_SEGS * 4);
  private dropBuf = new Float32Array(MAX_DROPS * 4);
  private dropInkBuf = new Float32Array(MAX_DROPS * 4);

  constructor(canvas: HTMLCanvasElement, opts: { coarse: boolean }) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new PaintUnavailableError('WebGL2 is not available.');
    this.gl = gl;
    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    const rg = this.pickFormat([[gl.RG16F, gl.RG], [gl.RGBA16F, gl.RGBA]]);
    const r = this.pickFormat([[gl.R16F, gl.RED], [gl.RG16F, gl.RG], [gl.RGBA16F, gl.RGBA]]);
    const rgba = this.pickFormat([[gl.RGBA16F, gl.RGBA]]);
    if (!rg || !r || !rgba) throw new PaintUnavailableError('This GPU can’t render to float textures.');
    this.rg = rg;
    this.r = r;
    this.rgba = rgba;
    this.maxTexels = opts.coarse ? 0.55e6 : 2.1e6;
    this.historyBytes = opts.coarse ? 28e6 : 100e6;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const sources: Record<string, string> = {
      copy: SH.COPY, fill: SH.FILL, encode: SH.ENCODE, decode: SH.DECODE, settle: SH.SETTLE,
      velStep: SH.VEL_STEP, curl: SH.CURL, vorticity: SH.VORTICITY, divergence: SH.DIVERGENCE,
      scale: SH.SCALE, jacobi: SH.JACOBI, gradient: SH.GRADIENT,
      fieldStep: SH.FIELD_STEP, compose: SH.COMPOSE, paper: SH.PAPER, flow: SH.FLOW, render: SH.RENDER,
    };
    for (const [name, src] of Object.entries(sources)) this.progs[name] = this.program(src);
  }

  get isContextLost(): boolean {
    return this.gl.isContextLost();
  }

  /** False until a sheet has been created or loaded. */
  get ready(): boolean {
    return !!this.field && !!this.look;
  }

  /** True while anything is still moving, bleeding or drying. */
  isBusy(now: number): boolean {
    return now < this.flowUntil || now < this.wetUntil || this.settleLeft > 0 || this.isTweening(now);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // ------------------------------------------------------------- the sheet

  /** Starts a fresh, blank sheet covering at least the given CSS size. */
  newSheet(meta: SheetMeta): void {
    this.meta = { ...meta, seed: [...meta.seed] as [number, number] };
    this.release();
    this.allocate();
  }

  /** Grows the sheet (never shrinks it) so the viewport always sits on paper. */
  setView(cssW: number, cssH: number, canvasW: number, canvasH: number): void {
    this.viewW = Math.max(1, cssW);
    this.viewH = Math.max(1, cssH);
    if (this.canvas.width !== canvasW) this.canvas.width = canvasW;
    if (this.canvas.height !== canvasH) this.canvas.height = canvasH;
    if (!this.meta) return;
    if (cssW > this.meta.width + 0.5 || cssH > this.meta.height + 0.5) {
      const old = this.field[0];
      const oldK = this.k;
      const oldW = this.meta.width;
      const oldH = this.meta.height;
      this.meta.width = Math.max(this.meta.width, Math.ceil(cssW));
      this.meta.height = Math.max(this.meta.height, Math.ceil(cssH));
      this.release(old);
      this.allocate();
      // Old sheet, centered on the new one, at its own texel density.
      const s = oldK / this.k;
      const offX = ((this.meta.width - oldW) / 2) * this.k;
      const offY = ((this.meta.height - oldH) / 2) * this.k;
      this.run('copy', this.field[0], (u) => {
        this.gl.uniform4f(u.uMap, s, s, -offX * s, -offY * s);
      }, { uSrc: old.tex });
      this.deleteTarget(old);
    }
  }

  /** Field position (texels, y up) under a CSS point, including the breathing offset. */
  toField(cssX: number, cssY: number, time: number): [number, number] {
    const fx = (cssX + (this.meta.width - this.viewW) / 2) * this.k;
    const fy = (this.viewH - cssY + (this.meta.height - this.viewH) / 2) * this.k;
    const [wx, wy] = breathe(fx, fy, this.meta.unit * this.k, this.meta.seed, this.look?.drift ?? 0, time);
    return [fx + wx, fy + wy];
  }

  /** Lays a generator composition down as the new sheet (it flows into place). */
  compose(cfg: DriftConfig): void {
    if (!this.ready) return;
    this.checkpoint();
    const t = this.settleTarget ?? this.makeTarget(this.fieldW, this.fieldH, this.rgba, true);
    this.settleTarget = t;
    const rand = createRng(cfg.seed * 7919 + 13);
    const seedOff = [rand() * 240 - 120, rand() * 240 - 120];
    const anchor = { bottom: 0, top: 1, left: 2, right: 3 }[cfg.anchor] ?? 0;
    const gl = this.gl;
    this.run('compose', t, (u) => {
      gl.uniform2f(u.uView, this.viewW * this.k, this.viewH * this.k);
      gl.uniform2f(u.uViewOff, ((this.meta.width - this.viewW) / 2) * this.k, ((this.meta.height - this.viewH) / 2) * this.k);
      gl.uniform2f(u.uSeedOff, seedOff[0], seedOff[1]);
      gl.uniform1i(u.uAnchor, anchor);
      gl.uniform1f(u.uCoverage, cfg.coverage);
      gl.uniform1f(u.uRidge, cfg.ridge);
      gl.uniform1f(u.uScale, cfg.scale);
      gl.uniform1f(u.uWarp, cfg.warp);
      gl.uniform1f(u.uFeather, cfg.feather);
      gl.uniform1f(u.uMotion, cfg.motion);
      gl.uniform1f(u.uRiver, cfg.river);
      gl.uniform1f(u.uRiverWidth, cfg.riverWidth);
      gl.uniform1f(u.uRiverMeander, cfg.riverMeander);
      gl.uniform1f(u.uRiverDepth, cfg.riverDepth);
      gl.uniform1f(u.uRiverTilt, cfg.riverTilt);
    }, {});
    this.settleLeft = SETTLE_SECONDS;
  }

  /** Washes the sheet back to bare paper. */
  clear(): void {
    if (!this.ready) return;
    this.checkpoint();
    const t = this.settleTarget ?? this.makeTarget(this.fieldW, this.fieldH, this.rgba, true);
    this.settleTarget = t;
    this.fillTarget(t, [0, 0, 0, 0]);
    this.settleLeft = SETTLE_SECONDS * 0.8;
  }

  // ------------------------------------------------------------- history

  /** Remembers the sheet as it is now; call when a gesture starts. */
  checkpoint(): void {
    if (!this.ready) return;
    this.finishSettle();
    this.undoStack.push(this.snapshot());
    while (this.undoStack.length > this.maxSnapshots) this.deleteTarget(this.undoStack.shift()!);
    this.pool.push(...this.redoStack.splice(0));
    this.trimPool();
  }

  undo(): boolean {
    return this.travel(this.undoStack, this.redoStack);
  }

  redo(): boolean {
    return this.travel(this.redoStack, this.undoStack);
  }

  /** Snapshots keep pigment and inks in four bytes per texel; a restored sheet is dry. */
  private snapshot(): Target {
    const gl = this.gl;
    const snap = this.pool.pop() ?? this.makeTarget(this.fieldW, this.fieldH, { internal: gl.RGBA8, format: gl.RGBA }, false, gl.UNSIGNED_BYTE);
    this.run('encode', snap, () => {}, { uSrc: this.field[0].tex });
    return snap;
  }

  private travel(from: Target[], to: Target[]): boolean {
    const snap = from.pop();
    if (!snap) return false;
    this.finishSettle();
    to.push(this.snapshot());
    this.run('decode', this.field[0], (u) => this.gl.uniform1f(u.uInks, 1), { uSrc: snap.tex });
    this.pool.push(snap);
    this.trimPool();
    this.stopFlow();
    this.wetUntil = 0;
    return true;
  }

  // ------------------------------------------------------------- look

  setLook(look: Look, animate = false): void {
    const prev = this.look;
    this.look = { ...look, inks: look.inks.map((i) => [...i]) };
    const paper = hexToLinear(look.paper);
    const inks = Array.from({ length: MAX_INKS }, (_, i) => look.inks[i] ?? look.inks[0]);
    const lab = inks.flatMap((ink) => ink.flatMap((c) => hexToOklab(c)));
    const key = (l: Look) => `${l.paper}|${l.inks.join('|')}`;
    const now = performance.now();
    if (animate && prev && key(prev) !== key(look)) {
      const t = this.tweenT(now);
      this.paperFrom = mixArr(this.paperFrom, this.paperTo, t);
      this.labFrom = mixArr(this.labFrom, this.labTo, t);
      this.tweenStart = now;
      this.tweenMs = 700;
    } else if (!prev || key(prev) !== key(look)) {
      this.paperFrom = paper;
      this.labFrom = lab;
      this.tweenMs = 0;
    }
    this.paperTo = paper;
    this.labTo = lab;
  }

  isTweening(now: number): boolean {
    return this.tweenMs > 0 && now - this.tweenStart < this.tweenMs;
  }

  // ------------------------------------------------------------- simulation

  /** Advances the sheet by dt seconds. Returns false when nothing needed doing. */
  step(dt: number, now: number, segs: Segment[], drops: Drop[]): boolean {
    const gl = this.gl;
    const forcing = segs.some((s) => s.coupling > 0);
    if (forcing) this.flowUntil = now + 2000;
    if (segs.length || drops.length) this.wetUntil = now + 2500 + 6000 * this.look.bleed;
    const flowing = now < this.flowUntil;
    const wet = now < this.wetUntil;
    if (!flowing && !wet && !segs.length && !drops.length && this.settleLeft <= 0) {
      if (this.velDirty) this.stopFlow();
      return false;
    }
    dt = Math.min(dt, 1 / 30);

    const n = Math.min(segs.length, MAX_SEGS);
    for (let i = 0; i < n; i++) {
      const s = segs[i];
      this.segBuf.set([s.ax, s.ay, s.bx, s.by], i * 4);
      this.segPBuf.set([s.radius, s.target, s.strength, s.kind + 4 * s.slot], i * 4);
      this.forceBuf.set([s.fx, s.fy, s.radius * 1.3, s.coupling], i * 4);
    }
    const nd = Math.min(drops.length, MAX_DROPS);
    for (let i = 0; i < nd; i++) {
      const d = drops[i];
      this.dropBuf.set([d.x, d.y, d.r0 * d.r0, d.r1 * d.r1], i * 4);
      this.dropInkBuf.set([d.ink, 1.5, d.kind, d.slot], i * 4);
    }

    if (flowing) {
      this.velDirty = true;
      const [vw, vh] = [this.vel[0].w, this.vel[0].h];
      this.run('velStep', this.vel[1], (u) => {
        gl.uniform2f(u.uVelSize, vw, vh);
        gl.uniform2f(u.uFieldSize, this.fieldW, this.fieldH);
        gl.uniform1f(u.uDt, dt);
        // Thick water: it follows the finger, then settles quickly instead of coasting.
        gl.uniform1f(u.uKeep, Math.exp(-dt * 4.5));
        gl.uniform1i(u.uSegCount, n);
        gl.uniform4fv(u.uSeg, this.segBuf);
        gl.uniform4fv(u.uForce, this.forceBuf);
      }, { uVel: this.vel[0].tex });
      this.swap(this.vel);
      this.run('curl', this.curl, () => {}, { uVel: this.vel[0].tex });
      this.run('vorticity', this.vel[1], (u) => {
        gl.uniform1f(u.uStrength, 1.6);
        gl.uniform1f(u.uDt, dt);
      }, { uVel: this.vel[0].tex, uCurl: this.curl.tex });
      this.swap(this.vel);
      this.run('divergence', this.divergence, () => {}, { uVel: this.vel[0].tex });
      this.run('scale', this.pressure[1], (u) => gl.uniform1f(u.uAmount, 0.8), { uSrc: this.pressure[0].tex });
      this.swap(this.pressure);
      for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
        this.run('jacobi', this.pressure[1], () => {}, { uPressure: this.pressure[0].tex, uDivergence: this.divergence.tex });
        this.swap(this.pressure);
      }
      this.run('gradient', this.vel[1], () => {}, { uPressure: this.pressure[0].tex, uVel: this.vel[0].tex });
      this.swap(this.vel);
    } else if (this.velDirty) {
      this.stopFlow();
    }

    const bleed = this.look.bleed;
    this.run('fieldStep', this.field[1], (u) => {
      gl.uniform2f(u.uSize, this.fieldW, this.fieldH);
      gl.uniform1f(u.uDt, dt);
      gl.uniform1f(u.uFlowing, flowing ? 1 : 0);
      gl.uniform1f(u.uBleed, bleed);
      gl.uniform1f(u.uDryKeep, Math.exp(-dt / (0.7 + 2.2 * bleed)));
      gl.uniform2f(u.uSeedOff, this.meta.seed[0], this.meta.seed[1]);
      gl.uniform1i(u.uDropCount, nd);
      gl.uniform4fv(u.uDrop, this.dropBuf);
      gl.uniform4fv(u.uDropInk, this.dropInkBuf);
      gl.uniform1i(u.uSegCount, n);
      gl.uniform4fv(u.uSeg, this.segBuf);
      gl.uniform4fv(u.uSegP, this.segPBuf);
    }, { uField: this.field[0].tex, uVel: this.vel[0].tex });
    this.swap(this.field);

    if (this.settleLeft > 0 && this.settleTarget) {
      this.settleLeft -= dt;
      const amount = this.settleLeft <= 0 ? 1 : 1 - Math.exp(-dt * 4.2);
      this.run('settle', this.field[1], (u) => gl.uniform1f(u.uAmount, amount), {
        uSrc: this.field[0].tex, uTarget: this.settleTarget.tex,
      });
      this.swap(this.field);
      if (this.settleLeft <= 0) this.settleLeft = 0;
    }
    return true;
  }

  // ------------------------------------------------------------- drawing

  /** Draws the sheet to the canvas (or to an offscreen target for export). */
  render(timeS: number, target: Target | null = null): void {
    const w = target ? target.w : this.canvas.width;
    const h = target ? target.h : this.canvas.height;
    if (target) {
      const aux = this.makeAux(w, h);
      this.drawLook(timeS, target, aux);
      this.deleteAux(aux);
      return;
    }
    if (!this.aux || this.aux.w !== w || this.aux.h !== h) {
      if (this.aux) this.deleteAux(this.aux);
      this.aux = this.makeAux(w, h);
    }
    this.drawLook(timeS, null, this.aux);
  }

  private drawLook(timeS: number, target: Target | null, aux: Aux): void {
    const gl = this.gl;
    const { w, h } = aux;
    const map = [this.k / (w / this.viewW), this.k / (h / this.viewH),
      ((this.meta.width - this.viewW) / 2) * this.k, ((this.meta.height - this.viewH) / 2) * this.k] as const;
    const unit = this.meta.unit * this.k;
    const seed = this.meta.seed;
    const look = this.look;

    // Paper: only when the size or the sheet's placement changes.
    const key = [...map, unit, ...seed].join();
    if (aux.key !== key) {
      this.run('paper', aux.paper, (u) => {
        gl.uniform4f(u.uMap, ...map);
        gl.uniform1f(u.uUnit, unit);
        gl.uniform2f(u.uSeedOff, seed[0], seed[1]);
        gl.uniform1f(u.uPx, Math.max(0.25, w / this.viewW));
      }, {});
      aux.key = key;
    }
    // Breathing noise, at a quarter of the resolution (it's all low frequency).
    this.run('flow', aux.flow, (u) => {
      gl.uniform4f(u.uMap, map[0] * (w / aux.flow.w), map[1] * (h / aux.flow.h), map[2], map[3]);
      gl.uniform1f(u.uUnit, unit);
      gl.uniform2f(u.uSeedOff, seed[0], seed[1]);
      gl.uniform1f(u.uTime, timeS);
      gl.uniform1f(u.uDrift, look.drift);
    }, {});

    const t = this.tweenT(performance.now());
    this.run('render', target, (u) => {
      gl.uniform2f(u.uFieldSize, this.fieldW, this.fieldH);
      gl.uniform2f(u.uRes, w, h);
      gl.uniform4f(u.uMap, ...map);
      gl.uniform1f(u.uUnit, unit);
      gl.uniform3fv(u.uPaper, mixArr(this.paperFrom, this.paperTo, t));
      gl.uniform3fv(u.uLab, mixArr(this.labFrom, this.labTo, t));
      gl.uniform1i(u.uLayers, Math.round(look.layers));
      gl.uniform1f(u.uEdge, look.edges);
      gl.uniform1f(u.uTexture, look.texture);
      gl.uniform1f(u.uHueDrift, look.hueDrift);
      gl.uniform1f(u.uMist, look.mist);
      gl.uniform1f(u.uRidge, look.ridge);
      gl.uniform1f(u.uFeather, look.feather);
      gl.uniform1f(u.uDensity, look.density);
    }, {
      uField: this.field[0].tex, uPaperTex: aux.paper.tex,
      uFlow0: aux.flowTex[0], uFlow1: aux.flowTex[1], uFlow2: aux.flowTex[2],
    });
  }

  private makeAux(w: number, h: number): Aux {
    const gl = this.gl;
    const paper = this.makeTarget(w, h, { internal: gl.RGBA8, format: gl.RGBA }, false, gl.UNSIGNED_BYTE);
    const fw = Math.max(1, Math.ceil(w / 4));
    const fh = Math.max(1, Math.ceil(h / 4));
    const flow = this.makeTarget(fw, fh, this.rgba, true);
    const flowTex = [flow.tex];
    gl.bindFramebuffer(gl.FRAMEBUFFER, flow.fbo);
    for (let i = 1; i < 3; i++) {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, this.rgba.internal, fw, fh, 0, this.rgba.format, gl.HALF_FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
      flowTex.push(tex);
    }
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { w, h, paper, flow, flowTex, key: '' };
  }

  private deleteAux(a: Aux): void {
    this.deleteTarget(a.paper);
    for (const t of a.flowTex) this.gl.deleteTexture(t);
    this.gl.deleteFramebuffer(a.flow.fbo);
  }

  /** Renders what the viewport shows at `scale` × CSS size; rows top-down, RGBA. */
  capture(scale: number, timeS: number): { width: number; height: number; pixels: Uint8Array } {
    const gl = this.gl;
    const maxDim = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const s = Math.min(scale, maxDim / this.viewW, maxDim / this.viewH);
    const width = Math.round(this.viewW * s);
    const height = Math.round(this.viewH * s);
    const t = this.makeTarget(width, height, { internal: gl.RGBA8, format: gl.RGBA }, false, gl.UNSIGNED_BYTE);
    this.render(timeS, t);
    const raw = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.deleteTarget(t);
    const pixels = new Uint8Array(raw.length);
    const row = width * 4;
    for (let y = 0; y < height; y++) pixels.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return { width, height, pixels };
  }

  // ------------------------------------------------------------- saving

  save(): SavedSheet {
    const gl = this.gl;
    const t = this.makeTarget(this.fieldW, this.fieldH, { internal: gl.RGBA8, format: gl.RGBA }, false, gl.UNSIGNED_BYTE);
    this.run('encode', t, () => {}, { uSrc: this.field[0].tex });
    const raw = new Uint8Array(this.fieldW * this.fieldH * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.readPixels(0, 0, this.fieldW, this.fieldH, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.deleteTarget(t);
    return { ...this.meta, fieldW: this.fieldW, fieldH: this.fieldH, data: raw, format: 2 };
  }

  /** Restores a saved sheet. Returns false if it doesn't fit this device. */
  load(saved: SavedSheet): boolean {
    const gl = this.gl;
    const texels = saved.fieldW * saved.fieldH;
    const inks = saved.format === 2;
    if (saved.data.length !== texels * (inks ? 4 : 2)) return false;
    this.meta = { width: saved.width, height: saved.height, unit: saved.unit, seed: [...saved.seed] as [number, number] };
    this.release();
    this.allocate();
    let rgba = saved.data;
    if (!inks) {
      rgba = new Uint8Array(texels * 4);
      for (let i = 0, j = 0; j < saved.data.length; i += 4, j += 2) {
        rgba[i] = saved.data[j];
        rgba[i + 1] = saved.data[j + 1];
      }
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, saved.fieldW, saved.fieldH, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const decoded = this.makeTarget(saved.fieldW, saved.fieldH, this.rgba, true);
    this.run('decode', decoded, (u) => gl.uniform1f(u.uInks, inks ? 1 : 0), { uSrc: tex });
    gl.deleteTexture(tex);
    // Resample if this device picked a different texel density for the same sheet.
    this.run('copy', this.field[0], (u) => {
      const s = saved.fieldW / this.fieldW;
      gl.uniform4f(u.uMap, s, s, 0, 0);
    }, { uSrc: decoded.tex });
    this.deleteTarget(decoded);
    return true;
  }

  dispose(): void {
    const gl = this.gl;
    this.release();
    if (this.aux) this.deleteAux(this.aux);
    this.aux = null;
    for (const p of Object.values(this.progs)) gl.deleteProgram(p.p);
    gl.deleteVertexArray(this.vao);
  }

  // ------------------------------------------------------------- internals

  /** Creates the field and sim targets for this.meta (call release() first). */
  private allocate(): void {
    const gl = this.gl;
    const maxTex = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const { width, height } = this.meta;
    this.k = Math.min(1, Math.sqrt(this.maxTexels / (width * height)), maxTex / width, maxTex / height);
    this.fieldW = Math.max(1, Math.round(width * this.k));
    this.fieldH = Math.max(1, Math.round(height * this.k));
    // Snapshots are four bytes per texel (see ENCODE).
    this.maxSnapshots = Math.max(4, Math.min(16, Math.floor(this.historyBytes / (this.fieldW * this.fieldH * 4))));
    this.field = [this.makeTarget(this.fieldW, this.fieldH, this.rgba, true), this.makeTarget(this.fieldW, this.fieldH, this.rgba, true)];
    const vw = Math.max(1, Math.ceil(this.fieldW / VEL_DOWNSCALE));
    const vh = Math.max(1, Math.ceil(this.fieldH / VEL_DOWNSCALE));
    this.vel = [this.makeTarget(vw, vh, this.rg, true), this.makeTarget(vw, vh, this.rg, true)];
    this.pressure = [this.makeTarget(vw, vh, this.r, false), this.makeTarget(vw, vh, this.r, false)];
    this.divergence = this.makeTarget(vw, vh, this.r, false);
    this.curl = this.makeTarget(vw, vh, this.r, false);
    for (const t of [...this.field, ...this.vel, ...this.pressure, this.divergence, this.curl]) this.fillTarget(t, [0, 0, 0, 0]);
  }

  /** Frees every GPU target, except `keep` (used to carry the old sheet over when growing). */
  private release(keep?: Target): void {
    this.clearHistory();
    for (const t of this.pool.splice(0)) this.deleteTarget(t);
    if (this.settleTarget) this.deleteTarget(this.settleTarget);
    this.settleTarget = null;
    this.settleLeft = 0;
    if (!this.field) return;
    for (const t of [...this.field, ...this.vel, ...this.pressure, this.divergence, this.curl]) {
      if (t !== keep) this.deleteTarget(t);
    }
    this.field = undefined as unknown as [Target, Target];
    this.flowUntil = 0;
    this.wetUntil = 0;
    this.velDirty = false;
  }

  private clearHistory(): void {
    for (const t of [...this.undoStack.splice(0), ...this.redoStack.splice(0)]) this.deleteTarget(t);
  }

  private trimPool(): void {
    while (this.pool.length > 2) this.deleteTarget(this.pool.pop()!);
  }

  private finishSettle(): void {
    if (this.settleLeft > 0 && this.settleTarget) {
      this.copyTarget(this.settleTarget, this.field[0]);
      this.settleLeft = 0;
    }
  }

  private stopFlow(): void {
    for (const t of [...this.vel, ...this.pressure]) this.fillTarget(t, [0, 0, 0, 0]);
    this.flowUntil = 0;
    this.velDirty = false;
  }

  private tweenT(now: number): number {
    if (this.tweenMs <= 0) return 1;
    const t = Math.min(1, (now - this.tweenStart) / this.tweenMs);
    return t * t * (3 - 2 * t);
  }

  private swap(pair: [Target, Target]): void {
    const t = pair[0];
    pair[0] = pair[1];
    pair[1] = t;
  }

  private copyTarget(from: Target, to: Target): void {
    this.run('copy', to, (u) => this.gl.uniform4f(u.uMap, 1, 1, 0, 0), { uSrc: from.tex });
  }

  private fillTarget(t: Target, value: [number, number, number, number]): void {
    this.run('fill', t, (u) => this.gl.uniform4f(u.uValue, ...value), {});
  }

  private run(name: string, target: Target | null, setup: (u: Prog['u']) => void, tex: Record<string, WebGLTexture>): void {
    const gl = this.gl;
    const prog = this.progs[name];
    gl.useProgram(prog.p);
    gl.bindVertexArray(this.vao);
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    let unit = 0;
    for (const [uniform, t] of Object.entries(tex)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(prog.u[uniform], unit);
      unit++;
    }
    setup(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private program(fs: string): Prog {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(s)}`);
      }
      return s;
    };
    const p = gl.createProgram()!;
    const vs = compile(gl.VERTEX_SHADER, SH.VERTEX);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, vs);
    gl.attachShader(p, f);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Shader link failed: ${gl.getProgramInfoLog(p)}`);
    }
    const u: Prog['u'] = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(p, i)!.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  private makeTarget(w: number, h: number, f: Format, linear: boolean, type?: number): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, type ?? gl.HALF_FLOAT, null);
    const filter = linear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  private deleteTarget(t: Target): void {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  private pickFormat(options: [number, number][]): Format | null {
    const gl = this.gl;
    for (const [internal, format] of options) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, format, gl.HALF_FLOAT, null);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      if (ok) return { internal, format };
    }
    return null;
  }
}

function mixArr(a: number[], b: number[], t: number): number[] {
  if (a.length !== b.length || t >= 1) return b;
  return b.map((v, i) => a[i] + (v - a[i]) * t);
}
