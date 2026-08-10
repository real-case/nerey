---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0018. A widget lifecycle runtime, not merely lifecycle types

## Context and Problem Statement

A generative widget is not a component that renders once and stays live forever. A poll closes after
you vote. A confirmation dialog stops accepting input once you confirm. An offer expires after ninety
seconds. A composer-attached widget must yield the composer back. Every one of those is the same
question — *when does this widget stop being interactive, and what does the transcript show
afterwards* — and the transcript must answer it identically on first render and after a reload three
days later.

The extraction source declares the vocabulary for this and evaluates none of it. `Lifecycle` sits on
`WidgetRegistryEntry` with `persist`, `expiry` and `afterExpiry`; nothing reads those fields. Locking
is instead re-derived inside each widget: the poll widget holds its own `hasVoted` state, disables its
own buttons, and loses all of it on reload, so a reloaded transcript shows a poll that invites a
second vote for a question already answered. The types are documentation of an intention, and three
widgets would produce three inconsistent implementations of it.

This is also the one area where Nerey cannot copy a settled standard. The registry pattern, the
tool-part status machine and text-only fallback all have converged prior art (ADR 0008, ADR 0019,
ADR 0012). Widget lifecycle does not: the research pass found it verifiably unstandardised. MCP Apps
(SEP-1865) explicitly deferred widget-state persistence and rehydration to a later revision, and the
OpenAI Apps SDK is the only surveyed system with a documented full contract — a three-tier state
model, message-scoped `setWidgetState`, inline / fullscreen / pip display modes, and two distinct
dismissal paths. So the decision is not "which spec do we implement" but "do we take a position at
all, and where does the evaluation live".

## Decision Drivers

* A reloaded transcript must be truthful. An answered widget that re-enables on reload invites a
  duplicate action against a system that already recorded the first one.
* One derivation of `readonly`, not one per widget. Locking rules that live in widget bodies cannot be
  tested once, cannot be styled consistently (ADR 0020), and cannot be audited.
* Widget authors are the wrong people to implement expiry. They are writing a poll, not a scheduler
  with a persisted deadline and a rehydration path.
* Core has no router, no transport and no clock authority over the application (ADR 0037). Whatever
  the runtime evaluates, it must evaluate from signals the host already owns.
* `snapshot` has to be renderable without re-running the widget's effects, or replay becomes a second
  execution of the original interaction.
* The area is unstandardised, so the design must be cheap to revise: an evaluator with a narrow input
  type ages better than lifecycle logic smeared across a widget catalog.
* Placement makes this load-bearing rather than cosmetic: an `input: 'replace'` widget that never
  expires never gives the composer back (ADR 0017).

## Considered Options

* A lifecycle runtime in core that evaluates the rules and derives readonly
* Declarative lifecycle types only, enforced by each widget
* A consumer-injected lifecycle policy port

## Decision Outcome

Chosen option: "A lifecycle runtime in core that evaluates the rules and derives readonly", because
the rules are already declared per entry and only core sees every input they depend on — the widget's
interactions, its persisted state, the message stream and the wall clock — so any other placement of
the evaluation either duplicates it per widget or pushes a scheduler onto the consumer for behaviour
the library claims to provide.

The contract:

```ts
type Lifecycle = {
  persist: 'forever' | 'ephemeral';
  expiry: ExpiryRule[];
  afterExpiry: 'fallback' | 'hide' | 'snapshot';
};

type ExpiryRule =
  | { on: 'interact' }                  // any outbound interaction
  | { on: 'interact'; action: string }  // a specific action only
  | { on: 'timeout'; ms: number }
  | { on: 'message' }                   // a later message arrives in the conversation
  | { on: 'navigate' }
  | { on: 'event'; name: string };      // a host-dispatched named signal
```

Rules are **disjunctive**: the first rule to fire expires the widget, and the reason is recorded. There
is no conjunction and no ordering — an entry that needs "vote *and* thirty seconds" is expressing a
policy the widget's own state machine should own, not a lifecycle rule.

**Evaluation is a pure function.** `evaluateLifecycle(lifecycle, expiryState, signal)` returns
`{ expired: boolean; reason?: ExpiryReason; expiredAt?: number }` and touches no React, no timers and
no DOM. The React layer is a thin subscriber that feeds it signals and publishes the result as the
`readonly` prop, `data-readonly` and `data-state="expired"` (ADR 0020). Everything hard about the
feature — rule precedence, deadline arithmetic, rehydration — is therefore testable as a table.

