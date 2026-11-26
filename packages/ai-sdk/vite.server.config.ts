import { resolve } from 'node:path';

import { defineConfig } from 'vite';

// ADR 0052 / 0055 — `@nerey/ai-sdk/server` is built alone, with no banner, so a route handler or a
// server component gets functions rather than client references. Built in the same pass as the
// client entry, shared modules would be hoisted into a chunk carrying `'use client'`.

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: false,
    lib: {
      entry: { 'server/index': resolve(import.meta.dirname, 'src/server/index.ts') },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^@nerey\/core($|\/)/, /^ai($|\/)/, /^@ai-sdk\//],
      output: {
        preserveModules: false,
        entryFileNames: '[name].js',
        chunkFileNames: 'server/chunks/[name]-[hash].js',
      },
    },
  },
});
