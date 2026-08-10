---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0028. Package exports map policy and the ban on deep imports

## Context and Problem Statement

Three packages ship from this monorepo (ADR 0002), and what a consumer is allowed to import from
each determines more than tidiness. The `'use client'` boundary lives inside the packages and must
not be dragged across the whole surface by a single barrel; the dev and mock layer must be reachable
without being paid for in a production bundle; the theme ships two CSS files that are entry points in
their own right; and every path a consumer can resolve becomes a constraint on internal file layout
that ADR 0029 makes expensive to change. Node and every modern bundler will enforce whatever the
`exports` field says — including nothing at all, if the field is absent.

## Decision Drivers

* A consumer importing from a React Server Component file must not be forced to add `'use client'`
  themselves (FR-3, AC-2), which means the client-marked graph must stay behind a narrow entry.
* `@nerey/core/mock` — dev registry, fixtures, widget-command injection, in-memory persistence — must
  be opt-in, not linked into every production build that imports the runtime.
* The theme's `tokens.css` must be loadable on its own, without the component stylesheet, because
  that is what makes the Storybook workbench a truthful reference (ADR 0024, ADR 0031).
* Internal file layout must stay refactorable; a resolvable path into `dist/` is a public API nobody
  agreed to.
* Compliance has to be machine-checked against the real published tarball, not against intent.

## Considered Options

* A closed `exports` map listing exactly the supported subpaths
* A single root barrel exporting the whole surface from the package root
* Wildcard subpath exports mapping onto `dist/`
* No `exports` field at all, using legacy `main` / `module` / `types`

## Decision Outcome

Chosen option: "A closed `exports` map listing exactly the supported subpaths", because it is the
only option under which a deep import fails at resolution rather than working quietly — and a deep
import that works is a dependency on our directory structure that we will discover the day we rename
a file.

The complete published surface:

* `@nerey/core` — registry, host contract, slot hosts, lifecycle runtime, primitives, built-in
  widgets (ADR 0035).
* `@nerey/core/mock` — the dev layer, separate so that a production bundle which never imports it
  never carries fixtures, and so the core-purity gate can assert the main entry does not reach into
  it.
* `@nerey/theme` — the themed components.
* `@nerey/theme/tokens.css` — the `--nerey-*` declarations and nothing else (ADR 0024).
* `@nerey/theme/theme.css` — the compiled component stylesheet with hashed class names (ADR 0023).
* `@nerey/eslint-config` — one root entry (ADR 0015).

Rules attached to the map:

* `types` is listed first in every conditional entry, since condition order is significant and a
  `types` condition placed after `import` is silently ignored by some resolvers.
* No `require` condition. The packages are ESM (FR-1); failing at resolution with a clear message
  beats shipping an untested CJS build that mostly works.
* No `"./*"` pattern key. The only key beyond those listed is `"./package.json"`, which tooling —
  `publint` included — expects to be resolvable.
* CSS entries are plain string targets with no condition branching, and are listed in `sideEffects`
  so no bundler tree-shakes an imported stylesheet away.
* `files` is `["dist"]`, so `src` is not in the tarball at all: a deep import into source fails for
  lack of a file as well as lack of an export.

Adding a subpath is a MINOR release; removing or narrowing one is MAJOR (ADR 0029).

### Consequences

