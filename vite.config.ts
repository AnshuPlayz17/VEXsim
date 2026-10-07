import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works on GitHub Pages under /<repo>/.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
  test: {
    environment: 'node',
  },
});
