// Dev only: scripted drops and strokes on a virtual clock, for checking the look
// without a visible window. Run from the console: __paint.demo('all'), then __paint.snap('name').

import type { BrushInput, Tool } from './brush';

export interface DemoApi {
  input: BrushInput;
  set: (tool: Tool, pan: number, radius: number) => void;
  /** Advances the virtual clock, running frames of 1/60 s. */
  tick: (ms: number) => void;
  checkpoint: () => void;
}

/**
 * The same kind of scene, but as real pointer events over real time through the
 * real animation loop (/paint/?live): what a person tapping and dragging would send.
 */
export async function runLive(canvas: HTMLCanvasElement): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const r = canvas.getBoundingClientRect();
  const fire = (type: string, x: number, y: number, id: number) =>
    canvas.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: id === 1, bubbles: true, cancelable: true,
      clientX: r.left + x, clientY: r.top + y, pressure: 0.5, button: 0,
    }));
  const pick = (sel: string) => document.querySelector<HTMLElement>(sel)!.click();
  const W = r.width;
  const H = r.height;
  let id = 1;
  const tap = async (x: number, y: number, hold: number) => {
    const p = id++;
    fire('pointerdown', x, y, p);
    await sleep(hold);
    fire('pointerup', x, y, p);
    await sleep(380);
  };
  const drag = async (pts: [number, number][], every = 16) => {
    const p = id++;
    fire('pointerdown', pts[0][0], pts[0][1], p);
    for (const [x, y] of pts.slice(1)) {
      await sleep(every);
      fire('pointermove', x, y, p);
    }
    fire('pointerup', pts.at(-1)![0], pts.at(-1)![1], p);
    await sleep(120);
  };
  await sleep(1500);
  for (const [pan, hold] of [[0, 450], [3, 300], [1, 260], [4, 220], [0, 160]] as const) {
    pick(`.pan[data-pan="${pan}"]`);
    await tap(W * 0.3, H * 0.32, hold);
  }
  pick('.pan[data-pan="2"]');
  await drag(Array.from({ length: 50 }, (_, i) => [W * (0.5 + i * 0.008), H * (0.25 + Math.sin(i / 7) * 0.06)] as [number, number]));
  pick('.tool[data-tool="water"]');
  await drag(Array.from({ length: 45 }, (_, i) => {
    const a = (i / 45) * Math.PI * 2.2;
    return [W * 0.3 + Math.cos(a) * (30 + i * 2), H * 0.32 + Math.sin(a) * (30 + i * 2)] as [number, number];
  }), 18);
  await drag(Array.from({ length: 40 }, (_, i) => [W * (0.1 + i * 0.02), H * (0.72 + Math.sin(i / 5) * 0.05)] as [number, number]), 18);
  document.body.dataset.live = 'done';
}

export function runDemo(name: string, api: DemoApi): void {
  const { input, set, tick, checkpoint } = api;
  let id = 1000;
  const ev = (pointerId: number) => ({ pointerId, pointerType: 'touch', pressure: 0.5, target: null }) as unknown as PointerEvent;
  const W = innerWidth;
  const H = innerHeight;

  const drop = (x: number, y: number, pan: number, hold = 60, tool: Tool = 'pigment', radius = 24) => {
    set(tool, pan, radius);
    checkpoint();
    const pid = id++;
    input.down(ev(pid), x, y);
    tick(hold);
    input.up(ev(pid));
    tick(350);
  };

  const stroke = (pts: [number, number][], pan: number, tool: Tool = 'pigment', radius = 24, stepMs = 16) => {
    set(tool, pan, radius);
    checkpoint();
    const pid = id++;
    input.down(ev(pid), pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) {
      input.move(ev(pid), x, y);
      tick(stepMs);
    }
    input.up(ev(pid));
    tick(100);
  };

  const curve = (x0: number, y0: number, x1: number, y1: number, bend: number, n = 40): [number, number][] =>
    Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * bend] as [number, number];
    });

  if (name === 'rings' || name === 'all') {
    // Suminagashi: alternating drops in one spot make concentric rings.
    const cx = W * 0.36;
    const cy = H * 0.45;
    for (const [pan, hold] of [[0, 500], [3, 350], [1, 300], [4, 260], [2, 220], [0, 160]] as const) drop(cx, cy, pan, hold);
    drop(cx, cy, 0, 200, 'water', 18);
    drop(W * 0.64, H * 0.36, 2, 400);
    drop(W * 0.64, H * 0.36, 4, 250);
    drop(W * 0.64, H * 0.36, 1, 150);
  }
  if (name === 'strokes' || name === 'all') {
    stroke(curve(W * 0.08, H * 0.84, W * 0.92, H * 0.8, -90, 60), 1, 'pigment', 42);
    stroke(curve(W * 0.12, H * 0.72, W * 0.88, H * 0.68, -70, 60), 3, 'pigment', 30);
    stroke(curve(W * 0.2, H * 0.92, W * 0.8, H * 0.9, -30, 40), 0, 'pigment', 26);
    stroke(curve(W * 0.55, H * 0.18, W * 0.95, H * 0.28, 40, 30), 4, 'pigment', 40);
  }
  if (name === 'stir' || name === 'all') {
    const cx = W * 0.36;
    const cy = H * 0.45;
    const pts: [number, number][] = Array.from({ length: 50 }, (_, i) => {
      const a = (i / 50) * Math.PI * 2.4;
      const r = 40 + i * 2.2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
    stroke(pts, 0, 'water', 26, 18);
    stroke(curve(W * 0.05, H * 0.6, W * 0.95, H * 0.62, 50, 50), 0, 'water', 30, 14);
  }
  if (name === 'pans') {
    // One stroke and one drop per pan, deepest at the top.
    for (let i = 0; i < 5; i++) {
      const y = H * (0.14 + i * 0.17);
      stroke(curve(W * 0.08, y, W * 0.6, y, -12, 40), i, 'pigment', 26);
      drop(W * 0.8, y, i, 200);
    }
  }
  if (name === 'lift' || name === 'all') {
    stroke(curve(W * 0.3, H * 0.76, W * 0.7, H * 0.73, -20, 30), 0, 'lift', 22, 20);
  }
  // Let it all dry.
  tick(9000);
}
