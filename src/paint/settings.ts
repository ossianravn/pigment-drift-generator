// The studio's preferences: the inks, the feel of water and paper, and the brush.
// Pure functions, so they're easy to test; main.ts persists them in localStorage.

import { isHex } from '../engine/color';
import { PALETTES, type Palette } from '../engine/palettes';
import type { Tool } from './brush';
import { type Look, MAX_INKS } from './engine';

/**
 * Pigment each pan lays down, deepest -> palest: mid-way between the wash stack's
 * thresholds, so each pan shows its own color and its soft edges don't eat into it.
 */
export const PAN_INK = [0.97, 0.78, 0.6, 0.42, 0.2];
export const PAN_NAMES = ['Deepest', 'Deep', 'Middle', 'Light', 'Palest'];
/** Brush radii (CSS px) the size button steps through. */
export const SIZES = [7, 14, 24, 42];

export interface Settings {
  /** One to three inks, each a five-color ramp. The first ink also sets the paper. */
  inks: Palette[];
  /** The ink the pans show and paint with. */
  ink: number;
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
    inks: [copyPalette(PALETTES[0])],
    ink: 0,
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
  const s: Settings = { ...base, inks: base.inks.map(copyPalette) };
  if (!input || typeof input !== 'object') return s;
  const raw = input as Partial<Record<keyof Settings | 'palette', unknown>>;
  const num = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  const valid = (p: unknown): p is Palette => {
    const q = p as Partial<Palette> | null;
    return !!q && isHex(q.paper) && Array.isArray(q.colors) && q.colors.length === 5 && q.colors.every(isHex);
  };
  const named = (p: Palette): Palette => ({ name: String(p.name ?? 'Custom'), paper: p.paper, colors: [...p.colors] });
  const inks = Array.isArray(raw.inks) ? raw.inks.filter(valid).slice(0, MAX_INKS).map(named) : [];
  // Settings from before inks had a single palette.
  if (!inks.length && valid(raw.palette)) inks.push(named(raw.palette));
  if (inks.length) s.inks = inks;
  s.ink = Math.round(num(raw.ink, 0, s.inks.length - 1, 0));
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
  const { inks, layers, bleed, drift, texture, edges, hueDrift, mist, ridge, feather, density } = s;
  return { paper: inks[0].paper, inks: inks.map((i) => [...i.colors]), layers, bleed, drift, texture, edges, hueDrift, mist, ridge, feather, density };
}

export function copyPalette(p: Palette): Palette {
  return { ...p, colors: [...p.colors] };
}
