---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0031. Storybook 10 as the component workbench, CSF 3 with play functions

## Context and Problem Statement

Nothing in this repository mounts a widget. `@nerey/core` ships headless primitives whose public styling surface is a set of `data-nerey-*` attributes (ADR 0020) plus `className` and a polymorphic `render` prop (ADR 0021); `@nerey/theme` ships a compiled stylesheet (ADR 0023) driven by `--nerey-*` custom properties (ADR 0024). There is no application here — no Next.js, no consumer, no page — so both packages are currently developed blind, against unit tests that assert structure and never look at a rendered result.

That gap is worse than the usual "we should have a component explorer" complaint, because most of what the theme has to get right is not the first paint. Every widget has eight visible states — idle, hover, tentative selection, submitting, locked/terminal, expired, error fallback, read-only replay — at two chat column widths, and the interesting ones are only reachable after an interaction (ADR 0014) followed by a lifecycle transition evaluated by the runtime (ADR 0018). A screenshot in a design file cannot produce them; a developer clicking through a scratch page produces them once and proves nothing tomorrow.

Two constraints narrow the answer before the tooling comparison starts. AC-20 requires a workbench that loads only `@nerey/theme/tokens.css` and the theme's own stylesheet and still renders every widget identically to a consuming app. AC-21 requires a widget authored against `@nerey/core/mock` alone to render, interact and persist with no backend and no network. The decision is therefore about what artefact a state is authored in, whether that artefact is executable, and what CSS is allowed to reach it.

## Decision Drivers

* The workbench must be a truthful reference: whatever it renders must be reproducible in a consumer's app, which means no cascade the consumer does not have.
* States behind an interaction and a lifecycle expiry must be reachable without a human clicking, or they will not be reviewed and will not be tested.
* ADR 0006 already provisions a second Vitest project in browser mode. The workbench should supply that project's test cases rather than run as a parallel, untested universe of examples.
* The story format must be statically analysable. The enforcement in this repo is AST-level gate scripts (ADR 0033) and ESLint (ADR 0005); neither can reason about stories assembled at runtime by a factory.
* npm workspaces with three packages (ADR 0002) and `react@^19` as the only peer dependency (FR-4) — the builder must be the repo's own Vite/Vitest toolchain, not a framework's.
* Authoring cost per state has to stay near zero, or the eight-state matrix will be documented for the first widget and abandoned by the third.

## Considered Options

* Storybook 10 on `@storybook/react-vite`, CSF 3 only, stories colocated in each package, executed as tests through `@storybook/addon-vitest`
* Ladle
* A bespoke Vite playground application in the workspace, with a route per widget state

## Decision Outcome

Chosen option: "Storybook 10 on `@storybook/react-vite`, CSF 3 only, stories colocated in each package, executed as tests through `@storybook/addon-vitest`", because it is the only option in which a state is authored once and then serves simultaneously as the reviewable artefact, the interaction test, the accessibility subject (ADR 0032) and a contributor to the merged coverage number (ADR 0007) — and because its story format is a plain module of named exports, which is exactly what the gate scripts can parse.

The decision fixes six things:

1. **Framework: `@storybook/react-vite`.** Not `@storybook/nextjs-vite`. There is no Next.js in this repository, and adopting the Next builder would drag a framework's module resolution, font pipeline and image handling into the development loop of a library that declares one peer dependency. The absence of an app framework in the workbench is a property under test, not an omission.
2. **Colocation.** Stories live at `packages/*/src/**/*.stories.tsx`, in the component's own directory. A top-level `stories/` tree separates the example from the code it exemplifies and drifts within a release.
3. **CSF 3 only.** `storiesOf` and `Template.bind({})` are rejected. A story is a named export whose object literal carries `args`, optional `render` and optional `play`. MDX is allowed for prose and may embed an existing story with `<Story of={Primary} />`; it may never define one, because a story defined in MDX is invisible to the gates and to the Vitest runner.
4. **`play` is mandatory for interactive components.** Anything that can call `onInteraction` gets a `play` function that drives the real interaction with `userEvent` and asserts the resulting DOM. Submitting, locked and expired states are produced by the lifecycle runtime, never faked by passing `data-state="locked"` as an arg — a hand-set attribute would test the stylesheet against a state the runtime might never emit.
5. **The preview loads exactly two stylesheets:** `@nerey/theme/tokens.css` and `@nerey/theme/theme.css`. No Tailwind, no host design system, no `normalize.css`, no reset of our own. ADR 0025 asserts the theme is self-sufficient in the cascade; the workbench is the one place where that assertion is either true or observably false, and adding a single convenience reset to the preview would permanently destroy the evidence.
6. **One root Storybook over all workspace packages,** not one per package. Core primitives and themed components have to be visible side by side, since the entire point of the split is that the same headless component renders under different CSS.