**Core evaluates; the host delivers signals.** `interact` is core's own — it sits on the single
outbound channel (ADR 0014), so `interact` and `interact+action` need nothing from the consumer.
`timeout` is core's own, with the deadline computed from the widget's message timestamp rather than
from mount, so a reload does not restart the clock and a widget whose deadline passed while the tab
was closed is already expired on first paint. `message` is derived from the message identity the host
already passes through `WidgetHostProvider` (ADR 0016). `navigate` and `event` cannot be core's:
core knows nothing about routers (ADR 0037), so both arrive as explicit host-dispatched signals. A
signal-driven rule whose signal is never dispatched simply never fires, and that is a wiring defect
the conformance kit catches, not a runtime core papers over.

**Expiry is recorded, not recomputed.** When a rule fires, core writes an expiry marker through the
injected persistence port (ADR 0016) in a reserved namespace alongside — never inside — the widget's
own state, so the widget's `stateSchema` (ADR 0011) stays exactly what its author declared. On reload
the marker is read back before first paint, which is what makes `snapshot` deterministic instead of a
re-derivation that has to guess. `persist: 'forever'` writes state and marker through the port;
`persist: 'ephemeral'` keeps both in a session-scoped in-memory store and writes nothing, so an
ephemeral widget renders fresh on reload — acceptable for a transient prompt, wrong for anything that
sent a message, which is why the conformance kit rejects `ephemeral` combined with an action-bearing
expiry rule.

**`afterExpiry` treatments:**

* `snapshot` — the widget component renders again with `readonly: true`, seeded from its persisted
  terminal state, and **fires no effect**: core does not replay the interaction, does not re-run
  reducers, and does not write state on mount. This is the default for anything the user acted on.
* `hide` — the widget is not rendered; the message's own text still renders. Used for surfaces that
  make no sense as history, such as an expired `input: 'replace'` prompt, whose composer is restored
  at the same moment (ADR 0017).
* `fallback` — routed through the injected fallback renderer, reusing the terminal step of the
  degradation chain (ADR 0012). Expiry is not a failure: nothing is emitted to `onWidgetError`
  (ADR 0013), and the two paths are distinguishable in the DOM by `data-state="expired"` versus
  `data-state="error"`.

**An acted-upon widget is disabled, not removed.** No expiry treatment unmounts a widget from the
transcript in a way that rewrites history — `hide` collapses a live surface, it does not delete a
recorded exchange. Removal breaks scroll anchoring, makes the transcript disagree with what the user
remembers doing, and destroys the evidence of an action whose side effects are still real. The rule is
absolute and is the reason `snapshot` exists at all.

### Consequences

* Good, because `readonly` has exactly one derivation with exactly one test surface. A widget author
  reads a prop; they do not implement a lock, a timer or a rehydration path.
* Good, because a reloaded transcript is deterministic: same marker, same terminal state, same DOM, no
  effects. The duplicate-action hazard that the extraction source's per-widget `hasVoted` state
  produced is structurally gone.
* Good, because `data-state="expired"` and `data-readonly` become truthful, which is what makes the
  attribute surface stylable as a contract rather than as a convention (ADR 0020) and lets the theme
  specify a read-only replay state per widget.
* Good, because the pure evaluator is trivially exhaustive to test — every rule kind, every
  `afterExpiry`, every reload path — without rendering anything.
* Good, because it makes the placement invariants enforceable: a `replace` widget and a
  non-dismissible overlay both have a guaranteed exit (ADR 0017).
* Bad, because core acquires a scheduler, a clock and a persisted side-channel. That is genuinely more
  machinery than a renderer needs, and it is the largest single piece of behaviour in `@nerey/core`.
* Bad, because the reserved namespace in persisted state is a forward-compatibility hazard: consumers
  will see it in their storage, and changing its shape later is a migration (ADR 0030 governs the
  payload side of the same problem).
* Bad, because we are inventing in an unstandardised space. If MCP Apps later specifies widget-state
  persistence and rehydration, or the OpenAI Apps SDK's state tiers become a de-facto shape, Nerey may
  own a runtime that disagrees with the ecosystem. The mitigation is the narrow evaluator boundary and
  `event(name)` as the extension seam — new host-specific triggers should arrive as named events, not
  as new members of `ExpiryRule`.
* Neutral, because `navigate` and `event` require host cooperation. The library is honest that these
  are host signals rather than pretending to observe the router.

### Confirmation