* Good, because `import '@nerey/core/dist/index.js'` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` at
  resolution time. Internal reorganisation stays non-breaking because it was never reachable.
* Good, because the `'use client'` boundary stays where the packages put it; a consumer importing
  types or the registry does not pull the client-marked module graph into their server components.
* Good, because the mock layer is opt-in by path rather than by hoping tree-shaking works, which it
  frequently does not across a package boundary with side-effectful module initialisation.
* Good, because the two CSS entries are addressable independently, which is what lets Storybook load
  tokens alone and lets a consumer take tokens without the components.
* Neutral, because the map is short enough to read in one screen — and is reviewed by a gate anyway,
  since reading it is exactly the check people skip.
* Bad, because a consumer who needs something we did not export has no escape hatch and must open an
  issue. That is deliberate, and it is why the exported surface has to be generous where it counts
  (ADR 0021).
* Bad, because five entries mean five build outputs and five sets of declarations, and a build config
  can produce an entry whose types resolve in the repo but not from an installed tarball. That
  failure is invisible without a packing gate.

### Confirmation

* `npm run check:exports` → `scripts/check-exports.mjs` packs each workspace with `npm pack`, then
  runs `publint` and `@arethetypeswrong/cli` (`attw --pack`) against the resulting tarball. Any
  error-level finding — a missing declaration for a subpath, a mis-ordered condition, a file
  referenced but not shipped — fails the gate.
* The same script asserts the `exports` object equals the recorded allowlist in
  `docs/contracts/package-exports.json` key for key, and rejects any key containing `*`. Adding a
  subpath is then a deliberate two-file change, which is what makes the MINOR/MAJOR distinction of
  ADR 0029 auditable.
* `packages/core/src/__tests__/exports.resolution.test.ts` resolves each declared subpath and asserts
  that `@nerey/core/dist/index.js` and `@nerey/core/src/index.ts` both throw
  `ERR_PACKAGE_PATH_NOT_EXPORTED` — the ban is verified from the outside, the way a consumer
  experiences it.
* `@nerey/eslint-config` ships `no-restricted-imports` patterns for `@nerey/*/dist/**` and
  `@nerey/*/src/**`, so a consumer's own lint reports a deep import before their bundler resolves it
  (ADR 0015).
* `check:exports` runs in CI on every package build and is registered in the gate manifest that
  `npm run check:gates` self-tests by rejecting a planted violator (ADR 0033).

## Pros and Cons of the Options

### A closed `exports` map listing exactly the supported subpaths

* Good, because unlisted paths are unresolvable, so internal layout stays private by mechanism rather
  than by documentation.
* Good, because per-entry conditions let types, ESM runtime and raw CSS be described precisely
  instead of approximated by file extension.
* Good, because it is the only shape `publint` and `attw` can meaningfully validate; the gate exists
  because the mechanism exists.
* Neutral, because it requires maintaining an allowlist file alongside the manifests.
* Bad, because every legitimate new entry point is a small ceremony, and a consumer blocked on a
  missing export is blocked until a release.

### A single root barrel exporting the whole surface from the package root

* Good, because there is exactly one import specifier for a consumer to learn, and no decision about
  which subpath something lives under.
* Good, because refactoring internal files is invisible as long as the barrel re-exports them.
* Neutral, because bundlers can often tree-shake a pure barrel effectively.
* Bad, because a barrel that re-exports any client module drags the `'use client'` boundary across
  the whole surface, breaking AC-2 for every consumer importing anything at all.
* Bad, because the mock layer and its fixtures would sit in the same module graph as the runtime, so
  dev-only code ships to production whenever tree-shaking is imperfect — which it is across a package
  boundary with side effects.
* Bad, because it makes the whole surface one unit for versioning: any internal export becomes
  reachable, and therefore becomes API by accident.
* Bad, because CSS entry points cannot be expressed through a JavaScript barrel at all, so the theme
  would need a second mechanism regardless.

### Wildcard subpath exports mapping onto `dist/`

The `"./*": "./dist/*.js"` escape hatch, which many libraries add to stop deep-import complaints.

* Good, because no consumer is ever blocked on a missing export, and no release is needed to unblock
  them.
* Good, because it needs no maintenance as the file tree grows.
* Neutral, because it still hides `src`, so at least the authored layout is private.
* Bad, because it publishes the entire compiled tree as API: every file becomes a path someone may
  depend on, and renaming any of them is then a breaking change under ADR 0029.
* Bad, because `attw` and `publint` can verify almost nothing about a wildcard — the gate loses most
  of its power precisely where the risk is highest.
* Bad, because it re-opens the `'use client'` problem: a consumer can reach a client module directly
  and pull the directive into a graph that was supposed to stay on the server.

### No `exports` field at all, using legacy `main` / `module` / `types`

* Good, because it is maximally compatible with old tooling and needs no thought.
* Good, because nothing about it can be mis-specified, since it specifies almost nothing.
* Neutral, because the primary entry still works for the common case.
* Bad, because the entire package directory is resolvable, so `dist/`, `src/` if shipped, and every
  internal module are public by default — the worst version of the wildcard problem.
* Bad, because condition-based type resolution is unavailable, so `attw` findings cannot be fixed
  properly and consumers on `moduleResolution: bundler` or `node16` get inconsistent results.
* Bad, because CSS subpaths would be resolved by accident of file location rather than by declaration,
  making the theme's entry points untestable as a contract.

## More Information

Implements FR-2 and supports AC-1 and AC-2. The subpath split is what makes the packaging assertions
of ADR 0002 checkable and what keeps the surface described in ADR 0037 — no transport, no LLM SDK
binding, no markdown renderer — small enough to review.

The theme's two CSS entries are the file-level expression of ADR 0023 and ADR 0024; separating them
is what makes ADR 0025 verifiable, since a stylesheet that silently depended on tokens being loaded
could not be tested without them.

Consumers never need a deep import for styling, because the styling contract is the attribute surface
of ADR 0020 rather than a set of files. Where they need an escape hatch it is the `className` and
`render` props of ADR 0021, both reachable from the single `@nerey/core` entry.