A useful consequence of ADR 0026: because themed components expose `variant` / `size` / `tone` and refuse `className`, the Storybook controls panel is a complete rendering of the themed public API. A story that needs an escape hatch to look right is a factoring bug in the token surface, and it shows up as a missing control rather than as a passing test.

Light and dark (ADR 0027) are a preview toolbar global that stamps `data-nerey-theme` on the preview root, which exercises the explicit-override direction of AC-19 on every story rather than in one dedicated test.

### Consequences

* Good, because the eight-state matrix becomes cheap: a state is roughly ten lines of `args` plus a `play`, and it is immediately a browser-mode test contributing to the merged coverage threshold (ADR 0007).
* Good, because AC-20 and AC-21 stop being aspirations reviewed by eye. The preview's import list and the mock-only host wiring are both machine-checkable facts about a file.
* Good, because ADR 0032's accessibility gate needs no separate harness — it rides the same runner and inspects the post-`play` DOM, which is where the locked and expired states actually live.
* Good, because a widget author outside this repo has a working template: `@nerey/core/mock` (FR-37) plus a story file is the documented path to building a widget with no backend.
* Neutral, because Storybook is a substantial dev dependency with its own upgrade cadence. It is a devDependency of the workspace root only and never enters any published package's dependency graph, so it cannot affect a consumer's install.
* Bad, because CSF 3 forbids the one abstraction people reach for when a component has twenty near-identical states — a shared `Template` bound with different args. The replacement is a plain factory function returning a story object, which is more verbose and, unlike `Template.bind({})`, statically inspectable.
* Bad, because stories that are also tests are slower to write than stories that are only pictures; `play` functions demand real assertions, and a broken interaction now fails the build instead of looking slightly wrong in a panel.

### Confirmation

Four automated checks, all wired into `npm run check:all` or `npm test`:

* **`npm run check:stories`** (`scripts/check-stories.mjs`) parses every `*.stories.tsx` with the TypeScript AST and fails on: a stories file outside `packages/*/src/`; any import or call of `storiesOf`; any `Template.bind(` or member-expression `.bind({})` assigned to an exported binding; an `.mdx` file that exports a story object or imports `Meta`/`StoryObj` as a definition rather than embedding `<Story of={Primary} />`; a default export not written as `satisfies Meta<typeof Component>`; and a story for a component whose registry entry declares an interaction contract but whose object literal has no `play` property. It also asserts that `.storybook/preview.ts` imports exactly `@nerey/theme/tokens.css` and `@nerey/theme/theme.css` and no other stylesheet, which is the executable form of AC-20.
* **ESLint** (`eslint-plugin-storybook`, flat config, scoped to the stories glob per ADR 0005): `storybook/no-stories-of`, `storybook/default-exports`, `storybook/await-interactions`, `storybook/no-renderer-packages`, `storybook/prefer-pascal-case`. The `await-interactions` rule is the one that matters most — an un-awaited `userEvent` call in a `play` produces a story that passes for the wrong reason.
* **`npm test`** runs the Storybook project defined in ADR 0006 through `@storybook/addon-vitest`. Every story is a test case; a `play` function that throws fails the build.
* **Gate self-test** per ADR 0033: `scripts/check-stories.mjs` ships fixtures containing one planted violator per rule above, and its own test asserts the gate exits non-zero on each. A gate nobody has seen fail is an unverified claim.