* `packages/core/src/lifecycle/__tests__/evaluate-lifecycle.test.ts` — table-driven over the pure
  evaluator: every `ExpiryRule` kind, disjunctive precedence, the `interact` versus `interact+action`
  distinction, and deadline arithmetic under `vi.useFakeTimers()` including a deadline that passed
  while unmounted. No React in this file; if a case cannot be expressed here, the logic has leaked out
  of the evaluator.
* `packages/core/src/lifecycle/__tests__/lifecycle-runtime.test.tsx` — the AC-12 acceptance surface:
  `expiry: [{ on: 'interact' }]` flips `readonly` to `true` after the first interaction;
  `{ on: 'timeout', ms }` flips it after the interval; `afterExpiry: 'snapshot'` renders the terminal
  state read-only after a remount **and fires no effect**, asserted by spying every injected port —
  `sendUserMessage`, `persistence.updateWidgetState`, `onInteraction` — and requiring zero calls
  across the remount. "Fires no effect" is thereby a numeric assertion, not a claim.
* `packages/core/src/lifecycle/__tests__/after-expiry.test.tsx` — one case per treatment: `snapshot`
  renders the widget with `data-readonly="true"`, `hide` renders no widget while the message text
  survives and any replaced composer is restored (ADR 0017), `fallback` routes through the injected
  renderer and emits nothing to `onWidgetError` (ADR 0013).
* The widget conformance kit exported from `@nerey/core/testing` and run under `npm run test:unit`
  adds three entry-level rules: an entry combining `persist: 'ephemeral'` with an action-bearing
  expiry rule fails; an entry whose component renders an enabled control while `readonly` is true
  fails, checked by requiring
  `[data-readonly="true"] :is(button,input,select,textarea):not([disabled])` to match nothing; and an
  entry declaring a `navigate` or `event` rule with no registered signal source in its test host fails
  as unreachable.
* `npm run check:data-contract` (`scripts/check-data-contract.mjs`) locks `data-readonly` and the
  `expired` value of `data-state` into the attribute snapshot, so the runtime's observable output
  cannot drift away from what themes and consumer CSS select on (ADR 0020).
* `npm run check:gates` (ADR 0033) plants the violator this ADR was written against — a widget that
  re-enables after expiry, and a `snapshot` render that writes state on mount — and requires the
  suites above to go red. A gate that cannot reject the original defect is not evidence.
* Coverage thresholds apply to `packages/core/src/lifecycle/**` with no exclusion (ADR 0007); the
  runtime is the part of core least likely to be exercised incidentally by other tests, so it is the
  part that most needs the floor.

## Pros and Cons of the Options

### A lifecycle runtime in core that evaluates the rules and derives readonly

Core reads `lifecycle` off the registry entry, evaluates the rules against interactions, timers,
message identity and host-dispatched signals, records expiry through the persistence port, and passes
`readonly` down to the widget.

* Good, because it is the only placement where all the inputs are already present — the outbound
  channel (ADR 0014), the persistence port (ADR 0016), the message stream and the registry entry meet
  in core and nowhere else.
* Good, because consistency is structural. Thirty widgets behave the same on reload because they share
  one evaluator, not because thirty authors read the same paragraph.
* Good, because the pure-function core makes the hardest cases — rehydration, elapsed deadlines,
  precedence — cheap to test exhaustively.
* Good, because it makes `readonly` a first-class prop that themes can style and the conformance kit
  can assert against, which is what turns FR-24 from a convention into a checkable property.
* Neutral, because it defines behaviour in a space no standard covers; Nerey documents its position
  rather than claiming conformance.
* Bad, because it is the largest behavioural surface in core, and the one most likely to need a
  breaking revision if the ecosystem settles differently.
* Bad, because the persisted expiry marker is a schema Nerey now owns forever in consumers' storage.

### Declarative lifecycle types only, enforced by each widget

Keep `Lifecycle` on the entry as declaration and documentation; each widget implements its own locking
against it. This is what the extraction source does today, and it is the option with the lowest
implementation cost.

* Good, because it is already written and ships immediately.
* Good, because a widget author retains complete freedom over its own state machine, including
  policies the rule vocabulary cannot express.
* Neutral, because the declaration still has value as prompt-side and catalog-side metadata even when
  nothing evaluates it.
* Bad, because it does not survive reload. Locking held in component state disappears, and the poll
  widget in the extraction source demonstrates precisely this: an answered poll re-offers its options,
  which is a duplicate-action bug dressed as a rendering bug.
