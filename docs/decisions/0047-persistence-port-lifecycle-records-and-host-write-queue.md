---
status: "accepted"
date: 2026-11-19
decision-makers: Yurii Anichkin
---

# 0047. The persistence port stores lifecycle records, and the host owns the write queue

## Context and Problem Statement

ADR 0016 made widget state cross out of `@nerey/core` through an injected `MessagePersistence` port,
with one invariant that matters more than the rest: **the lock is independent of rollback**. A failed
write rolls the value back and reports a `PersistenceError`, and never re-enables a widget whose reply
was already sent. That decision is right and is carried here unchanged.

Two things have appeared since, and both are about the port's edges rather than its middle.

**The lifecycle marker has nowhere to go.** ADR 0018 says expiry is written through the port "in a
reserved namespace alongside, never inside, the widget's own state". ADR 0046 now depends on reading
it back. The port has two methods, both about widget state, so "alongside" can only be done today by
smuggling the marker into `updateWidgetState` under a magic key, which puts Nerey's data inside a
record the author's `stateSchema` validates.

**A write inside the debounce window is dropped on unmount.** `useWidgetState` applies a value
optimistically and persists it after a debounce. When the component unmounts inside that window, the
pending write is cancelled, deliberately: the comment in `use-widget-state.tsx` argues that flushing
from a dead component is an unowned request whose failure nothing can show, and that an immediate
remount (a virtualised transcript does this while scrolling) would race its hydrated value against the
write it left behind. Both arguments are correct about a write owned by the component. Neither holds
for a write owned by something that outlives it. The cost of dropping is real: a user's last choice in
a virtualised list silently disappears on reload.

This record supersedes ADR 0016 so that the port, its lock rule, the lifecycle record and the write
queue are one decision in one place.

## Decision Drivers

- `@nerey/core` performs no I/O and depends on no data library (ADR 0016, 0037). The transport stays
  with the consumer.
- The lock never depends on the outcome of a write (ADR 0016, AC-10). Nothing here may weaken that.
- The widget author's `stateSchema` describes the author's state and nothing else (ADR 0011, 0018).
- A value the user saw on screen should reach storage, including when the widget unmounts.
- A remount must not hydrate a value older than the one it left behind.
- Existing ports must keep working: a consumer who implemented two methods should not have to
  implement four to upgrade.

## Considered Options

- Optional lifecycle methods on the port, and a write queue owned by the host provider
- A reserved key inside `updateWidgetState` for the marker
- Keep dropping the pending write, and record that as the decision

## Decision Outcome

Chosen option: "Optional lifecycle methods on the port, and a write queue owned by the host provider",
because it gives the marker its own channel without touching the author's state, and moves the pending
write to the one owner that outlives the widget, which removes both reasons for dropping it.

**Carried from ADR 0016, unchanged.**

- `MessagePersistence` is an injected port on the host value. Core ships `createInMemoryPersistence()`
  from `@nerey/core/mock`; the consumer supplies the real one (TanStack Query, SWR, a server action,
  `fetch`) in their own code.
- `getWidgetState(conversationId, messageId)` and
  `updateWidgetState(conversationId, messageId, state, { signal? })` keep their current signatures.
  State read back passes through `migrate` (ADR 0030) and then `stateSchema` (ADR 0011).
- `useWidgetState` is optimistic and debounced, isolated per `messageId`, and rolls the value back on a
  rejected write.
- **The lock is independent of rollback.** A rejected write reports a `PersistenceError` through
  `onWidgetError` (ADR 0013) and leaves the widget locked and read-only.
- The port is required on the host value in production. A silently non-persistent default is a worse
  failure than a missing field.

**New: lifecycle records.** The port gains two **optional** methods:

```ts
getLifecycleRecord?(conversationId: string, messageId: string | number): Promise<LifecycleRecord | undefined>;
updateLifecycleRecord?(conversationId: string, messageId: string | number, record: LifecycleRecord): Promise<void>;

type LifecycleRecord = { expiredAt: number; reason: ExpiryRule };
```

They are separate from widget state, so the marker is "alongside, never inside" in the literal sense
ADR 0018 asked for. A port without them still works: the marker then lives in a session-scoped memory
store, which is correct for `persist: 'ephemeral'` and lossy for `persist: 'forever'`. The conformance
kit reports an entry with `persist: 'forever'` and an action-bearing rule, mounted on a port without
these methods, as a configuration error. `createInMemoryPersistence()` implements both.

