// Copy-paste code and README text for every export type. Pure functions so
// they're easy to test and reuse in the zip packs.

import type { Anchor, DriftConfig } from '../engine/params';
import { toPortableConfig } from '../engine/params';

export const POSITION: Record<Anchor, string> = {
  bottom: 'center bottom',
  top: 'center top',
  left: 'left center',
  right: 'right center',
};

/** Media query that switches to the portrait (mobile) asset. */
export const PORTRAIT_QUERY = '(max-aspect-ratio: 4/5)';

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;');

export function configJson(cfg: DriftConfig, pretty = false): string {
  return JSON.stringify(toPortableConfig(cfg), null, pretty ? 2 : 0);
}

export interface ImageFiles {
  desktop: string;
  mobile?: string;
}

export function imageSnippet(cfg: DriftConfig, files: ImageFiles): { html: string; css: string } {
  const html = `<!-- First thing inside <body> -->
<div class="pd-bg" aria-hidden="true"></div>`;
  const css = `/* Pigment Drift background · No. ${cfg.seed} */
.pd-bg {
  position: fixed;          /* use "absolute" to sit behind a single section */
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: ${cfg.paper} url("${files.desktop}") ${POSITION[cfg.anchor]} / cover no-repeat;
}${
    files.mobile
      ? `
@media ${PORTRAIT_QUERY} {
  .pd-bg { background-image: url("${files.mobile}"); }
}`
      : ''
  }`;
  return { html, css };
}

export interface VideoFiles {
  desktop: string;
  mobile?: string;
  type: string;
  posterDesktop: string;
  posterMobile?: string;
}

export function videoSnippet(cfg: DriftConfig, files: VideoFiles): { html: string; css: string } {
  const sources = [
    files.mobile ? `  <source src="${files.mobile}" type="${files.type}" media="${PORTRAIT_QUERY}">` : '',
    `  <source src="${files.desktop}" type="${files.type}">`,
  ].filter(Boolean).join('\n');
  const html = `<!-- First thing inside <body> -->
<div class="pd-bg pd-still" aria-hidden="true"></div>
<video class="pd-bg pd-video" autoplay muted loop playsinline preload="auto" aria-hidden="true">
${sources}
</video>`;
  const css = `/* Pigment Drift video background · No. ${cfg.seed} · ${cfg.loop}s seamless loop */
.pd-bg {
  position: fixed;          /* use "absolute" to sit behind a single section */
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
  pointer-events: none;
}
.pd-video { object-fit: cover; object-position: ${POSITION[cfg.anchor]}; }
/* The still shows instantly while the video loads, and replaces it for reduced motion. */
.pd-still { background: ${cfg.paper} url("${files.posterDesktop}") ${POSITION[cfg.anchor]} / cover no-repeat; }${
    files.posterMobile
      ? `
@media ${PORTRAIT_QUERY} {
  .pd-still { background-image: url("${files.posterMobile}"); }
}`
      : ''
  }
@media (prefers-reduced-motion: reduce) {
  .pd-video { display: none; }
}`;
  return { html, css };
}

export interface EmbedOptions {
  scriptSrc: string;
  poster?: string;
  still: boolean;
  fps: number;
  quality: number;
}

export function embedSnippet(cfg: DriftConfig, o: EmbedOptions): { html: string; css: string; react: string; js: string } {
  const json = configJson(cfg);
  const extra = [
    o.poster ? `poster="${o.poster}"` : '',
    o.still ? 'still' : '',
    !o.still && o.fps !== 30 ? `fps="${o.fps}"` : '',
    !o.still && o.quality !== 0.75 ? `quality="${o.quality}"` : '',
  ].filter(Boolean);
  const html = `<!-- First thing inside <body> -->
<pigment-drift class="pd-bg"${extra.length ? ' ' + extra.join(' ') : ''}
  config='${attr(json)}'></pigment-drift>

<!-- Once per page, anywhere -->
<script src="${o.scriptSrc}" defer></script>`;
  const css = `.pd-bg {
  position: fixed;          /* use "absolute" to sit behind a single section */
  inset: 0;
  z-index: -1;
  pointer-events: none;
}`;
  const react = `// 1. Load ${o.scriptSrc} once (e.g. <script> in index.html, or next/script).
// 2. Render the element anywhere — it is a standard custom element.
const config = ${configJson(cfg, true)};

export function PigmentDriftBackground() {
  return (
    <pigment-drift
      className="pd-bg"
      config={JSON.stringify(config)}${o.poster ? `\n      poster="${o.poster}"` : ''}${o.still ? '\n      still=""' : ''}
    />
  );
}`;
  const js = `// Or mount into any positioned element yourself:
const bg = PigmentDrift.mount(document.querySelector('.hero'), ${json}, {
  still: ${o.still}, fps: ${o.fps}, quality: ${o.quality}
});
// bg.update(newConfig)  ·  bg.destroy()`;
  return { html, css, react, js };
}

/** A minimal page demonstrating a pack, so people can open it and see it working. */
export function examplePage(title: string, cfg: DriftConfig, snippet: { html: string; css: string }): string {
  const dark = isDark(cfg.paper);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
${snippet.css}

/* Demo page only */
body { margin: 0; min-height: 100vh; font: 18px/1.5 system-ui, sans-serif; color: ${dark ? '#f4efe6' : '#2a2433'}; }
main { max-width: 40rem; padding: 12vh 8vw; }
h1 { font-weight: 500; font-size: clamp(2rem, 5vw, 3.2rem); margin: 0 0 .4em; }
</style>
</head>
<body>
${snippet.html}
<main>
  <h1>${title}</h1>
  <p>Your content sits on top. Resize the window or open this on a phone to see the background adapt.</p>
</main>
</body>
</html>
`;
}

function isDark(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
}

export function readme(opts: {
  kind: 'image' | 'video' | 'embed';
  cfg: DriftConfig;
  files: string[];
  snippet: { html: string; css: string };
  shareUrl: string;
  notes?: string[];
}): string {
  const { kind, cfg, files, snippet, shareUrl } = opts;
  const what = {
    image: 'a still watercolor background (desktop + mobile)',
    video: `a seamless ${cfg.loop}-second video loop (desktop + mobile)`,
    embed: 'a live, animated WebGL background (one small script)',
  }[kind];
  return `# Pigment Drift · No. ${cfg.seed}

This pack contains ${what}.

## Files

${files.map((f) => `- \`${f}\``).join('\n')}

## Use it

1. Copy the files next to your page (or into your \`public/\` / static folder).
2. Paste the HTML as the first thing inside \`<body>\`:

\`\`\`html
${snippet.html}
\`\`\`

3. Add the CSS to your stylesheet:

\`\`\`css
${snippet.css}
\`\`\`

Open \`example.html\` to see it working.

## Tips

- **Behind one section instead of the whole page:** change \`position: fixed\` to \`position: absolute\` and give that section \`position: relative; isolation: isolate;\`.
- **Text contrast:** the paper color is \`${cfg.paper}\`. Keep body text on the paper area, or add a soft scrim behind text that sits over dense pigment.
${(opts.notes ?? []).map((n) => `- ${n}`).join('\n')}

## Re-open in the generator

${shareUrl}

---
Made with Pigment Drift — https://github.com/ossianravn/pigment-drift-generator (MIT).
The artwork you generate is yours to use however you like.
`;
}
