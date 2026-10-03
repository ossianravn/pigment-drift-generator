// The single source of truth for every tweakable parameter.
// The control panel, randomizer, share links, exports and the embed runtime
// all read this schema, so adding a parameter here wires it up everywhere.

import { isHex, normalizeHex } from './color';

export type Anchor = 'bottom' | 'top' | 'left' | 'right';
export const ANCHORS: Anchor[] = ['bottom', 'top', 'left', 'right'];

export type GroupId = 'palette' | 'composition' | 'current' | 'texture' | 'motion';

export interface DriftConfig {
  v: 1;
  seed: number;
  /** Background paper color. */
  paper: string;
  /** Five pigments, ordered foreground (deepest) -> horizon (lightest). */
  colors: string[];
  density: number;
  hueDrift: number;
  anchor: Anchor;
  coverage: number;
  layers: number;
  ridge: number;
  scale: number;
  warp: number;
  mist: number;
  river: number;
  riverWidth: number;
  riverMeander: number;
  riverDepth: number;
  riverTilt: number;
  granulation: number;
  grain: number;
  edge: number;
  feather: number;
  brush: number;
  motion: number;
  flow: number;
  /** Seconds for one seamless animation loop. */
  loop: number;
}

export type NumericKey = {
  [K in keyof DriftConfig]: DriftConfig[K] extends number ? K : never;
}[keyof DriftConfig];

export interface RangeSpec {
  key: Exclude<NumericKey, 'v'>;
  group: GroupId;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  /** Range the randomizer draws from: narrower than min/max so results stay tasteful. */
  random: [number, number];
  /** Formats the value for display. */
  format?: (v: number) => string;
}

export const GROUPS: { id: GroupId; title: string; numeral: string }[] = [
  { id: 'palette', title: 'Pigment', numeral: 'i' },
  { id: 'composition', title: 'Composition', numeral: 'ii' },
  { id: 'current', title: 'Current', numeral: 'iii' },
  { id: 'texture', title: 'Paper & texture', numeral: 'iv' },
  { id: 'motion', title: 'Motion', numeral: 'v' },
];

const pct = (v: number) => `${Math.round(v * 100)}`;
const fixed2 = (v: number) => v.toFixed(2);

export const RANGES: RangeSpec[] = [
  { key: 'density', group: 'palette', label: 'Density', hint: 'How much pigment is in the wash', min: 0.3, max: 1.3, step: 0.01, random: [0.75, 1.1], format: pct },
  { key: 'hueDrift', group: 'palette', label: 'Hue drift', hint: 'How far colors wander across the wash', min: 0, max: 1, step: 0.01, random: [0.25, 0.8], format: pct },

  { key: 'coverage', group: 'composition', label: 'Coverage', hint: 'How far the pigment reaches into the canvas', min: 0.15, max: 1.25, step: 0.01, random: [0.42, 0.75], format: pct },
  { key: 'layers', group: 'composition', label: 'Layers', hint: 'Number of washes stacked like ridges', min: 2, max: 7, step: 1, random: [3, 6], format: (v) => `${v}` },
  { key: 'ridge', group: 'composition', label: 'Ridges', hint: 'Height of the hills along each wash edge', min: 0, max: 1, step: 0.01, random: [0.3, 0.85], format: pct },
  { key: 'scale', group: 'composition', label: 'Scale', hint: 'Size of the shapes', min: 0.4, max: 2.5, step: 0.01, random: [0.75, 1.5], format: fixed2 },
  { key: 'warp', group: 'composition', label: 'Swirl', hint: 'Domain warp — how much the pigment swirls', min: 0, max: 1.5, step: 0.01, random: [0.35, 1.1], format: pct },
  { key: 'mist', group: 'composition', label: 'Mist', hint: 'Soft haze where pigment meets paper', min: 0, max: 1, step: 0.01, random: [0.35, 0.85], format: pct },

  { key: 'river', group: 'current', label: 'Strength', hint: 'The lifted, pale current winding through the wash (0 = off)', min: 0, max: 1, step: 0.01, random: [0, 1], format: pct },
  { key: 'riverWidth', group: 'current', label: 'Width', hint: 'Width of the current in the foreground', min: 0.02, max: 0.3, step: 0.005, random: [0.05, 0.16], format: fixed2 },
  { key: 'riverMeander', group: 'current', label: 'Meander', hint: 'How much it winds', min: 0, max: 1, step: 0.01, random: [0.3, 0.9], format: pct },
  { key: 'riverDepth', group: 'current', label: 'Position', hint: 'Where in the wash it runs (near ↔ far)', min: 0, max: 1, step: 0.01, random: [0.25, 0.7], format: pct },
  { key: 'riverTilt', group: 'current', label: 'Tilt', hint: 'Angle of the current', min: -1, max: 1, step: 0.01, random: [-0.7, 0.7], format: fixed2 },

  { key: 'granulation', group: 'texture', label: 'Granulation', hint: 'Pigment settling into the paper tooth', min: 0, max: 1, step: 0.01, random: [0.3, 0.8], format: pct },
  { key: 'grain', group: 'texture', label: 'Paper grain', hint: 'Fine texture of the paper itself', min: 0, max: 1, step: 0.01, random: [0.25, 0.7], format: pct },
  { key: 'edge', group: 'texture', label: 'Edge pooling', hint: 'Darker rims where the wash dried', min: 0, max: 1, step: 0.01, random: [0.25, 0.75], format: pct },
  { key: 'feather', group: 'texture', label: 'Feathering', hint: 'Ragged, bleeding edges', min: 0, max: 1, step: 0.01, random: [0.3, 0.9], format: pct },
  { key: 'brush', group: 'texture', label: 'Brushwork', hint: 'Painterly stroke relief', min: 0, max: 1, step: 0.01, random: [0.2, 0.75], format: pct },

  { key: 'motion', group: 'motion', label: 'Drift', hint: 'How much the pigment moves in the loop', min: 0, max: 1, step: 0.01, random: [0.25, 0.7], format: pct },
  { key: 'flow', group: 'motion', label: 'Flow', hint: 'Speed of the current', min: 0, max: 1, step: 0.01, random: [0.2, 0.7], format: pct },
  { key: 'loop', group: 'motion', label: 'Loop length', hint: 'Seconds before the animation repeats seamlessly', min: 6, max: 40, step: 1, random: [12, 24], format: (v) => `${v}s` },
];

