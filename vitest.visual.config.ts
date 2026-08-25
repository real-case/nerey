import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// ADR 0042 — the visual regression run, deliberately in its own config rather than as a third
// project in `vitest.config.ts`.
//
// `npm test` must stay runnable on any machine, and this one is not: the theme's font tokens are
// SYSTEM stacks (ADR 0024), so the same component rasterises differently on macOS and on the Linux
// runner. Reference images are therefore Linux images, produced in the official Playwright
// container by `npm run test:visual:update`, and comparing them anywhere else is meaningless.
// Folding that into the default suite would make `npm test` fail on a developer's laptop for a
// reason that has nothing to do with their change.
export default defineConfig({
  // The same aliases as vitest.config.ts and .storybook/main.ts: `@nerey/core` resolves to SOURCE,
  // never to whatever was last built (ADR 0006).
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
  plugins: [react()],
  test: {
    name: 'visual',
    include: ['packages/*/src/**/*.visual.test.tsx'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({}),
      // One fixed viewport. A screenshot is only a baseline if everything that decides its pixels
      // is pinned, and the viewport decides layout before anything else does.
      instances: [{ browser: 'chromium', viewport: { width: 1280, height: 800 } }],
      expect: {
        toMatchScreenshot: {
          comparatorName: 'pixelmatch',
          comparatorOptions: {
            // Zero, and that is the point of pinning the container image. A loose tolerance is a
            // hedge against a rasteriser you do not control; references and comparison both come
            // out of `mcr.microsoft.com/playwright:v1.62.1-noble`, so there is nothing to hedge
            // against and every mismatched pixel is a real difference.
            //
            // Measured, not assumed: at 0.2% a `--nerey-radius-md` change from 0.375rem to
            // 0.875rem moved only 2 of 90 references, because a corner radius touches a few dozen
            // pixels and seventeen stylesheets use that token. A gate that absorbs a visible
            // change to seventeen components is a gate that looks like it works.
            allowedMismatchedPixels: 0,
          },
          /**
           * Vitest's default path template ends in `-${browserName}-${platform}`, which would let a
           * macOS run quietly write a SECOND set of references beside the Linux ones and pass.
           * Dropping the platform leaves exactly one authoritative image per screenshot, so running
           * this suite outside the container fails loudly — which is the correct outcome, not a
           * shortcoming.
           */
          resolveScreenshotPath: ({ root, testFileDirectory, testFileName, arg, ext }) =>
            path.join(root, testFileDirectory, '__screenshots__', testFileName, `${arg}${ext}`),
        },
      },
    },
  },
});
