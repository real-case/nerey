import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// ADR 0002 / 0028 — @nerey/core builds to ESM with three entry points matching its exports
// map. There is no CSS here and there must never be: `npm run check:core-purity` fails the
// build if a stylesheet ever appears in this package.

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: {
        index: resolve(import.meta.dirname, 'src/index.ts'),
        'mock/index': resolve(import.meta.dirname, 'src/mock/index.ts'),
        'testing/index': resolve(import.meta.dirname, 'src/testing/index.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^@standard-schema\//],
      output: {
        // Rollup strips top-of-file directives from bundled chunks, so `'use client'` written
        // in a source file never survives. Emitting it as a banner is deterministic and makes
        // the whole package a client boundary — which it is: every export touches React state,
        // context or effects (ADR 0002, AC-2).
        banner: "'use client';",
        preserveModules: false,
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
