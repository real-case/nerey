---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0006. Vitest and React Testing Library, with Storybook browser mode as a second project

## Context and Problem Statement

Nerey's acceptance criteria split cleanly into two kinds of assertion that want two different
environments.

One kind is contract logic with no visual dimension: `createWidgetRegistry` throwing on a duplicate key
at construction (AC-3), `poll@1.0.0` failing to resolve a payload carrying `"1.0"` (AC-5), each of the
four degradation steps emitting its own typed error (AC-6), a lifecycle timeout flipping `readonly`
(AC-12), a rejected persistence write leaving a widget locked and sending no second reply (AC-10).
These need a DOM, not a browser, and they need to run in seconds.

The other kind is only true in a real engine. Base UI supplies focus trapping, viewport-aware
positioning, roving tabindex and scroll lock (ADR 0022), all of which depend on layout; jsdom has no
layout engine, so `getBoundingClientRect` returns zeros and every one of those behaviours passes
vacuously. The theme's guarantees are cascade guarantees — that `theme.css` without `tokens.css` still
renders legibly through declared fallbacks (AC-16), that a page with no reset renders identically to
one with Preflight (AC-18), that `data-nerey-theme` overrides `prefers-color-scheme` in both
directions (AC-19). None of that is expressible against jsdom's stylesheet handling. Accessibility
checks (ADR 0032) that depend on computed contrast silently pass there too, which is worse than not
running them.

Separately, the workbench already contains an executable description of every widget state — CSF 3
stories with `play` functions (ADR 0031). The question is whether those stories are a second artefact
to keep in sync with the tests, or the tests themselves.

## Decision Drivers

* Contract assertions must be fast enough to run on every save; visual and behavioural assertions must
  run somewhere they can actually fail.
* One runner, one config lineage, one coverage report — ADR 0007 needs a single merged number, not two
  reports to reconcile by hand.
* Tests must resolve modules through the same Vite pipeline the packages build with, so CSS Modules
  (ADR 0023) and ESM-only dependencies behave identically at test time and build time.
* Component states must be described once. The eight states the theme specifies per widget — idle,
  hover, tentative selection, submitting, locked, expired, error fallback, read-only replay — should
  not exist as both a story and a near-duplicate test.
* A widget authored against `@nerey/core/mock` must be exercisable with no backend and no network
  (AC-21).

## Considered Options

* One Vitest workspace with two projects: `unit` (jsdom) and `storybook` (browser mode, Playwright provider)
* Vitest in jsdom only, plus a separate Playwright suite driving a built Storybook
* Jest with React Testing Library, plus the Storybook test runner

## Decision Outcome

Chosen option: "One Vitest workspace with two projects: `unit` (jsdom) and `storybook` (browser mode, Playwright provider)", because it is the only arrangement where the fast contract tests and the real
browser tests are the same runner with the same module graph, which is what makes a single merged
coverage number possible and what lets a story be a test rather than a thing a test duplicates.

Two projects are declared in the root Vitest config:

* **`unit`** — `environment: 'jsdom'`, including colocated `packages/*/src/**/*.test.ts` and
  `*.test.tsx`. React Testing Library with `@testing-library/user-event` and jest-dom matchers. This
  project owns registry construction and composition (ADR 0010), exact `type@version` resolution
  (ADR 0009), the degradation chain (ADR 0012), the error taxonomy (ADR 0013), lifecycle rule
  evaluation (ADR 0018), the persistence port and rollback behaviour (ADR 0016), and the compile-time
  interaction-contract assertions (ADR 0014). `npm run test:unit` runs it alone — this is the loop a
  contributor keeps open.
* **`storybook`** — the `storybookTest` plugin from `@storybook/addon-vitest`, with `browser.enabled`
  and the Playwright provider from `@vitest/browser-playwright`, headless, one Chromium instance,
  including `**/*.stories.tsx`. Its `setupFiles` apply the Storybook preview annotations, so a story under test
  runs with the same decorators and the same stylesheets the workbench loads — `tokens.css` plus the
  theme's compiled sheet and nothing else (ADR 0024, ADR 0025). This project owns the `data-*` contract
  snapshot (AC-14), the theme's cascade criteria (AC-16, AC-18, AC-19, AC-20), the Base UI behaviours,
  the axe run (ADR 0032), and the mock-layer end-to-end demonstration (AC-21).

**Why stories double as tests.** A CSF 3 story is already a component plus concrete args plus, with a
`play` function, a scripted interaction — which is precisely what an RTL test is, minus the
duplication. Writing both means the same eight states are named twice, and the copies drift in the
ordinary way: someone fixes the story because it looked wrong in the workbench and never touches the
test, or vice versa. Running the story as the test removes the possibility: a green suite and a
correct-looking workbench cannot disagree, because they are the same execution. It also fixes the
usual weakness of RTL component tests, which is that they mount the component in an environment
nobody ever looks at; here the environment under test is the one a human reviews. Where a unit test
does need a component, portable stories (`composeStories`) reuse the story's args and decorators
rather than restating them, so there is still one definition of "the submitting state".

What stays a plain unit test is everything with no rendered surface — registry construction, version
resolution, lifecycle rule evaluation, adapters, the persistence port. Those get no story because
there is nothing to look at.

### Consequences