**New: the host owns the write queue.** Pending debounced writes move from the component into a queue
held by `WidgetHostProvider`, keyed by `conversationId` and `messageId`.

- A widget's write enters the queue. The debounce runs in the queue, not in the component.
- On unmount, a pending write is **flushed through the queue**, not dropped. Its failure goes to
  `onWidgetError` as today; the queue, not the dead component, owns the request.
- A remount of the same `messageId` hydrates from the queue first, then from the port. It sees the
  value it left behind, so there is no race with its own write.
- Two writes for the same key coalesce; the later value wins.

### Consequences

- Good, because the lifecycle marker has a typed home, and ADR 0046's reload path has something to
  read.
- Good, because the user's last visible choice reaches storage in a virtualised transcript.
- Good, because an existing two-method port keeps compiling and keeps working.
- Good, because the lock rule, the most important line in ADR 0016, is restated verbatim and its test
  does not change.
- Bad, because `WidgetHostProvider` gains state. Today it passes its value straight through; after
  this it owns timers and in-flight requests, and its unmount must flush them.
- Bad, because optional methods create two behaviours behind one type. A consumer can implement the
  state half and forget the lifecycle half; the conformance kit catches the dangerous combination, not
  every combination.
- Neutral, because the marker is a schema Nerey now owns in consumers' storage forever. ADR 0018
  already accepted that cost; this record gives it a name and a type.

### Confirmation

- `packages/core/src/state/use-widget-state.test.tsx`: a write inside the debounce window reaches the
  port exactly once after unmount; a remount inside the window hydrates the queued value; a rejected
  flush reports a `PersistenceError` and the widget stays locked.
- `packages/core/src/lifecycle/lifecycle-reload.test.tsx` (ADR 0046): the marker is written through
  `updateLifecycleRecord` once when a rule fires, and read through `getLifecycleRecord` on remount.
- The lock-independence test (AC-10) is unchanged. It passing unchanged is the evidence that this
  record did not move the invariant it inherits.
- `npm run check:core-purity` still bans data libraries from core's manifest and source.
- `npm run check:gates` plants the current drop-on-unmount behaviour as a violator and requires the
  first test above to fail (ADR 0033).
- `npm run check:public-api` and `check:api-signatures` show the two optional members and
  `LifecycleRecord`, re-blessed in the implementing commit.

## Pros and Cons of the Options

### Optional lifecycle methods on the port, and a write queue owned by the host provider

- Good, because it keeps the author's state schema exactly what the author wrote.
- Good, because the owner of a write now outlives the write, which is the precondition for flushing.
- Good, because it is additive at the port: old adapters keep working.
- Bad, because the provider stops being a pass-through.
- Bad, because optional methods give a half-implemented port a way to look complete.

### A reserved key inside `updateWidgetState` for the marker

Store the marker under `messageId + '#lifecycle'`, or as a `__nerey` key in the state record.

- Good, because the port does not change.
- Good, because consumers who store a JSON blob per message get the marker for free.
- Bad, because the marker lands inside a record validated by the author's `stateSchema`, which then
  either rejects it or has to know about it. ADR 0018 rules this out by name.
- Bad, because a reserved key is a collision waiting for one author who picks the same name.

### Keep dropping the pending write, and record that as the decision

Write the existing comment's reasoning into the port's record and change no code.

- Good, because it is honest and free.
- Good, because it keeps the provider stateless.
- Bad, because it loses the user's last choice whenever a virtualised list unmounts a widget inside the
  debounce window, and the user only finds out on reload.
- Bad, because the reasons for dropping are about who owns the write, and that is exactly what can be
  changed.

## More Information

Supersedes ADR 0016. The port, the in-memory implementation and the lock rule are ADR 0016's, carried
forward. The two additions are the lifecycle record (asked for by ADR 0018 and needed by ADR 0046) and
the host-owned write queue (the owner's decision O-3 in the production-ready plan).

ADR 0016 asked to be revisited "if a consumer needs synchronous reads for server-rendered
transcripts". ADR 0046 answers that with the envelope's `state` and `expiry` fields, which the host
fills from its own transcript, so the port stays asynchronous.

Read with ADR 0013 (`PersistenceError`), ADR 0014 (the reply is already sent when a write fails) and
ADR 0018 (the runtime holds `readonly`, so the lock never depends on the state value).
