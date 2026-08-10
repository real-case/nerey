---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0008. Registry-based generative UI: the model parameterises pre-declared widgets

## Context and Problem Statement

Nerey renders interface elements chosen by a language model inside a chat transcript. Every other decision in the library depends on one prior answer: what actually crosses the boundary from model output to the DOM? There are two families of answer. Either the model produces the interface — markup, JSX, a component definition, a style block — and the client evaluates it; or the model produces a *reference plus data*, and the client runs code it wrote, reviewed, tested and shipped itself.

Three systems solved this independently between 2024 and 2026 and landed on the same shape. MCP Apps declares UI as `ui://` resource templates that the host resolves against resources the host already holds, with a normative SHOULD for text-only fallback (SEP-1865, ratified 2026-01-26). Google's A2UI hands the agent a client-owned catalog of pre-approved components that the agent may reference but cannot extend. The Vercel AI SDK binds a tool name to a React component at the call site, so a tool result arrives as props to a component that was in the bundle before the conversation started. Three ecosystems, three threat models, one architecture.

The scope of this record is the message → widget boundary: what a `NereyMessage.widget` may contain, and what the renderer is permitted to do with it. It does not cover how a widget is looked up (ADR 0009), how registries are assembled (ADR 0010), or what happens when lookup fails (ADR 0012).

## Decision Drivers

* The model is an untrusted input source. Its output is influenced by retrieved documents, tool results and user text, all of which an attacker can reach. Any path from model output to evaluated code is a cross-site scripting primitive that runs with the user's session.
* Widget code must be reviewable the same way as every other line in the repo — in a pull request, under TypeScript strict mode (ADR 0003), under tests and the coverage gate (ADR 0007).
* End-to-end generic inference. `defineWidget` must preserve `<P, S, E>` so that `payload`, `state` and reducer events are inferred rather than asserted (FR-8). Inference requires a component that exists at compile time.
* Deterministic degradation. The four-step chain in ADR 0012 can only be exhaustive over a closed set of failure modes; "the generated code was subtly wrong" is not a closed set.
* Testability with no model in the loop. Fixtures, the mock layer (FR-37) and Storybook (ADR 0031) all presuppose that a widget is addressable by a stable identifier and a data shape.
* The lifecycle runtime (ADR 0018), placement model (ADR 0017) and styling contract (ADR 0020) each need a per-widget declaration to hang off. There is nowhere to declare `expiry` or `placement` for a component that did not exist a second ago.
* `@nerey/core` ships no transport, no LLM SDK binding and no markdown renderer (ADR 0037). Any option requiring an interpreter, a compiler or a sandbox host contradicts that boundary.

## Considered Options

* Registry-based parameterisation
* Free-form UI code generation
* Sandboxed iframe with a `postMessage` bridge
* Model-composed primitive tree

## Decision Outcome

Chosen option: "Registry-based parameterisation", because it is the only option in which no model-produced byte ever becomes executable, and it is simultaneously the option that MCP Apps, A2UI and the Vercel AI SDK each arrived at from different starting points. The model emits `{ type, version, payload }` and the client owns the component; the registry, not the renderer, is therefore the load-bearing abstraction and the thing worth packaging.

Concretely: a message carries a widget envelope of exactly three fields — `type`, `version`, `payload`. The renderer resolves `type@version` against an immutable registry (ADR 0009, ADR 0010), validates `payload` against the entry's Standard Schema (ADR 0011), and renders the entry's `component`. There is no field in the envelope that carries markup, code, a template, a style rule or a component reference, and no code path that evaluates a string. If resolution or validation fails, the message degrades to text (ADR 0012) and emits a typed error (ADR 0013).

### Consequences

