---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0002. npm workspaces monorepo with three published packages

## Context and Problem Statement

Nerey ships three artefacts that are separate products for the consumer but one product for the
maintainer: `@nerey/core` (headless runtime, zero CSS), `@nerey/theme` (the reference look, CSS
Modules compiled to a static stylesheet), and `@nerey/eslint-config` (the shipped boundary rule that
keeps I/O out of widget modules). They are coupled by contracts rather than by code. The
`data-nerey-*` attribute surface that core emits is exactly what the theme's selectors target, so a
renamed part in core silently unstyles the theme. The lint rule in `@nerey/eslint-config` is written
against core's widgets directory convention. A root Storybook is the workbench where all three are
observed together, and it must import unpublished source, not a registry tarball.

Against that, the packages must version and release independently: a consumer takes the behaviour and
writes their own CSS, so a theme release must not force a core bump, and `@nerey/core` must have no
dependency — direct or transitive — on `@nerey/theme`.

The question is what repository and workspace topology gives one atomic change across the three
contracts while keeping the shipped dependency graph one-directional.

## Decision Drivers

* A change to the `data-*` contract, the theme selector that consumes it, and the story that proves it
  must land in one commit and one review, or the contract drifts between releases.
* `@nerey/core` may never depend on `@nerey/theme`, in any dependency field, at any depth — this is
  AC-1 and it must be verified mechanically rather than by convention.
* Independent semantic versions per package (ADR 0029), with the root itself unpublished.
* One install, one type-check graph, one lint pass, one test run, one coverage number (ADR 0007).
* Storybook must resolve workspace sources so the workbench reflects the working tree (ADR 0031).
* Setup cost for a contributor should be the Node version and nothing else (ADR 0004).

## Considered Options

* npm workspaces in a single repository, three publishable packages under `packages/*`
* pnpm workspaces, optionally with a Turborepo task graph
* One repository per package, integrated through published versions

## Decision Outcome

Chosen option: "npm workspaces in a single repository, three publishable packages under `packages/*`", because it is the only option that makes a cross-package contract change a single
reviewable diff without adding a package manager or a task runner to the bootstrap path, and the one
guarantee the alternatives would have bought us — a resolver that refuses phantom dependencies — is
one we need as an explicit gate anyway, since it must hold for consumers installing from the registry
with a package manager we do not control.

The topology is fixed as follows. The root `package.json` is `private: true` with
`workspaces: ["packages/*"]`; it owns the toolchain, the Storybook workbench, and the `check:*` gate
scripts, and is never published. Dependency direction is one-way and total:

* `@nerey/core` depends on `react@^19` as a peer and on nothing else. No `@nerey/theme`, no CSS file
  of any kind in the published tarball.
* `@nerey/theme` takes `@nerey/core` and `react` as peers, and `@base-ui/react` as its own dependency
  (ADR 0022).
* `@nerey/eslint-config` depends on neither sibling. It is consumed by repositories that never install
  Nerey's runtime at all.

The root `tsconfig.json` holds project references to `packages/core` and `packages/theme`, which
encodes build order for `npm run typecheck` (`tsc --build --force`). `@nerey/eslint-config` ships as
plain ESM — ESLint loads flat config at runtime rather than bundling it (ADR 0005) — so it carries no
project reference today.

### Consequences

* Good, because renaming a `data-nerey-part` value, updating the theme selector, and updating the
  contract snapshot are one commit; a reviewer sees the contract and its consumers side by side.
* Good, because the workbench imports workspace sources, so a story exercises the code being edited,
  which is the precondition for stories doubling as tests (ADR 0006).
* Good, because one lockfile and one `npm ci` mean CI cannot install a different tree than a
  contributor's.
* Bad, because npm hoists, so a module under `packages/core/src` can resolve a package it does not
  declare and the build will still pass locally. This is the single real cost of the choice and is
  covered by `npm run check:core-purity` and `npm run check:boundaries`, not by hope.
* Bad, because every change runs the whole test suite; there is no task-graph cache. At three packages
  the full run is cheaper than the cache-key machinery that would avoid it, and this stops being true
  only if the package count grows substantially.
