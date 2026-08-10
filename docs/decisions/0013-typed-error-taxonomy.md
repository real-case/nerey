---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0013. Typed error taxonomy and the onWidgetError diagnostics hook

## Context and Problem Statement

The degradation chain (ADR 0012) makes every widget failure invisible to the end user by design. That is the
right product behaviour and the wrong operational behaviour: an application whose model has started emitting
`poll@1.1` against a registry that only knows `poll@1.0` looks completely healthy while every poll in every
conversation silently renders as text. The only signal that anything is wrong is whatever Nerey reports at
the moment of degradation.

So the diagnostics hook is not a convenience. It is the sole observability surface for a subsystem that is
deliberately failure-tolerant, and its payload has to be good enough to answer the operational questions
directly: which widget type, which version, which message, and which of the four failure classes.

Two further constraints shape it. Nerey runs inside applications with their own telemetry — Sentry, an
OpenTelemetry pipeline, a structured logger — so it must never write to `console` on a consumer's behalf; a
library that logs is a library that pollutes a dashboard someone else pays for. And the error must survive
the boundary between a consumer's copy of the package and any nested copy, which rules out identity checks.

## Decision Drivers

* Four distinct failure classes, each needing a distinct alert: unknown widget, invalid payload, render
  throw, persistence write failure (FR-15).
* Every error must carry enough context to locate the failure without a stack: `type`, `version`,
  `messageId`.
* Consumers must be able to `switch` on the class and have TypeScript prove the switch is exhaustive, so
  adding a fifth class is a compile error rather than a silently unhandled branch.
* No `console` output from any Nerey package, ever.
* Reporting must never affect rendering: a consumer hook that throws must not take down the transcript that
  the degradation chain just rescued.
* Errors must be usable with error-reporting SDKs, which fingerprint real `Error` instances and ignore plain
  objects.

## Considered Options

* A discriminated union of `Error` subclasses tagged with a literal `kind`
* A single `NereyWidgetError` class carrying a `code` string
* Plain data objects with no `Error` in the hierarchy
* Throwing to the nearest boundary instead of a diagnostics callback

## Decision Outcome

Chosen option: "A discriminated union of `Error` subclasses tagged with a literal `kind`", because it is the
only option that gives consumers a compiler-checked exhaustive `switch` while still producing objects an
error-reporting SDK will accept, and the literal tag makes narrowing independent of class identity across
duplicated package copies.

The union is:

```
type NereyWidgetError =
  | UnknownWidgetError    // kind: 'unknown-widget'
  | InvalidPayloadError   // kind: 'invalid-payload'
  | WidgetRenderError     // kind: 'widget-render'
  | PersistenceError      // kind: 'persistence'
```

Every member extends `Error`, sets `name` to its class name, and declares a `readonly kind` literal plus the
shared context fields `type`, `version` and `messageId`. Members add what only they can supply:
`InvalidPayloadError` carries the Standard Schema issue list (ADR 0011) reduced to `{ message, path }`;
`WidgetRenderError` carries the original thrown value as `cause` and the React `componentStack`;
`PersistenceError` carries the failed `operation` (`'read' | 'write'`) and the port's rejection as `cause`.

Consumers narrow on `error.kind`, never on `instanceof`. Narrowing on `instanceof` fails when two copies of
`@nerey/core` end up in one graph — a realistic outcome with transitive installs — and the failure is a
silent fall-through to a `default` branch, which is the worst possible failure mode for the observability
surface. The classes still extend `Error` because Sentry and comparable SDKs discard non-`Error` values and
because a captured stack is the only thing that locates a render throw in consumer code.

`onWidgetError(error)` sits on the host value (FR-16) and defaults to a no-op, so widgets stay unit-testable
with no provider mounted. Core wraps every invocation so that a consumer hook which throws is contained: the
throw is swallowed at that call site and the fallback still renders. This is the one place Nerey discards an
error, and it is deliberate — the alternative is that a broken telemetry integration blanks the transcript
that the degradation chain exists to preserve.

`PersistenceError` is the member that does not originate in the degradation chain. It is emitted by the
persistence port (ADR 0016) and is load-bearing for FR-20: a widget that committed a visual lock and then
failed its state write stays locked and reports, rather than re-enabling and inviting a duplicate reply.

### Consequences

* Good, because a consumer routes all four classes to their own telemetry in one `switch`, and adding a
  fifth class in a future major is a compile error at every call site rather than a silently dropped alert.
* Good, because `kind`-based narrowing is immune to duplicated package instances, unlike `instanceof`.
* Good, because the context fields make the alert actionable without a stack: `unknown-widget` plus
  `poll@1.1` is the whole diagnosis for a version-drift incident.
* Neutral, because the union is exported from the package root, so it participates in the public API
  snapshot and its evolution is governed by semantic versioning (ADR 0029).
* Bad, because subclassing `Error` in TypeScript requires the `Object.setPrototypeOf` incantation in each
  constructor for older downlevel targets, which is boilerplate with no expressive value.
* Bad, because swallowing a throwing `onWidgetError` means a consumer whose telemetry integration is broken
  gets no signal at all from Nerey — the failure is invisible by construction. The tradeoff is accepted
  because the alternative is a blank conversation.
