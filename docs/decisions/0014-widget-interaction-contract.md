---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0014. onInteraction is a widget’s only outbound channel

## Context and Problem Statement

A widget rendered inside a transcript has to turn a click into a user turn. The built-in `confirmation`
widget (ADR 0035) has two buttons; pressing one must produce a message the model reads as though the
user had typed it. The open question is which side of the boundary composes that message and which side
performs the send.

Widgets are consumer-authored components resolved from a registry (ADR 0008) and mounted by a host the
consumer owns. The host already holds the conversation identity, the message list, the pending-request
state and the failure copy. Every capability a widget reaches for beyond its own props becomes a
coupling that the extraction out of `osint-chat-client/src/shared/generative-ui/` has to break, and a
reason the widget can no longer be rendered on its own. The scope of this decision is the widget-facing
prop surface: what a widget is handed, and what — if anything — it is allowed to call.

## Decision Drivers

* A widget must render, interact and be asserted on in a unit test or a Storybook story with no host
  provider mounted, so its outbound surface has to arrive as a prop rather than as an ambient
  capability pulled from context.
* Optimistic insertion, the thinking indicator, retry policy and error copy differ per consumer and are
  already implemented once in the host; reproducing them per widget guarantees divergence between
  widgets in the same transcript.
* Both reference implementations converged on a host-mediated reverse contract: the AI SDK's
  `addToolOutput` hands a tool result back to the host, which decides whether to auto-resubmit, and MCP
  Apps routes every widget action to the host as JSON-RPC over `postMessage` rather than letting the
  widget speak to the conversation.
* The narrowing has to hold at compile time. A payload loose enough to accept anything documents
  nothing, and the existing `__tests__/interaction-contract.test.tsx` in the source repository already
  encodes the narrowing as a compile-time assertion worth preserving.
* Widget authors are a wide audience — anyone extending a consumer's catalog. The smaller the surface
  they can misuse, the less review each new widget needs.

## Considered Options

* Single onInteraction callback, host-owned send
* Widgets call sendUserMessage from the host context
* Per-widget callback props on the registry entry

## Decision Outcome

Chosen option: "Single onInteraction callback, host-owned send", because it is the only option that
leaves a widget fully renderable with no host in scope while keeping exactly one place in the system
that knows how a conversation turn is created.

The signature is:

```ts
type InteractionPayload = { text: string; meta?: Record<string, unknown> };
type OnInteraction = (action: string, payload: InteractionPayload) => void;
```

`text` is required and typed `string`. The widget composes it, because only the widget knows what the
pressed control meant — "Yes, delete the export" is a widget-level fact, not a host-level one. The host
receives `(action, payload)` and owns everything downstream: optimistic insertion into the transcript,
the thinking indicator, the call to `sendUserMessage`, error handling and retry. `meta` is deliberately
`Record<string, unknown>`, is never inspected by `@nerey/core`, and is not on the send path — a host may
attach it to its own request envelope or ignore it.

"Only outbound channel" is meant literally: no other prop, hook or context member exposed to a widget
produces an effect outside that widget's own subtree. Widget state writes go through the injected
persistence port (ADR 0016) and address a `messageId`, not the conversation. Failures are reported to
the host's diagnostics hook as typed errors (ADR 0013) and never re-enter as interactions. Direct I/O is
prohibited outright and linted (ADR 0015). Those three records plus this one are what make the word
"only" checkable rather than aspirational.

### Consequences

* Good, because a widget's entire externally visible behaviour is `(action, payload)` tuples, which is
  what makes the conformance kit (FR-38) able to test an arbitrary third-party widget without knowing
  anything about it.
* Good, because swapping the transport, the optimistic-insert strategy or the error UI is a host-side
  edit that touches no widget — the property that lets Nerey ship no transport at all (ADR 0037).
* Good, because a widget mounted without a provider still receives a callable no-op `onInteraction`
  (FR-16), so stories and unit tests never need a wrapper.
* Bad, because a widget cannot run a multi-step protocol on its own — anything past "emit one turn"
  requires the host to send a new widget back down. This is the intended cost; it is also why
  `cancellable` and `updateStrategy` live on the registry entry rather than being negotiated at runtime.
* Bad, because `meta` is an untyped escape hatch that will accumulate consumer-specific keys. It is
  scoped by being invisible to core: nothing in `@nerey/core` branches on its contents, so the drift
  stays in consumer code.
* Neutral, because idempotency is the host's problem. A widget may fire `onInteraction` twice if its own
  lock is misconfigured; the lifecycle runtime (ADR 0018) is what prevents that, not the interaction
  contract.

