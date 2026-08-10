---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0012. Four-step degradation chain with an injected fallback renderer

## Context and Problem Statement

A generative transcript renders objects the model produced, against a registry the client declared months
earlier (ADR 0008). Four independent things can go wrong at that seam: the model names a widget the registry
does not have, the payload does not satisfy the widget's schema, the widget component throws while
rendering, or the host never supplied a way to render text at all. Each has to end in something legible in
the message list. A blank bubble is worse than a wrong one — the user has no way to tell the difference
between "the assistant answered and the UI broke" and "the assistant did not answer".

This is not open design space. MCP Apps makes text-only fallback a normative SHOULD, on the reasoning that a
host may not implement a given resource template and the conversation must remain readable regardless. Nerey
takes the same position and makes it unconditional rather than a SHOULD.

The second half of the problem is what "render text" means. The extraction source contains
`markdown-fallback.tsx`, which pulls in `react-markdown`, `remark-gfm` and `rehype-external-links`. Those
three roots resolve to several dozen packages (`unified`, `mdast-util-*`, `micromark-*`, `hast-util-*`,
`vfile`). FR-4 rules them out of core, and independently of the rule, most consumers already render assistant
text with their own markdown pipeline and would immediately replace whatever core shipped — so the tree would
be paid for by everyone and used by almost nobody.

## Decision Drivers

* The transcript must never render empty, and must never let a widget failure escape into the consumer's
  application-level error boundary and unmount the conversation.
* Each failure mode must be independently observable, so a consumer can tell "unknown widget" from "bad
  payload" in their telemetry (ADR 0013).
* `@nerey/core` ships an empty `dependencies` object (FR-4, AC-1).
* The fallback path is where consumers' existing investment already lives — their markdown renderer, their
  link handling, their sanitisation policy.
* Degradation must be cheap to test: one test per step, no mocking of a rendering library.

## Considered Options

* Four-step chain with an injected `renderFallback` port
* Four-step chain with a markdown fallback bundled in core
* No chain in core: propagate failures to the consumer's own error boundary

## Decision Outcome

Chosen option: "Four-step chain with an injected `renderFallback` port", because it is the only option that
both guarantees a legible transcript on every failure mode and keeps core's dependency tree empty, and
because injecting the renderer puts the markdown policy where the sanitisation and link-handling decisions
already are — in the consumer.

The chain runs in this fixed order, and each step is reached only if the previous one did not resolve:

1. **Unknown `type@version`.** Exact-match resolution (ADR 0009) returns `undefined`. Emit
   `UnknownWidgetError` and render `renderFallback(message.text)`.
2. **Payload fails validation.** The entry resolved, migration-on-read ran (ADR 0030), and
   `payloadSchema` rejected the result. Emit `InvalidPayloadError` carrying the issue paths and render
   `renderFallback(message.text)`.
3. **Component throws during render.** An error boundary wraps every widget instance, keyed by
   `messageId` so one widget's failure never blanks its neighbours. Emit `WidgetRenderError` and render
   `renderFallback(message.text)`.
4. **No fallback renderer configured.** `renderFallback` is absent from the host value. Render
   `message.text` as plain text inside the node Nerey owns, carrying the documented `data-nerey-part`
   attribute (ADR 0020). No error is emitted for this step itself — the error from step 1, 2 or 3 has
   already been reported.

`renderFallback: (text: string) => ReactNode` sits on the host value alongside the registry (FR-16). The
markdown implementation moves out of core to a documented recipe and an optional
`@nerey/fallback-markdown` adapter, which is not part of the three published packages (ADR 0002) and does
not gate v1.

Two rules keep the chain honest. Step 2 is suppressed entirely while `status` is `streaming` — a partial
payload is not a failed payload (ADR 0019). And the chain is never skipped for the built-in `text` widget:
it renders through `renderFallback` like everything else (ADR 0035), which is what keeps the fallback path
exercised in every consumer rather than only on the bad day.

### Consequences

* Good, because the failure surface is exhaustive and ordered, so "what does Nerey do when X breaks" has one
  answer per X instead of depending on which host mounted the widget.
* Good, because core stays installable in any stack: no markdown parser, no sanitiser, no opinion about
  whether raw HTML in assistant text is permitted.
* Good, because a consumer's existing markdown component — already tuned for their link, code block and
  sanitisation policy — becomes the fallback with one prop, and the transcript stays visually consistent
  between widget failures and ordinary assistant messages.
* Neutral, because step 4 means the worst case is unformatted text with visible markdown syntax. That is a
  degraded reading experience but never a data loss, and it only happens in a host that opted out of
  supplying a renderer.
* Bad, because the most common first-run experience for someone evaluating Nerey is raw markdown source,
  since `renderFallback` is optional and easy to omit. Mitigated by the mock layer (FR-37) wiring a trivial
  renderer and by the quickstart making the prop the first thing it sets.
* Bad, because per-instance error boundaries mean one class component per widget instance in a codebase that
  is otherwise function components. React offers no hook equivalent, so this is a permanent, contained
  exception.
