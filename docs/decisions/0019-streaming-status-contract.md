---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0019. Streaming status prop mirroring the tool-part state machine

## Context and Problem Statement

A widget's payload arrives by increments. The model streams the tool call's arguments token by token, so
between the first delta and the last one the host holds a syntactically valid but semantically incomplete
object — `{ question: "Which regi" }` where the entry's schema demands a `question` and four `options`.

Two things go wrong if nothing in the contract acknowledges this. Validation (ADR 0011) rejects every
intermediate object, so the degradation chain (ADR 0012) fires step 2 on each delta and the message flickers
between fallback text and widget, while `onWidgetError` (ADR 0013) emits a burst of `InvalidPayloadError`
that means nothing operationally. And the widget itself has no way to distinguish "the payload is still
arriving" from "the payload arrived and this field is genuinely absent", so it cannot render a skeleton
without the host guessing on its behalf.

The AI SDK settled the vocabulary here: a tool part moves through `input-streaming` → `input-available` →
`output-available` → `output-error`. That machine is the right shape, but adopting it verbatim would put an
LLM SDK's versioned enum in Nerey's public types, which ADR 0037 forbids.

## Decision Drivers

* Partial payloads must never reach a schema — FR-12 states this as an explicit non-behaviour, and AC-7
  asserts it.
* A widget must be able to render a loading branch from its own props, without the host inferring intent.
* Core carries no LLM SDK binding and no transport (ADR 0037), so the vocabulary must be Nerey's.
* Reading a required payload field during the incomplete phase should be a type error, not a runtime
  `undefined` — consistent with `noUncheckedIndexedAccess` and the no-`any` rule (ADR 0003).
* A non-streaming host must need zero wiring.

## Considered Options

* A three-state `status` prop, mapped from the tool-part machine by the host adapter
* Mirror the AI SDK's four tool-part states verbatim in Nerey's public types
* No status prop: infer readiness by attempting validation on every payload update

## Decision Outcome

Chosen option: "A three-state `status` prop, mapped from the tool-part machine by the host adapter", because
three states is exactly the number a widget can act on differently, and mapping at the adapter boundary keeps
the AI SDK's vocabulary — and its version cadence — out of Nerey's public types while preserving the state
machine's semantics.

The prop is `status: 'streaming' | 'ready' | 'error'`, and the documented mapping from the four-state machine
is:

| tool-part state    | Nerey `status` |
| ------------------ | -------------- |
| `input-streaming`  | `streaming`    |
| `input-available`  | `ready`        |
| `output-available` | `ready`        |
| `output-error`     | `error`        |

The two terminal input states collapse because they are indistinguishable from inside a widget: in both the
payload is complete and the widget's rendering obligation is identical. What differs between them is the tool
*result*, which core does not own and never sees. Preserving the distinction would force every widget author
to write two branches that must be kept identical.

The load-bearing rule: **partial streamed payloads are never validated.** Validation runs exactly once, when
the part first reaches a terminal input state — that is, on the transition into `ready`. While `status` is
`streaming`, core passes the payload through untouched, step 2 of the degradation chain is suppressed, and
`onWidgetError` receives nothing. A payload that would fail its schema mid-stream renders the widget's
loading branch and produces no diagnostic noise.

The rule is enforced in the type system, not only at runtime. `WidgetProps<P, S, E>` is a discriminated union
on `status`:

```
| { status: 'streaming'; payload: DeepPartial<P>; readonly: boolean; ... }
| { status: 'ready';     payload: P;              readonly: boolean; ... }
| { status: 'error';     payload: DeepPartial<P>; readonly: boolean; ... }
```

so a widget that reads `payload.options[0]` without first narrowing on `status === 'ready'` fails
`npm run typecheck`. The loading branch is not a convention a widget author may forget; under strict
TypeScript it is the only way to compile.

`status` defaults to `'ready'`. A host with no streaming transport — the mock layer, a Storybook story, a
consumer polling a REST endpoint — passes nothing and gets validating, fully-typed behaviour.

`status: 'error'` is the transport's failure, distinct from every member of the taxonomy in ADR 0013: the
model call itself failed, so there is no widget failure to report. Core renders the widget's error branch if
`status: 'error'` is reachable for that entry, and otherwise falls through to the degradation chain's
fallback. It emits no `NereyWidgetError`, because nothing in Nerey went wrong.

`status` is orthogonal to `readonly`. `readonly` is produced by the lifecycle runtime evaluating expiry rules
(ADR 0018); a widget can be `ready` and `readonly`, or `streaming` and not. Conflating them would make an
expired widget indistinguishable from an arriving one.

### Consequences

* Good, because AC-7 becomes structural rather than defensive: there is no code path from a `streaming`
  payload to a schema, so the invariant cannot regress through a refactor.
* Good, because widget authors get a compiler-enforced loading branch, which is the difference between
  skeletons that exist and skeletons that were meant to.
* Good, because Nerey's public types name no SDK. A consumer on the AI SDK writes a four-line mapping in
  their adapter; a consumer on a bespoke transport writes their own, and neither is privileged.
* Neutral, because collapsing `input-available` and `output-available` loses a distinction some consumer may
  eventually want. It is recoverable through the interaction contract's `meta` (ADR 0014) without changing
  `status`.
* Bad, because suppressing validation during `streaming` means a host that never advances the status keeps a
  permanently malformed payload rendering as a skeleton forever, with no diagnostic. Advancing the status is
  the host's responsibility and cannot be verified from inside core.
