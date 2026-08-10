---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0004. Node 24 runtime and npm as package manager

## Context and Problem Statement

Nerey publishes ESM libraries targeting a bundler, so Node is not part of the shipped runtime
contract — it is the development and CI toolchain. What Node version and package manager we require
therefore binds contributors, the gate scripts under `scripts/`, the Storybook workbench and the
Playwright-backed browser test project, and nothing else. That makes the choice cheap to get right and
expensive to leave vague: a floating Node range means the deterministic gates (ADR 0033) run on
runtimes the maintainer never exercised, and browser-mode Vitest with a Playwright provider (ADR 0006)
is the part of the stack most sensitive to that.

The package manager question is separate but decided together, because the two choices trade against
each other: the value of a stricter resolver depends on how much bootstrap cost it adds, and the
bootstrap path is a property of the Node distribution.

## Decision Drivers

* One runtime version, pinned and enforced, so a failing gate is a real failure rather than a version
  difference.
* Bootstrap must be a single step; a contributor should be able to go from clone to green with the
  Node version and nothing else installed.
* CI and local machines must resolve an identical dependency tree.
* Publishing three packages with independent versions and build provenance must be supported by the
  tool without extra release infrastructure (ADR 0002, ADR 0029).
* The toolchain floor must satisfy Vite 7, Vitest with browser mode, Storybook 10 and Playwright,
  which have all moved their supported-Node windows forward.

## Considered Options

* Node 24 with the bundled npm, pinned by `.nvmrc`, `engines` and `engine-strict`
* Node 24 with pnpm, bootstrapped through Corepack and the `packageManager` field
* A permissive Node range (`>=20`) with npm

## Decision Outcome

Chosen option: "Node 24 with the bundled npm, pinned by `.nvmrc`, `engines` and `engine-strict`", because npm is the one package manager that requires no bootstrap step — it is already installed by
the act of installing the pinned Node — and at three workspace packages the install performance and
resolver strictness that a different manager would buy do not outweigh adding a second thing that must
be present and at the right version before `install` can run.

The pin is expressed three times, deliberately, because each location is read by a different actor:

* `.nvmrc` contains `24` — read by `nvm use` locally and by `actions/setup-node` through
  `node-version-file`, so CI and a developer machine cannot select different majors.
* Root `package.json` declares `engines: { node: ">=24" }` — read by npm and by consumers' tooling.
* `.npmrc` sets `engine-strict=true` — this is what converts `engines` from documentation into an
  install-time failure. Without it, a wrong Node produces a warning and a green build that lies.

Node 24 is the current Active LTS line, which fixes the revisit trigger: re-evaluate when Node 26
enters LTS in October 2026, not on every release. Dependency installation in CI is `npm ci` against a
committed `package-lock.json`; `npm install` is never run in CI. Publishing is `npm publish
--workspaces --provenance`, which needs no additional release tooling beyond the version fields
maintained per ADR 0029.

The known cost is that npm hoists and therefore permits a package to import something it does not
declare. That is accepted here and paid for in ADR 0002 with `npm run check:core-purity` and
`npm run check:boundaries`, which have to exist regardless: a consumer installing `@nerey/core` from
the registry uses their own package manager, so the "core has no path to the theme" guarantee (AC-1)
can never be delegated to our resolver.

### Consequences

* Good, because setup is `nvm use && npm ci`, with no package-manager shim, no global install, and no
  version-mismatch class of first-run failure.
* Good, because a contributor on the wrong Node fails at `npm ci` with a clear message rather than
  three steps later inside a Playwright launch or a Vite transform.
* Good, because `npm publish --workspaces --provenance` covers the three-package release with npm's
  own attestation support, keeping the release path in the same tool as the install path.
* Bad, because hoisting allows phantom dependencies; mitigated by explicit gates, not by the resolver.
* Bad, because installs are slower and consume more disk than a content-addressed store would, and
  `overrides` is less expressive than pnpm's patching. Neither is currently on the critical path.
