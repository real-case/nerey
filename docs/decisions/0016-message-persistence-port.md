---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0016. MessagePersistence as an injected port

## Context and Problem Statement

An interactive widget carries state that has to outlive the render: which option a user picked, whether
a confirmation was answered, what the terminal snapshot should show on reload (FR-24). That state lives
next to the message on the server, keyed by `messageId`, and the widget needs to read it back when the
transcript is re-rendered.

In the extraction source this is wired to TanStack Query: `useWidgetState` calls a mutation, the Query
cache holds the optimistic value, and rollback is Query's. That is a working design and the wrong
dependency for a library — it forces every consumer onto one cache implementation, and pulls a
peer-dependency negotiation into a package whose only declared peer is React (FR-4). The decision here
is how widget state crosses the boundary out of `@nerey/core`, and what happens when the crossing fails
after a reply has already been sent.

## Decision Drivers

* `@nerey/core` may depend on nothing but React. TanStack Query, SWR, a fetch wrapper and a consumer's
  own server actions are all legitimate transports for the same operation.
* `useWidgetState(messageId, initial)` must keep its behaviour — optimistic update, debounced write,
  rollback on failure, per-`messageId` isolation (FR-19) — regardless of which transport is underneath.
* A failed write must never re-enable a widget that has already emitted an interaction. Rollback of the
  *value* and release of the *lock* are different questions, and conflating them invites a duplicate
  reply into the conversation (FR-20).
* Widgets must be demonstrable with no backend at all, in Storybook (ADR 0031) and in tests (ADR 0006),
  which requires a real implementation in the box rather than a mock the consumer writes.
* Persisted state is read back across deploys, so the read path has to tolerate old shapes rather than
  assume the current schema.

## Considered Options

* MessagePersistence as an injected port
* Core depends on TanStack Query and ships the cache-backed implementation
* No persistence in core; widgets own their own state

## Decision Outcome

Chosen option: "MessagePersistence as an injected port", because it is the only option that keeps
`useWidgetState` in core — with its optimistic, debounce and lock semantics tested once — while leaving
the transport entirely to the consumer.

The port is two methods, supplied on the host value (FR-16):

```ts
interface MessagePersistence {
  getWidgetState(conversationId: string, messageId: string): Promise<unknown>;
  updateWidgetState(conversationId: string, messageId: string, state: unknown): Promise<void>;
}
```

`state` is `unknown` at the port and is validated on the way in through the entry's `stateSchema`
(ADR 0011), with `migrate` applied first when the stored shape predates the registered version
(ADR 0030). Core ships `createInMemoryPersistence()` from `@nerey/core/mock` (ADR 0028 governs the
subpath), which is what makes AC-21 possible: a widget authored against the mock layer alone renders,
interacts and persists with no network. Consumers supply the real implementation — a TanStack Query
mutation, an SWR mutation, a server action, a plain `fetch` — and it stays in consumer code.

**The lock is independent of rollback.** Once `onInteraction` has fired and the reply is on its way
(ADR 0014), the widget's visual lock is committed. If `updateWidgetState` then rejects, `useWidgetState`
rolls the optimistic *value* back to its last persisted state and reports a `PersistenceError` through
`onWidgetError` (ADR 0013) — and leaves the widget locked and read-only. It must never re-enable. A
re-enabled control after a failed write reads to the user as "that did not go through, try again", when
in fact the turn was already sent; the second press produces a duplicate reply in the transcript and a
second model turn. Losing a state write is recoverable and visible; sending the same answer twice is
neither.

### Consequences

* Good, because `@nerey/core`'s dependency list stays at `react@^19`, which is the precondition for
  AC-1 and for the package being adoptable by a consumer on any data layer.
* Good, because the interesting logic — debounce window, optimistic apply, rollback, per-`messageId`
  isolation, lock retention — is written and tested once in core rather than reimplemented per consumer.
* Good, because the in-memory implementation makes the mock layer (FR-37) a first-class development
  path, not a testing afterthought.
* Bad, because the port is `Promise`-based and therefore hides whatever caching the consumer has. Core
  cannot deduplicate concurrent reads across widgets or participate in the consumer's invalidation; a
  consumer wiring Query must invalidate their own keys after `updateWidgetState` resolves.
* Bad, because a consumer can supply an implementation that silently succeeds without writing anything,
  and core has no way to tell. The conformance kit tests widgets, not the consumer's port.
* Neutral, because `unknown` at the port boundary means the consumer's implementation cannot type the
  payload it stores. This is deliberate: the type is per widget entry and known only to core's caller
  after schema validation.

### Confirmation

Two test files carry this record, plus one packaging gate.

