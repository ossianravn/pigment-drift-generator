// Curated palettes, full presets and a generator for new harmonious palettes.
// "Pigment drift" palettes are ramps whose hue drifts as the value lightens,
// the way a single wash shifts color as it dries.

import { luminance, oklchToHex } from './color';
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

  // Prussian blue breaking into sea foam, on aged washi.
  { name: 'Hokusai', paper: '#f6efdf', colors: ['#0f2a4a', '#1d4f7c', '#3f7fa8', '#9cc3d5', '#ece3cc'] },
  // A single stick of ink, ground lighter and lighter.
  { name: 'Sumi', paper: '#f4f1ea', colors: ['#1b1b20', '#3a3a42', '#6b6a72', '#a9a6a4', '#e3ded4'] },
  { name: 'Matcha', paper: '#f4f2e4', colors: ['#34461c', '#62782c', '#9fb259', '#d4dba2', '#eff1d9'] },
  // Plum dissolving into saffron.
  { name: 'Saffron & Plum', paper: '#fbf3e4', colors: ['#4a1d4f', '#8c2f5d', '#d9603b', '#f2a541', '#fbe3a8'] },
  // Lavender rows running out into ripe wheat.
  { name: 'Provence', paper: '#f9f4ec', colors: ['#3a2d6c', '#6f5db5', '#ab9bd8', '#e5cd8e', '#f6ecd3'] },
  // Weathered copper: verdigris over the bare metal.
  { name: 'Verdigris', paper: '#f2efe6', colors: ['#1d4a47', '#2e7a70', '#6db2a0', '#c98a5a', '#f0d9bf'] },
  { name: 'Coral Reef', paper: '#fdf4ee', colors: ['#0e4f6e', '#1b8a99', '#f06f5c', '#f9a988', '#fde3d2'] },
  // Deep pond water under lilac and blush (after Monet).
  { name: 'Water Lilies', paper: '#f5f3ec', colors: ['#2c465a', '#4d7d85', '#8fb59f', '#c6b6dd', '#f2e3ea'] },
  // Oxblood to ember (after Rothko).
  { name: 'Rothko', paper: '#f3e6d8', colors: ['#3d0f16', '#7a1a20', '#b8322a', '#e07b45', '#f2c8a2'] },
  { name: 'Kyoto Autumn', paper: '#fbf2e3', colors: ['#3a1a12', '#9b2b1a', '#e2572b', '#f1a23c', '#f7dfae'] },
  // Moss-green stems giving way to wisteria.
  { name: 'Wisteria', paper: '#faf6f5', colors: ['#2b3a2a', '#5c6d43', '#8a86c4', '#c4b8e3', '#efe9f3'] },
  { name: 'Dune', paper: '#f8f0e3', colors: ['#5a3b24', '#9c6a3f', '#d4a06a', '#ebcc9c', '#f6e7cc'] },
  { name: 'Harbor Fog', paper: '#eef0ef', colors: ['#26323f', '#46596b', '#7f93a3', '#b8c6cf', '#e5eaed'] },
  { name: 'Peach & Sage', paper: '#fbf4ec', colors: ['#3f5245', '#7c9480', '#b7c4a8', '#f2b48f', '#fbe0cd'] },
  // Indigo dusk warming to the last pink light.
  { name: 'Blue Hour', paper: '#f2f1f6', colors: ['#1a1f4d', '#3c3f8c', '#7b6fbf', '#e3a3b8', '#f6dfe0'] },
  { name: 'Citrus', paper: '#fffbea', colors: ['#2f5d34', '#7da33a', '#f2c230', '#f59a3a', '#fde8b0'] },
  // Indigo petals with a yellow throat: complementary drift.
  { name: 'Iris', paper: '#f6f5fb', colors: ['#262a6b', '#4a4fb8', '#8f8ee0', '#f2d27a', '#f8eed0'] },
  { name: 'Cobalt & Clay', paper: '#f7f0e6', colors: ['#1c2e6b', '#3c5bb0', '#c4734b', '#e3b08b', '#f3e1cf'] },
  { name: 'Pistachio Rose', paper: '#fbf6ef', colors: ['#56683a', '#9bb06a', '#d6dfae', '#f0b8b8', '#fbe3df'] },

  // Dark paper: the foreground glows, the horizon sinks back into the night.
  { name: 'Aurora', paper: '#0c131e', colors: ['#b8f5cf', '#4cd3a7', '#2e8fb3', '#383f8f', '#151c32'] },
  { name: 'Ultraviolet', paper: '#120d1e', colors: ['#f6a6ff', '#b45cf0', '#6f3fd6', '#3a2a8a', '#1e1638'] },
  { name: 'Absinthe', paper: '#0f1a14', colors: ['#e6f59a', '#9ccc4f', '#4f9a5c', '#2a5c46', '#142a20'] },
  { name: 'Gold Leaf', paper: '#14110f', colors: ['#f6d98a', '#d9a441', '#9b6a2c', '#4b3420', '#1f1915'] },
];

