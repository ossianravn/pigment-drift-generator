import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, sanitizeConfig } from '../src/engine/params';
import { configJson, embedSnippet, examplePage, imageSnippet, readme, videoSnippet } from '../src/export/snippets';

const cfg = sanitizeConfig({ ...DEFAULT_CONFIG, anchor: 'top' });

describe('image snippet', () => {
  it('references both files and anchors the crop to the pigment edge', () => {
    const { html, css } = imageSnippet(cfg, { desktop: 'd.webp', mobile: 'm.webp' });
    expect(html).toContain('class="pd-bg"');
    expect(css).toContain('url("d.webp") center top / cover');
    expect(css).toContain('url("m.webp")');
    expect(css).toContain(cfg.paper);
  });

  it('omits the media query without a mobile file', () => {
    expect(imageSnippet(cfg, { desktop: 'd.webp' }).css).not.toContain('@media');
  });
});

describe('video snippet', () => {
  it('is muted, inline, looping and has a reduced-motion fallback', () => {
    const { html, css } = videoSnippet(cfg, {
      desktop: 'd.mp4', mobile: 'm.mp4', type: 'video/mp4', posterDesktop: 'd.webp', posterMobile: 'm.webp',
    });
    for (const attr of ['autoplay', 'muted', 'loop', 'playsinline']) expect(html).toContain(attr);
    expect(html.indexOf('m.mp4')).toBeLessThan(html.indexOf('d.mp4')); // first matching <source> wins
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('object-position: center top');
  });
});

describe('embed snippet', () => {
  it('embeds a config that parses back to the same piece', () => {
    const { html } = embedSnippet(cfg, { scriptSrc: 'pigment-drift.min.js', still: false, fps: 30, quality: 0.75 });
    const attr = /config='([^']*)'/.exec(html)![1].replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    expect(sanitizeConfig(JSON.parse(attr))).toEqual(cfg);
    expect(html).toContain('<script src="pigment-drift.min.js" defer></script>');
    expect(html).not.toContain('fps=');
  });

  it('adds non-default options as attributes', () => {
    const { html, react } = embedSnippet(cfg, { scriptSrc: 'x.js', poster: 'p.webp', still: true, fps: 60, quality: 1 });
    expect(html).toContain('poster="p.webp"');
    expect(html).toContain(' still');
    expect(react).toContain('still=""');
  });
});

describe('docs', () => {
  it('README lists files and the share link', () => {
    const md = readme({ kind: 'image', cfg, files: ['a.webp', 'README.md'], snippet: { html: '<div>', css: '.x{}' }, shareUrl: 'https://x/#c=abc' });
    expect(md).toContain('`a.webp`');
    expect(md).toContain('https://x/#c=abc');
    expect(md).toContain('```css');
  });

  it('example page includes the snippet', () => {
    const page = examplePage('Demo', cfg, { html: '<div class="pd-bg"></div>', css: '.pd-bg{}' });
    expect(page).toContain('<div class="pd-bg"></div>');
    expect(page).toMatch(/^<!doctype html>/);
  });

  it('config JSON is compact unless asked', () => {
    expect(configJson(cfg)).not.toContain('\n');
    expect(configJson(cfg, true)).toContain('\n');
  });
});
