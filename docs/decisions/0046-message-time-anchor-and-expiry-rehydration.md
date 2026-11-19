---
status: "proposed"
date: 2026-11-19
decision-makers: Yurii Anichkin
---

# 0046. Messages carry a required time anchor, and expiry is rehydrated before first paint

## Context and Problem Statement

ADR 0018 decided that the lifecycle runtime measures a `timeout` from the widget's message timestamp
rather than from mount, and that expiry is recorded through the persistence port and read back before
first paint. Neither half is implemented (deviation D-8). The runtime takes `mountedAt: Date.now()` on
first render, keeps interactions in component state, and writes no marker. Two things are missing
before the code can follow the record:

1. **There is no timestamp to measure from.** `NereyMessage` is `{ id, role, text, widget? }`. ADR
   0018 assumed a field the type never had.
2. **"Read back before first paint" has no defined shape.** The persistence port is asynchronous
   (ADR 0016). A read that resolves after the first commit cannot prevent the first paint, so either
   the marker arrives synchronously with the message, or the runtime must decide what to show while
   the read is in flight.

The consequence of leaving it is concrete. `snapshot` only survives a reload for a widget that derives
its own lock from persisted state. A widget that relies on `readonly` alone is interactive again after
a reload, and its second press is a duplicate reply. That is the failure ADR 0018 exists to prevent,
and it is invisible in the reference widgets because `poll` locks itself.

This record decides the time anchor, the synchronous path, the asynchronous path and what renders in
between. Where the marker is stored is ADR 0047.

## Decision Drivers

- A reload must not restart a deadline, and a deadline that passed while the tab was closed must render
  as expired on the first frame (ADR 0018).
- No interactive frame may be painted for a widget that is already expired. One enabled frame is
  enough for a fast second click.
- Server rendering must produce the same first frame as the client, or hydration reports a mismatch
  near every deadline.
- Stories and tests must be deterministic (ADR 0031): no `Date.now()` the test cannot control.
- `@nerey/core` stays free of transport and storage (ADR 0037). The host owns where time and markers
  come from.
- The fix must happen before the first publish. After `0.1.0`, a new required field on `NereyMessage`
  is a declared break (ADR 0038).

## Considered Options

- Required `createdAt`, marker on the envelope or from the port, fail-closed while loading
- Optional `createdAt` with a fallback to mount time
- Keep mount time and persist the deadline instead of a timestamp

## Decision Outcome

Chosen option: "Required `createdAt`, marker on the envelope or from the port, fail-closed while
loading", because it is the only option in which every path (fresh message, reload with a marker in
the transcript, reload with the marker only in storage, server render) has one defined first frame,
and none of those frames is an interactive widget that should already be dead.

**The anchor.** `NereyMessage` gains `createdAt: number`, epoch milliseconds, **required**. A
`timeout` rule's deadline is `createdAt + ms`. The anchor is the message's own time, which a host
already has (every chat store keeps one), so the requirement asks for data that exists rather than
for new bookkeeping. Adapters and the mock layer always fill it.

**The clock.** The host value gains `now?: () => number`, defaulting to `Date.now`. The runtime reads
time only through it. That removes the `react-hooks/purity` suppression in `use-widget-lifecycle.tsx`,
makes stories deterministic by injecting a fixed clock, and lets a server render and the hydrating
client agree on the instant they evaluate.

**The synchronous path.** `NereyWidgetEnvelope` gains an optional
`expiry?: { expiredAt: number; reason: ExpiryRule }`, next to the existing `state?`. A host that loads
its transcript from a server can hand the marker over with the message, and the runtime treats it as
authoritative: the widget is expired on the first frame, with no read and no effect. This is the path
for SSR and for any host that already stores markers next to messages.

**The asynchronous path.** When the envelope has no `expiry` and the entry has an action-bearing rule
(`interact`, `message`, `navigate`, `event`), the runtime reads the marker through the port
(`getLifecycleRecord`, ADR 0047). `timeout` needs no read: it is computed from `createdAt` and the
clock.

**Fail-closed while loading.** Until that read settles, a widget with an action-bearing rule renders
with `readonly: true` and `data-state` unchanged. It cannot be pressed during the read, which closes
the window in which a reload invites a duplicate. A widget whose rules are all `timeout`, or which has
no rules, does not wait.

