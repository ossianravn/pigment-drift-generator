// Minimal WebGL2 renderer for the pigment drift shader.
// Shared by the generator app, the exporters and the embeddable runtime.

import { hexToLinear, hexToOklab } from './color';
import type { DriftConfig } from './params';
import { createRng } from './params';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shader';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

const ANCHOR_INDEX = { bottom: 0, top: 1, left: 2, right: 3 } as const;

const FLOAT_UNIFORMS = [
  'coverage', 'ridge', 'scale', 'warp', 'mist', 'density', 'hueDrift',
  'river', 'riverWidth', 'riverMeander', 'riverDepth', 'riverTilt',
  'granulation', 'grain', 'edge', 'feather', 'brush', 'motion', 'flow',
] as const;

export interface DrawOptions {
  /** Loop phase, 0..1. */
  phase: number;
  /** Device pixels per CSS pixel — keeps paper grain a consistent physical size. */
  pixelRatio: number;
  /** Size of the whole composition when this canvas only renders a tile of it. */
  view?: { width: number; height: number; offsetX: number; offsetY: number };
}

export class WebGLUnavailableError extends Error {
  constructor(message = 'WebGL2 is not available in this browser.') {
    super(message);
    this.name = 'WebGLUnavailableError';
  }
}

export class DriftRenderer {
  readonly canvas: AnyCanvas;
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private config: DriftConfig | null = null;

  constructor(canvas: AnyCanvas, options: { preserveDrawingBuffer?: boolean; fragmentSource?: string } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
      powerPreference: 'default',
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new WebGLUnavailableError();
    this.gl = gl;

    this.program = this.link(VERTEX_SHADER, options.fragmentSource ?? FRAGMENT_SHADER);
    gl.useProgram(this.program);

    // One oversized triangle covers the viewport.
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const names = [
      'uRes', 'uView', 'uViewOff', 'uPx', 'uPhase', 'uSeedOff', 'uPaper', 'uLab', 'uAnchor', 'uLayers',
      ...FLOAT_UNIFORMS.map((k) => `u${k[0].toUpperCase()}${k.slice(1)}`),
    ];
    for (const name of names) this.loc[name] = gl.getUniformLocation(this.program, name);
  }

  /** Largest drawing buffer edge this GPU supports. */
  get maxSize(): number {
    const gl = this.gl;
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    return Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, dims[0], dims[1]);
  }

  get isContextLost(): boolean {
    return this.gl.isContextLost();
  }

  setConfig(cfg: DriftConfig): void {
    this.config = cfg;
    const gl = this.gl;
    gl.useProgram(this.program);
    const rand = createRng(cfg.seed * 7919 + 13);
    gl.uniform2f(this.loc.uSeedOff, rand() * 240 - 120, rand() * 240 - 120);
    gl.uniform3fv(this.loc.uPaper, hexToLinear(cfg.paper));
    gl.uniform3fv(this.loc.uLab, cfg.colors.flatMap((c) => hexToOklab(c)));
    gl.uniform1i(this.loc.uAnchor, ANCHOR_INDEX[cfg.anchor] ?? 0);
    gl.uniform1i(this.loc.uLayers, Math.round(cfg.layers));
    for (const key of FLOAT_UNIFORMS) {
      gl.uniform1f(this.loc[`u${key[0].toUpperCase()}${key.slice(1)}`], cfg[key]);
    }
  }

  /** Resizes the drawing buffer (in device pixels). */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  draw({ phase, pixelRatio, view }: DrawOptions): void {
    if (!this.config) throw new Error('DriftRenderer.draw() called before setConfig()');
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, w, h);
    gl.uniform2f(this.loc.uRes, w, h);
    gl.uniform2f(this.loc.uView, view?.width ?? w, view?.height ?? h);
    gl.uniform2f(this.loc.uViewOff, view?.offsetX ?? 0, view?.offsetY ?? 0);
    gl.uniform1f(this.loc.uPx, Math.max(0.25, pixelRatio));
    gl.uniform1f(this.loc.uPhase, ((phase % 1) + 1) % 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private link(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error(`Shader compile failed: ${log}`);
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Shader link failed: ${gl.getProgramInfoLog(p)}`);
    }
    return p;
  }
}
