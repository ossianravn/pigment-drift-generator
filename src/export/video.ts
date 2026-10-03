// Frame-exact video export via WebCodecs (through mediabunny). Every frame is
// rendered at its exact loop phase, so the last frame flows into the first.

import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  Quality,
  type VideoCodec,
  WebMOutputFormat,
} from 'mediabunny';
import type { DriftConfig } from '../engine/params';
import { DriftRenderer } from '../engine/renderer';

export type VideoContainer = 'mp4' | 'webm';
export type VideoQuality = 'light' | 'balanced' | 'high';

export interface VideoSpec {
  width: number;
  height: number;
  /** CSS pixels the video represents across its width (keeps grain consistent with stills). */
  cssWidth: number;
  fps: number;
  container: VideoContainer;
  quality: VideoQuality;
}

/**
 * Bits per pixel per frame. Paper grain is static, so it compresses well once the
 * encoder has enough bits to keep it; below ~0.02 the grain smears into blotches.
 * VP9 is more efficient than H.264, so it gets a little less for similar quality.
 */
const BPP: Record<VideoQuality, number> = { light: 0.02, balanced: 0.04, high: 0.08 };
const CODEC_EFFICIENCY: Record<VideoContainer, number> = { mp4: 1, webm: 0.8 };
const CANDIDATES: Record<VideoContainer, VideoCodec[]> = {
  // H.264 is the only codec every browser plays inside MP4.
  mp4: ['avc'],
  webm: ['vp9', 'vp8'],
};

export const MIME: Record<VideoContainer, string> = { mp4: 'video/mp4', webm: 'video/webm' };

export function webCodecsAvailable(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export async function pickCodec(container: VideoContainer, width: number, height: number): Promise<VideoCodec | null> {
  if (!webCodecsAvailable()) return null;
  try {
    return await getFirstEncodableVideoCodec(CANDIDATES[container], { width, height });
  } catch {
    return null;
  }
}

export async function encodeLoop(
  config: DriftConfig,
  spec: VideoSpec,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  const codec = await pickCodec(spec.container, spec.width, spec.height);
  if (!codec) throw new Error(`This browser can’t encode ${spec.container.toUpperCase()} video at ${spec.width}×${spec.height}.`);

  const canvas = document.createElement('canvas');
  const renderer = new DriftRenderer(canvas, { preserveDrawingBuffer: true });
  renderer.setConfig(config);
  renderer.setSize(spec.width, spec.height);

  const output = new Output({
    format: spec.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  const bitrate = Math.round(spec.width * spec.height * spec.fps * BPP[spec.quality] * CODEC_EFFICIENCY[spec.container]);
  const source = new CanvasSource(canvas, { codec, quality: new Quality({ bitrate }), keyFrameInterval: 2 });
  output.addVideoTrack(source, { frameRate: spec.fps });

  try {
    await output.start();
    const frames = Math.round(config.loop * spec.fps);
    const pixelRatio = spec.width / spec.cssWidth;
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) {
        await output.cancel();
        throw new DOMException('Export cancelled', 'AbortError');
      }
      renderer.draw({ phase: i / frames, pixelRatio });
      await source.add(i / spec.fps, 1 / spec.fps);
      onProgress((i + 1) / frames);
    }
    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error('Video encoder produced no data.');
    return new Blob([buffer], { type: MIME[spec.container] });
  } finally {
    renderer.dispose();
  }
}