* Good, because each state is described once, in the artefact that is also the documentation.
* Good, because layout-dependent behaviour and cascade behaviour are asserted where they can fail; a
  focus trap test in jsdom is worse than no test, since it reports success.
* Good, because both projects share Vite's resolution, so a CSS Modules import or an ESM-only
  dependency behaves the same in tests as in the built package — no separate transform configuration
  to keep aligned.
* Good, because coverage from both projects lands in one report, which is what ADR 0007 gates on.
* Bad, because CI must install a Playwright browser (`npx playwright install --with-deps chromium`),
  adding setup time and a binary to cache.
* Bad, because the browser project is materially slower than jsdom, so the default `npm run test` is
  not the inner loop; `npm run test:unit` is, and contributors must know the difference.
* Bad, because a broken story now breaks the build. This is intended — a story that does not run is
  documentation that is already wrong — but it does mean the workbench is no longer a place to leave
  something half-finished.
* Neutral, because story-based tests are less precise about *why* they failed than a narrow unit test;
  the compensation is that a failing story is directly reproducible by opening it in the workbench.

### Confirmation

* `npm run test` — runs both projects; CI fails on either. This is the required check.
* `npm run test:unit` (`vitest run --project unit`) — the jsdom project alone, for the edit loop and
  for a fast pre-push signal.
* `npm run check:stories` — asserts that every registry entry and every exported themed component has
  a story, and that the required states are present, so "it has no story" cannot be the way a component
  escapes the browser project (ADR 0031).
* `npm run test:coverage` — the merged report and its threshold, specified in ADR 0007.
* `npm run check:gates` — per ADR 0033, both projects are proven against planted violators: a widget
  whose payload validation is removed must fail the degradation tests, and a component with a renamed
  `data-nerey-part` must fail the contract snapshot.
* Compile-time assertions are carried by `typecheck` rather than by the runner, since a
  `@ts-expect-error` that stops erroring fails `tsc` (ADR 0003).

## Pros and Cons of the Options

### One Vitest workspace with two projects: `unit` (jsdom) and `storybook` (browser mode, Playwright provider)

* Good, because one runner, one config lineage, one reporter, one coverage report.
* Good, because stories run through the same Vite pipeline as `storybook dev`, so there is no build
  step between editing source and running the browser tests.
* Good, because the project split is a first-class Vitest concept: `--project unit` selects the fast
  half without maintaining a second config file.
* Good, because V8 coverage is collected from source in both environments, which is the precondition
  for a single merged threshold.
* Neutral, because browser mode's API surface is still evolving faster than the jsdom path; the risk is
  bounded by pinning Playwright and the addon together.
* Bad, because it requires a browser binary in CI and is slower than jsdom for the half that needs it.

### Vitest in jsdom only, plus a separate Playwright suite driving a built Storybook

* Good, because it is the well-trodden arrangement — the Storybook test-runner shape — with plenty of
  prior art.
* Good, because the Playwright suite tests the actual built workbench, which is closest to what a
  consumer would deploy.
* Neutral, because the same stories are still the source of truth; the difference is how they are
  driven.
* Bad, because it requires `build-storybook` before every run, so the browser feedback loop includes a
  full static build rather than a Vite transform of the changed module.
* Bad, because it produces two coverage artefacts in different formats — the jsdom run over source and
  the Playwright run over a built bundle — and merging them is exactly the reconciliation ADR 0007
  exists to avoid.
* Bad, because two runners means two configs, two reporters, two sets of CI flakiness, and two places
  a setup file can be wrong.

### Jest with React Testing Library, plus the Storybook test runner

* Good, because Jest's ecosystem, matchers and IDE integration are the most mature of the three, and
  most contributors have used it.
* Neutral, because the assertion style is effectively identical to Vitest's, so migration in either
  direction is mechanical.
* Bad, because the packages build with Vite, so Jest requires a parallel transform configuration for
  CSS Modules, ESM-only dependencies and JSX — a second module-resolution reality that will diverge
  from the build in some detail nobody notices until a release.
* Bad, because Storybook 10's supported testing integration is the Vitest addon; using the test runner
  instead means running against a built static Storybook, with the same rebuild and coverage-merging
  problems as the option above.
* Bad, because it still leaves the layout problem unsolved — Jest with jsdom is exactly the
  environment where focus traps and cascade assertions pass without being true.

## More Information

The workbench itself, CSF 3 conventions and the requirement that every component has a story are in
ADR 0031. The accessibility gate that runs inside the browser project is ADR 0032. Coverage collection
and its threshold are ADR 0007. The behaviours under test are specified in ADR 0009 (exact version
resolution), ADR 0010 (explicit registry composition), ADR 0012 (degradation chain), ADR 0013 (error
taxonomy), ADR 0014 (interaction channel), ADR 0016 (persistence port), ADR 0018 (lifecycle runtime),
ADR 0019 (streaming status) and ADR 0020 (the `data-*` styling API whose snapshot the browser project
locks).

The conformance kit of FR-38 is packaged as reusable assertions consumed by both projects rather than
as a third runner: given a registry entry, it asserts schema round-trip, fallback on invalid payload,
absence of I/O imports, lifecycle transitions and `data-*` stability, and per AC-22 it must itself fail
against a deliberately seeded violation of each rule — the same planted-violator discipline as
ADR 0033.
