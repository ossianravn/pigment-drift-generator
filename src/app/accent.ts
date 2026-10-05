import { hexToOklab, luminance } from '../engine/color';

/**
 * The UI borrows its accent from the piece: on light paper the deepest pigment;
 * on dark paper the most vivid mid-tone, so buttons still stand out against the page.
 * Either way white text on it stays readable.
 */
export function accentFor(colors: string[], darkPaper: boolean): string {
  if (!darkPaper) {
    return [...colors].sort((a, b) => luminance(a) - luminance(b)).find((c) => luminance(c) < 0.2) ?? '#2a2433';
  }
  const chroma = (c: string) => Math.hypot(hexToOklab(c)[1], hexToOklab(c)[2]);
  const mids = colors.filter((c) => luminance(c) >= 0.06 && luminance(c) <= 0.22);
  return mids.sort((a, b) => chroma(b) - chroma(a))[0] ?? '#6a5fd8';
}
