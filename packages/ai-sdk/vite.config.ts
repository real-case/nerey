import { resolve } from 'node:path';

import { defineConfig } from 'vite';

// ADR 0051 — an adapter ships ESM, no CSS, and bundles none of its peers. The client entry carries
// `'use client'` for the same reason core's does: its hooks hold React state. The React-free
// mapping and the tool derivation are built separately as `./server` (vite.server.config.ts).

const PEERS = [/^react($|\/)/, /^react-dom($|\/)/, /^@nerey\/core($|\/)/, /^ai($|\/)/, /^@ai-sdk\//];

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
      external: PEERS,
      output: {
        banner: "'use client';",
        preserveModules: false,
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
