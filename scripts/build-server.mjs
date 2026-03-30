#!/usr/bin/env node
/**
 * Server build script for production
 * Uses esbuild to bundle the server with proper dead code elimination
 */

import * as esbuild from 'esbuild';

const result = await esbuild.build({
  entryPoints: ['server/index.ts', 'server/instrument.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outdir: 'dist',
  packages: 'external',
  // This is the key: define process.env.NODE_ENV as "production" string
  // This enables dead code elimination for development-only code
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  logLevel: 'info',
});

// Verify the build
if (result.errors.length > 0) {
  console.error('Build failed with errors:', result.errors);
  process.exit(1);
}

console.log('Server build completed successfully');
