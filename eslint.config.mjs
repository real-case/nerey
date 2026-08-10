import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import storybook from 'eslint-plugin-storybook';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// ADR 0005. Nerey lints itself with the same boundary rules it publishes — dogfooding the
// config is the only way to know it still works.
import nerey from './packages/eslint-config/index.js';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'storybook-static/**',
      'coverage/**',
      '**/*.module.css.d.ts',
      'packages/theme/src/tokens.generated.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.es2023 },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },

  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // ADR 0003 — `any` defeats the point of a typed contract. `unknown` plus narrowing is
      // the replacement, and the registry's deliberate generic erasure goes through the
      // documented `asAnyWidget` helper rather than through a cast at each call site.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // A library that logs shows up in someone else's error budget (ADR 0013).
      'no-console': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },

  // The published boundary rules, applied to this repo (ADR 0015 / 0022).
  ...nerey.configs.recommended,

  // ADR 0031 — CSF 3 only. CSF 2 and storiesOf fail here rather than in review.
  ...storybook.configs['flat/recommended'],

  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/__fixtures__/**', '**/testing/**'],
    rules: {
      // Test fixtures deliberately construct malformed values to exercise the degradation
      // chain; forcing them through the type system would only prove the type system works.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },

  {
    files: ['**/*.stories.tsx'],
    rules: {
      // A story's whole job is to demonstrate a component; the interaction handlers it passes
      // are illustrations, not production code paths.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      'no-console': 'off',
    },
  },

  {
    files: ['*.config.ts', '.storybook/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Plain JS/ESM tooling — gate scripts, hooks, the published eslint config, this file. They
  // are not part of any tsconfig `include`, so type-aware rules cannot run on them and would
  // otherwise fail with "not found by the project service" rather than with a real finding.
  {
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  prettier,
);
