---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0035. Core ships only the text and confirmation widgets

## Context and Problem Statement

`@nerey/core` composes its built-in registry with the consumer's catalog (ADR 0010), so it has to ship some set of widgets — possibly empty. The question is which, and the answer is a boundary decision rather than a convenience one: every widget in core is a widget every consumer carries, styles around, and inherits opinions from, whether or not they ever render it.

The shipped implementation the library is extracted from contains `text` and `poll`. The poll widget is the most developed component in the source: it exercises tentative selection, commit, visual lock, per-message state persistence, rollback semantics and read-only replay, and it accumulated fifteen acceptance criteria of its own (OSI-2574). It is also, in every visible respect, a design decision — how many options a row holds, whether results render as bars, what a selected-but-uncommitted option looks like. Core ships zero CSS by construction (ADR 0002, AC-1), which means a poll in core would be a headless skeleton whose entire value proposition lives in the package that styles it.

Requirements Open Question 3 states the tension directly: FR-36 places poll in `@nerey/theme` on the argument that it is a design decision, and the counter-argument is that its select/lock/persist choreography is the most valuable thing the shipped code proved out, so burying it in the optional package hides it from anyone who takes core alone.

## Decision Drivers

* Everything in core's built-in registry is in every consumer's dependency graph. A consumer with their own design system pays for it and then ships their own version anyway.
* Core's contracts — interaction (ADR 0014), lifecycle (ADR 0018), persistence (ADR 0016), the `data-*` surface (ADR 0020), degradation (ADR 0012) — need at least one in-package widget that exercises them end to end, or they are specified but not proven.
* Core ships no CSS and no visual opinion. A widget whose value is a layout cannot be delivered honestly from a package that cannot lay anything out.
* The pedagogical argument is real: the most instructive code in the project must be findable, runnable and copyable, wherever it lives.
* Package count is fixed at three (ADR 0002); adding a fourth is a decision with its own release, versioning and documentation cost (ADR 0029).
* The degradation chain already requires a text renderer path (ADR 0012), so a `text` widget costs nothing beyond what core must contain regardless.

## Considered Options

* Two built-ins in core: `text` and `confirmation`
* Full catalog in core
* Zero built-ins in core
* A fourth package, `@nerey/widgets`

## Decision Outcome

Chosen option: "Two built-ins in core: `text` and `confirmation`", because they are the minimum pair that makes core's own contracts executable, and everything beyond that pair — `poll` included, which moves to `@nerey/theme` — is a design decision that a package shipping zero CSS has no standing to make.

`text` renders through the injected fallback renderer (FR-14, FR-36). It is the terminal step of the degradation chain made addressable as a widget type, so it introduces no markup, no styling surface and no dependency that core did not already require.

`confirmation` is the minimum interactive widget. It has one prompt, two actions and one terminal state, and in that shape it exercises every contract core defines: `onInteraction` as the only outbound channel (ADR 0014), `useWidgetState` with optimistic write and rollback (FR-19), `lifecycle.expiry: [{ on: 'interact' }]` flipping `readonly` (ADR 0018), `afterExpiry: 'snapshot'` for read-only replay (FR-24), the `data-state` progression from `idle` through `submitting` to `locked` (ADR 0020), and the lock-survives-persistence-failure rule (FR-20, AC-10). It is core's executable specification of itself. Without it, those contracts have types and prose and no proof.

`poll` ships in `@nerey/theme` as the reference widget. Its choreography is not more sophisticated than `confirmation`'s in kind — it is the same select, commit, lock, persist, replay sequence with more options and a results view. What it adds over `confirmation` is entirely visual, and the visual layer is where it belongs.

The counter-argument stands and is not dismissed: poll is the most instructive code in the project, and a consumer who takes core alone will not have it in their `node_modules`. The compensation is that discoverability is a documentation problem and is solved as one, with gates so the documentation cannot drift:

* poll ships a full CSF 3 story set with play functions covering all eight documented states — idle, hover, tentative selection, submitting, locked, expired, error fallback, read-only replay (ADR 0031);
* a walkthrough, `docs/guides/authoring-a-stateful-widget.md`, builds poll from an empty entry to a locked, persisted, replayable widget, with every code block extracted from the real `packages/theme/src/widgets/poll/` source rather than retyped;
* poll is the conformance kit's most demanding subject (FR-38), so the kit's own coverage is proven against the hardest widget in the repo;
* the mock layer in `@nerey/core/mock` supplies the persistence and command injection the walkthrough needs, so the whole thing runs with no backend and no network (FR-37, AC-21).

### Consequences

* Good, because core's built-in surface is exactly what every consumer needs and nothing they will replace. A consumer with their own design system carries a text passthrough and one two-button component, not somebody else's poll.
* Good, because it keeps core's zero-CSS claim (AC-1) honest rather than technically true. Shipping a headless widget whose point is its layout would satisfy the packaging test while betraying its intent.
* Good, because `confirmation` gives every core contract an in-package integration test subject, so the conformance kit (FR-38) has something to run against inside the package that defines it (AC-22).
* Good, because the built-in set is small enough to enumerate in a single assertion, which makes "core grew a widget" a reviewable event rather than a drift.
* Bad, because poll's choreography — the single most transferable piece of knowledge in the project — is one package removed from anyone who takes core alone. The walkthrough and the story set mitigate this; they do not erase it.
* Bad, because `@nerey/theme` now carries both a styling role and a reference-widget role, which makes its scope less crisp than core's.
* Neutral, because the boundary is testable and therefore movable: promoting a widget into core later is a deliberate change to one assertion, one export map entry and one ADR, not a refactor.

