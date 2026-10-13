import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so the tests do not load the router plugin or the dev proxy.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
