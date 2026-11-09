import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/db/**/*.test.ts'],
    environment: 'node',
    // The database test files share one local Postgres server.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
