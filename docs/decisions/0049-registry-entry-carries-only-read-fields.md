---
status: "accepted"
date: 2026-11-19
decision-makers: Yurii Anichkin
---

# 0049. A registry entry declares only fields the runtime reads

## Context and Problem Statement

`WidgetRegistryEntry` has three optional fields that nothing reads: `reducer`, `updateStrategy` and
`cancellable` (`packages/core/src/types.ts`). They came from FR-9 in `docs/requirements.md`, which
lists them as part of the entry. No module in `@nerey/core` consults them. The only references outside
the type are two tests asserting that the built-in widgets leave `reducer` undefined.

A field on a public type is a promise. A widget author who sets `updateStrategy: 'pessimistic'` will
reasonably expect writes to wait for the server, and gets optimistic writes. One who sets
`cancellable: false` expects something to stop a cancel, and nothing does. `reducer` is typed
`(previous, event) => State`, and no host ever dispatches a widget event, so the function is never
called. This is the same shape of defect as D-8: a declared behaviour with no implementation, which
every gate of form passes.

Nothing has been published yet. Today, removing them is free. After `0.1.0`, removing a member of a
public type is a declared break (ADR 0038), while adding a field later is additive. The asymmetry
decides the timing.

## Decision Drivers

- A published field must do what its name says, or not exist.
- Removing a public member after the first publish costs a declared break; adding one costs a MINOR.
- `updateStrategy: 'pessimistic'` collides with the lock rule (ADR 0047): a pessimistic write that
  fails has to decide whether to unlock, and that decision needs its own record.
- `reducer` needs an event source. The host contract has none, so implementing it means designing one.
- The type parameter `Event` on `WidgetRegistryEntry<Payload, State, Event>` exists only for `reducer`.

## Considered Options

- Remove all three before `0.1.0`, and add a gate that every entry field is read
- Implement all three now
- Keep them and mark them reserved in their doc comments

## Decision Outcome

Chosen option: "Remove all three before `0.1.0`, and add a gate that every entry field is read",
because it is the only option that leaves the published type true, costs nothing now, and stops the
same defect from returning.

- `reducer`, `updateStrategy` and `cancellable` are removed from `WidgetRegistryEntry`.
- The `Event` type parameter goes with `reducer`. The entry becomes
  `WidgetRegistryEntry<Payload, State>`, and `defineWidget` and `AnyWidgetRegistryEntry` follow.
- FR-9 in `docs/requirements.md` is amended to the fields that remain, citing this record.
- Each field can come back, as an addition, when there is a consumer who asked for it and a record
  that decides its semantics. `pessimistic` in particular needs a record that says what a failed
  pessimistic write does to the lock.
- A new gate, `check:entry-fields`, makes "declared means read" a machine check rather than a review
  habit.

### Consequences

- Good, because every field on the entry does something, and an author can trust the type.
- Good, because the gate is the first in this repository that checks "declared, therefore executed"
  rather than shape. It would have caught these three.
- Good, because removing `Event` simplifies the most-used generic signature in the package.
- Bad, because if a consumer later needs pessimistic writes, they wait for a record and a MINOR
  instead of finding the field already there. That is the intended trade.
- Neutral, because the gate reads the type through the TypeScript checker, the same way
  `check:api-signatures` does, so it inherits that script's dependence on the compiler's rendering.

### Confirmation

- `npm run check:entry-fields` (`scripts/check-entry-fields.mjs`, new): lists every property of
  `WidgetRegistryEntry` through the TypeScript checker and requires each to be read (a property access
  or destructuring) in at least one non-test module under `packages/core/src`. It fails naming the
  field and the record.
- Its `--self-test` plants a fixture entry type with a field no module reads and requires the gate to
  fail; it is registered in `check:gates` and run by `check:all` (ADR 0033).
- `npm run check:public-api` and `check:api-signatures` show the removed members and the changed
  generic arity, re-blessed in the implementing commit under the pre-release rule in
  `docs/releasing.md`.
- `npm run typecheck` fails on any remaining reference to the removed fields, including the two tests
  that assert `reducer` is undefined, which are deleted with the field.

## Pros and Cons of the Options

### Remove all three before `0.1.0`, and add a gate that every entry field is read

- Good, because it is free now and expensive later.
- Good, because the gate generalises: any future dead field fails the same way.
- Bad, because it changes a generic signature, which every typed `defineWidget` call site sees.
- Bad, because it reverses part of FR-9, which someone wrote on purpose.

### Implement all three now

- Good, because FR-9 stays as written.
- Bad, because it is three new semantics with no consumer asking for them, designed without one.
- Bad, because `reducer` needs a widget event source in the host contract, which is a new port, and
  `pessimistic` needs a new answer to the lock question. Neither is small, and neither has a record.

### Keep them and mark them reserved in their doc comments

- Good, because nothing changes and nothing breaks.
- Bad, because a doc comment does not stop a setter, and `'pessimistic'` will be set by someone who
  did not read it.
- Bad, because after `0.1.0` the fields become permanent, and "reserved" becomes a promise to
  implement them with the semantics the names suggest.

## More Information

The owner's decision O-1 in the production-ready plan. Related: ADR 0008 (the registry), ADR 0014 and
0048 (ADR 0014 mentioned `cancellable` and `updateStrategy` as living on the entry; ADR 0048 withdraws
that), ADR 0038 (why the timing is before the first publish) and D-8 (the same class of defect in the
lifecycle runtime).