`packages/core/src/persistence/__tests__/lock-independence.test.tsx` is the AC-10 fitness function. It
renders the `confirmation` widget with a persistence stub whose `updateWidgetState` rejects, fires the
submit, then asserts all four properties together: the root node still carries `data-state="locked"` and
`data-readonly`, the control is disabled, `sendUserMessage` was called exactly once across a second
attempted press, and `onWidgetError` received a `PersistenceError` carrying `type`, `version` and
`messageId`. A regression that releases the lock on rejection fails on the fourth assertion — the
duplicate send — not merely on an attribute.

`packages/core/src/persistence/__tests__/use-widget-state.test.tsx` covers the rest of FR-19: optimistic
value applied before the promise settles, writes coalesced within the debounce window, value rolled back
on rejection, and two widget instances in one conversation persisting and restoring independently by
`messageId` (AC-11).

`npm run check:core-purity` asserts the negative half — that the packed `@nerey/core` tarball's resolved
dependency closure contains no data-fetching library (`@tanstack/react-query`, `swr`, `axios`, `ky`) —
so the port cannot be quietly re-coupled by an implementation landing inside core. `npm run test:coverage`
holds these files to the merged threshold of ADR 0007.

## Pros and Cons of the Options

### MessagePersistence as an injected port

Two async methods on the host value; in-memory implementation shipped, real one supplied by the
consumer.

* Good, because it is the smallest interface that satisfies every known transport, and small interfaces
  are the ones consumers actually implement correctly.
* Good, because it composes with the rest of the host contract — persistence, `renderFallback` and
  `onWidgetError` are all injected on the same value, so there is one place a consumer configures Nerey.
* Good, because the in-memory implementation doubles as the reference: a consumer reads forty lines to
  learn what their adapter has to do.
* Neutral, because it adds one required field to the host value. A default in-memory instance would make
  it optional, and is deliberately not the default in production — silently non-persistent widget state
  is a worse failure than a missing-field error.
* Bad, because errors from the consumer's transport arrive as opaque rejections, so `PersistenceError`
  carries the original as `cause` rather than a classified reason.

### Core depends on TanStack Query and ships the cache-backed implementation

Carry the extraction source forward as-is: `useWidgetState` built on `useMutation` and the Query cache.

* Good, because it is already written, already correct, and already proven by the shipped poll widget.
* Good, because Query supplies optimistic update, rollback, retry and request deduplication, so core
  writes none of that logic itself.
* Good, because a consumer already on Query gets cache coherence between widget state and the rest of
  their application for free.
* Bad, because it makes a large peer dependency mandatory and version-coupled: a consumer on SWR, on
  server actions, or on Query v6 while core targets v5 cannot adopt `@nerey/core` at all. That is
  precisely the adoptability failure ADR 0037 exists to prevent.
* Bad, because it requires a `QueryClientProvider` above every Nerey story and every unit test,
  contradicting the "renderable with no host mounted" property of FR-16.

### No persistence in core; widgets own their own state

Ship no `useWidgetState`; each widget takes an initial state prop and a state-change callback, and the
consumer wires storage.

* Good, because core's surface shrinks and there is no port to specify, document or version.
* Good, because a consumer with unusual requirements — CRDT-backed state, no persistence at all — is not
  fighting a built-in abstraction.
* Neutral, because the callback shape would end up looking much like the port anyway, just declared per
  widget rather than once.
* Bad, because the lock-independent-of-rollback invariant would be re-decided by every consumer, and
  most would get it wrong in the direction that produces duplicate replies — the single most damaging
  failure this subsystem has.
* Bad, because the lifecycle runtime (ADR 0018) needs to read persisted state to render an
  `afterExpiry: 'snapshot'` widget on reload without re-firing effects; with no port it has nothing to
  read from.

## More Information

Implements FR-19 and FR-20; verified by AC-10, AC-11 and, through the mock implementation, AC-21.

The lock-independence rule is the resolution of a concrete production incident pattern in the extraction
source: a rolled-back optimistic state re-enabled a poll's options after the vote had already been sent.
Read it with ADR 0014 (the reply is already gone by the time the write fails), ADR 0018 (the lifecycle
runtime is what holds `readonly`, so the lock does not depend on the state value at all) and ADR 0013
(`PersistenceError` is a member of the typed union, so a consumer can surface a retry affordance
themselves without core inventing one).

State read back from the port passes through `migrate` before validation (ADR 0030), which is what keeps
an old persisted shape from degrading a historical message to the fallback renderer (ADR 0012).

Revisit if a consumer needs synchronous reads for server-rendered transcripts. That would mean a second,
optional synchronous method on the port rather than changing the asynchronous one.
