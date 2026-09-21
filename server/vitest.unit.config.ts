import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only database-free tests belong here: name them *.unit.test.ts.
    include: ['test/**/*.unit.test.ts'],
    sequence: { concurrent: false },
  },
});