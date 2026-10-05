// CPU twin of the shader noise, just enough to know where the breathing warp
// moves a point, so paint lands exactly under the finger.

const M = 1664525;
const C = 1013904223;

function hash22(ix: number, iy: number): [number, number] {
  let x = ix | 0;
  let y = iy | 0;
  x = (Math.imul(x, M) + C) >>> 0;
  y = (Math.imul(y, M) + C) >>> 0;
  x = (x + Math.imul(y, M)) >>> 0;
  y = (y + Math.imul(x, M)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  x = (x + Math.imul(y, M)) >>> 0;
  y = (y + Math.imul(x, M)) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  return [x / 4294967295, y / 4294967295];
}

export function gnoise(px: number, py: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const fx = px - ix;
  const fy = py - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dot = (cx: number, cy: number, ox: number, oy: number) => {
    const [hx, hy] = hash22(ix + cx, iy + cy);
    return (hx * 2 - 1) * (fx - ox) + (hy * 2 - 1) * (fy - oy);
  };
  const a = dot(0, 0, 0, 0);
  const b = dot(1, 0, 1, 0);
  const c = dot(0, 1, 0, 1);
  const d = dot(1, 1, 1, 1);
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return 1.4 * (top + (bottom - top) * uy);
}

export function fbm(px: number, py: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gnoise(px, py);
    norm += amp;
    const x = (0.8 * px - 0.6 * py) * 2.03 + 17.1;
    const y = (0.6 * px + 0.8 * py) * 2.03 + 9.3;
    px = x;
    py = y;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Same as the render shader's breathing offset, in field texels. */
export function breathe(
  fx: number, fy: number, unit: number, seed: [number, number], drift: number, time: number,
): [number, number] {
  if (drift <= 0) return [0, 0];
  const sx = fx / unit;
  const sy = fy / unit;
  const ang = (time * Math.PI * 2) / 26;
  const o1x = Math.cos(ang) * drift * 0.55;
  const o1y = Math.sin(ang) * drift * 0.55;
  const o2x = Math.cos(ang + 2.1) * drift * 0.4;
  const o2y = Math.sin(ang + 2.1) * drift * 0.4;
  const qx = fbm(sx * 0.9 + seed[0] + o1x, sy * 0.9 + seed[1] + o1y, 3);
  const qy = fbm(sx * 0.9 + seed[1] + 5.2 - o1x, sy * 0.9 + seed[0] + 1.3 - o1y, 3);
  const bx = sx * 1.7 + 1.6 * qx + seed[0];
  const by = sy * 1.7 + 1.6 * qy + seed[1];
  const rx = fbm(bx + 1.7 + o2x, by + 9.2 + o2y, 3);
  const ry = fbm(bx + 8.3 - o2x, by + 2.8 - o2y, 3);
  return [drift * 0.016 * (rx + 0.5 * qx) * unit, drift * 0.012 * (ry + 0.5 * qy) * unit];
}
