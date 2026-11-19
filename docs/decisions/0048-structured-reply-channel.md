---
status: "accepted"
date: 2026-11-19
decision-makers: Yurii Anichkin
---

# 0048. The interaction channel carries an optional validated result, and the host may answer a call directly

## Context and Problem Statement

ADR 0014 made `onInteraction(action, { text, meta? })` a widget's only outbound channel. The widget
composes `text`, the host owns sending it, and nothing in core reads `meta`. That holds, and it is the
reason a widget can be rendered and tested with no host at all.

What it cannot express is the shape agent frameworks now use for human-in-the-loop. In the AI SDK a
tool call is answered with `addToolOutput({ toolCallId, output })`; in AG-UI a paused run resumes with
a tool result for a specific call id. In both, the answer is **structured data addressed to a call**,
not a new user turn. Today a widget can only produce a user turn, so a host that wants to answer the
call has to smuggle the call id and the structured value through `meta`, untyped and unvalidated, and
map it back by hand.

That has two costs. The structured value is the one thing in the system the model consumes as data,
and it is the one thing Nerey never validates: payloads are validated inbound (ADR 0011), results are
not validated outbound. And each host invents its own `meta` convention, so an adapter package
(ADR 0051) cannot rely on any of them.

This record supersedes ADR 0014 to add the structured half without giving up the text half.

## Decision Drivers

- `text` stays required and human-readable. It is the last line of degradation (ADR 0012) and the
  agent reads it as the user's own words (CLAUDE.md, ADR 0041).
- A widget stays renderable and testable with no host (ADR 0014, FR-16), so the widget-facing surface
  stays one callback.
- What leaves a widget as data is validated, the same as what enters it (ADR 0011).
- Core speaks neutral words. No SDK vocabulary (`toolCallId`, `addToolOutput`) in core's public types.
- A host that does not care about structured results keeps working with no change.

## Considered Options

- An optional `result` validated by an entry-level `resultSchema`, a correlation id on the envelope,
  and an optional host `respond`
- Keep `meta` as the carrier and document a convention
- Give the widget a `respond()` of its own

## Decision Outcome

Chosen option: "An optional `result` validated by an entry-level `resultSchema`, a correlation id on
the envelope, and an optional host `respond`", because it is the only option that validates the
structured answer, keeps the widget's surface at one callback, and keeps the protocol on the host
side, where ADR 0014 put it.

**Carried from ADR 0014, unchanged.** `onInteraction(action, payload)` is the widget's only outbound
channel. "Only" is literal: no other prop, hook or context member reaches outside the widget's subtree.
State writes go through the persistence port (ADR 0047), failures go to `onWidgetError` (ADR 0013), and
direct I/O is linted out (ADR 0015). `text: string` is required, and the compile-time assertion that
`{ text: 123 }` does not type-check stays. `meta` stays untyped and is never inspected. A widget mounted with
no provider still receives a callable no-op. The host owns optimistic insertion, the thinking
indicator, retry and error copy.

**New: the payload.**

```ts
type WidgetInteractionPayload = { text: string; meta?: Record<string, unknown>; result?: unknown };
```

**New: the entry.** `WidgetRegistryEntry` gains an optional `resultSchema` (Standard Schema v1). When
an interaction carries a `result`, core validates it against `resultSchema` before it leaves. An
invalid `result` is reported as a typed error through `onWidgetError` (a new code in the ADR 0013
union), and the interaction goes out as text only. A `result` on an entry with no `resultSchema` is
dropped the same way: unvalidated structured data does not reach a model.

**New: the envelope.** `NereyWidgetEnvelope` gains `correlationId?: string`. The adapter that turns a
tool call into an envelope puts the call id there. Core treats it as an opaque string.

