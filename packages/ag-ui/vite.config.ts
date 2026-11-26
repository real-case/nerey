import { resolve } from 'node:path';

import { defineConfig } from 'vite';

// ADR 0051 / 0054 — @nerey/ag-ui builds to ESM with one entry point. Core, React and the protocol
// package are peers and stay external; the protocol is imported for its types only, so nothing
// from `@ag-ui/core` survives into the bundle at all.

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: { index: resolve(import.meta.dirname, 'src/index.ts') },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^@nerey\/core($|\/)/, /^@ag-ui\//],
      output: {
        // `useAgUiFrames` uses React state, so the entry is a client boundary (ADR 0052).
        banner: "'use client';",
        entryFileNames: '[name].js',
      },
    },
  },
});
