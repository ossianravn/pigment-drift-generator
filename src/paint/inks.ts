// Making inks: from any hue, or a suggestion that sits apart from the inks in use.

import { hexToOklab, luminance, oklchToHex } from '../engine/color';
import { PALETTES, type Palette, isDarkPalette } from '../engine/palettes';

/**
 * A five-color ramp around one hue (degrees), deep to pale, drifting a little in
 * hue as it lightens, the way the curated palettes do.
 */
export function rampFromHue(hue: number, paper: string): Palette {
  const h = ((hue % 360) + 360) % 360;
  const dark = luminance(paper) < 0.18;
  // On dark paper the ramp runs the other way: the "deepest" pigment is the brightest.
  const L = dark ? [0.86, 0.72, 0.56, 0.4, 0.24] : [0.32, 0.45, 0.6, 0.76, 0.9];
  const C = dark ? [0.1, 0.16, 0.17, 0.12, 0.05] : [0.14, 0.18, 0.16, 0.1, 0.05];
  const colors = L.map((l, i) => oklchToHex(l, C[i], h + (28 * i) / 4));
  return { name: `Hue ${Math.round(h)}°`, paper, colors };
}

/** The hue (degrees) a palette leans toward: its mid-deep pigment's. */
export function hueOf(p: Palette): number {
  const [, a, b] = hexToOklab(p.colors[1]);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

const chromaOf = (p: Palette) => Math.hypot(...hexToOklab(p.colors[1]).slice(1));
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * A curated palette (on the same kind of paper) that stands apart from the inks in use:
 * far away in hue, and vivid rather than muted.
 */
export function suggestInk(inks: Palette[]): Palette {
  const dark = isDarkPalette(inks[0]);
  const used = inks.map(hueOf);
  const pool = PALETTES.filter((p) => isDarkPalette(p) === dark && !inks.some((i) => i.colors.join() === p.colors.join()));
  const best = pool.reduce((a, b) => {
    const score = (p: Palette) => Math.min(...used.map((u) => hueGap(u, hueOf(p)))) + 300 * chromaOf(p);
    return score(b) > score(a) ? b : a;
  });
  return { ...best, colors: [...best.colors] };
}