**New: the host.** `WidgetHostValue` gains `respond?(correlationId, { action, text, result })`. When the
envelope has a `correlationId` and the host has `respond`, core calls `respond` exactly once. Otherwise
it calls `sendUserMessage(text, meta)` exactly as today. `text` travels in both cases, so a host that
answers the call can still show the user what they said.

### Consequences

- Good, because the structured answer to a tool call is validated, typed and addressed, and an adapter
  can rely on one shape instead of a per-host `meta` convention.
- Good, because outbound data now gets the same Standard Schema treatment as inbound data, which
  closes the asymmetry in A2 of the production-ready plan.
- Good, because every existing widget and host keeps working: all three additions are optional.
- Bad, because the outbound path now has a validation step that can fail, and a widget author has a
  new way to be surprised (their `result` was dropped). The typed error says which widget and why.
- Bad, because a host now has two send paths to implement and test.
- Neutral, because `correlationId` is a neutral name for what every SDK calls something else. The
  mapping lives in the adapter.

### Confirmation

- `packages/core/src/render/interaction-contract.test.tsx` (new):
  `// @ts-expect-error` on a payload with `result` and no `text`, and on `{ text: 123 }`; `respond`
  called exactly once when the envelope has a `correlationId` and the host has `respond`, and
  `sendUserMessage` not called; `sendUserMessage` called when either is missing; an invalid `result`
  reports the typed error and sends text only; a `result` on an entry without `resultSchema` is
  dropped and reported.
- `packages/core/src/render/widget-renderer.test.tsx` extended: the outbound schema is called once per
  interaction with a `result`, zero times without one, and never while the widget is streaming.
- `npm run check:public-api` and `check:api-signatures` show the new optional members, re-blessed in
  the implementing commit under the pre-release rule in `docs/releasing.md`.
- `npm run check:gates` plants an implementation that forwards an unvalidated `result` and requires the
  contract test to fail (ADR 0033).

## Pros and Cons of the Options

### An optional `result` validated by an entry-level `resultSchema`, a correlation id on the envelope, and an optional host `respond`

- Good, because it validates the structured answer at the same boundary as the payload.
- Good, because the widget's surface stays one callback and the protocol stays with the host.
- Good, because it is additive and can be adopted per widget.
- Bad, because it adds four members across four types in one change.
- Bad, because a host with `respond` has to decide what to show in the transcript, which `sendUserMessage`
  used to decide for it.

### Keep `meta` as the carrier and document a convention

`meta: { toolCallId, output }`, documented in a recipe.

- Good, because nothing in core changes.
- Good, because it already works in a host that wants it.
- Bad, because `meta` is untyped and unvalidated by design, so the one value the model consumes as data
  is the one value nothing checks.
- Bad, because a convention in a recipe is not a contract, and the adapter packages need a contract.

### Give the widget a `respond()` of its own

A second callback prop, or a hook, through which a widget answers the call directly.

- Good, because a widget that knows it answers a tool call can say so explicitly.
- Bad, because the widget starts driving the protocol: when to answer, whether to also post a turn,
  what to do on failure. ADR 0014 kept that on the host so it is implemented once.
- Bad, because a second outbound channel makes "only outbound channel" false and the conformance kit
  would have to observe two surfaces.

## More Information

Supersedes ADR 0014. The channel, its required `text`, the compile-time narrowing and the host-owned
send are ADR 0014's, carried forward. ADR 0014's note that `cancellable` and `updateStrategy` live on
the registry entry is withdrawn: ADR 0049 removes both fields.

ADR 0014 asked to be revisited "if a widget type genuinely requires a request/response round trip".
Answering a tool call is that case. The answer is still one round trip, addressed by
`correlationId`, not a general request/response channel.

Read with ADR 0011 (Standard Schema), ADR 0012 (text as the last line of degradation), ADR 0013 (the
error union), ADR 0019 (no validation while streaming; this record validates only on interaction) and
ADR 0051 (the adapters that fill `correlationId` and implement `respond`). The security reading of
"text the user did not type" is in ADR 0053.
