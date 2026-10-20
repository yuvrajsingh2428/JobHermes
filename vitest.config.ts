import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'coverage/**',
        'dist/**',
        'node_modules/**',
        'tests/**',
        '**/*.d.ts',
        'scratch/**',
        'src/dashboard/public/**',
      ],
      thresholds: {
        statements: 70,
      },
    },
  },
});
