import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      // Two pages: the generator, and the paint studio at /paint/.
      input: { main: page('./index.html'), paint: page('./paint/index.html') },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