* Neutral, because pinning a single major means a Node upgrade is an explicit, reviewed change to
  three files plus a CI run, rather than something that happens to a contributor silently.

### Confirmation

* `npm ci` under `engine-strict=true` is itself the primary gate: on any Node below 24 the install
  exits non-zero. This runs on every machine and in CI, before anything else can pass.
* CI resolves Node from `node-version-file: .nvmrc` and runs a single-version matrix. No job may
  hardcode a Node version, so the pin cannot drift between workflow files.
* `scripts/toolchain.test.ts` — a unit-project test (ADR 0006) asserting that the major in `.nvmrc`,
  the lower bound of root `engines.node`, and the `engines.node` field of every workspace package all
  agree, and that `.npmrc` sets `engine-strict=true`. This is the piece that would otherwise rot: the
  three declarations are trivially editable one at a time.
* `package-lock.json` is committed and CI uses `npm ci`, so a resolution that differs from the lockfile
  fails rather than silently updating it.

## Pros and Cons of the Options

### Node 24 with the bundled npm, pinned by `.nvmrc`, `engines` and `engine-strict`

* Good, because there is no bootstrap: the package manager arrives with the runtime that is already
  pinned.
* Good, because `engine-strict` turns the version floor into an enforced precondition instead of a
  warning.
* Good, because workspaces, `npm ci`, `npm publish --workspaces` and provenance cover every operation
  this repository needs.
* Neutral, because npm's workspace features are less rich than the alternatives', but Nerey uses only
  the subset that is well supported.
* Bad, because hoisting permits undeclared imports to resolve.
* Bad, because install time and disk usage are the worst of the three options.

### Node 24 with pnpm, bootstrapped through Corepack and the `packageManager` field

* Good, because strict linking makes an undeclared import fail immediately, catching phantom
  dependencies at the moment they are written.
* Good, because installs are markedly faster and the store is shared across projects.
* Neutral, because the `packageManager` field does pin the manager version precisely when Corepack is
  available and enabled.
* Bad, because Corepack's place in the Node distribution has been unstable across recent majors —
  deprecated, and repeatedly proposed for unbundling — so "it ships with Node" is not a promise the
  bootstrap can rely on; the fallback is a global install at a matching version, which is the extra
  setup step this decision exists to avoid.
* Bad, because the strictness does not reach the published artefact, so the packaging gate that proves
  AC-1 must be written anyway — the resolver would duplicate it locally, not replace it.
* Bad, because Storybook, Vitest browser mode and Playwright periodically require hoisting escape
  hatches under strict linking, spending configuration to restore a default.

### A permissive Node range (`>=20`) with npm

* Good, because contributors run whatever they already have and nobody is blocked at clone time.
* Good, because it maximises the chance that an incidental contributor can reproduce a bug.
* Neutral, because the library's own output is unaffected either way; the range only ever describes the
  build environment.
* Bad, because the deterministic gates lose their meaning: a gate that passes on the maintainer's Node
  and fails on a contributor's produces a debate about the environment instead of about the code.
* Bad, because Vite 7, Vitest browser mode, Storybook 10 and Playwright have moved their supported
  ranges forward, so a nominal `>=20` claim would be untested and, in places, untrue.
* Bad, because it makes the toolchain floor unfalsifiable — there is no version at which we would
  notice we had broken it.

## More Information

The phantom-dependency exposure this decision accepts is discharged in ADR 0002, whose
`check:core-purity` and `check:boundaries` gates are the mechanical form of AC-1. Release mechanics and
version semantics for the three packages are in ADR 0029; commit conventions that feed release notes
are in ADR 0036. The browser test project that is most sensitive to the Node pin is in ADR 0006, and
the rule that every gate must prove itself against a planted violator is in ADR 0033.

Revisit in October 2026 when Node 26 enters LTS. Revisit the package-manager half sooner if install
time becomes a measurable part of CI duration or if the workspace count grows past the point where
hoisting-related surprises are being caught by gates rather than avoided by construction.
