---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0005. ESLint flat config with Prettier

## Context and Problem Statement

Nerey lints a heterogeneous tree from one root: two TypeScript library packages with different rules
(core may not import CSS or Base UI; the theme may), a published ESLint config package, CSF 3 stories,
gate scripts under `scripts/`, and Storybook configuration. Rules must differ per directory without
three copies of a config.

The decisive constraint is not internal, though. `@nerey/eslint-config` is a *published product*
(FR-18, ADR 0015): consumers install it and it must fail their build when a widget imports an HTTP
client (AC-8). A linter we adopt only for ourselves would be a taste question; a linter we ship a
config for determines what our consumers must run. Whatever authoring format we choose for our own
tree is the format that config is written in, and we should be running the same one we ask of them.

Formatting is the second question in the same area: whether ESLint should also be responsible for
whitespace, or whether Prettier owns that outright.

## Decision Drivers

* The published `@nerey/eslint-config` must be consumable by ordinary consumer repositories, which run
  ESLint.
* Type-aware rules are required by ADR 0003 — the `no-unsafe-*` family and `ban-ts-comment` need a
  TypeScript program, not just a parser.
* Per-directory rule scoping (core vs theme vs stories vs scripts) from a single root config.
* Formatting must never be a review topic, and must never surface as a lint error queue.
* An editor-time and hook-time pass must be fast enough to run on every file save (ADR 0034).

## Considered Options

* ESLint flat config plus Prettier as a separate tool, joined by `eslint-config-prettier`
* ESLint flat config with `eslint-plugin-prettier`, running Prettier as a lint rule
* Biome, replacing both the linter and the formatter

## Decision Outcome

Chosen option: "ESLint flat config plus Prettier as a separate tool, joined by `eslint-config-prettier`", because Nerey ships an ESLint config to consumers and cannot credibly ship
one it does not itself run, and because keeping Prettier out of the rule set keeps formatting off the
error channel entirely — a formatting difference should be repaired on save, not reported as a
violation.

The concrete shape:

* One `eslint.config.mjs` at the repository root. `npm run lint` is bare `eslint`, which discovers
  that file and lints the whole tree; CI adds `--max-warnings=0`, so a warning is a failure and the
  warn level is reserved for staged rollouts of a new rule rather than as a permanent tolerance.