* Bad, because the no-op default means a consumer who never wires the hook operates blind. The documentation
  states this and the mock layer wires a hook by default, but nothing can force it at runtime without
  logging, which is forbidden.

### Confirmation

* `packages/core/src/errors/widget-error.test.ts` asserts, per member: `kind` literal, `name`,
  `instanceof Error`, and that `type`, `version` and `messageId` are populated. A type-level case routes the
  union through an `assertNever` default branch, so removing a member from the `switch` fails
  `npm run typecheck`.
* `packages/core/src/errors/on-widget-error.test.tsx` asserts each of the four degradation steps emits
  exactly one error of the expected `kind` (AC-6), and that a hook implemented as `() => { throw new Error() }`
  still leaves the fallback rendered.
* `packages/core/src/persistence/persistence-error.test.tsx` covers AC-10: a rejected write leaves the
  widget locked, emits `PersistenceError` with `operation: 'write'`, and sends no second reply.
* `no-console` is set to `error` in `@nerey/eslint-config` for `packages/*/src` (ADR 0015, ADR 0005), which
  makes "Nerey never logs on a consumer's behalf" a lint failure rather than a review comment.
* `npm run check:public-api` (`scripts/check-public-api.mjs`) snapshots the exported union and each member's
  field set, so a change to the taxonomy shows up as a reviewable diff tied to a version bump (ADR 0028,
  ADR 0029).
* Per ADR 0033, `check:public-api` self-tests against a fixture that adds a field, and fails if that fixture
  passes.

## Pros and Cons of the Options

### A discriminated union of `Error` subclasses tagged with a literal `kind`

Four classes, one literal tag, shared context fields, narrowing on the tag rather than on identity.

* Good, because exhaustiveness is compiler-checked and the failure mode of forgetting a class is a build
  error.
* Good, because it satisfies error-reporting SDKs, which require real `Error` instances.
* Good, because tag-based narrowing survives duplicated package copies and bundler deduplication failures.
* Neutral, because it is more code than a single class — four constructors instead of one.
* Bad, because subclass boilerplate is unavoidable.
* Bad, because each new member is a breaking change for consumers using exhaustive switches, which is
  correct but does constrain the release cadence.

### A single `NereyWidgetError` class carrying a `code` string

One class, one `code: string` field, consumers compare strings.

* Good, because it is the least code and the simplest thing to document.
* Good, because adding a new code is never a breaking change.
* Neutral, because per-class fields could be modelled as an optional `details: Record<string, unknown>`.
* Bad, because `code: string` gives no exhaustiveness checking, so a new code is silently unhandled — the
  precise failure this taxonomy exists to prevent.
* Bad, because member-specific data (schema issues, component stack, persistence operation) collapses into
  an untyped bag that consumers must cast to use, which conflicts with the no-`any` rule in ADR 0003.
* Bad, because it invites string typos at consumer call sites with no compiler help.

### Plain data objects with no `Error` in the hierarchy

`type NereyWidgetError = { kind: 'unknown-widget'; type: string; ... } | ...`, constructed as object literals.

* Good, because it is the most serialisable representation — structured-cloneable, trivially loggable as
  JSON, no prototype concerns across realms.
* Good, because it avoids all subclassing boilerplate while keeping full exhaustiveness checking.
* Neutral, because a consumer who needs an `Error` can wrap one in a single line.
* Bad, because error-reporting SDKs drop non-`Error` values or report them as an unhelpful "Non-Error
  exception captured", which loses grouping and makes the primary consumption path worse.
* Bad, because there is no stack, so `WidgetRenderError` cannot point at the line in consumer code that
  threw — losing the one piece of information that class exists to deliver.
* Bad, because it reads as unidiomatic to consumers, who expect an argument named `error` to behave like an
  `Error`.

### Throwing to the nearest boundary instead of a diagnostics callback

Core throws the typed error; the consumer catches it in an error boundary and reports from there.

* Good, because it needs no hook on the host value and no default, so the API surface is smaller.
* Good, because it is impossible to ignore — an unhandled failure is loud.
* Neutral, because the same typed union could be thrown rather than passed.
* Bad, because it is incompatible with ADR 0012: the whole point of the chain is that rendering continues,
  and a throw unmounts the subtree it escapes into.
* Bad, because `PersistenceError` originates in an async write with no render frame to throw into, so this
  option cannot express one of the four classes at all.
* Bad, because it makes reporting and recovery the same mechanism, so a consumer cannot report an error
  without also deciding to interrupt rendering.

## More Information

Implements FR-15 and the diagnostics half of FR-16; verified by AC-6 and AC-10. Related records: ADR 0012
defines the four degradation steps that emit the first three members, ADR 0011 defines the issue shape
carried by `InvalidPayloadError`, ADR 0009 defines the resolution miss that produces `UnknownWidgetError`,
ADR 0016 defines the port whose rejection produces `PersistenceError`, ADR 0014 keeps `onInteraction` as the
outbound channel so widgets never report errors themselves, ADR 0015 ships the ESLint config that enforces
the no-`console` rule, and ADR 0019 explains why no error is emitted for a partial payload.
