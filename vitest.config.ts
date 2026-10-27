import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@meal/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@meal/data': fileURLToPath(new URL('./packages/data/dist/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: false,
  },
});
