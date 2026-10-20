import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts so the tests do not load the router plugin or the dev proxy.
export default defineConfig({
  // `@/x` means `src/x` and `@contract/x` the server's `src/contract/x`, as the "paths" in tsconfig.json
  // say (vite.config.ts has the same line).
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
