import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import release from '../embed/release.json';
import { VERSION } from '../src/embed/version';
import { DEFAULT_CONFIG } from '../src/engine/params';
import { cdnUrl, embedSnippet } from '../src/export/snippets';

describe('released embed runtime', () => {
  it('release.json describes the committed file', () => {
    const bytes = readFileSync(new URL('../embed/pigment-drift.min.js', import.meta.url));
    expect(release.bytes).toBe(bytes.length);
    expect(release.integrity).toBe(`sha384-${createHash('sha384').update(bytes).digest('base64')}`);
  });

  it('matches the source version and its tag', () => {
    expect(release.version).toBe(VERSION);
    expect(release.tag).toBe(`embed-v${VERSION}`);
  });

  it('CDN snippets are pinned to the tag and carry the integrity hash', () => {
    const url = cdnUrl(release);
    expect(url).toBe(`https://cdn.jsdelivr.net/gh/ossianravn/pigment-drift-generator@embed-v${VERSION}/embed/pigment-drift.min.js`);
    const { html } = embedSnippet(DEFAULT_CONFIG, { scriptSrc: url, integrity: release.integrity, still: false, fps: 30, quality: 0.75 });
    expect(html).toContain(`src="${url}"`);
    expect(html).toContain(`integrity="${release.integrity}" crossorigin="anonymous"`);
  });

  it('self-hosted snippets have no integrity attribute', () => {
    const { html } = embedSnippet(DEFAULT_CONFIG, { scriptSrc: 'pigment-drift.min.js', still: false, fps: 30, quality: 0.75 });
    expect(html).not.toContain('integrity');
  });
});