* Good, because the attack surface from prompt injection collapses to data. The worst an attacker who fully controls model output can achieve is to render a widget the client already approved, with attacker-chosen values in it — not to execute script, not to exfiltrate via an injected `<img src>`, not to reach the DOM outside a node Nerey owns.
* Good, because the schema does double duty exactly as the reference implementations use it: prompt-side constraint that tells the model what a valid payload looks like, and runtime validation at the boundary (FR-11).
* Good, because widgets are ordinary React components. They are storybook-able, unit-testable, profilable and type-checked, and they participate in the React Compiler's assumptions rather than defeating them.
* Good, because the failure modes are enumerable, which is what makes ADR 0012's chain a specification rather than a hope.
* Bad, because the catalog is a hard ceiling. The model cannot produce a UI nobody anticipated; every new interface is a code change, a release and a version bump (ADR 0029). This is the cost of the security property and is accepted, not regretted.
* Bad, because payload authority remains real. A `confirmation` widget whose prompt text is attacker-chosen is a social-engineering vector even though it is not an XSS vector. The mitigations are that a widget's only outbound channel is `onInteraction` (ADR 0014) and that widgets perform no I/O (ADR 0015) — the widget can ask the user something misleading, but it cannot act on the answer itself.
* Neutral, because it commits Nerey to a catalog-curation problem instead of a code-generation problem: dead registrations accumulate as widgets are retired, which is tracked as an open question rather than solved in v1.

### Confirmation

Four automated gates, all wired into `npm run check:all` or `npm run test`:

1. `packages/core/src/registry/__tests__/widget-envelope.contract.test.ts` — asserts the parsed envelope surface is exactly `{ type, version, payload }`, and that an envelope carrying `html`, `code`, `template`, `component` or `__html` keys is rejected before any render occurs, emitting `InvalidPayloadError` (ADR 0013).
2. ESLint, via `@nerey/eslint-config` (ADR 0005, ADR 0015): `no-eval`, `no-implied-eval`, `no-new-func` and `react/no-danger` at `error` across `packages/**`. A renderer or widget cannot open an evaluation path without failing lint. `dangerouslySetInnerHTML` has no legitimate use in this library, so the rule carries no allowlist.
3. `npm run check:public-api` — the exported API snapshot. No export may appear that accepts markup, a component factory or a source string derived from message data without the snapshot diff surfacing in review.
4. `npm run check:gates` (ADR 0033) plants a deliberate violator against each of the above — an envelope with an `html` field, a `new Function` call, a smuggled export — and fails if any gate lets it through, so the gates themselves are tested rather than trusted.

## Pros and Cons of the Options

### Registry-based parameterisation

The model emits `{ type: 'confirmation', version: '1.0', payload: { /* validated fields */ } }`. The client resolves that key against a registry built at composition time and renders a component from its own bundle.

* Good, because no model output is ever executed; the only thing the model controls is data that has passed a schema.
* Good, because the widget contract is statically typed end to end, so `payload`, `state` and reducer events are inferred (FR-8).
* Good, because the failure set is finite and each member has a defined degradation step (ADR 0012) and a typed error (ADR 0013).
* Good, because lifecycle, placement, persistence and the `data-*` styling contract have a declaration site (ADR 0018, ADR 0017, ADR 0020).
* Good, because it matches the convergent industry shape, so a consumer migrating from an AI SDK binding or an MCP Apps host is porting a mapping, not rethinking an architecture.
* Neutral, because the catalog must be maintained and versioned; retirement of a widget is a deliberate act, not an emergent one.
* Bad, because novel or long-tail UI is impossible without shipping code, which rules Nerey out for use cases whose entire premise is unbounded interface generation.

### Free-form UI code generation

The model emits JSX or a component source string; the client transpiles and evaluates it, typically in a scoped interpreter with an allowlisted component scope.

* Good, because the interface ceiling disappears — the model can produce a layout nobody anticipated, which is the single most compelling demo in this space.
* Good, because it needs no catalog maintenance and no per-widget release cycle.
* Neutral, because it trades a catalog-curation problem for a prompt-engineering one: output quality becomes a function of the system prompt and the model version rather than of reviewed code.
* Bad, because it is remote code execution by design. A scoped interpreter narrows the reachable globals; it does not stop a hostile payload from rendering a credential-harvesting form inside the trusted chrome, and prompt injection makes "hostile payload" a routine event rather than an exotic one.
* Bad, because it drags a transpiler or interpreter into `@nerey/core`, contradicting ADR 0037 and adding a large, security-critical dependency to a library whose selling point is that it has almost none.
* Bad, because there is no type inference, no coverage, no Storybook story and no review for code that first exists at runtime — every quality mechanism in ADR 0003, ADR 0006 and ADR 0007 goes dark exactly where the risk is highest.
* Bad, because it is non-deterministic across renders: the same conversation replayed produces different markup, so persisted transcripts (ADR 0016) cannot be faithfully restored.

