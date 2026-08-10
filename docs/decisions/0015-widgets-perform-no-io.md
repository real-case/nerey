---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0015. Widgets perform no I/O, enforced by a shipped ESLint config

## Context and Problem Statement

ADR 0014 makes `onInteraction` the only sanctioned outbound channel from a widget. That claim is only
true if nothing else in a widget module can reach the network. Nothing in TypeScript stops a widget
author from writing `import axios from 'axios'` and calling an endpoint from a `useEffect`, and the
degradation chain (ADR 0012) cannot catch it: a widget that fetches renders perfectly well until it is
mounted in a transcript replay, a Storybook story, or a test — where it hangs, throws, or quietly
mutates production data.

The rule exists today in the extraction source, but it lives in the application's own
`eslint.config.mjs`. That file stays behind. The question this record settles is not whether widgets may
perform I/O — that is decided by FR-18 — but where the enforcement lives so that it survives extraction
and reaches consumers who never see the Nerey repository.

## Decision Drivers

* Enforcement has to travel with the library. Nerey's widgets are mostly written by consumers in their
  own repositories, against their own lint setup; a rule that only runs in this monorepo protects the
  two built-in widgets (ADR 0035) and nothing else.
* The failure is silent and delayed. A fetching widget passes review, passes its own test with a mocked
  module, and breaks on transcript reload — exactly the case the read-only replay requirement (FR-24)
  cares about.
* The boundary must be stated as code the consumer can run, because "widgets are pure" is otherwise a
  sentence in a README that no build step reads.
* Nerey already publishes three packages (ADR 0002), so a third artifact carries no new release
  machinery, and lint rules are covered by the same semver contract as the code (ADR 0029).
* The gate has to be provably effective, not merely present — the corpus rule is that a gate self-tests
  by rejecting a planted violator (ADR 0033).

## Considered Options

* Ship the boundary as @nerey/eslint-config
* Keep the restriction in the monorepo root ESLint config
* Enforce the boundary with a dependency-cruiser rule

## Decision Outcome

Chosen option: "Ship the boundary as @nerey/eslint-config", because it is the only option under which
the rule reaches the repositories where widgets are actually written.

`@nerey/eslint-config` is a published flat-config package (ADR 0005) exporting a `widgets` config object
that a consumer applies to their own widget directory:

```js
import nerey from '@nerey/eslint-config';

export default [
  ...nerey.recommended,
  { files: ['src/**/widgets/**'], ...nerey.widgets },
];
```

The `widgets` config restricts, inside matched files:

* module imports of HTTP clients and transport libraries — `axios`, `ky`, `got`, `superagent`,
  `socket.io-client`, `ws`, `eventsource`;
* imports of the consumer's own API layer, via a configurable path pattern that defaults to
  `**/api/**`, `**/services/**` and `@/lib/api*`;
* the globals `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`;
* direct `localStorage` and `sessionStorage` access, because widget state has a port (ADR 0016) and a
  second, unsynchronized store is how a widget ends up disagreeing with the transcript.

Each restriction carries a message naming the sanctioned alternative — `onInteraction` for sending,
`useWidgetState` for persisting — so the lint error teaches the contract instead of only denying the
import. The path pattern is config, not a hard-coded constant, because the API-layer convention differs
per consumer while the transport list does not.

### Consequences

* Good, because the boundary ships as an artifact with a version number, so tightening it is a
  deliberate minor or major release rather than a surprise in someone's next CI run (ADR 0029).
* Good, because widget purity becomes a property a consumer can rely on for their own architecture:
  widgets are safe to render during replay, in stories, and in server-side snapshot tests.
* Good, because the same config is what makes the conformance kit's "no I/O imports" assertion (FR-38)
  meaningful — the kit invokes the shipped rule rather than reimplementing a second, drifting deny list.
* Bad, because consumers who do not adopt the config get no enforcement. The rule is opt-in by
  construction; documentation and the conformance kit are what make adoption the default path.
* Bad, because a lint rule is defeatable with a disable comment. That is acceptable — the goal is to make
  I/O in a widget a visible, reviewable act rather than an accident.
