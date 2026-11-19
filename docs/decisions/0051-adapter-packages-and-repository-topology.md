---
status: "proposed"
date: 2026-11-19
decision-makers: Yurii Anichkin
---

# 0051. Adapter packages join the monorepo as peers of core, and examples stay unpublished

## Context and Problem Statement

ADR 0002 fixed the repository as one npm-workspaces monorepo with three published packages,
`@nerey/core`, `@nerey/theme` and `@nerey/eslint-config`, and a one-way dependency graph in which core
depends on nothing of ours. That topology is right and is carried here.

What changes is the number of packages. ADR 0037 kept transports, LLM SDK bindings and agent protocols
out of core as "adapter points", and said in as many words that some of them would eventually ship as
separate packages without reopening that record. The production-ready plan now needs two of them:
`@nerey/ai-sdk` (Vercel AI SDK) and `@nerey/ag-ui` (the AG-UI protocol). A third,
`@nerey/fallback-markdown`, is likely. A runnable consumer application (a Next.js app with React
Server Components) is also needed, to prove the packages work outside the workbench.

ADR 0002 says "three publishable packages", lists them, and its gates are written for exactly those
three. Adding a fourth without a record would make the record false the day it lands. The question is
where adapters live, what they may depend on, and how the existing purity guarantees extend to them.

## Decision Drivers

- `@nerey/core`'s `dependencies` stay `{ "@standard-schema/spec" }`, and it imports nothing of an
  adapter's (ADR 0002, 0011, 0037).
- A contract change in core and its effect on every adapter must be one diff and one review, which was
  ADR 0002's main reason for a monorepo.
- A consumer installs only the SDK they use, at the version they already have.
- No published package collects analytics or telemetry, and that must be a machine check rather than a
  fact nobody verifies.
- Example applications must be built in CI without ever being published.

## Considered Options

- Adapters as separate workspace packages with their SDK as a peer, examples as private workspaces
- Adapters as subpath exports of core (`@nerey/core/ai-sdk`)
- Adapters in a separate repository

## Decision Outcome

Chosen option: "Adapters as separate workspace packages with their SDK as a peer, examples as private
workspaces", because it is the only option that keeps core's dependency list and purity gate untouched
while keeping a core contract change and its adapters in one review.

**Carried from ADR 0002, unchanged.** One repository, npm workspaces. The root `package.json` is
`private: true`, owns the toolchain, the Storybook workbench and the `check:*` gates, and is never
published. Packages version and release independently (ADR 0038, 0039). One lockfile, one install,
one type-check graph, one lint pass, one test run, one coverage number (ADR 0007).

**The dependency rules, now for every package.**

- `@nerey/core` takes `react` as a peer and depends only on `@standard-schema/spec`. It imports no
  sibling package: not the theme, not an adapter.
- `@nerey/theme` takes `@nerey/core` and `react` as peers and depends on `@base-ui/react` and `zod`
  (ADR 0022, 0011).
- `@nerey/eslint-config` depends on no sibling.
- **An adapter** (`@nerey/ai-sdk`, `@nerey/ag-ui`, and any later one) takes `@nerey/core`, `react` and
  its SDK as **peers**, and its `dependencies` are empty. It imports core only through core's public
  entry points (ADR 0028). It imports nothing from `@nerey/theme` and ships no CSS. Core never imports
  an adapter.
- **No published package** depends on an analytics or telemetry library.

**Examples.** Runnable applications live under `examples/*`, are workspaces with `private: true`, and
are never published. CI builds them. They may depend on anything a real consumer would, including the
theme and a framework.

The `workspaces` globs become `["packages/*", "examples/*"]`. The commit scope vocabulary is derived
from them (ADR 0050), so a new package or example extends it with no gate edit.

### Consequences

- Good, because core's purity is untouched: an SDK cannot enter core's install through an adapter.
- Good, because a consumer on AI SDK version N uses their own copy; the adapter does not pin it.
- Good, because a change to `WidgetHostValue` and the adapters that implement it is still one diff.
- Good, because the telemetry ban becomes a gate rather than a property nobody checks.
- Bad, because every adapter is a package to version, release, snapshot and document.
- Bad, because peer dependency ranges must be maintained by hand against SDKs that move quickly, and a
  wrong range shows up as an install warning in someone else's project.
- Neutral, because ADR 0002's argument against a task-graph cache weakens as the package count grows.
  At five or six packages a full run is still cheaper than the cache.

### Confirmation

- `npm run check:package-purity` generalises `check:core-purity` (which it replaces) into a manifest
  of every published package: its allowed `dependencies` and `peerDependencies`, a shared banned set
  (transports, validators in core, markdown renderers, query libraries), core's own additions
  (`@ag-ui/*`, any LLM SDK) and, for every package, analytics and telemetry (`@segment/*`, `posthog-*`,
  `@scarf/scarf`, `mixpanel*`, `@sentry/*`). An adapter with a non-empty `dependencies` fails. It
  keeps core-purity's checks of the source and the built `dist` for CSS.
- `npm run check:boundaries` (`depcruise`) adds rules: no module in core imports an adapter, no adapter
  imports the theme, and adapters import core only through its public entry points.
- `npm run check:exports` and `check:public-api` cover each new package from its first commit.
- `npm run check:gates` plants a violator for each new rule: an adapter with a dependency, an adapter
  importing the theme, core importing an adapter, and a telemetry package in a manifest (ADR 0033).

## Pros and Cons of the Options

### Adapters as separate workspace packages with their SDK as a peer, examples as private workspaces

- Good, because each adapter's SDK stays out of everything else's install.
- Good, because the existing gates extend rather than bend.
- Bad, because the release and snapshot work scales with the package count.

### Adapters as subpath exports of core (`@nerey/core/ai-sdk`)

- Good, because there is one package to install and release.
- Bad, because the SDK becomes a peer of core, and every core consumer sees a peer warning for an SDK
  they do not use.
- Bad, because `check:core-purity` would have to allow SDK imports under some directories of core,
  which is the first exception to the rule this repository relies on most.

### Adapters in a separate repository

- Good, because core's repository stays small and the adapters release on their own cadence.
- Bad, because a contract change in core becomes two pull requests in two repositories, which is the
  exact cost ADR 0002 chose a monorepo to avoid.
- Bad, because the adapters would test against published core, so a break is found after a release
  rather than before one.

## More Information

Supersedes ADR 0002. ADR 0037 anticipated this ("some of these will eventually ship as separate
packages") and is not reopened. Related: ADR 0022 (the theme's Base UI dependency), ADR 0028 (exports
policy and the ban on deep imports), ADR 0038 and 0039 (per-package versioning and releases), ADR 0048
(the reply channel adapters implement) and ADR 0052 (the server entry the example needs). The owner's
decision O-5 targets the current majors of the AI SDK and AG-UI; a CopilotKit v2 recipe is deferred
until v2 is stable.