### Sandboxed iframe with a `postMessage` bridge

Model-authored HTML is rendered in a `sandbox`ed iframe on a separate origin; the widget talks to the host over a `postMessage` JSON-RPC channel. This is a real deployment shape for MCP Apps and deserves to be argued rather than dismissed.

* Good, because the browser, not the library, enforces the isolation — origin separation plus `sandbox` attributes is a far stronger boundary than any in-process interpreter scope.
* Good, because it preserves the unbounded-UI property while keeping the host document safe from direct DOM access.
* Neutral, because it forces every interaction through an explicit message protocol, which happens to resemble the `onInteraction` narrowing Nerey wants anyway (ADR 0014).
* Bad, because the visual contract dies. An iframe cannot inherit the host's cascade, so `--nerey-*` tokens (ADR 0024), the `data-*` styling API (ADR 0020) and the "consumer styles Nerey from their own CSS Modules" premise (AC-14) all become unimplementable. A headless library whose output cannot be styled by its host is a contradiction.
* Bad, because accessibility degrades sharply: focus order, screen-reader virtual cursor continuity, viewport-aware positioning for overlays (ADR 0017) and scroll behaviour all break at the frame boundary, and Base UI's behavioural primitives (ADR 0022) cannot operate across it.
* Bad, because it requires a host origin, a bridge protocol, a resize channel and a security review of the sandbox flags — a substantial runtime that FR-39 explicitly puts out of scope for v1.
* Bad, because it solves a problem Nerey does not have: isolation is only necessary because the content is untrusted, and the chosen option makes the content trusted by construction.

### Model-composed primitive tree

The model emits a JSON tree of primitives — stack, text, button, image, input — that the client walks and renders. No code crosses the wire, but composition does.

* Good, because it keeps the no-executable-content property while restoring some compositional freedom, and it is a genuinely established server-driven-UI pattern.
* Good, because the primitive vocabulary is reviewable and versionable in the same way a registry is.
* Neutral, because it needs its own schema and interpreter, roughly the size of the registry plus a layout engine.
* Bad, because there is no stable unit to attach lifecycle, persistence, `updateStrategy` or expiry rules to. `expiry: [{ on: 'interact' }]` (ADR 0018) is a statement about a widget; an arbitrary tree has no widget.
* Bad, because the styling contract dissolves. `data-nerey-widget="<type>"` presupposes a `<type>`; a consumer cannot write CSS against a shape the model invents per message, so AC-14 and AC-17 become untestable.
* Bad, because state handling is unsolved: `useWidgetState` is keyed per `messageId` around a declared state schema (FR-19), and a model-composed tree has no schema to key against.
* Bad, because it reintroduces the ceiling problem anyway — the primitive vocabulary becomes the new catalog, but with worse types and no per-unit tests.

## More Information

This record is the keystone for the generative-UI group. ADR 0009 fixes how a `type@version` key resolves, ADR 0010 fixes how registries are built and merged, ADR 0030 covers payload evolution over time, and ADR 0035 fixes which widgets `@nerey/core` ships. The behavioural consequences are recorded in ADR 0011 (validation), ADR 0012 (degradation), ADR 0013 (error taxonomy), ADR 0014 (outbound channel), ADR 0015 (no I/O) and ADR 0019 (streaming status).

Primary sources: MCP Apps SEP-1865 (`ui://` resource templates, host-mediated JSON-RPC, text-only fallback as a normative SHOULD, ratified 2026-01-26); Google A2UI's client-owned pre-approved component catalog; the Vercel AI SDK's tool→component bindings with `addToolOutput` and auto-resubmission. Requirements coverage: FR-6 through FR-10, FR-13, FR-39. Acceptance criteria: AC-5, AC-6.

Revisit if a browser-native, styleable isolation primitive makes the sandbox option viable without giving up the cascade, or if a consumer's use case genuinely requires unbounded interface generation — in which case the honest answer is that Nerey is the wrong library, not that this decision should be relaxed.
