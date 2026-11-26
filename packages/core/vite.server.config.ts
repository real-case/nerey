import { resolve } from 'node:path';

import { defineConfig } from 'vite';

// ADR 0052 — `@nerey/core/server` is built on its own, after the client build, into the same
// `dist/`. It cannot share the client build: Rolldown would hoist the modules both entries use into
// shared chunks, those chunks carry the `'use client'` banner, and a server module importing one
// gets client references instead of functions — the exact failure this entry exists to remove.
// Built alone, every module it reaches is inlined into `dist/server/index.js` with no banner.

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    // The client build already wrote dist/; this pass only adds dist/server/.
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: {
      entry: { 'server/index': resolve(import.meta.dirname, 'src/server/index.ts') },
      formats: ['es'],
    },
    rollupOptions: {
      // React is external so that, if a React import ever creeps into this graph, it shows up as
      // an import statement `server-entry.test.ts` can see rather than as inlined code.
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^@standard-schema\//],
      output: {
        preserveModules: false,
        entryFileNames: '[name].js',
        chunkFileNames: 'server/chunks/[name]-[hash].js',
      },
    },
  },
});
