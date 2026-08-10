---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0023. CSS Modules compiled to a static stylesheet at build time

## Context and Problem Statement

`@nerey/theme` is authored in CSS Modules, but CSS Modules are a *bundler* feature, not a
language feature. Next.js — the primary consumer stack — does not run its CSS Modules loader over
files inside `node_modules`; a `*.module.css` shipped raw in a published package either fails to
resolve or is treated as a global stylesheet, depending on the version and the import site. Vite
consumers would work, webpack consumers would need a custom rule, and Next consumers would need to
eject or patch the loader configuration. Requiring any of that is a per-consumer configuration tax
levied at install time for a package that is supposed to be the shortcut.

The question this record settles is what `@nerey/theme` actually puts on disk in `dist/`, and what
authoring rules the source must follow so that the compilation step is total — no authoring
construct may exist that only resolves inside the monorepo's own build.

## Decision Drivers

* AC-15: `import '@nerey/theme/theme.css'` in a Next.js 16 app must render styled widgets with zero
  CSS Modules configuration for `node_modules`.
* The consumer's bundler must see one plain, already-scoped stylesheet and nothing that needs
  interpretation.
* Class names must stay an implementation detail. If they are stable and readable, consumers will
  select on them, and the theme becomes unreplaceable — the failure ADR 0026 exists to prevent.
* Authoring ergonomics inside the monorepo: colocation with the component, type-safe class access
  under the strictness of ADR 0003.
* The theme must not drag a CSS framework into the consumer's build. `@nerey/theme` is a leaf.

## Considered Options

* Author CSS Modules, compile at build to one plain `theme.css` with hashed class names plus JS
  carrying the name map
* Ship the `*.module.css` sources unbuilt and let the consumer's bundler process them
* Abandon CSS Modules; hand-author one global stylesheet with stable BEM-style class names

## Decision Outcome

Chosen option: "Author CSS Modules, compile at build to one plain `theme.css` with hashed class
names plus JS carrying the name map", because it is the only option that keeps colocated,
type-checked, role-named authoring inside the repo while shipping an artifact whose interpretation
requires nothing from the consumer's build beyond the ability to load a `.css` file.

Concretely, `packages/theme` builds in library mode with CSS code-splitting disabled, so every
`*.module.css` collapses into a single `dist/theme.css`. Class names are hashed from
`filePath + localName` only — never from build order and never from the package version, so a
release that changes no CSS produces a byte-identical stylesheet and consumers get no spurious
cache invalidation. The emitted JS contains the hashed names inlined as string literals and carries
**no** `import './theme.css'`: the stylesheet is a separate export-map entry
(`@nerey/theme/theme.css`, ADR 0028) that the consumer imports explicitly, and the JS entries are
marked side-effect-free so a consumer who only wants the components' markup can tree-shake them
without dragging CSS in.

Authoring rules, binding on every file under `packages/theme/src`:

* One `*.module.css` colocated with the component it styles. No shared "utilities" module.
* camelCase class names, so the generated accessor is `styles.metaRow` with no bracket syntax.
* Role-based naming: `metaRow`, `pollOption`, `lockedBadge` — never `flexRowGray`, `mt8`,
  `blueButton`. A name that describes the current appearance instead of the element's role is a
  rename waiting to happen the first time the design changes.
* `.d.ts` files are **generated and committed** (`npm run gen:css-types`, happy-css-modules), not
  produced on the fly, so `tsc --build` and every editor agree without a plugin.
* No Tailwind at-rules of any kind inside a module — no `@tailwind`, `@apply`, `@theme`, `@config`,
  `@utility`, `@variant`, and no `theme()` function call. Any of them makes the file uncompilable
  outside a build that has Tailwind configured, which is exactly the dependency this decision
  removes.

### Consequences

* Good, because the consumer contract collapses to a single line — import one CSS file — and AC-15
  is satisfied on Next, Vite, Rspack and webpack identically.
* Good, because hashed names are unusable as a selector target by accident, which makes the
  `data-nerey-*` contract of ADR 0020 the only reasonable way for a consumer to reach the DOM.
* Good, because one stylesheet means one network request and no per-component CSS ordering
  problem; cascade order inside `theme.css` is fixed at build time and cannot be permuted by import
  order in the consumer.
* Bad, because CSS is no longer tree-shaken per component: a consumer using one widget ships the
  whole theme's rules. Accepted — the theme is small, gzip handles the repetition, and the
  alternative reintroduces the loader configuration this record exists to avoid.
* Bad, because the build step is now load-bearing for correctness, not just for packaging. A
  developer running Storybook against source and a consumer running against `dist/` can diverge,
  which is why the dist contract is tested rather than assumed.
