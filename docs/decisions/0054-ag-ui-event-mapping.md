---
status: "proposed"
date: 2026-11-26
decision-makers: Yurii Anichkin
---

# 0054. The AG-UI adapter folds the event stream into one message per widget tool call

## Context and Problem Statement

ADR 0051 makes `@nerey/ag-ui` a package of its own and fixes what it may depend on. It does not say
how the adapter maps the protocol onto core's contracts, and AG-UI 1.0 differs from core's model in
four places where a mapping has to be chosen rather than copied:

1. An AG-UI assistant message can hold text and several tool calls. A `NereyMessage` holds at most
   one widget (ADR 0008).
2. A tool call arrives as `TOOL_CALL_START`, any number of `TOOL_CALL_ARGS` string fragments and a
   `TOOL_CALL_END`. Nothing in the stream says which tool name means which `type@version`.
3. The protocol has one built-in notion of expiry: `Interrupt.expiresAt`, an ISO 8601 string on a
   `RUN_FINISHED` interrupt outcome. Core's lifecycle runs on registry rules and a handed-over
   `LifecycleRecord` (ADR 0018, 0046).
4. A reload replays the conversation as a `MESSAGES_SNAPSHOT`, which carries no event timestamps and
   no widget state. A widget the user already answered must still come back read-only on the first
   frame, and a `timeout` deadline must not restart (ADR 0046).

The question is how the adapter represents tool calls, chooses `type@version`, expires widgets and
rehydrates a transcript, without adding anything to core.

## Decision Drivers

- `type@version` is an exact match decided by the registry, never by the adapter (ADR 0009). An
  adapter that maps a tool name or `"1.0"` onto a registered `1.0.0` repeats the bug ADR 0009
  exists to prevent.
- A partial payload is never validated, and the complete one is validated once (ADR 0019).
- The answer to a tool call goes back through the protocol's own mechanism for that call (ADR 0048).
- `createdAt` is stable across reloads (ADR 0046).
- No change to `@nerey/core` is needed for any of this. A sibling adapter (`@nerey/ai-sdk`) is built
  in parallel, and core changes made for one protocol would be imposed on the other.

## Considered Options

- One `NereyMessage` per widget tool call, keyed by `toolCallId`, folded by a deterministic reducer
- One `NereyMessage` per AG-UI message, with the first widget call as its envelope
- Delegate to `@ag-ui/client`'s own message state (`agent.messages`) and map each snapshot

## Decision Outcome

Chosen option: "One `NereyMessage` per widget tool call, keyed by `toolCallId`, folded by a deterministic
reducer", because it is the only option in which every widget call has a stable identity of its
own for persistence and lifecycle, and it keeps the adapter free of `@ag-ui/client` and its RxJS
dependency.

**Messages.** The adapter folds events into a transcript and projects it as
`{ message: NereyMessage; status: WidgetStatus }` frames, which is exactly what `WidgetRenderer`
takes. Text messages become text frames keyed by their AG-UI id. Each widget tool call becomes its
own frame with `id = toolCallId` and `envelope.correlationId = toolCallId`. A tool call that is not
a widget call produces no frame: it belongs to a backend or frontend tool the consumer handles.

**Choosing `type@version`.** Two bindings, both explicit:

- a single generic tool (default name `render_widget`) whose arguments are
  `{ type, version, payload }`, with the version as the model wrote it;
- a table `toolName → { type, version }`, where the version is required by the type.

The adapter never consults the registry to resolve a call. `toolsFromRegistry` derives the tool
definitions from `describeRegistry` (ADR 0040), and throws when a table row names a `type@version`
the registry does not hold, so a wiring mistake fails at startup rather than as a silent fallback.

**Streaming.** Argument fragments are concatenated per `toolCallId` and parsed with a tolerant
partial-JSON reader; the frame is `streaming` until `TOOL_CALL_END`, then `ready` with one strict
parse. Under the generic tool, no frame is emitted until `type` and `version` are both complete
strings, because a truncated `"1."` would otherwise be rendered as an unknown widget. Arguments that
are not JSON at the end give status `error` with no payload, which core reports as
`invalid-payload`. Frames are memoised per call, so an unrelated event does not hand the renderer a
new envelope and re-run validation.

**Answering.** `respond` appends a `role: "tool"` message with the call's `toolCallId`, whose content
is the JSON of `{ action, text, result? }`. When a `RUN_FINISHED` interrupt outcome named that call,
the same answer goes out as a `ResumeEntry` (`status: "resolved"`). The adapter runs the agent once
every widget call after the last user message is answered; a user message typed while interrupts
are open cancels them (`status: "cancelled"`), because the protocol requires the next run to
address every open interrupt.

