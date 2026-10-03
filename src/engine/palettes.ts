// Curated palettes, full presets and a generator for new harmonious palettes.
// "Pigment drift" palettes are ramps whose hue drifts as the value lightens,
// the way a single wash shifts color as it dries.

import { oklchToHex } from './color';
import { DEFAULT_CONFIG, type DriftConfig, type GroupId, randomizeRanges, sanitizeConfig } from './params';

export interface Palette {
  name: string;
  paper: string;
  /** Foreground (deepest) -> horizon (lightest). */
  colors: string[];
}

export const PALETTES: Palette[] = [
  { name: 'Soft Current', paper: '#fdf1e3', colors: ['#2a1a7a', '#3446c9', '#6a4fd6', '#b7a2ee', '#f3cfdf'] },
  { name: 'Ember Field', paper: '#fdf1e3', colors: ['#33228f', '#8a3aa8', '#ef4f63', '#ff8a3d', '#ffc77a'] },
  { name: 'Apricot Path', paper: '#fdf1e3', colors: ['#c43a5a', '#f05a3a', '#ff8f2e', '#ffb54a', '#ffe0a6'] },
  { name: 'Sea Glass', paper: '#f5f2ea', colors: ['#0b3f57', '#14707f', '#3f9c98', '#93cdb9', '#e2efd6'] },
  { name: 'Moss & Fog', paper: '#f4efe4', colors: ['#24331f', '#475f33', '#7f8f4f', '#c4bf86', '#ebdfc4'] },
  { name: 'Rose Quartz', paper: '#fff4ee', colors: ['#5c2150', '#a3406f', '#db6f93', '#f2adbf', '#fbe0d5'] },
  { name: 'Glacier', paper: '#f6f6f2', colors: ['#14244a', '#28538f', '#5f93cf', '#a9cdec', '#e5eff6'] },
  { name: 'Terracotta', paper: '#fbf3e8', colors: ['#4a1f17', '#94422a', '#cf7a4b', '#e5ae7f', '#f3dcc0'] },
  { name: 'Night Ink', paper: '#121020', colors: ['#ff7a8a', '#b25bd6', '#5b5fe0', '#2c3f8f', '#1c1a3a'] },
];

export interface Preset {
  name: string;
  config: DriftConfig;
}

const preset = (name: string, palette: string, overrides: Partial<DriftConfig>): Preset => {
  const p = PALETTES.find((x) => x.name === palette)!;
  return {
    name,
    config: sanitizeConfig({ ...DEFAULT_CONFIG, paper: p.paper, colors: p.colors, ...overrides }),
  };
};

export const PRESETS: Preset[] = [
  preset('Soft Current', 'Soft Current', {}),
  preset('Ember Field', 'Ember Field', {
    seed: 90211, coverage: 0.6, layers: 5, ridge: 0.45, warp: 0.9, hueDrift: 0.75,
    river: 0.8, riverWidth: 0.13, riverMeander: 0.35, riverDepth: 0.45, riverTilt: -0.25,
  }),
  preset('Apricot Path', 'Apricot Path', {
    seed: 31337, coverage: 0.5, layers: 4, ridge: 0.5, warp: 0.6, hueDrift: 0.6,
    river: 0.9, riverWidth: 0.11, riverMeander: 0.75, riverDepth: 0.55, riverTilt: 0.45, edge: 0.4,
  }),
  preset('Sea Glass', 'Sea Glass', {
    seed: 2718, coverage: 0.48, layers: 6, ridge: 0.7, warp: 0.55, mist: 0.75, river: 0, granulation: 0.7,
  }),
  preset('Moss & Fog', 'Moss & Fog', {
    seed: 6022, coverage: 0.62, layers: 6, ridge: 0.85, scale: 0.85, mist: 0.9, river: 0.6, riverWidth: 0.06,
    riverMeander: 0.85, riverTilt: -0.4, brush: 0.6,
  }),
  preset('Rose Quartz', 'Rose Quartz', {
    seed: 1618, anchor: 'top', coverage: 0.42, layers: 4, ridge: 0.4, warp: 1.1, mist: 0.7, river: 0,
    feather: 0.85, hueDrift: 0.35,
  }),
  preset('Glacier', 'Glacier', {
    seed: 4669, coverage: 0.7, layers: 7, ridge: 0.9, scale: 1.25, warp: 0.45, river: 0.75,
    riverWidth: 0.07, riverDepth: 0.3, riverTilt: 0.1, granulation: 0.65, edge: 0.65,
  }),
  preset('Night Ink', 'Night Ink', {
    seed: 7777, coverage: 0.58, layers: 5, ridge: 0.55, warp: 0.95, mist: 0.5, river: 0.7,
    riverWidth: 0.08, density: 0.9, grain: 0.35, edge: 0.35,
  }),
];

/** A fresh drifting ramp in OKLCH: deep & saturated in front, pale near the horizon. */
export function generatePalette(rand: () => number): Palette {
  const h0 = rand() * 360;
  const drift = (25 + rand() * 55) * (rand() < 0.5 ? -1 : 1);
  const chroma = 0.75 + rand() * 0.45;
  const L = [0.32, 0.45, 0.6, 0.76, 0.9];
  const C = [0.15, 0.19, 0.17, 0.11, 0.05];
  const colors = L.map((l, i) =>
    oklchToHex(l + (rand() - 0.5) * 0.04, C[i] * chroma, h0 + (drift * i) / 4 + (rand() - 0.5) * 8),
  );
  // Mostly warm cream paper, sometimes a whisper of the horizon hue.
  const paper = rand() < 0.7
    ? oklchToHex(0.965 + rand() * 0.015, 0.02 + rand() * 0.012, 70 + rand() * 15)
    : oklchToHex(0.97, 0.012, h0 + drift);
  return { name: 'Generated', paper, colors };
}

/** A new random palette: usually a curated one, sometimes freshly generated. */
export function randomPalette(rand: () => number, current?: Palette): Palette {
  if (rand() < 0.45) return generatePalette(rand);
  const pool = PALETTES.filter((p) => p.name !== current?.name && p.name !== 'Night Ink');
  return pool[Math.floor(rand() * pool.length)];
}

export function randomizeConfig(
  cfg: DriftConfig,
  locked: ReadonlySet<GroupId>,
  rand: () => number = Math.random,
): DriftConfig {
  const out = randomizeRanges(cfg, locked, rand);
  if (!locked.has('palette')) {
    const p = randomPalette(rand);
    out.paper = p.paper;
    out.colors = [...p.colors];
  }
  return out;
}
