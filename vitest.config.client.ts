import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // Run the client suite in a fixed, non-UTC browser timezone. The UI
    // renders appointment times with local Date getters, and the only bug
    // class that matters there (UTC getters where local ones belong) is
    // INVISIBLE when the test process itself is UTC — which GitHub Actions
    // is, while a developer's Mac in Eastern time is not. Eastern matches
    // the practices this is built for and the QA repro (2026-11-18).
    // `pool: 'forks'`: a TZ assignment is only honoured on a process's main
    // thread, so the default worker_threads pool silently ignores `env.TZ`.
    pool: 'forks',
    env: { TZ: 'America/New_York' },
    include: ['client/src/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./client/src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules',
        'dist',
        '**/*.test.ts',
        '**/*.test.tsx',
        'migrations/**',
        'supabase/**',
      ],
      thresholds: {
        statements: 20,
        branches: 15,
        functions: 20,
        lines: 20,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
});