### Confirmation

* `packages/core/src/widgets/__tests__/built-ins.test.ts` — asserts `Object.keys(builtInWidgets).sort()` deep-equals `['confirmation@1.0', 'text@1.0']`. Adding a third built-in fails this test by name, which forces the decision through review instead of through a merge.
* `npm run check:core-purity` — asserts no `.css` file exists anywhere under `packages/core`, that `@nerey/theme` appears nowhere in core's dependency graph (AC-1), and that `packages/core/src/widgets/` contains exactly the two entry directories.
* `npm run check:stories` (ADR 0031) — every widget exported from `@nerey/theme` has a story file, and poll's set covers the eight documented states with play functions rather than static renders.
* `npm run check:doc-snippets` (`scripts/check-doc-snippets.mjs`) — every fenced code block in `docs/guides/authoring-a-stateful-widget.md` that claims a source path must match that file's current contents byte for byte. The compensation for poll living in the optional package is a tutorial, and an untested tutorial rots; this gate is what makes the compensation load-bearing rather than aspirational.
* `packages/theme/src/widgets/poll/__tests__/poll.conformance.test.ts` and the matching conformance runs for both built-ins — the kit asserts schema round-trip, fallback on invalid payload, no I/O imports, lifecycle transitions and `data-*` contract stability (FR-38, AC-22).
* `npm run check:gates` (ADR 0033) plants a third built-in widget, a `.css` file under core, and a doc snippet edited out of sync with its source, and fails if any gate passes them.

## Pros and Cons of the Options

### Two built-ins in core: `text` and `confirmation`

Everything else, `poll` included, ships from `@nerey/theme`.

* Good, because every core contract has an in-package widget proving it, at the cost of one small component.
* Good, because nothing in core's built-in set embodies a visual decision, so the zero-CSS boundary is substantive.
* Good, because the set is small enough for an exact-equality assertion, making growth a reviewed act.
* Neutral, because it splits the widget corpus across two packages, which the export maps (ADR 0028) already make navigable.
* Bad, because the richest reference implementation is not in the package most consumers install first.

### Full catalog in core

Ship `text`, `confirmation` and `poll` headless from core, letting the theme supply only styling.

* Good, because the reference choreography arrives with the package everyone installs, which is the strongest possible answer to the discoverability objection.
* Good, because there is exactly one place widgets live, so authors never wonder which package a new widget belongs in.
* Neutral, because poll headless is genuinely small — a reducer, a list of buttons and a lock.
* Bad, because it puts a design decision in a package with no design surface. Poll's option layout and results presentation are not implementable in core, so core would ship the half that carries no value and the theme would still own the half that does.
* Bad, because every consumer pays for poll's reducer, DOM and state machine in their bundle whether or not the model ever emits a poll.
* Bad, because it sets the precedent that core is where widgets go, and the built-in set then grows monotonically with no principle to stop it — which is precisely the "styled library" failure mode the two-package split exists to prevent.

### Zero built-ins in core

The registry ships empty; consumers supply everything, including `text`.

* Good, because it is the purest expression of "core is a registry and a runtime, not a component library", and it makes core's neutrality unarguable.
* Good, because `emptyRegistry` already exists as the zero value (ADR 0010), so the machinery costs nothing.
* Neutral, because `text` is nearly free either way, since it delegates entirely to the injected fallback renderer.
* Bad, because core's contracts would have no in-package subject. The interaction, lifecycle, persistence and `data-*` contracts would be defined by types and tested only through fixtures, so the conformance kit would ship with nothing in its own package to conform.
* Bad, because the degradation chain's terminal step needs a text path regardless (ADR 0012); excluding a `text` widget removes the registry-addressable form of something core already contains.
* Bad, because a consumer's first working render would require authoring a widget, which turns a five-minute integration into a tutorial.

### A fourth package, `@nerey/widgets`

A headless widget collection between core and theme.

* Good, because it separates "the runtime" from "the reference widgets" cleanly, and consumers opt into the collection without opting into CSS.
* Good, because poll would then be reachable without the theme, answering the discoverability objection head-on.
* Neutral, because npm workspaces (ADR 0002) make a fourth package mechanically cheap to add.
* Bad, because it is a third release train, a third changelog, a third version-compatibility matrix (ADR 0029) and a third README, for a collection whose v1 contents would be one widget.
* Bad, because it does not resolve the underlying question. Poll headless is still a design decision without a design, so the new package inherits exactly the problem that made poll unfit for core.
* Bad, because it fragments the export surface (ADR 0028) for no boundary that is not already expressed by core-versus-theme.

## More Information

Grounded in FR-36 and FR-37, and it answers Requirements Open Question 3 in the affirmative with the compensation measures stated above. Depends on the registry composition mechanism in ADR 0010 and the envelope model in ADR 0008; the built-in entries are the ones the conformance kit and the migration corpus (ADR 0030) exercise first. Packaging constraints come from ADR 0002, ADR 0028 and ADR 0037; poll's presentation in the theme is governed by ADR 0023, ADR 0026 and ADR 0031, and the behavioural primitives it uses are wrapped per ADR 0022.

Revisit if a widget in `@nerey/theme` turns out to be needed by consumers who never take the theme — which would be evidence that the widget is a primitive after all — or if the walkthrough measurably fails to carry the poll choreography to readers, at which point promoting poll behind a subpath export is a one-line change to the built-ins assertion and a superseding record.