* Flat config's array-of-blocks structure carries the per-directory rules directly: a block scoped to
  `packages/core/src/**` forbids `.css` imports and `@base-ui/react`; a block scoped to
  `**/*.stories.tsx` enables `eslint-plugin-storybook` and relaxes the rules that only make sense for
  library source; a block for `scripts/**` allows Node built-ins and `console`, which library code may
  not use (ADR 0013 forbids Nerey logging on a consumer's behalf).
* Type-aware linting is enabled with a project service, which is what makes ADR 0003's `any` ban
  enforceable at all.
* Prettier owns formatting completely, configured in `.prettierrc.json` (`singleQuote`, `semi`,
  `printWidth: 110`, `trailingComma: "all"`). `eslint-config-prettier` is the last entry in the flat
  config array, switching off every stylistic ESLint rule so the two tools cannot disagree.
* `eslint-plugin-prettier` is deliberately not installed. Running Prettier as a rule reports every
  whitespace difference as a lint error, mixes formatting noise into the same output as correctness
  findings, and slows the lint pass by formatting each file twice.
* `@nerey/eslint-config` is authored as a flat-config array export and published as plain ESM. It is
  applied to Nerey's own `packages/*/src/widgets/**` blocks, so the rule we ship is proven against our
  own built-in widgets (ADR 0035) before a consumer ever sees it.

### Consequences

* Good, because we run the artefact we publish: a regression in the shipped import-restriction rule
  fails Nerey's own lint pass, not just a consumer's.
* Good, because per-directory rules live in one file, so a reviewer can see the whole enforcement
  surface at once instead of reconstructing it from cascading configs.
* Good, because type-aware rules make ADR 0003's `any` ban and `ts-expect-error` policy enforceable
  rather than aspirational.
* Good, because formatting never appears in lint output, so `npm run lint` failing always means
  something is actually wrong.
* Bad, because type-aware linting requires the TypeScript program and is therefore substantially
  slower than a syntax-only pass; the mitigation is that edit-time enforcement (ADR 0034) lints the
  changed file rather than the tree.
* Bad, because there are two tools and two commands in CI (`lint` and `format:check`) instead of one.
* Neutral, because flat config is now the only supported format in current ESLint majors, so this is a
  choice about how we structure it rather than whether we adopt it.

### Confirmation

* `npm run lint` — ESLint over the whole tree, run in CI with `--max-warnings=0`. Required check.
* `npm run format:check` — `prettier --check .`, honouring `.prettierignore` (generated files:
  `*.module.css.d.ts`, `packages/theme/src/tokens.generated.ts`). Required check, separate from lint so
  the two failures are distinguishable.
* `npx eslint-config-prettier` against a representative source file — reports any enabled ESLint rule
  that conflicts with Prettier. Run in CI after a config or plugin-version change, which is the only
  time a conflict can appear.
* `npm run check:gates` — per ADR 0033, the lint gate is exercised against a planted violator: a
  fixture widget module importing an HTTP client must produce the documented error, and a fixture
  module under `packages/core/src` importing a `.css` file must fail. A gate nobody has seen fail is
  not a gate.
* The published config's own self-test lives with its package (ADR 0015) and covers AC-8 from the
  consumer's side.

## Pros and Cons of the Options

### ESLint flat config plus Prettier as a separate tool, joined by `eslint-config-prettier`

* Good, because it is the same system `@nerey/eslint-config` is published in, so dogfooding is
  automatic rather than an extra effort.
* Good, because the plugin ecosystem Nerey depends on — TypeScript type-aware rules, React Hooks
  including the compiler rules, Storybook, import restrictions — all exist here and nowhere else in
  complete form.
* Good, because the flat array makes per-directory scoping explicit and greppable.
* Neutral, because two tools mean two CI steps; both are fast enough to be unremarkable.
* Bad, because type-aware linting is slow on a cold run.

### ESLint flat config with `eslint-plugin-prettier`, running Prettier as a lint rule

* Good, because there is exactly one command and one editor integration to configure, and `--fix`
  repairs formatting along with everything else.
* Good, because formatting cannot be skipped by someone who runs lint but forgets `format:check`.
* Neutral, because the resulting formatting output is byte-identical to running Prettier directly.
* Bad, because every formatting difference becomes an ESLint error, so lint output stops being a
  signal about correctness and becomes a queue of whitespace.
* Bad, because it formats each file inside the lint pass, roughly doubling the cost of the slowest
  step in CI.
* Bad, because the maintainers of both tools recommend against it, and it makes editor squiggles
  appear mid-typing for code that is merely unformatted.

### Biome, replacing both the linter and the formatter

* Good, because it is one binary doing both jobs, an order of magnitude faster, with no plugin
  resolution and no config cascade.
* Good, because it would collapse `lint` and `format:check` into a single gate and make edit-time
  enforcement effectively free.
* Neutral, because its formatting output is close enough to Prettier's that the migration cost is a
  one-time reformat.
* Bad, because it cannot deliver the actual product requirement: `@nerey/eslint-config` must be
  installable in consumer repositories that run ESLint, and a Biome rule set is not consumable there.
  Choosing Biome internally would mean maintaining a rule set we never run.
* Bad, because ADR 0003's ban depends on type-aware rules driven by a full TypeScript program, which
  Biome's type inference does not yet provide at that fidelity.
* Bad, because there is no equivalent of the Storybook plugin or of the React Compiler lint rules,
  both of which apply directly to this codebase.

## More Information

The shipped boundary rule and its consumer-facing behaviour are specified in ADR 0015; the built-in
widgets it is first applied to are in ADR 0035. Edit-time enforcement — running the linter and
formatter on write rather than only in CI — is ADR 0034. The requirement that every gate proves itself
by rejecting a planted violator is ADR 0033. The compiler settings the type-aware rules complement are
in ADR 0003, and the story files that get their own lint block are in ADR 0031.

Revisit if Biome gains full type-aware analysis *and* consumer repositories can install a Nerey-shipped
Biome rule set as easily as an ESLint config; until both hold, speed does not compensate for shipping a
config in a system we do not use.