/** Display order for the palette library: a varied first glance, then everything else. */
const LIBRARY_LEAD = ['Soft Current', 'Ember Field', 'Hokusai', 'Water Lilies', 'Rothko', 'Provence', 'Sumi', 'Verdigris', 'Night Ink'];
export const LIBRARY: Palette[] = [
  ...LIBRARY_LEAD.map((name) => PALETTES.find((p) => p.name === name)!),
  ...PALETTES.filter((p) => !LIBRARY_LEAD.includes(p.name)),
];
/** How many library palettes show before "More palettes" on desktop. */
export const LIBRARY_PREVIEW = LIBRARY_LEAD.length;

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
  preset('Great Wave', 'Hokusai', {
    seed: 1831, coverage: 0.72, layers: 6, ridge: 0.9, scale: 0.8, warp: 1.35, mist: 0.4, river: 0,
    hueDrift: 0.45, granulation: 0.7, edge: 0.65, feather: 0.7, brush: 0.6,
  }),
  preset('Water Lilies', 'Water Lilies', {
    seed: 1899, coverage: 1.15, layers: 6, ridge: 0.5, scale: 1.1, warp: 1.2, mist: 0.45, hueDrift: 0.9,
    river: 0.5, riverWidth: 0.08, riverMeander: 0.7, riverDepth: 0.6, brush: 0.8, granulation: 0.6, feather: 0.75,
  }),
  preset('Aurora', 'Aurora', {
    seed: 6600, anchor: 'top', coverage: 0.52, layers: 6, ridge: 0.85, scale: 0.9, warp: 1.4, mist: 0.95, hueDrift: 0.75,
    river: 0, density: 0.72, grain: 0.3, edge: 0.45, feather: 0.9, motion: 0.65,
  }),
  preset('Apricot Path', 'Apricot Path', {
    seed: 31337, coverage: 0.5, layers: 4, ridge: 0.5, warp: 0.6, hueDrift: 0.6,
    river: 0.9, riverWidth: 0.11, riverMeander: 0.75, riverDepth: 0.55, riverTilt: 0.45, edge: 0.4,
  }),
  preset('Color Field', 'Rothko', {
    seed: 1958, coverage: 1.05, layers: 3, ridge: 0.25, scale: 1.7, warp: 0.5, mist: 0.3, river: 0,
    hueDrift: 0.4, feather: 0.9, edge: 0.75, brush: 0.75, granulation: 0.5, density: 1.05,
  }),
  preset('Lavender Hills', 'Provence', {
    seed: 4242, coverage: 0.62, layers: 7, ridge: 0.9, scale: 1.3, warp: 0.4, mist: 0.6, hueDrift: 0.55,
    river: 0.7, riverWidth: 0.05, riverMeander: 0.9, riverDepth: 0.35, riverTilt: 0.2,
  }),
  preset('Sea Glass', 'Sea Glass', {
    seed: 2718, coverage: 0.48, layers: 6, ridge: 0.7, warp: 0.55, mist: 0.75, river: 0, granulation: 0.7,
  }),
  preset('Ink Study', 'Sumi', {
    seed: 8188, coverage: 0.62, layers: 4, ridge: 0.6, warp: 0.85, mist: 0.85, hueDrift: 0.2,
    river: 0.7, riverWidth: 0.06, riverMeander: 0.6, riverTilt: -0.3,
    granulation: 0.85, grain: 0.6, edge: 0.7, density: 0.85,
  }),
  preset('Verdigris', 'Verdigris', {
    seed: 3087, anchor: 'left', coverage: 0.58, layers: 5, ridge: 0.65, warp: 1, mist: 0.6, hueDrift: 0.9,
    river: 0, granulation: 0.75,
  }),
  preset('Maple Valley', 'Kyoto Autumn', {
    seed: 1185, coverage: 0.64, layers: 6, ridge: 0.8, warp: 0.7, hueDrift: 0.7,
    river: 0.9, riverWidth: 0.12, riverMeander: 0.7, riverDepth: 0.4, riverTilt: -0.35,
  }),
  preset('Night Ink', 'Night Ink', {
    seed: 7777, coverage: 0.58, layers: 5, ridge: 0.55, warp: 0.95, mist: 0.5, river: 0.7,
    riverWidth: 0.08, density: 0.9, grain: 0.35, edge: 0.35,
  }),
  preset('Wisteria', 'Wisteria', {
    seed: 2112, anchor: 'top', coverage: 0.55, layers: 5, ridge: 0.5, warp: 0.95, mist: 0.8, hueDrift: 0.6,
    river: 0, feather: 0.9,
  }),
  preset('Dunes', 'Dune', {
    seed: 1965, coverage: 0.6, layers: 7, ridge: 0.95, scale: 1.6, warp: 0.3, mist: 0.5, hueDrift: 0.3,
    river: 0, granulation: 0.9, grain: 0.7, edge: 0.7, brush: 0.55,
  }),
  preset('Saffron Dusk', 'Saffron & Plum', {
    seed: 5150, coverage: 0.66, layers: 6, ridge: 0.6, warp: 0.85, hueDrift: 0.85,
    river: 0.85, riverWidth: 0.1, riverMeander: 0.8, riverDepth: 0.5, riverTilt: 0.3,
  }),
  preset('Moss & Fog', 'Moss & Fog', {
    seed: 6022, coverage: 0.62, layers: 6, ridge: 0.85, scale: 0.85, mist: 0.9, river: 0.6, riverWidth: 0.06,
    riverMeander: 0.85, riverTilt: -0.4, brush: 0.6,
  }),
  preset('Harbor Fog', 'Harbor Fog', {
    seed: 9001, coverage: 0.52, layers: 6, ridge: 0.5, warp: 0.6, mist: 1, hueDrift: 0.3,
    river: 0.6, riverWidth: 0.04, riverDepth: 0.6, riverMeander: 0.4, granulation: 0.5,
  }),
  preset('Ultraviolet', 'Ultraviolet', {
    seed: 1337, coverage: 0.7, layers: 5, ridge: 0.6, warp: 1.2, mist: 0.55, hueDrift: 0.8,
    river: 0.8, riverWidth: 0.07, riverMeander: 0.7, density: 0.9, grain: 0.3, edge: 0.4,
  }),
  preset('Blue Hour', 'Blue Hour', {
    seed: 2030, coverage: 0.6, layers: 6, ridge: 0.7, warp: 0.7, mist: 0.75, hueDrift: 0.65,
    river: 0.85, riverWidth: 0.09, riverTilt: -0.2, riverDepth: 0.45,
  }),
  preset('Citrus Grove', 'Citrus', {
    seed: 7070, coverage: 0.58, layers: 5, ridge: 0.55, scale: 0.7, warp: 1.1, mist: 0.55, hueDrift: 0.9,
    river: 0.6, riverWidth: 0.07, riverMeander: 0.8,
  }),
  preset('Rose Quartz', 'Rose Quartz', {
    seed: 1618, anchor: 'top', coverage: 0.58, layers: 4, ridge: 0.4, warp: 1.1, mist: 0.7, river: 0,
    feather: 0.85, hueDrift: 0.35,
  }),
  preset('Reef', 'Coral Reef', {
    seed: 4040, anchor: 'right', coverage: 0.55, layers: 5, ridge: 0.6, warp: 1, mist: 0.6, hueDrift: 0.8,
    river: 0.7, riverWidth: 0.08,
  }),
  preset('Glacier', 'Glacier', {
    seed: 4669, coverage: 0.7, layers: 7, ridge: 0.9, scale: 1.25, warp: 0.45, river: 0.75,
    riverWidth: 0.07, riverDepth: 0.3, riverTilt: 0.1, granulation: 0.65, edge: 0.65,
  }),
  preset('Matcha Morning', 'Matcha', {
    seed: 3110, coverage: 0.6, layers: 6, ridge: 0.75, warp: 0.8, mist: 0.85, hueDrift: 0.5,
    river: 0.55, riverWidth: 0.05, riverMeander: 0.7, riverDepth: 0.55, feather: 0.8, granulation: 0.75, density: 1.05,
  }),
  preset('Gold Leaf', 'Gold Leaf', {
    seed: 2468, coverage: 0.55, layers: 4, ridge: 0.6, warp: 0.9, mist: 0.5, hueDrift: 0.6,
    river: 0.9, riverWidth: 0.05, riverMeander: 0.8, granulation: 0.8, edge: 0.6, brush: 0.7, density: 0.95,
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

/** Palettes painted on dark paper (the page itself turns dark). */
export const isDarkPalette = (p: Palette) => luminance(p.paper) < 0.18;

/**
 * A new random palette: usually a curated one, sometimes freshly generated.
 * Dark-paper palettes turn up now and then, since they change the whole page.
 */
export function randomPalette(rand: () => number, current?: Palette): Palette {
  if (rand() < 0.4) return generatePalette(rand);
  const dark = rand() < 0.12;
  const pool = PALETTES.filter((p) => p.name !== current?.name && isDarkPalette(p) === dark);
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
