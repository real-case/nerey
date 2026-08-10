/**
 * @nerey/eslint-config — the widget boundary, shipped as a lint rule.
 *
 * ADR 0015. The rule that widgets perform no I/O is the single most load-bearing invariant
 * in Nerey, and it is the one that does NOT survive extraction: an origin repo enforces it in
 * its own `eslint.config.mjs`, and the moment the code moves to a new project the rule stays
 * behind and the invariant becomes folklore. So it ships in the box.
 *
 * Usage — flat config:
 *
 *   import nerey from '@nerey/eslint-config';
 *
 *   export default [
 *     ...nerey.configs.recommended,
 *     // or, to point the widget rules at your own directory layout:
 *     ...nerey.widgets({ files: ['src/chat/widgets/**\/*.{ts,tsx}'] }),
 *   ];
 *
 * The config deliberately contains no stylistic rules and no parser configuration. It has one
 * job — the architectural boundaries — and a config that also has opinions about semicolons
 * is a config people delete.
 */

const IO_PATTERNS = [
  {
    group: ['axios', 'axios/*', 'ofetch', 'ky', 'superagent', 'got'],
    message:
      'A widget performs no I/O. Its only outbound channel is onInteraction(action, { text }), ' +
      'and its only persistence channel is useWidgetState (ADR 0014 / 0015 / 0016). Hand the ' +
      'message to the host and let the host own the request.',
  },
  {
    group: ['@tanstack/react-query', '@tanstack/query-core', 'swr'],
    message:
      'A widget does not talk to the server cache. Persistence flows through the ' +
      'MessagePersistence port the host injects (ADR 0016), which is what lets the same widget ' +
      'run in Storybook against an in-memory implementation.',
  },
  {
    group: ['**/api/*', '**/api', '**/services/*'],
    message:
      'A widget must not reach into an application API layer — that coupling is exactly what ' +
      'makes a widget unportable between hosts (ADR 0015).',
  },
];

const CORE_PATTERNS = [
  {
    group: ['*.css', '**/*.css', '@nerey/theme', '@nerey/theme/*'],
    message:
      '@nerey/core ships zero CSS and never depends on the theme. Styling is driven from the ' +
      'data-* contract (ADR 0020); the dependency arrow points theme → core and never back ' +
      '(ADR 0002).',
  },
  {
    group: ['zod', 'zod/*', 'valibot', 'arktype', 'yup', 'joi'],
    message:
      'Core validates through Standard Schema v1, not through a specific validator — that is ' +
      'what lets a consumer bring their own (ADR 0011). Type against StandardSchemaV1.',
  },
  {
    group: ['react-markdown', 'remark-*', 'rehype-*', 'marked', 'markdown-it'],
    message:
      'Core ships no markdown renderer. The fallback renderer is injected through the host ' +
      'value (ADR 0012), so a consumer pays for a markdown pipeline only if they want one.',
  },
  {
    group: ['@base-ui/react', '@base-ui/react/*', '@radix-ui/*', 'react-aria*'],
    message:
      'Behavioural primitives belong to @nerey/theme, wrapped and never re-exported (ADR 0022). ' +
      'Core stays headless so a consumer can build their own presentation layer on it.',
  },
];

/** Rules for the files that implement widgets. */
function widgets(options = {}) {
  const files = options.files ?? ['**/widgets/**/*.{ts,tsx}'];
  return [
    {
      name: 'nerey/widgets-perform-no-io',
      files,
      rules: {
        'no-restricted-imports': ['error', { patterns: IO_PATTERNS }],
        'no-restricted-globals': [
          'error',
          {
            name: 'fetch',
            message:
              'A widget performs no I/O (ADR 0015). Use onInteraction to hand a message to the ' +
              'host, or useWidgetState to persist.',
          },
          {
            name: 'XMLHttpRequest',
            message: 'A widget performs no I/O (ADR 0015).',
          },
          {
            name: 'WebSocket',
            message:
              'Transport belongs to the host, not to a widget (ADR 0015 / 0037). Nerey has no ' +
              'opinion about how messages reach you.',
          },
        ],
      },
    },
  ];
}

/**
 * Rules for the files that make up a headless core package.
 *
 * Tests, stories and fixtures are excluded by default. The headless claim is about what SHIPS,
 * and a core test that imports Zod to exercise Standard Schema is not a violation of it — it is
 * the only honest way to prove the abstraction works against a real validator. Linting them
 * here would push people toward `eslint-disable` comments, which is strictly worse: the
 * exemption stops being visible in one place and starts being scattered through the code.
 */
function core(options = {}) {
  const files = options.files ?? ['**/packages/core/src/**/*.{ts,tsx}'];
  const ignores = options.ignores ?? [
    '**/*.test.{ts,tsx}',
    '**/*.spec.{ts,tsx}',
    '**/*.stories.tsx',
    '**/__tests__/**',
    '**/__fixtures__/**',
  ];
  return [
    {
      name: 'nerey/core-stays-headless',
      files,
      ignores,
      rules: {
        'no-restricted-imports': ['error', { patterns: CORE_PATTERNS }],
      },
    },
  ];
}

/** Rules for a themed presentation layer built on the core. */
function theme(options = {}) {
  const files = options.files ?? ['**/packages/theme/src/**/*.{ts,tsx}'];
  return [
    {
      name: 'nerey/theme-does-not-reexport-base-ui',
      files,
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@radix-ui/*', 'react-aria*', '@ark-ui/*'],
                message:
                  'The theme has exactly one behavioural dependency — Base UI (ADR 0022). A second ' +
                  'means two focus traps, two portals and two Escape implementations, which users ' +
                  'notice long before they notice bundle size.',
              },
            ],
          },
        ],
      },
    },
  ];
}

const recommended = [...core(), ...theme(), ...widgets()];

export default { configs: { recommended }, widgets, core, theme };
export { recommended, widgets, core, theme };