* Bad, because `DeepPartial<P>` is an approximation: it cannot express that a streamed string is truncated
  rather than absent, so a widget rendering `payload.question` mid-stream may show a partial word. That is
  usually the desired effect and occasionally is not.
* Bad, because the discriminated union makes `WidgetProps` harder to destructure at the top of a component —
  authors must narrow before pulling fields out, which is more ceremony than a flat props object.

### Confirmation

* `packages/core/src/streaming/status-contract.test.tsx` covers AC-7: a payload that fails `payloadSchema`
  rendered at `status: 'streaming'` renders the widget's loading branch, and `onWidgetError` is asserted with
  `toHaveBeenCalledTimes(0)`. A companion case flips the same payload to `ready` and asserts exactly one
  `InvalidPayloadError`, proving the suppression is scoped to the streaming state and not a swallowed error.
* `packages/core/src/streaming/widget-props.types.test.ts` uses `@ts-expect-error` on a read of a required
  payload field without narrowing on `status`, so a regression that widens `payload` to `P` in all three
  branches fails `npm run typecheck` rather than silently permitting unguarded reads.
* `packages/core/src/streaming/validation-count.test.ts` wraps a Standard Schema implementation in a counting
  proxy and asserts `validate` is invoked exactly once across a full `streaming` → `ready` sequence of ten
  payload updates — the direct machine check of "validation runs once, at the terminal input state".
* A CSF 3 story with a play function (ADR 0031) drives the same sequence in the Storybook browser project
  (ADR 0006), so the skeleton-to-widget transition is verified in a real browser and not only in jsdom.
* `npm run check:public-api` (`scripts/check-public-api.mjs`) snapshots the `status` union and the
  `WidgetProps` discriminant, so adding a fourth state is a reviewable diff bound to a version bump
  (ADR 0029).

## Pros and Cons of the Options

### A three-state `status` prop, mapped from the tool-part machine by the host adapter

`'streaming' | 'ready' | 'error'`, defaulting to `'ready'`, discriminating the payload type.

* Good, because the state count matches the number of distinct rendering obligations a widget has.
* Good, because it keeps the LLM SDK out of Nerey's types while keeping its semantics.
* Good, because it makes the never-validate-partials rule enforceable at compile time through the payload
  discriminant.
* Neutral, because the consumer writes a small mapping function; the AI SDK case is four lines and is a
  documented recipe.
* Bad, because the mapping is a place a consumer can get it wrong — mapping `input-streaming` to `ready`
  would reintroduce mid-stream validation errors.
* Bad, because collapsing two terminal states is irreversible in a minor release.

### Mirror the AI SDK's four tool-part states verbatim in Nerey's public types

Export `status: 'input-streaming' | 'input-available' | 'output-available' | 'output-error'`.

* Good, because there is no mapping at all for the largest population of likely consumers, and therefore no
  mapping to get wrong.
* Good, because the vocabulary is already documented and understood outside Nerey.
* Neutral, because the extra state is inert for most widgets, which would branch on two cases regardless.
* Bad, because it puts another project's enum in Nerey's public API. A rename or an added state upstream
  becomes a Nerey breaking change for reasons unrelated to Nerey (ADR 0029).
* Bad, because it contradicts ADR 0037: the type name alone tells a reader that core assumes an LLM SDK, and
  it makes a non-AI-SDK consumer translate into vocabulary that describes machinery they do not have.
* Bad, because `output-available` versus `input-available` invites widget authors to branch on a distinction
  core cannot honour, since core never sees the tool output.

### No status prop: infer readiness by attempting validation on every payload update

Run the schema on each update; treat a passing payload as ready and a failing one as not-yet.

* Good, because it needs no new prop, no adapter mapping and no host cooperation.
* Good, because it is self-correcting: the widget renders the moment the payload is genuinely complete,
  regardless of what any state machine claims.
* Neutral, because validation cost per update is small for the payload sizes in question.
* Bad, because it directly violates FR-12 and fails AC-7 — every partial payload is validated, which is the
  behaviour this record exists to forbid.
* Bad, because a schema with optional fields can pass on a partial payload, so the widget renders as
  complete and then mutates under the user as more deltas arrive.
* Bad, because it cannot distinguish "still arriving" from "arrived and invalid", so the degradation chain
  can never fire step 2 with confidence — a permanently malformed payload is indistinguishable from a slow
  stream, and `InvalidPayloadError` becomes unreportable.
* Bad, because a widget still has no signal for its loading branch, leaving the original problem unsolved.

## More Information

Implements FR-21 and FR-12; verified by AC-7. Related records: ADR 0011 supplies the validation contract this
record schedules, ADR 0012 defines the degradation step suppressed during `streaming`, ADR 0013 defines the
errors that are deliberately not emitted for partial payloads, ADR 0018 owns `readonly` and explains why it
stays orthogonal to `status`, ADR 0030 places migration-on-read before the single validation pass, ADR 0037
records the no-LLM-SDK-binding boundary that rules out the verbatim four-state option, ADR 0003 supplies the
strict settings that make the discriminated union enforceable, and ADR 0031 covers the Storybook workbench
where the transition is exercised in a browser.

Revisit if a consumer produces a concrete case where `input-available` and `output-available` require
different widget rendering; that is the evidence that would justify a fourth state.
