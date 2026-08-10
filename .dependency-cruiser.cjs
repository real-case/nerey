// .dependency-cruiser.cjs
//
// ADR 0028 / 0002 / 0015 / 0033 — the module-boundary gate, run as `npm run check:boundaries`
// (`depcruise packages`).
//
// It is `.cjs` because the root package.json is `"type": "module"`, and dependency-cruiser
// loads a `.js` config as ESM in that case while this file uses `module.exports`.
//
// The rules here express the boundaries that no type can: which package may reach which, how
// deep a reach is allowed to go, and what a published entry point is allowed to carry into a
// consumer's install. Every one of them is fixture-covered by `npm run check:gates`.

/**
 * Modules that perform network I/O, in the two shapes dependency-cruiser reports them:
 * `node_modules/<name>/…` once installed, and the bare specifier when it is not installed
 * (an unresolvable import must still trip the rule, or the gate would only work after
 * somebody had already added the dependency).
 */
const IO_MODULES =
  'axios|ofetch|ky|got|superagent|node-fetch|@tanstack/(?:react-)?query|swr|@apollo/client|urql';

const ioPaths = [`(?:^|/)node_modules/(?:${IO_MODULES})(?:/|$)`, `^(?:${IO_MODULES})(?:/|$)`];

/** Test and story modules are development artifacts; several rules must not judge them. */
const NON_SHIPPING = [
  '\\.(?:test|spec)\\.(?:ts|tsx|js|jsx|mts|cts)$',
  '\\.stories\\.(?:ts|tsx|js|jsx)$',
  '(?:^|/)__fixtures__/',
  '(?:^|/)__(?:tests|mocks)__/',
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependency. Module initialisation order becomes undefined, which in React shows up ' +
        'as an undefined component at render time rather than as a build error. Break the cycle by ' +
        'moving the shared piece down into a module both sides import.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'Orphan module — nothing imports it and it is not an entry point. Either wire it up or delete ' +
        'it. Declaration files, stories, tests, barrels and generated token modules are exempt because ' +
        'each is legitimately unreferenced from inside the graph.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$', // dot files
          '[.]d[.]ts$',
          '(^|/)index[.](?:ts|tsx|js|jsx|mjs|cjs)$', // barrels: an entry point by definition
          '(^|/)tokens[.]generated[.]ts$', // written by gen-tokens.mjs, read by tooling
          '(^|/)(?:vite|vitest|babel|webpack)[.]config[.](?:ts|js|cjs|mjs)$',
          ...NON_SHIPPING,
        ],
      },
      to: {},
    },
    {
      name: 'core-not-depend-on-theme',
      severity: 'error',
      comment:
        'ADR 0002 — the dependency arrow points theme → core and never back. @nerey/core is the ' +
        'headless package; reaching the theme from it would drag CSS into every consumer that only ' +
        'wanted the runtime, and would make the theme unreplaceable. Style through the data-nerey-* ' +
        'contract (ADR 0020) instead.',
      from: { path: '^packages/core/' },
      to: {
        path: ['^packages/theme/', '(?:^|/)node_modules/@nerey/theme(?:/|$)', '^@nerey/theme(?:/|$)'],
      },
    },
    {
      name: 'no-cross-package-deep-import',
      severity: 'error',
      comment:
        "ADR 0028 — relative reach into another package's src. This resolves during development and " +
        'fails for a published consumer, because `files` is ["dist"] and the exports map has no such ' +
        'subpath. Import the package by name (`@nerey/core`) so the boundary is the one that ships.',
      from: { path: '^packages/([^/]+)/' },
      to: {
        path: '^packages/[^/]+/src/',
        pathNot: '^packages/$1/',
        // Only RELATIVE reaches. `import { x } from '@nerey/core'` resolves — through the tsconfig
        // `paths` alias — to the very same `packages/core/src/index.ts`, and carries `local` too,
        // so the relative form is distinguished by the absence of `aliased` rather than by the
        // presence of `local`. Every alias flavour dependency-cruiser knows (tsconfig paths,
        // tsconfig baseUrl, npm workspace, webpack, subpath import) carries the umbrella
        // `aliased` type, so this one exclusion covers the by-name import however it resolves.
        dependencyTypes: ['local'],
        dependencyTypesNot: ['aliased'],
      },
    },
    {
      name: 'theme-widgets-no-io',
      severity: 'error',
      comment:
        'ADR 0015 — a widget performs no I/O. Its only outbound channel is onInteraction(action, ' +
        '{ text }) and its only persistence channel is useWidgetState (ADR 0014 / 0016). A widget ' +
        'that fetches cannot be rendered from a transcript, cannot be tested without a network, and ' +
        'moves request policy out of the host that owns it.',
      from: { path: '^packages/theme/src/widgets/' },
      to: { path: ioPaths },
    },
    {
      name: 'no-dev-dep-in-published-src',
      severity: 'error',
      comment:
        'ADR 0028 — published source importing a devDependency. It resolves here because the root ' +
        'workspace installed it, and it fails in a consumer install, where the package is absent. ' +
        'Promote it to `dependencies` (or `peerDependencies`) in that package.json, or move the code ' +
        'into a test, story or __fixtures__ module.',
      from: { path: '^packages/[^/]+/src/', pathNot: NON_SHIPPING },
      to: {
        dependencyTypes: ['npm-dev'],
        // A package declared both dev (root) and peer/prod (the workspace) is correctly declared;
        // dependency-cruiser reports both types. And a type-only import is erased by the compiler,
        // so it cannot fail at a consumer's runtime.
        dependencyTypesNot: ['npm', 'npm-peer', 'npm-optional', 'type-only'],
        pathNot: ['(?:^|/)node_modules/@types/'],
      },
    },
  ],

  options: {
    // node_modules is `doNotFollow`, NOT `exclude`. `exclude` deletes those modules from the
    // graph, which would silently disarm `theme-widgets-no-io` and `no-dev-dep-in-published-src`
    // — both of which match on a `to` that lives in node_modules. `doNotFollow` keeps them as
    // leaf nodes, so the edges are still there to judge, and nothing inside them is parsed.
    doNotFollow: { path: ['node_modules'] },
    exclude: {
      path: ['(?:^|/)dist/', '\\.stories\\.(?:ts|tsx|js|jsx)$', '\\.test\\.(?:ts|tsx)$'],
    },

    // Type-only imports are followed, so a boundary cannot be crossed by writing `import type`.
    tsPreCompilationDeps: true,

    // Climb to the root package.json when classifying a dependency. Without this, dependency-cruiser
    // only reads `packages/<name>/package.json`, so a root-only devDependency imported from a
    // published `src/` is reported as `npm-no-pkg` rather than `npm-dev` and slips past
    // `no-dev-dep-in-published-src` — which is the exact case that rule exists to catch in a
    // workspaces monorepo (ADR 0002 / 0028).
    combinedDependencies: true,

    // Resolution must match the compiler's, or `@nerey/core` looks unresolvable during development
    // and every by-name import turns into a false positive.
    tsConfig: { fileName: 'tsconfig.json' },

    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },

    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
