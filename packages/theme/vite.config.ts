import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// ADR 0023 — CSS Modules are compiled HERE, at publish time, into one static stylesheet with
// hashed class names. A consumer must never have to teach their bundler to process CSS
// Modules inside node_modules; Next.js does not do it by default, and asking them to is
// asking them to fork their build config for a dependency.

const packageDir = import.meta.dirname;

/**
 * `tokens.css` ships as a raw, uncompiled entry point (ADR 0024): it declares custom
 * properties only, a consumer may want it without the component CSS, and the Storybook
 * preview loads it alone. Copying rather than bundling keeps it readable and diffable in
 * node_modules — which matters for a file whose whole purpose is to be overridden.
 */
function copyTokens(): Plugin {
  return {
    name: 'nerey-copy-tokens',
    apply: 'build',
    closeBundle() {
      const outDir = resolve(packageDir, 'dist');
      mkdirSync(outDir, { recursive: true });
      copyFileSync(resolve(packageDir, 'src/tokens.css'), resolve(outDir, 'tokens.css'));
    },
  };
}

export default defineConfig({
  plugins: [react(), copyTokens()],
  resolve: {
    alias: {
      '@nerey/core': resolve(packageDir, '../core/src/index.ts'),
    },
  },
  css: {
    modules: {
      // A stable, readable pattern: `nerey-<class>-<hash>`. Readable so a devtools inspection
      // tells you which component you are looking at; hashed so two components may both call
      // a class `root`. The pattern is pinned because the emitted names end up in consumer
      // snapshots (ADR 0023).
      generateScopedName: 'nerey-[local]-[hash:base64:5]',
      localsConvention: 'camelCaseOnly',
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // JS stays readable: a consumer debugging a widget's render should land in code they can
    // follow, and a bundler will minify it in their app anyway.
    minify: false,
    // CSS does not get the same treatment. Nobody steps through a stylesheet, the authoring
    // comments are long by design, and a consumer cannot tree-shake a single emitted file — so
    // every byte of commentary here is a byte on their critical path.
    cssMinify: true,
    // One stylesheet, not one per chunk: the exports map promises exactly `./theme.css`.
    cssCodeSplit: false,
    lib: {
      entry: { index: resolve(packageDir, 'src/index.ts') },
      formats: ['es'],
    },
    rollupOptions: {
      // Every declared runtime dependency stays OUT of the bundle, `zod` included. Bundling it
      // shipped a second copy beside the one npm installs from `dependencies` — 135 kB raw,
      // 26 kB gzipped, duplicated on every consumer's critical path — and left the artifact
      // disagreeing with the dependency graph ADR 0002 fixes. It is also a correctness seam: a
      // consumer who extends an exported widget schema would be mixing two Zod runtimes, which
      // is the same two-copies-in-the-graph failure ADR 0011 refuses a hard Zod dependency in
      // core to avoid. `@standard-schema/spec` needs no entry — it is types-only and emits
      // nothing to externalise.
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^@nerey\/core/, /^@base-ui\//, /^zod($|\/)/],
      output: {
        banner: "'use client';",
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (asset) => (asset.names?.[0]?.endsWith('.css') ? 'theme.css' : '[name][extname]'),
      },
    },
  },
});
