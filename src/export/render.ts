// Offscreen rendering for exports and thumbnails. Large outputs are drawn in
// tiles so they work on GPUs with small texture limits and never stall the
// GPU long enough to trigger a driver reset.

import type { DriftConfig } from '../engine/params';
import { DriftRenderer } from '../engine/renderer';

export interface RenderSpec {
  /** Output size in device pixels. */
  width: number;
  height: number;
  /** Device pixels per CSS pixel the output represents (2 for a "@2x" image). */
  pixelRatio: number;
  phase: number;
}

let shared: { canvas: HTMLCanvasElement; renderer: DriftRenderer } | null = null;

/** One long-lived offscreen renderer (browsers cap the number of live WebGL contexts). */
export function offscreenRenderer(): DriftRenderer {
  if (!shared || shared.renderer.isContextLost) {
    const canvas = document.createElement('canvas');
    shared = { canvas, renderer: new DriftRenderer(canvas, { preserveDrawingBuffer: true }) };
  }
  return shared.renderer;
}

const TILE = 2048;

/** Renders the composition into a 2D canvas of exactly width × height. */
export async function renderToCanvas(config: DriftConfig, spec: RenderSpec): Promise<HTMLCanvasElement> {
  const r = offscreenRenderer();
  r.setConfig(config);
  const out = document.createElement('canvas');
  out.width = spec.width;
  out.height = spec.height;
  const ctx = out.getContext('2d')!;
  const tile = Math.min(TILE, r.maxSize);

  for (let ty = 0; ty < spec.height; ty += tile) {
    for (let tx = 0; tx < spec.width; tx += tile) {
      const tw = Math.min(tile, spec.width - tx);
      const th = Math.min(tile, spec.height - ty);
      r.setSize(tw, th);
      // GL's y axis points up, so the top tile row sits at the largest offset.
      r.draw({
        phase: spec.phase,
        pixelRatio: spec.pixelRatio,
        view: { width: spec.width, height: spec.height, offsetX: tx, offsetY: spec.height - ty - th },
      });
      ctx.drawImage(r.canvas as HTMLCanvasElement, 0, 0, tw, th, tx, ty, tw, th);
      // Yield between tiles so the page stays responsive during big exports.
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  return out;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`Could not encode ${type}`))), type, quality),
  );
}

/** Small data-URL preview of a config (used for preset thumbnails). */
export async function thumbnail(config: DriftConfig, width = 192, height = 120): Promise<string> {
  const canvas = await renderToCanvas(config, { width, height, pixelRatio: 0.6, phase: 0 });
  return canvas.toDataURL('image/webp', 0.85);
}
