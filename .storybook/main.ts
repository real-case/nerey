import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { StorybookConfig } from '@storybook/react-vite';

// ADR 0031 — the workbench. `@storybook/react-vite`, not `nextjs-vite`: Nerey is a plain
// React library and the workbench must not inherit a framework's assumptions.
//
// Storybook 10 requires this file to be valid ESM — `require`, `__dirname` and `__filename`
// are undefined here.

const configDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(configDir, '..');
const packagesDir = join(repoRoot, 'packages');

// One specifier per workspace package rather than a single flat glob across `packages`.
// Storybook splits a glob at its first magic character to derive the auto-title root, so the
// flat form would title every story `Theme/Src/Components/Button`. Per-package specifiers with
// an explicit `titlePrefix` give a sidebar that reads like the package layout.
const workspaceStories = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(packagesDir, entry.name, 'src')))
  .sort((a, b) => a.name.localeCompare(b.name))
  .flatMap((entry) => [
    { directory: `../packages/${entry.name}/src`, files: '**/*.mdx', titlePrefix: entry.name },
    {
      directory: `../packages/${entry.name}/src`,
      files: '**/*.stories.@(ts|tsx)',
      titlePrefix: entry.name,
    },
  ]);

const config: StorybookConfig = {
  framework: {
    name: '@storybook/react-vite',
    options: { strictMode: true },
  },

  stories: workspaceStories,

  addons: [
    '@storybook/addon-docs',
    // ADR 0032 — axe over every story, failing rather than advisory.
    '@storybook/addon-a11y',
    // ADR 0031 — stories double as browser-mode Vitest tests. The wiring lives in
    // vitest.config.ts via `@storybook/addon-vitest/vitest-plugin`.
    '@storybook/addon-vitest',
  ],

  // react-docgen-typescript cannot follow a props type across a workspace package boundary,
  // which is exactly what @nerey/theme does when it types against @nerey/core. react-docgen
  // can, so autodocs prop tables stay populated.
  typescript: { reactDocgen: 'react-docgen', check: false },

  docs: { defaultName: 'Docs' },

  viteFinal: async (viteConfig) => {
    const { mergeConfig } = await import('vite');
    return mergeConfig(viteConfig, {
      resolve: {
        // `@nerey/core` resolves to SOURCE, mirroring the `paths` mapping in tsconfig.json.
        //
        // Without this, the workspace symlink sends resolution through core's `exports` map to
        // `dist/index.js` — so the workbench renders whatever was last built, and a change to
        // core is invisible until someone rebuilds. Worse, it makes the story suite depend on a
        // build having happened: it passed locally only because `dist` was lying around, and
        // failed in CI, where the test job has no build step (ADR 0006).
        //
        // The alias is ordered before `preserveSymlinks` on purpose — it must win.
        alias: [
          { find: /^@nerey\/core\/mock$/, replacement: join(repoRoot, 'packages/core/src/mock/index.ts') },
          {
            find: /^@nerey\/core\/testing$/,
            replacement: join(repoRoot, 'packages/core/src/testing/index.ts'),
          },
          { find: /^@nerey\/core$/, replacement: join(repoRoot, 'packages/core/src/index.ts') },
        ],
        // npm workspaces symlink packages into node_modules; resolving through to the real
        // path is what keeps HMR and docgen pointed at source rather than at dist.
        preserveSymlinks: false,
      },
      server: { fs: { allow: [repoRoot] } },
    });
  },
};

export default config;