**Writing the marker.** When a rule fires, the runtime writes the marker through the port once
(ADR 0047). A `snapshot` render reads and never writes, and fires no effect (ADR 0018, unchanged).

Everything else in ADR 0018 stands: the rule vocabulary, the evaluator's purity, `afterExpiry`
treatments, "disabled, not removed", and `persist: 'ephemeral'` keeping state and marker in memory.

### Consequences

- Good, because the record and the code can finally agree, and D-8 has a defined end.
- Good, because the first frame is defined on every path, including SSR, which ADR 0018 did not
  address at all.
- Good, because injecting the clock removes the one deliberate impurity in core's render path and the
  `eslint-disable` that excused it.
- Bad, because `createdAt` is required. Every host must supply it, and a host whose messages genuinely
  have no time (a hand-built demo) must invent one. The mock layer does this for them.
- Bad, because a fail-closed widget is briefly read-only on reload even when it turns out to be live.
  On a slow port that is a visible flicker from disabled to enabled. That is the cheaper failure: a
  late enable costs a moment, an early enable costs a duplicate turn.
- Neutral, because the envelope's `expiry` field is a second way to deliver the same fact. It exists
  because the asynchronous port cannot serve a server render, not as an alternative for its own sake.

### Confirmation

- `packages/core/src/lifecycle/lifecycle-reload.test.tsx` (new): a `timeout` widget whose deadline
  passed renders expired on the first frame; an `interact` widget **with no lock of its own** is
  read-only after a remount when the port returns a marker; while the port read is pending, the same
  widget renders `readonly`; a `snapshot` remount makes zero calls to `sendUserMessage`,
  `updateWidgetState`, `updateLifecycleRecord` and `onInteraction`.
- `packages/core/src/lifecycle/lifecycle-ssr.test.tsx` (new): `renderToString` then `hydrateRoot` with
  a fixed `now` on both sides, one millisecond either side of a deadline, with no hydration mismatch.
- The conformance kit in `@nerey/core/testing` gains a rule: a widget remounted against a stored
  marker has no enabled control, checked with the selector ADR 0018 already names.
- `npm run check:gates` plants the current implementation (`mountedAt` from mount, no marker) as the
  violator and requires `lifecycle-reload.test.tsx` to fail against it (ADR 0033).
- `npm run check:api-signatures` and `npm run check:public-api` show the new field on `NereyMessage`,
  the new envelope field and the new host member, re-blessed in the implementing commit under the
  pre-release rule in `docs/releasing.md`.

## Pros and Cons of the Options

### Required `createdAt`, marker on the envelope or from the port, fail-closed while loading

- Good, because a deadline is a fact about the message, and this stores it on the message.
- Good, because the envelope path makes SSR deterministic without making the port synchronous.
- Good, because fail-closed turns the race between the read and the click into a non-event.
- Bad, because it adds a required field, a host member and an envelope field in one change.
- Bad, because fail-closed adds a loading frame on reload for widgets with action-bearing rules.

### Optional `createdAt` with a fallback to mount time

The field exists, and a host that omits it gets today's behaviour.

- Good, because it is additive: no host has to change.
- Good, because it could ship after `0.1.0` as a MINOR.
- Bad, because the fallback is exactly the silent degradation ADR 0018 was written against. A host that
  forgets the field gets a widget that looks right in every test that does not reload.
- Bad, because an error for "no anchor" would need a new code in the ADR 0013 taxonomy, and a warning
  would be a `console` call core is not allowed to make.

### Keep mount time and persist the deadline instead of a timestamp

On first mount, compute `mountedAt + ms` and write it through the port; on reload, read it back.

- Good, because `NereyMessage` does not change.
- Bad, because the first mount of an old message (a transcript opened for the first time on a new
  device) still starts the clock at that moment, so a week-old question is live for its full interval.
- Bad, because it writes on mount, which the `snapshot` rule forbids, and it makes `timeout` depend on
  the port, so an ephemeral widget's deadline would restart on every reload.

## More Information

Refines ADR 0018 without changing its decision. The storage shape for the marker is ADR 0047. The
pre-release timing argument is in ADR 0038 and in `docs/releasing.md`. The deviation this closes is
D-8 in `docs/deviations.md`.

Revisit if a host appears whose messages cannot carry a creation time at all. The answer then is an
adapter that stamps one at ingestion, not an optional field.