* Bad, because the chain can mask an authoring bug: a widget whose payload never validates degrades quietly
  and correctly forever. The typed error to `onWidgetError` (ADR 0013) is the only signal, which is why
  Nerey never swallows it and never logs it on the consumer's behalf.

### Confirmation

* `packages/core/src/degradation/degradation-chain.test.tsx` contains exactly four tests, one per step,
  each asserting the rendered output and asserting that `onWidgetError` received exactly one error of the
  expected `kind` (AC-6). A fifth test asserts a throwing widget does not unmount its sibling widgets.
* `packages/core/src/degradation/streaming-suppression.test.tsx` asserts step 2 does not fire while
  `status` is `streaming` (AC-7), pinning the interaction with ADR 0019.
* `npm run check:core-purity` (`scripts/check-core-purity.mjs`) fails if `packages/core/package.json`
  declares any runtime dependency, which is what prevents a markdown renderer from returning.
* `npm run check:boundaries` (`depcruise packages`) forbids any module under `packages/core/src` from
  importing `react-markdown`, `remark-*`, `rehype-*` or `unified`, catching a devDependency import that the
  manifest check would not see.
* The merged coverage threshold (ADR 0007) covers the boundary and the chain module; an uncovered branch in
  the chain fails the gate rather than being reviewed.
* Per ADR 0033, the degradation suite is run against a seeded build in which the boundary is removed, and the
  gate fails if that build passes.

## Pros and Cons of the Options

### Four-step chain with an injected `renderFallback` port

Core owns the ordering and the error boundary; the consumer owns the text rendering.

* Good, because it satisfies the MCP Apps text-fallback SHOULD unconditionally, with no dependency cost.
* Good, because the fallback inherits the consumer's sanitisation and link policy automatically, rather than
  Nerey shipping a second, differently-configured markdown pipeline into a page that already has one.
* Good, because it is trivially testable: the tests pass `renderFallback={(t) => <span>{t}</span>}` and
  assert on text, with no rendering library in the test path.
* Neutral, because it adds one more required-in-practice prop to the host value.
* Bad, because the default experience without the prop is unformatted text.
* Bad, because two consumers can render the same failed message differently, so a bug report screenshot is
  not self-describing.

### Four-step chain with a markdown fallback bundled in core

Same ordering, but `react-markdown` + `remark-gfm` + `rehype-external-links` ship inside `@nerey/core` with
`renderFallback` as an override.

* Good, because it works correctly out of the box with no configuration, which is the best first-run
  experience of the three options.
* Good, because failure rendering is then identical across all consumers, making support and screenshots
  unambiguous.
* Neutral, because tree-shaking helps only consumers who override the default, and only if their bundler
  can prove the default unreachable — which it cannot, since the default is selected at runtime.
* Bad, because it fails AC-1 and FR-4 outright: several dozen transitive packages enter every consumer's
  install for a code path most of them replace on day one.
* Bad, because it forces Nerey to own a sanitisation policy. Shipping `rehype-external-links` and a raw-HTML
  stance is a security-relevant decision made on behalf of applications Nerey knows nothing about.
* Bad, because markdown pipeline majors (`unified` ecosystem releases are frequent) would drive Nerey
  releases that contain no Nerey change.

### No chain in core: propagate failures to the consumer's own error boundary

Core resolves and validates, then throws on failure; the consumer's application error boundary decides what
to render.

* Good, because it is the smallest amount of code in core and makes no assumption about presentation at all.
* Good, because it surfaces authoring bugs loudly instead of degrading quietly — a widget with a broken
  schema is impossible to ignore.
* Neutral, because a diligent consumer can reimplement the four steps themselves in about fifty lines.
* Bad, because the default blast radius is the whole conversation: a React error boundary unmounts its
  entire subtree, so one malformed payload from the model blanks the transcript. That is precisely the
  outcome the MCP Apps SHOULD exists to prevent.
* Bad, because failure handling becomes non-uniform across consumers, so no acceptance criterion like AC-6
  can be stated about Nerey at all — the library would have no defined behaviour for its most likely runtime
  event.
* Bad, because it pushes error classification onto the consumer, who has to distinguish "unknown widget"
  from "invalid payload" by parsing a message string, defeating ADR 0013.

## More Information

Implements FR-13 and FR-14; verified by AC-6 and, jointly with ADR 0019, AC-7. Related records: ADR 0009
supplies step 1's resolution rule, ADR 0011 supplies step 2's validation contract, ADR 0030 places
migration-on-read before validation, ADR 0013 defines the typed errors each step emits, ADR 0019 defines
when step 2 is suppressed, ADR 0035 explains why the built-in `text` widget renders through this same port,
ADR 0037 records the wider "no markdown renderer in core" boundary, and ADR 0020 defines the `data-*`
attributes the plain-text step must still carry.

The MCP Apps specification's text-fallback requirement is the external precedent; it is a SHOULD there
because hosts vary, and Nerey makes it unconditional because Nerey is the host-side implementation.
