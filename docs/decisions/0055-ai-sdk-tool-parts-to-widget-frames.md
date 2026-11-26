---
status: "proposed"
date: 2026-11-26
decision-makers: Yurii Anichkin
---

# 0055. The AI SDK adapter maps one widget tool part to one message, and an answered part is expired

## Context and Problem Statement

ADR 0051 admits `@nerey/ai-sdk` as an adapter package and fixes its dependency rules. It does not say
how the Vercel AI SDK's data model becomes Nerey's. The two do not line up one to one. An AI SDK
`UIMessage` is one assistant turn with many `parts`: text, reasoning, and any number of tool parts
(`tool-<name>` or `dynamic-tool`), each with a `toolCallId` and a `state` that moves through
`input-streaming`, `input-available`, `approval-requested`, `approval-responded`, `output-available`,
`output-error` and `output-denied`. A `NereyMessage` carries at most one widget, and its status is a
separate `WidgetRenderer` prop (ADR 0019).

Four questions follow, and each has a tempting wrong answer. Which tool parts are widgets, and how is
a part's `type@version` known? What is the message's identity and `createdAt` when the SDK keeps no
timestamp? How does a widget's answer reach the SDK? And what does a tool part that has already been
answered look like after a reload, when the persistence port may not have the expiry marker?

## Decision Drivers

- Lookup stays an exact match on `type@version` (ADR 0009). Matching a tool name, or a version that
  "nearly" matches, to an entry is the most common bug in this design.
- What the model is told is derived from the registry (ADR 0040), never retyped.
- A partial payload is never validated, and a complete one is validated once (ADR 0019).
- `createdAt` is set and never moves (ADR 0046).
- An answer goes through `respond` (ADR 0048) to the SDK's own mechanism, so the model sees a tool
  result, not a user message that happens to describe one.
- A tool call has exactly one answer. A widget that can be pressed again after reload sends a second
  answer to a call the model already moved past.

## Considered Options

- One message per widget tool part, binding declared explicitly, answered parts expired
- One message per `UIMessage`, the first widget tool part chosen, the tool name matched to an entry

## Decision Outcome

Chosen option: "One message per widget tool part, binding declared explicitly, answered parts
expired", because it is the only one that keeps the exact match, gives every tool call its own
lifecycle and persistence key, and makes an answered call read-only on reload without depending on
the port.

**Binding.** The consumer declares how tool parts map to widgets, in one of two modes, and nothing
else is a widget:

- `{ mode: 'render-widget' }` — one tool, named `render_widget` by default, whose input is
  `{ type, version, payload }`. The version is in the model's output and is passed through untouched.
- `{ mode: 'tools', tools: { [toolName]: { type, version } } }` — one tool per widget, whose input is
  the payload. The version is required in the table's type.

A tool part with any other name is not a widget and the adapter ignores it. Neither mode strips,
pads or ranges a version; a `"1.0"` against a registered `1.0.0` reaches the registry as `"1.0"` and
falls back as `unknown-widget`.

**Identity.** A widget tool part becomes one `NereyMessage` with `id` and `envelope.correlationId`
both equal to the `toolCallId`. `role` is `assistant`. `text` is the turn's text parts joined, or a
plain sentence naming the widget when the turn has none, so a fallback is always readable.

**Time.** `createdAt` comes from the `UIMessage`'s `metadata.createdAt` (epoch ms, ISO string or
`Date`) when the server attaches it. Otherwise the stateful mapper records the first time it saw the
`UIMessage` id and keeps it, so a stream does not move it. The pure function takes it as an argument.

**Status.** `input-streaming` is `streaming`. `input-available`, `approval-requested`,
`approval-responded`, `output-available` and `output-denied` are `ready`. `output-error` is `error`.
The mapper keeps the envelope object when a part's state and input have not changed, so a re-render
does not validate again.

**Answered parts are expired.** A part in `approval-responded`, `output-available`, `output-error` or
`output-denied` carries an envelope `expiry` marker, `{ expiredAt: createdAt, reason: { on: 'interact' } }`,
whatever the entry's own lifecycle says. The SDK transcript is the record that the call was answered,
so a reloaded transcript renders read-only on the first frame, including on the server, with no read
through the port. `expiredAt` is `createdAt` because the SDK does not record the answer's time and the
marker must be the same on the server and the hydrating client.

**Reply.** `createAiSdkHost({ chat })` implements `respond(correlationId, { action, text, result })`.
For a part in `approval-requested` it calls `chat.addToolApprovalResponse({ id, approved })`, where
`approved` is `result.approved` when that is a boolean and otherwise `action === 'confirm'`. For any
other part it calls `chat.addToolOutput({ tool, toolCallId, output: { action, text, result? } })`,
with `tool` read from the part, never guessed. `sendUserMessage(text)` calls `chat.sendMessage({ text })`.

**Model instructions.** `toolsFromRegistry(registry, { toJsonSchema, binding })`, on the
`@nerey/ai-sdk/server` entry, builds the AI SDK tool set from `describeRegistry` (ADR 0040). The tools
have no `execute`: they are answered in the browser.

### Consequences

- Good, because lookup is exact in both modes and the planted near-miss test can prove it.
- Good, because each tool call gets its own persistence key and lifecycle, which a turn that renders
  two widgets needs.
- Good, because an answered call is read-only after a reload even with the in-memory port.
- Bad, because the binding is one more thing a consumer declares; there is no "just use the tool name".
- Bad, because an expired part ignores an entry that never expires. An entry that wants to stay
  interactive after answering is not a tool call, and should be rendered from a data part instead.
- Neutral, because `expiredAt` is the message time rather than the answer time. Nothing in core reads
  `expiredAt` for anything but presence.

### Confirmation

- `packages/ai-sdk/src/conformance.test.ts` runs `expectAdapterConformance` from `@nerey/core/testing`
  against the adapter in both binding modes, including the planted `"1.0"` near miss.
- `packages/ai-sdk/src/integration.test.tsx` drives `poll` and `confirmation` through a scripted
  stream: streaming, ready, an answer through `addToolOutput` or `addToolApprovalResponse`, and a
  reload that renders read-only.
- `packages/ai-sdk/src/messages.test.ts` covers the status table and the expiry marker per state.
- `npm run check:package-purity` and `npm run check:boundaries` hold the dependency rules of ADR 0051.

## Pros and Cons of the Options

### One message per widget tool part, binding declared explicitly, answered parts expired

- Good, because the exact match, the lifecycle and the reply are all per tool call.
- Bad, because a consumer must declare the binding.

### One message per `UIMessage`, the first widget tool part chosen, the tool name matched to an entry

This is what most AI SDK integrations do: render `tool-<name>` with the component registered under
`<name>`.

- Good, because there is nothing to configure.
- Bad, because a tool name carries no version, so the lookup can only be by type, which is the fuzzy
  match ADR 0009 rules out.
- Bad, because a turn with two widget calls loses one, and both would share one persistence key.
- Bad, because an answered call is only read-only after reload when the port kept the marker.

## More Information

Related: ADR 0009 (exact match), 0019 (streaming status), 0040 (describing the registry), 0046
(`createdAt` and the expiry marker), 0048 (`respond`), 0051 (adapter packages), 0052 (the server
entry). AI SDK 7 is the targeted major (decision O-5); a new AI SDK major is a major of
`@nerey/ai-sdk`, not of core.
