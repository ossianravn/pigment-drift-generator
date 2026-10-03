import { defineConfig } from 'vite';

// Builds the standalone runtime that people drop into their own sites.
// Output lands in public/embed so the app can serve and bundle it.
export default defineConfig({
  publicDir: false,
  build: {
    target: 'es2020',
    outDir: 'public/embed',
    emptyOutDir: true,
    lib: {
      entry: 'src/embed/pigment-drift.ts',
      name: 'PigmentDrift',
      formats: ['iife'],
      fileName: () => 'pigment-drift.min.js',
    },
  },
});