* Neutral, because a determined author can still smuggle I/O through an indirect module that the pattern
  does not match. The deny list is a boundary marker, not a sandbox; no sandbox is planned (ADR 0037).

### Confirmation

`packages/eslint-config/test/no-io.test.ts` runs the shipped config against fixtures through the ESLint
Node API, following the planted-violator discipline of ADR 0033:

* `fixtures/violator-axios.tsx` — a widget importing `axios` — must produce exactly one error whose
  `messageId` and message text match the documented string, satisfying AC-8;
* one fixture per restricted global (`fetch`, `WebSocket`, `EventSource`) and per storage API, each
  asserted to fail;
* `fixtures/clean-widget.tsx` — a widget that sends via `onInteraction` and persists via
  `useWidgetState` — must produce zero errors, which is what stops the rule from being tightened into
  something that fails everything.

The test asserts the *count* of errors as well as their identity, so a rule that starts matching more
broadly than documented also fails. At repository level, `npm run lint` applies the same `widgets`
config to `packages/core/src/widgets/**`, so the two built-in widgets are held to the rule they define,
and `npm run check:gates` verifies that this gate is registered and that removing it is detected.

## Pros and Cons of the Options

### Ship the boundary as @nerey/eslint-config

A published flat-config package applied by the consumer to their widget directory.

* Good, because the rule travels with the library; extraction into a consumer repository carries the
  enforcement instead of leaving it behind.
* Good, because it is the ordinary way JavaScript ecosystems distribute conventions, so adoption is one
  spread operator and needs no explanation.
* Good, because the config is versioned and changelogged, making the boundary's evolution legible.
* Neutral, because it is a third published package to release and document; the release pipeline already
  handles three (ADR 0002).
* Bad, because enforcement depends on the consumer wiring it up, and nothing detects a consumer who
  installs `@nerey/core` and skips the config.

### Keep the restriction in the monorepo root ESLint config

The status quo in the extraction source: a `no-restricted-imports` block in the application's
`eslint.config.mjs`.

* Good, because it is zero additional packaging work and already proven in the source repository.
* Good, because the rule can name the application's exact internal API modules without a configurable
  pattern.
* Bad, because it does not survive extraction at all — the whole point of the extraction is that widget
  authoring moves out of this repository, and the rule would protect only the code that least needs
  protecting.
* Bad, because the boundary would be documented in prose for consumers and enforced in code only here,
  which is the state of affairs this record exists to end.

### Enforce the boundary with a dependency-cruiser rule

Express the restriction as a `forbidden` rule in the existing dependency-cruiser setup behind
`npm run check:boundaries`.

* Good, because dependency-cruiser sees the resolved module graph, so it catches an HTTP client reached
  transitively through a helper module that a per-file lint rule would miss.
* Good, because the tool is already in the repository and already gates package-level boundaries.
* Neutral, because it can be published as a shareable ruleset too, so distribution is not the
  discriminator between the options.
* Bad, because it cannot see globals. `fetch(...)` with no import is the most likely way a widget
  performs I/O in 2026, and the module graph contains no evidence of it.
* Bad, because the feedback arrives from a separate gate run rather than from the editor, so an author
  learns about the violation after writing the widget instead of while writing it (ADR 0034 covers
  edit-time enforcement, which hooks into lint, not into the graph checker).

## More Information

Implements FR-18 and is verified by AC-8. Complements ADR 0014: `onInteraction` is the only outbound
channel *because* this rule removes the alternatives, and ADR 0016 supplies the sanctioned route for the
one thing widgets legitimately need to write.

A runtime guard — patching `globalThis.fetch` while a widget subtree renders — was considered and
rejected outside the option set: it would ship enforcement machinery into production bundles, could not
distinguish a widget's own call from one made by a consumer component rendered inside it, and would
convert a build-time error into a runtime one.

Best combined with the graph-level check rather than treated as an alternative to it: the dependency
rule under `npm run check:boundaries` still catches package-level violations such as `@nerey/core`
acquiring an HTTP client (ADR 0037), while this config governs what a widget module may reference.