### Confirmation

`packages/core/src/host/__tests__/interaction-contract.test.tsx` is the fitness function and carries
both halves of the contract.

The compile-time half is a single line:

```ts
// @ts-expect-error text must be a string
onInteraction('reply', { text: 123 });
```

TypeScript reports an unused `@ts-expect-error` directive as an error in its own right, so this line
fails `npm run typecheck` in both directions: it fails if the narrowing is removed and `{ text: 123 }`
starts compiling, and it fails if the call is deleted. Widening `text` to `string | number` or `unknown`
therefore breaks the build rather than silently loosening the published contract.

The runtime half asserts AC-9 directly: `onInteraction('reply', { text: 'hi', meta: { a: 1 } })` calls
the host's `sendUserMessage` exactly once with `'hi'`, and a widget rendered with no provider mounted
still receives a callable `onInteraction`. `npm run check:public-api` locks the exported
`InteractionPayload` declaration in the built `.d.ts`, catching a widening that arrives through a
generic parameter rather than through the literal type.

## Pros and Cons of the Options

### Single onInteraction callback, host-owned send

One prop, one payload shape, host-side dispatch on `action`.

* Good, because the widget's dependency on the outside world is a function reference, which is trivially
  substitutable in tests and stories.
* Good, because the set of things a widget can cause is enumerable by reading one type, which makes the
  no-I/O lint rule (ADR 0015) a complete boundary rather than a partial one.
* Good, because the shape matches the reverse contract of both surveyed reference implementations, so a
  future adapter to either is a host-side mapping and not a widget rewrite.
* Neutral, because `action` is a plain `string` rather than a per-widget union. Typing it per entry would
  add a fourth generic to `defineWidget` (ADR 0008 keeps `<P, S, E>`) for a value the host dispatches on
  dynamically anyway.
* Bad, because the host must map `action` values it does not know about, so an unrecognized action is a
  runtime no-op rather than a compile error.

### Widgets call sendUserMessage from the host context

`useWidgetHost()` already returns `sendUserMessage`; a widget could call it and skip the indirection.

* Good, because there is no extra prop to thread and no dispatch table in the host.
* Good, because the widget can attach anything it wants to the outgoing message without a payload type
  standing in the way.
* Bad, because the outbound surface becomes ambient. Any widget can send at any time, from any effect,
  and reading the widget no longer tells you whether it does — the conformance kit would have to trace
  context consumption instead of inspecting props.
* Bad, because it makes the host's transport verb part of the widget-facing API, which contradicts the
  transport-free core (ADR 0037): swapping how a turn is sent would become a breaking change for every
  widget.
* Bad, because a widget rendered with the safe-default host (FR-16) would either send into a void or
  need a provider in every story, and the failure mode is silent.

### Per-widget callback props on the registry entry

Each entry declares its own handlers — `onConfirm`, `onVote`, `onDismiss` — wired by the consumer at
registration.

* Good, because each handler is precisely typed for its widget, with no `string` action and no `meta`
  bag.
* Good, because the consumer sees exactly which events a widget can raise at the point of registration.
* Neutral, because the generics are expressible; `defineWidget` could carry a handler map without much
  additional machinery.
* Bad, because the host can no longer implement send, optimistic insert and error handling once — the
  wiring is per widget, so every new widget re-derives behaviour that should be uniform across the
  transcript.
* Bad, because generic infrastructure loses its grip: the slot hosts (ADR 0017) and the lifecycle
  runtime (ADR 0018) need to know that "an interaction happened" in order to drive `readonly`, and a
  bespoke handler map gives them no common signal to observe.

## More Information

Implements FR-17 and is verified by AC-9. The compile-time assertion is carried over from
`__tests__/interaction-contract.test.tsx` in the extraction source, which already encodes the narrowing
this record makes normative.

Reads together with ADR 0015 (a widget may not bypass the channel with direct I/O), ADR 0016 (state
writes travel a separate port, and a failed write must not re-enable a widget that has already emitted
an interaction), ADR 0018 (an interaction is the event that can expire a widget and flip it to
read-only), ADR 0019 (`status` is the inbound counterpart to this outbound channel) and ADR 0037 (no
transport in core, which only holds because sending is host-owned).

Revisit if a widget type genuinely requires a request/response round trip that cannot be modelled as
"emit a turn, receive a new widget" — an autocomplete inside an input-slot widget is the plausible
candidate. That would be a new port alongside persistence, not a widening of this payload.
