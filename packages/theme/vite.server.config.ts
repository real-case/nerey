import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// ADR 0056 — `@nerey/theme/server` is built on its own, after the client build, into the same
// `dist/`, for the reason ADR 0052 gives for core's: a shared build would hoist modules into chunks
// that carry the `'use client'` banner. `@nerey/core/server` and `zod` stay external, so the entry's
// imports are exactly what `server-entry.test.ts` checks.

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
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^@nerey\/core/, /^@base-ui\//, /^zod($|\/)/],
      output: {
        preserveModules: false,
        entryFileNames: '[name].js',
        chunkFileNames: 'server/chunks/[name]-[hash].js',
      },
    },
  },
});