Visual fidelity itself — whether the locked state actually reads as locked — stays manual review at the Storybook UI, because no assertion distinguishes "correct" from "ugly". The reset-independence half of that question is not manual: AC-18 compares the same story rendered with and without Preflight by screenshot, which is mechanical.

## Pros and Cons of the Options

### Storybook 10 on `@storybook/react-vite`, CSF 3 only, stories colocated in each package, executed as tests through `@storybook/addon-vitest`

* Good, because a single story file is simultaneously the reviewable artefact, an interaction test, an accessibility subject and a coverage contributor — one authoring cost, four returns.
* Good, because `addon-vitest` runs stories in a real browser through the repo's existing Vitest configuration (ADR 0006), so there is one test command and one merged coverage report rather than two toolchains reporting separately.
* Good, because CSF 3's flat object literals are trivially analysable, which is what makes `check:stories` and the accessibility waiver gate possible at all.
* Good, because the preview's stylesheet list is a one-line, auditable statement of what CSS the workbench is allowed to see.
* Neutral, because Storybook 10 brings an addon ecosystem this project will mostly not use; the value taken is `addon-vitest` and `addon-a11y`, and everything else is declined.
* Neutral, because the root Storybook config knows about all three packages, adding one workspace-level file that must be kept in step with package additions.
* Bad, because it is the heaviest option by install size and cold-start time of the three.
* Bad, because Storybook's own major-version upgrades have historically required story migrations; committing to CSF 3 narrows that exposure but does not remove it.

### Ladle

Vite-native story runner, CSF-compatible, an order of magnitude lighter than Storybook.

* Good, because startup and HMR are noticeably faster, and the configuration surface is small enough to hold in your head.
* Good, because it consumes the same CSF story files, so this choice is reversible in principle.
* Neutral, because its story format compatibility means the colocation and CSF 3 rules in this ADR would survive a switch.
* Bad, because there is no equivalent of `addon-vitest`: stories do not become browser-mode Vitest cases in the repo's existing project structure, so ADR 0006's second project would have to be fed by a separate set of test files — the exact duplication this decision exists to avoid.
* Bad, because it has no accessibility integration that can fail a build on a pinned axe tag set with per-story rule waivers, which ADR 0032 requires.
* Bad, because the ecosystem is small enough that the failure mode of a missing integration is "write it yourself", and workbench tooling is not where this project should be spending implementation budget.

### A bespoke Vite playground application in the workspace, with a route per widget state

An `apps/playground` workspace with a route per widget and per state, hand-wired to `@nerey/core/mock`.

* Good, because it has zero third-party workbench dependencies and total control over the document — proving reset independence is as easy as shipping an empty `index.html`.
* Good, because it is closer to a real consumer than a story runner is: it imports the built packages exactly the way an app would.
* Neutral, because its routing structure would end up re-inventing a story hierarchy, with hand-maintained navigation instead of generated navigation.
* Bad, because nothing about it is a test. Every state would need a parallel test file, and the two would diverge — the playground would show a state the tests do not cover, or vice versa, and neither would be wrong enough to notice.
* Bad, because there is no controls panel, so exploring the `variant` × `size` × `tone` matrix from ADR 0026 means editing source or hand-writing a control surface.
* Bad, because per-state accessibility scanning, isolation of each case in its own iframe, and post-interaction DOM auditing all become bespoke infrastructure with no owner.

## More Information

Implements AC-20 (workbench loads only `tokens.css` plus the theme's stylesheet, no cascade leak) and AC-21 (a widget authored against `@nerey/core/mock` renders, interacts and persists with no backend). The states enumerated in the UX specification — idle through read-only replay, at roughly 520 px and 740 px column widths — are the story matrix each themed widget must cover.

Related records: ADR 0006 defines the Vitest project structure this rides on; ADR 0007 merges the resulting coverage; ADR 0032 adds the accessibility gate to the same runner; ADR 0033 requires the gate scripts named above to self-test against planted violators; ADR 0034 runs them at edit time. ADR 0016 makes the backend-free workbench possible by keeping persistence an injected port, and ADR 0035 fixes which built-in widgets have stories in core at all.

Revisit if Storybook's Vitest integration stops tracking Vitest releases, or if the story-as-test coupling starts producing stories written for the assertion rather than for the reader.