**Expiry.** An answered call is expired: its envelope carries `expiry = { expiredAt, reason: { on:
'interact' } }`, because a tool call has exactly one answer and a second one is a protocol error.
An unanswered call whose interrupt `expiresAt` has passed carries `expiry = { expiredAt, reason:
{ on: 'timeout', ms } }`. A deadline still in the future is scheduled by the React hook, which
re-projects at that instant. Both use only `NereyWidgetEnvelope.expiry`, which core already reads
as authoritative (ADR 0046).

**Time.** `createdAt` is taken, first match wins, from `metadata.nerey.createdAt` on the message or
the tool call, from the value an earlier event already gave the same id, from the event's
`timestamp`, and last from the injected clock at arrival. The adapter writes
`metadata.nerey.respondedAt` on the tool messages it creates, so an answered call rehydrates with the
time it was answered.

**Rehydration.** `MESSAGES_SNAPSHOT` rebuilds the transcript: assistant `toolCalls` become ended
calls, tool messages mark their calls answered. Messages the host added locally and the snapshot
does not yet contain are kept after it. Widget state is not carried by the protocol, and core reads
it from the envelope rather than from the port, so `hydrateWidgetStates` reads each widget call's
state through `MessagePersistence.getWidgetState` and hands it to the transcript, which puts it in
the envelope. It runs before the transcript is rendered, because a widget reads its state once, at
mount. Mirroring state into `STATE_DELTA` is out of scope.

### Consequences

- Good, because persistence and lifecycle are keyed on `toolCallId`, which the protocol already
  guarantees unique and stable.
- Good, because an answered widget is read-only on the first frame after a reload, with no read
  through the persistence port.
- Good, because the adapter depends on `@ag-ui/core` alone, whose main entry has no dependencies.
- Bad, because text and the widgets of one AG-UI assistant message render as separate transcript
  rows; a consumer who wants them grouped groups by `parentMessageId` themselves.
- Bad, because a producer that sends neither `timestamp` nor `metadata.nerey.createdAt` leaves the
  adapter to stamp arrival time, so a `timeout` rule restarts after a reload for that producer. The
  adapter's README says so.

### Confirmation

- `packages/ag-ui/src/transcript.test.ts` covers the reducer: fragment accumulation, no frame before
  `type` and `version` are complete, `error` on non-JSON arguments, answered-is-expired,
  `expiresAt` in the past and the future, snapshot rehydration and `createdAt` precedence.
- `packages/ag-ui/src/conformance.test.tsx` runs `checkAdapterConformance` from
  `@nerey/core/testing`, which plants `"1.0"` against a registered `1.0.0` and counts validations.
- `packages/ag-ui/src/integration.test.tsx` drives `poll` and `confirmation` through stream, ready,
  answer and reload on a scripted event feed, with no network and no model.
- `npm run check:package-purity` keeps `@nerey/ag-ui`'s `dependencies` empty and its peers to
  `@nerey/core`, `react`, `react-dom` and `@ag-ui/core` (ADR 0051).

## Pros and Cons of the Options

### One `NereyMessage` per widget tool call, keyed by `toolCallId`, folded by a deterministic reducer

- Good, because every widget has its own id, envelope and lifecycle.
- Good, because the reducer is a deterministic function of the events and an injected clock, so a scripted feed tests it fully.
- Bad, because the adapter re-implements the part of `@ag-ui/client`'s event application it needs.

### One `NereyMessage` per AG-UI message, with the first widget call as its envelope

- Good, because the transcript has the same rows as the protocol.
- Bad, because a second widget call in the same message is dropped or needs a core change to
  `NereyMessage`, which ADR 0008 keeps at one envelope.
- Bad, because persistence keyed on the message id merges the state of two widgets.

### Delegate to `@ag-ui/client`'s own message state (`agent.messages`) and map each snapshot

- Good, because event application is the client's, already tested upstream.
- Bad, because `agent.messages` holds argument strings, not partial parses or stream status, so the
  adapter still has to track streaming per call.
- Bad, because `@ag-ui/client` brings RxJS, `uuid` and four more packages into every consumer's
  install as a peer, for an adapter that needs types and one enum.

## More Information

Related: ADR 0008 (the envelope), ADR 0009 (exact match), ADR 0019 (streaming status), ADR 0040
(`describeRegistry`), ADR 0046 (time anchor and handed-over marker), ADR 0047 (persistence port),
ADR 0048 (`respond`), ADR 0051 (adapter packages). Built against `@ag-ui/core` 1.0.5 (protocol
version 1.0). The owner's decision O-5 defers a CopilotKit v2 recipe until v2 is stable.