* Neutral, because the hash makes the built CSS unreadable in devtools. Mitigated by
  `data-nerey-widget` / `data-nerey-part` being present on every node, which is what a developer
  reads to orient anyway.

### Confirmation

Three machine-checkable gates, each shipping a planted-violator fixture per ADR 0033:

1. `scripts/check-theme-css.mjs` (wired into `npm run check:all`) parses every
   `packages/theme/src/**/*.module.css` and fails on: any Tailwind at-rule or `theme()` call, any
   non-camelCase class selector, any `*.module.css` not colocated with a `.tsx` of the same stem,
   and any `.module.css.d.ts` that is missing from git.
2. `npm run gen:css-types` followed by `git diff --exit-code` in CI: a stale committed declaration
   file fails the build rather than silently type-checking against yesterday's class names.
3. `packages/theme/src/__tests__/dist-contract.test.ts` runs after `npm run build` and asserts
   against the real output: `dist/theme.css` exists; the packed tarball
   (`npm pack --dry-run --json`) contains no `*.module.css` and no `*.module.css.d.ts`; every class
   literal appearing in `dist/index.js` also appears in `dist/theme.css`; `dist/index.js` contains
   no `.css` import; and building twice from a clean tree yields an identical `theme.css` hash,
   which is the determinism claim above stated as an assertion.

AC-15 itself is covered by a CI job that builds `fixtures/next-consumer`, a stock Next.js 16 app
with no CSS configuration, importing `@nerey/theme/theme.css` from the packed tarball.

## Pros and Cons of the Options

### Author CSS Modules, compile at build to one plain `theme.css` with hashed class names plus JS carrying the name map

* Good, because the published artifact is inert CSS — the widest possible bundler compatibility.
* Good, because authoring keeps local scoping, so a class name collision between two components is
  impossible by construction and role-based names can stay short.
* Good, because generated `.d.ts` makes an undefined class a type error under ADR 0003 rather than
  a silently absent `undefined` in the `class` attribute.
* Neutral, because the theme owns a build step it must maintain; the monorepo already has one for
  every package under ADR 0002.
* Bad, because CSS granularity is lost — no per-component stylesheet, no CSS tree-shaking.
* Bad, because the source-versus-dist divergence risk is real and must be tested explicitly.

### Ship the `*.module.css` sources unbuilt and let the consumer's bundler process them

This is the reflexive choice, and it is what several component libraries with Vite-only audiences
do: publish `src/`, let the consumer compile, get per-component CSS granularity for free.

* Good, because CSS is tree-shaken per component and the consumer's build controls hashing.
* Good, because there is no build step to maintain and no source/dist divergence to test.
* Neutral, because it works flawlessly on Vite, which is what the theme is developed against.
* Bad, because it fails on the primary target: Next.js does not apply its CSS Modules loader inside
  `node_modules`, so the file resolves as a global stylesheet with unscoped literal class names, or
  not at all. Fixing it means a consumer-side webpack rule — configuration this package must not
  require.
* Bad, because class names then depend on the consumer's `generateScopedName`, which makes them
  non-deterministic across consumers and rules out asserting on them in the theme's own tests.
* Bad, because raw sources make every private class name public in practice; consumers read `src/`
  and select on it.

### Abandon CSS Modules; hand-author one global stylesheet with stable BEM-style class names

* Good, because it is the simplest thing that ships: one file, no build, no generated types, and it
  loads everywhere.
* Good, because devtools show meaningful class names.
* Neutral, because BEM naming discipline substitutes for the scoping the compiler would provide —
  workable, but enforced only by review.
* Bad, because stable public class names become the theme's de-facto API. Consumers will select on
  `.nerey-poll__option`, and every subsequent structural change is a breaking change under ADR
  0029. That is precisely the coupling ADR 0026 refuses at the prop layer, reintroduced at the
  selector layer.
* Bad, because there is no colocation and no type checking: a typo'd class name is silent.
* Bad, because a single global file with no scoping is one accidental bare-element selector away
  from violating ADR 0025.

## More Information

Implements FR-29 and satisfies AC-15. The token surface consumed by these modules, and the ban on
raw literals inside them, is ADR 0024; the ban on bare-element selectors in the output is ADR 0025;
the reason hashed names must never leak into the prop surface is ADR 0026. Subpath entries
`@nerey/theme` and `@nerey/theme/theme.css` are governed by ADR 0028. Edit-time enforcement of the
authoring rules is wired through ADR 0034 so a violation is reported at write time rather than at
CI.

Revisit if a consumer stack appears that can process package-internal CSS Modules natively and the
per-component granularity becomes worth the configuration, or if the theme's stylesheet grows past
the point where shipping unused rules is measurable.