export const RANGE_BY_KEY = Object.fromEntries(RANGES.map((r) => [r.key, r])) as Record<RangeSpec['key'], RangeSpec>;

export const DEFAULT_CONFIG: DriftConfig = {
  v: 1,
  seed: 4127,
  paper: '#fdf1e3',
  colors: ['#2a1a7a', '#3446c9', '#6a4fd6', '#b7a2ee', '#f3cfdf'],
  density: 0.95,
  hueDrift: 0.5,
  anchor: 'bottom',
  coverage: 0.55,
  layers: 5,
  ridge: 0.6,
  scale: 1,
  warp: 0.75,
  mist: 0.6,
  river: 0.85,
  riverWidth: 0.09,
  riverMeander: 0.6,
  riverDepth: 0.5,
  riverTilt: 0.35,
  granulation: 0.55,
  grain: 0.45,
  edge: 0.5,
  feather: 0.6,
  brush: 0.45,
  motion: 0.45,
  flow: 0.45,
  loop: 16,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const snap = (v: number, step: number) => Math.round(v / step) * step;
const round = (v: number, digits = 3) => Number(v.toFixed(digits));

/**
 * Coerces anything (old share links, hand-edited JSON, embed attributes)
 * into a valid config. Unknown keys are dropped, missing ones get defaults.
 */
export function sanitizeConfig(input: unknown, base: DriftConfig = DEFAULT_CONFIG): DriftConfig {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: DriftConfig = { ...base, colors: [...base.colors], v: 1 };

  const seed = Number(src.seed);
  if (Number.isFinite(seed)) out.seed = Math.abs(Math.floor(seed)) % 1_000_000;

  if (isHex(src.paper)) out.paper = normalizeHex(src.paper);

  if (Array.isArray(src.colors)) {
    const valid = src.colors.filter(isHex).map((c) => normalizeHex(c));
    if (valid.length > 0) {
      while (valid.length < 5) valid.push(valid[valid.length - 1]);
      out.colors = valid.slice(0, 5);
    }
  }

  if (typeof src.anchor === 'string' && (ANCHORS as string[]).includes(src.anchor)) {
    out.anchor = src.anchor as Anchor;
  }

  for (const spec of RANGES) {
    const raw = Number(src[spec.key]);
    if (src[spec.key] === undefined || !Number.isFinite(raw)) continue;
    out[spec.key] = round(clamp(snap(raw, spec.step), spec.min, spec.max), 4);
  }
  return out;
}

/** Compact JSON (rounded numbers) — what exports and share links contain. */
export function toPortableConfig(cfg: DriftConfig): DriftConfig {
  const out = { ...cfg, colors: [...cfg.colors] };
  for (const spec of RANGES) out[spec.key] = round(cfg[spec.key], 3);
  return out;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeConfig(cfg: DriftConfig): string {
  return toBase64Url(JSON.stringify(toPortableConfig(cfg)));
}

export function decodeConfig(token: string): DriftConfig | null {
  try {
    return sanitizeConfig(JSON.parse(fromBase64Url(token)));
  } catch {
    return null;
  }
}

/** Accepts raw JSON or a generator link containing #c=… (what people paste back in). */
export function parseConfigText(text: string): DriftConfig | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const m = /[#&]c=([\w-]+)/.exec(trimmed);
  if (m) return decodeConfig(m[1]);
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? sanitizeConfig(parsed) : null;
  } catch {
    return null;
  }
}

/** Small deterministic PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomizeRanges(
  cfg: DriftConfig,
  locked: ReadonlySet<GroupId>,
  rand: () => number,
): DriftConfig {
  const out = { ...cfg, colors: [...cfg.colors] };
  for (const spec of RANGES) {
    if (locked.has(spec.group)) continue;
    const [lo, hi] = spec.random;
    out[spec.key] = round(clamp(snap(lo + (hi - lo) * rand(), spec.step), spec.min, spec.max), 4);
  }
  if (!locked.has('current')) {
    // About a third of random pieces have no current — plain washes are lovely too.
    out.river = rand() < 0.35 ? 0 : round(0.55 + 0.45 * rand(), 2);
  }
  if (!locked.has('composition')) {
    out.seed = Math.floor(rand() * 1_000_000);
    const r = rand();
    out.anchor = r < 0.72 ? 'bottom' : r < 0.86 ? 'top' : r < 0.93 ? 'left' : 'right';
  }
  return out;
}
