// The studio's preferences: palette, the feel of water and paper, and the brush.
// Pure functions, so they're easy to test; main.ts persists them in localStorage.

import { isHex } from '../engine/color';
import { PALETTES, type Palette } from '../engine/palettes';
import type { Tool } from './brush';
import type { Look } from './engine';

/** Pigment each pan lays down, deepest -> palest: where the wash stack shows that pan's own color. */
export const PAN_INK = [0.95, 0.8, 0.54, 0.35, 0.12];
export const PAN_NAMES = ['Deepest', 'Deep', 'Middle', 'Light', 'Palest'];
/** Brush radii (CSS px) the size button steps through. */
export const SIZES = [7, 14, 24, 42];

export interface Settings {
  palette: Palette;
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
  tool: Tool;
  pan: number;
  radius: number;
  /** The generator piece this sheet started from (a share token), if any. */
  piece: string | null;
}

export function defaultSettings(reducedMotion = false): Settings {
  return {
    palette: { ...PALETTES[0], colors: [...PALETTES[0].colors] },
    layers: 5,
    bleed: 0.5,
    drift: reducedMotion ? 0 : 0.35,
    texture: 0.5,
    edges: 0.5,
    hueDrift: 0.3,
    mist: 0.5,
    ridge: 0.35,
    feather: 0.6,
    density: 0.95,
    tool: 'pigment',
    pan: 1,
    radius: 24,
    piece: null,
  };
}

/** Coerces anything (old or hand-edited storage) into valid settings; unknown or bad values fall back to `base`. */
export function sanitizeSettings(input: unknown, base: Settings): Settings {
  const s: Settings = { ...base, palette: { ...base.palette, colors: [...base.palette.colors] } };
  if (!input || typeof input !== 'object') return s;
  const raw = input as Partial<Record<keyof Settings, unknown>>;
  const num = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  const p = raw.palette as Partial<Palette> | undefined;
  if (p && isHex(p.paper) && Array.isArray(p.colors) && p.colors.length === 5 && p.colors.every(isHex)) {
    s.palette = { name: String(p.name ?? 'Custom'), paper: p.paper, colors: [...p.colors] };
  }
  s.layers = Math.round(num(raw.layers, 2, 7, s.layers));
  for (const k of ['bleed', 'drift', 'texture', 'edges', 'hueDrift', 'mist', 'ridge', 'feather'] as const) s[k] = num(raw[k], 0, 1, s[k]);
  s.density = num(raw.density, 0.3, 1.3, s.density);
  s.tool = raw.tool === 'water' || raw.tool === 'lift' || raw.tool === 'pigment' ? raw.tool : s.tool;
  s.pan = Math.round(num(raw.pan, 0, 4, s.pan));
  s.radius = num(raw.radius, 4, 120, s.radius);
  s.piece = typeof raw.piece === 'string' && /^[\w-]+$/.test(raw.piece) ? raw.piece : null;
  return s;
}

export function lookOf(s: Settings): Look {
  const { palette, layers, bleed, drift, texture, edges, hueDrift, mist, ridge, feather, density } = s;
  return { paper: palette.paper, colors: [...palette.colors], layers, bleed, drift, texture, edges, hueDrift, mist, ridge, feather, density };
}
