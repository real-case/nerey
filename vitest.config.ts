import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// ADR 0006 / 0007 — two projects, one coverage number.
//
//   unit       jsdom, colocated *.test.ts(x) across every workspace package
//   storybook  every story rendered in a real browser, with the axe gate (ADR 0032)
//
// The split matters: jsdom cannot honestly answer questions about focus order, scroll
// locking or computed contrast, which is most of what a headless UI library must get right.

export default defineConfig({
  // Shared by both projects via `extends: true`. The same reasoning as the alias in
  // .storybook/main.ts: `@nerey/core` must resolve to source, not to whatever was last built.
  // A test suite that silently depends on a prior `npm run build` passes on a developer's
  // machine and fails on a clean checkout, which is the worst possible place to learn it.
  resolve: {
    alias: [
      { find: /^@nerey\/core\/mock$/, replacement: path.join(dirname, 'packages/core/src/mock/index.ts') },
      {
        find: /^@nerey\/core\/testing$/,
        replacement: path.join(dirname, 'packages/core/src/testing/index.ts'),
      },
      { find: /^@nerey\/core$/, replacement: path.join(dirname, 'packages/core/src/index.ts') },
    ],
  },
  test: {
    projects: [
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          setupFiles: [path.join(dirname, 'vitest.setup.ts')],
          include: ['packages/*/src/**/*.{test,spec}.{ts,tsx}'],
          // The visual suite is a browser-only run against Linux reference images and lives in
          // `vitest.visual.config.ts` (ADR 0042). Its files end in `.test.tsx`, so without this
          // they are collected here too, in the forks pool, where importing `vitest/browser`
          // throws — a failing file in `npm test` for a reason that has nothing to do with the
          // code under it.
          exclude: ['packages/*/src/**/*.visual.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        plugins: [
          // No react() here on purpose: since 8.5 storybookTest pulls main.ts's framework
          // plugins and viteFinal in itself, and duplicating them double-transforms JSX.
          storybookTest({
            configDir: path.join(dirname, '.storybook'),
            storybookScript: 'npm run storybook -- --no-open',
            storybookUrl: 'http://localhost:6006',
          }),
        ],
        test: {
          name: 'storybook',
          // No `include`: the story set comes exclusively from `stories` in main.ts.
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.stories.tsx',
        '**/*.test.{ts,tsx}',
        '**/__fixtures__/**',
        // Generated from tokens.css; covering a generated union proves nothing.
        '**/tokens.generated.ts',
        '**/index.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