* Neutral, because releases are per-package and manual against Conventional Commits (ADR 0036) rather
  than a single repo-wide version.

### Confirmation

* `npm run check:core-purity` — resolves `packages/core` as it would be published (`npm pack
  --dry-run --json` file list plus the installed dependency tree) and exits non-zero if the file list
  contains any `.css`, or if `@nerey/theme`, a markdown renderer, an HTTP client or a schema library
  appears at any depth. This is AC-1 executed rather than asserted.
* `npm run check:boundaries` (`depcruise packages`) — a `no-core-to-theme` rule forbidding any module
  under `packages/core/src` from importing `@nerey/theme`, `@base-ui/react`, or a `.css`/`.module.css`
  specifier, and a rule forbidding `@nerey/eslint-config` from importing either sibling.
* `npm run check:exports` — every workspace package's `exports` map resolves and matches the subpath
  policy (ADR 0028).
* `npm run check:gates` — proves the two gates above actually fail by running them against a planted
  violator, per ADR 0033.

## Pros and Cons of the Options

### npm workspaces in a single repository, three publishable packages under `packages/*`

* Good, because a cross-package contract change is one commit, one CI run, one review.
* Good, because npm is already present with the pinned Node (ADR 0004): `nvm use && npm ci` is the
  entire setup, with no package-manager bootstrap step.
* Good, because `npm publish --workspaces` and per-package `version` fields support independent
  releases without extra release tooling.
* Neutral, because workspace protocol support (`"@nerey/core": "*"`) is adequate for peer wiring here;
  Nerey has no internal package that must be replaced with a concrete range at publish time.
* Bad, because hoisting permits phantom dependencies, which must be caught by an explicit gate.
* Bad, because there is no built-in task graph or caching; `npm run build --workspaces` runs in
  declaration order rather than dependency order, so build order is carried by TypeScript project
  references instead.

### pnpm workspaces, optionally with a Turborepo task graph

* Good, because the strict, symlinked `node_modules` makes an undeclared import fail at resolution
  time — exactly the phantom-dependency class that npm allows.
* Good, because installs are faster and disk-efficient, and `overrides`/`patchedDependencies` are more
  expressive than npm's.
* Neutral, because Turborepo's caching is real but its payoff scales with package count and task
  duration; at three packages the cache-key configuration costs more attention than the runs it skips.
* Bad, because the strict-resolver guarantee does not travel to the artefact. A consumer installing
  `@nerey/core` with npm gets a hoisted tree, so AC-1 still needs a packaging gate — the resolver
  would duplicate a check we must write regardless, not replace it.
* Bad, because it adds a bootstrap dependency: either a globally installed pnpm at a matching version
  or Corepack, whose place in the Node distribution has been unstable across recent majors (ADR 0004).
* Bad, because Storybook, Vitest browser mode and Playwright all occasionally need loose hoisting
  workarounds under strict linking, which is configuration spent to regain a default.

### One repository per package, integrated through published versions

* Good, because the "core must not depend on theme" rule becomes structurally impossible to violate —
  there is no path from one tree to the other.
* Good, because each package's history, issues and release cadence are cleanly separated.
* Bad, because the `data-*` contract change becomes a three-repository, three-PR, publish-in-between
  choreography, and the window where core and theme disagree is a released window, not a local one.
* Bad, because the Storybook workbench would have to consume published tarballs or `npm link`, which
  reintroduces the coupling problem as a local-linking problem with worse failure modes.
* Bad, because the toolchain (tsconfig, ESLint, Vitest projects, coverage thresholds, gate scripts)
  gets copied three times and diverges.

## More Information

Package boundaries are load-bearing elsewhere in the corpus: the export map policy and the ban on deep
imports are in ADR 0028, the requirement that core carries no transport, LLM SDK binding or markdown
renderer is in ADR 0037, and the theme's build-time CSS Modules compilation is in ADR 0023. The
shipped lint boundary that `@nerey/eslint-config` exists to deliver is in ADR 0015.

Revisit if the package count passes roughly ten, or if a build starts taking long enough that
re-running unaffected packages is felt — at that point a task graph earns its configuration, and it
can be added over npm workspaces without changing the repository layout.
