import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { VERSION } from './src/embed/version.ts';

// Builds the standalone runtime that people drop into their own sites.
// The output is committed (embed/) so jsDelivr can serve it straight from GitHub at
// the tag embed-v<VERSION>; release.json records the version and SRI hash the
// generator puts in its snippets.
const OUT = 'embed';
const FILE = 'pigment-drift.min.js';

const release: Plugin = {
  name: 'embed-release',
  closeBundle() {
    const bytes = readFileSync(resolve(OUT, FILE));
    const integrity = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
    const info = { version: VERSION, tag: `embed-v${VERSION}`, file: FILE, bytes: bytes.length, integrity };
    writeFileSync(resolve(OUT, 'release.json'), `${JSON.stringify(info, null, 2)}\n`);
  },
};

export default defineConfig({
  publicDir: false,
  plugins: [release],
  build: {
    target: 'es2020',
    outDir: OUT,
    emptyOutDir: false,
    lib: {
      entry: 'src/embed/pigment-drift.ts',
      name: 'PigmentDrift',
      formats: ['iife'],
      fileName: () => FILE,
    },
  },
});