* Bad, because the type lies. `expiry: [{ on: 'timeout', ms: 30_000 }]` reads as a promise the library
  makes and is in fact a note to the widget author, and nothing in the type system distinguishes those
  two readings.
* Bad, because per-widget locking produces per-widget DOM. `data-state` and `data-readonly` become
  whatever each author remembered to emit, and the attribute contract (ADR 0020) cannot be enforced.
* Bad, because it makes the placement invariants unenforceable: a `replace` widget's composer comes
  back only if that particular author remembered (ADR 0017).
* Bad, because every widget re-implements timers and rehydration, which is where the interesting bugs
  live, multiplied by the number of widgets.

### A consumer-injected lifecycle policy port

Core exposes lifecycle declarations and interaction events and accepts a `LifecyclePolicy` port on the
host value — the same injection shape used for persistence (ADR 0016) and the fallback renderer
(ADR 0012) — leaving the consumer to decide when a widget expires.

* Good, because it is consistent with how Nerey handles every other capability it does not want to
  own, and a consumer with an existing session or feature-flag system could integrate expiry with it.
* Good, because it keeps core small and keeps the unstandardised policy question outside the library's
  versioned surface.
* Neutral, because a default in-memory implementation could ship the same way the in-memory
  persistence adapter does, so the common case would still work out of the box.
* Bad, because it inverts the reason the ports exist. Persistence and fallback rendering are ports
  because they are *environmental* — storage and markdown belong to the consumer's stack. Expiry
  policy is not environmental; it is declared per widget by the widget's author, on the registry
  entry, in the library's own vocabulary. Injecting its evaluation asks the consumer to interpret a
  vocabulary they did not write.
* Bad, because it moves the hard parts outward without removing them: the deadline arithmetic, the
  rehydration ordering and the no-effects `snapshot` guarantee all become consumer responsibilities,
  and each consumer will get them wrong differently.
* Bad, because the guarantees other decisions depend on evaporate. ADR 0017 needs the composer restored
  and a non-dismissible overlay closed; the conformance kit (FR-38) needs lifecycle transitions to be
  assertable against an entry alone. Neither holds if the policy is supplied at the application
  boundary.
* Bad, because it turns a wiring omission into silence: a consumer who never supplies the port gets
  widgets that never expire, with no compile-time signal that anything is missing.

## More Information

Implements FR-23 and FR-24, and is the acceptance surface for AC-12. It is the decision the
requirements single out as "the deliberate core of the library" — the one area where Nerey is not
re-implementing a settled standard.

**Grounding.** Widget lifecycle is unstandardised as a matter of record, not of opinion. MCP Apps
(SEP-1865) specifies the `ui://` resource template and host-mediated JSON-RPC but explicitly defers
widget-state persistence and rehydration. Google A2UI standardises the client-owned component catalog
and says nothing about a component's lifetime. The Vercel AI SDK standardises the tool-part state
machine that Nerey mirrors as `status` (ADR 0019) — which describes the *arrival* of a widget's input,
not the *end* of its interactivity, and the two are routinely conflated. The OpenAI Apps SDK is the
only surveyed system with a documented full contract: a three-tier state model, message-scoped
`setWidgetState`, inline / fullscreen / pip display modes, and two distinct dismissal paths. Nerey's
`persist` / `expiry` / `afterExpiry` triple is a narrower vocabulary aimed at the same problem, chosen
because it can be declared on a registry entry and evaluated without a host protocol.

**Deliberately out of scope.** Conjunctive rules, rule priorities, and un-expiry. A widget that must
become interactive again is a new widget in a new message, which keeps the transcript append-only and
keeps the evaluator a one-way function.

**Revisit when** MCP Apps publishes a state-persistence revision, or when a second real consumer needs
an expiry trigger that `event(name)` cannot carry — that second case is the signal the vocabulary is
too narrow, and it should be answered by widening `ExpiryRule`, deliberately, in a successor record.

Related: ADR 0014 (the single outbound channel that `interact` observes), ADR 0016 (the persistence
port that carries the expiry marker), ADR 0017 (placement surfaces that depend on a guaranteed exit),
ADR 0019 (`status` as arrival, distinct from expiry as termination), ADR 0011 (state schema kept clean
of the reserved namespace), ADR 0030 (migration-on-read, the same forward-compatibility posture applied
to payloads), ADR 0013 (why expiry emits no error), ADR 0020 (`data-readonly` and `data-state`),
ADR 0035 (the confirmation widget as the end-to-end exerciser of interaction, lifecycle and
persistence).
