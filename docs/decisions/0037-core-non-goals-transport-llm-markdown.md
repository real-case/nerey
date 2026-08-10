---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0037. Core has no transport, LLM SDK binding, or markdown renderer

## Context and Problem Statement

Every generative-UI kernel sits next to a set of adjacent problems that look like they belong in the same
package: something has to stream tokens, something has to talk to a model provider, something has to
render the assistant's prose, and eventually something has to draw a chart. The extraction source solves
all of them, because it is an application. Nerey is not.

This is a negative record. It states what `@nerey/core` will not contain in v1, so that the absence is a
decision with a rationale rather than a backlog item someone closes by adding a dependency. The scope is
the published `@nerey/core` package and its dependency closure — not what a consumer may build on top,
and not what Nerey may publish later as a separate adapter package.

## Decision Drivers

* Adoptability is the property the whole extraction exists to buy. A consumer whose stack differs from
  ours by exactly one choice — SSE instead of WebSocket, Vercel AI SDK instead of a bespoke client,
  Streamdown instead of `react-markdown` — must still be able to install `@nerey/core` without a fight.
* Each of these subsystems has a faster and less compatible release cadence than a UI kernel. Model SDKs
  ship breaking changes on the timescale of new model families; a markdown pipeline is a moving target of
  `remark` and `rehype` majors.
* The registry, the host contract, the lifecycle runtime and the degradation chain are the parts nobody
  else ships. Transport, model SDKs and markdown rendering are all well served by existing packages.
* Bundle and dependency weight is a hard acceptance criterion, not a preference: AC-1 requires the packed
  tarball to contain no CSS and its dependency tree to include no markdown renderer and no HTTP client.
* Nerey's own contracts already anticipate each of these as an injection point rather than an
  implementation — the fallback renderer is a prop, sending is a host callback, persistence is a port.

## Considered Options

* Ship none of them; each stays a documented adapter point
* Batteries-included core with transport, SDK binding and markdown fallback
* Ship them as optional subpath entry points inside @nerey/core

## Decision Outcome

Chosen option: "Ship none of them; each stays a documented adapter point", because every one of these
subsystems is a place where consumers legitimately differ, and shipping any single choice converts an
adoptable library into one that only fits the stack it was extracted from.

Specifically, `@nerey/core` v1 contains:

* **No transport.** No WebSocket client, no SSE reader, no polling loop, no `fetch` wrapper. Core has no
  concept of a connection or a request. Turns leave through the host's `sendUserMessage`, which the
  consumer implements (ADR 0014); widget state leaves through the persistence port, which the consumer
  implements (ADR 0016).
* **No LLM SDK binding.** No `ai`, no `@ai-sdk/*`, no provider client. The four-state tool-part lifecycle
  is mirrored as a plain `status` prop the host supplies (ADR 0019) rather than as an adapter that
  reaches into an SDK's stream types.
* **No MCP client and no iframe sandbox.** Nerey renders trusted, consumer-registered components in the
  host document (ADR 0008); it does not fetch `ui://` resources, does not host untrusted HTML, and
  operates no `postMessage` bridge. Widget code is code the consumer shipped, reviewed under the no-I/O
  boundary (ADR 0015).
* **No i18n layer.** No message catalog, no `t()` function, no locale context. Chrome strings — the small
  number of labels core emits itself — are English literals and overridable through props.
* **No markdown renderer.** `renderFallback` is injected (ADR 0012). `react-markdown`, `remark-gfm` and
  `rehype-external-links` leave core; `markdown-fallback.tsx` becomes a documented recipe and, if it
  earns its own release, a separate `@nerey/fallback-markdown` package.
* **No charting.** No `recharts`, no `d3`, no SVG plotting primitives. A chart widget is a widget a
  consumer registers, exactly like any other.

Each of these is a documented adapter point, with a named seam and a recipe in the docs: transport
adapts at `sendUserMessage`, model SDKs adapt at the `status` prop and the message adapter, markdown
adapts at `renderFallback`, persistence adapts at the port, and everything else adapts at a registry
entry. "Non-goal" here means "not in this package", never "not supported".

### Consequences

* Good, because the install decision is trivial for the consumer: `@nerey/core` adds one package and no
  transitive surface, so evaluating it costs nothing and adopting it commits nothing.
* Good, because core's release cadence is decoupled from the fastest-moving dependencies in the
  ecosystem — a new AI SDK major is not a Nerey major (ADR 0029).
* Good, because the seams are testable. A library with no transport can have its entire behaviour driven
  from a test or a Storybook story with no server (AC-21), which is what makes the mock layer credible.
* Bad, because the first-run experience is longer. A consumer must write a `toNereyMessage` adapter, a
  `renderFallback`, a persistence implementation and a send function before they see a widget in their
  own app. The mock layer (FR-37) exists to make the Storybook path immediate, and the recipes exist to
  make the application path mechanical.
* Bad, because "the fallback is plain text" surprises people who expected markdown out of the box. This
  is why step four of the degradation chain renders `message.text` unstyled rather than failing — a
  consumer who wires nothing still gets a legible transcript (ADR 0012).
* Neutral, because some of these will eventually ship as separate packages. That is an additive decision
  per package, made when there is a second consumer to generalize against, and it does not reopen this
  record.

### Confirmation

`npm run check:core-purity` is the fitness function. It packs `@nerey/core` with `npm pack --json`,
resolves the full dependency closure of the packed manifest, and fails on any member of a documented
forbidden set:

* transport — `ws`, `socket.io-client`, `eventsource`, `axios`, `ky`, `got`, `superagent`;
* model SDKs and MCP — `ai`, `@ai-sdk/*`, `openai`, `@anthropic-ai/*`, `@modelcontextprotocol/sdk`;
* markdown — `react-markdown`, `remark-*`, `rehype-*`, `marked`, `markdown-it`;
* charting — `recharts`, `d3`, `d3-*`, `victory`, `visx`;
* i18n — `i18next`, `react-i18next`, `@formatjs/*`, `next-intl`;
* validation — `zod`, `valibot`, `arktype`, which are the consumer's choice under Standard Schema
  (ADR 0011).

The same script asserts the tarball contains zero `.css` files and that `dependencies` is empty with
`react` declared only as a peer, which together satisfy AC-1. `npm run check:exports` asserts the
`exports` map is exactly `.` and `./mock` (ADR 0028), so a forbidden implementation cannot arrive as a
new subpath. Both are registered with `npm run check:gates`, which verifies each gate rejects a planted
violator — a fixture manifest with `react-markdown` added — per ADR 0033, so a gate that silently stops
checking is itself a failure.

## Pros and Cons of the Options

### Ship none of them; each stays a documented adapter point

Core contains the registry, host contract, lifecycle runtime, validation and degradation chain, and
nothing else.

* Good, because the package fits every stack, which is the only way a library extracted from one
  application becomes usable by a second one.
* Good, because the absence is machine-checkable: an empty `dependencies` field is a far stronger
  guarantee than a policy about which dependencies are acceptable.
* Good, because it keeps core's test surface honest — nothing in the package needs a network, a model, or
  a DOM parser to test.
* Neutral, because the documentation burden moves from API reference to recipes. Five adapter recipes are
  the deliverable that replaces five implementations.
* Bad, because it is more work for the first consumer, and the value of the library is less obvious in a
  five-minute evaluation than a batteries-included alternative's.

### Batteries-included core with transport, SDK binding and markdown fallback

Carry the extraction source's dependencies forward: an SSE reader, an AI SDK binding, `react-markdown`
for the fallback.

* Good, because a consumer on the same stack is productive within minutes and writes no adapters.
* Good, because the integration between streaming state and the `status` prop is done once, correctly,
  instead of being re-derived by each consumer from the tool-part state machine.
* Bad, because it hard-codes four independent choices, and a consumer differing on any one of them is
  blocked. The markdown pipeline alone would pull roughly a dozen transitive packages into a library
  whose entire job is to be headless.
* Bad, because it breaks AC-1 outright, and every model-SDK major becomes a Nerey release event.
* Bad, because it forces version negotiation on the consumer for dependencies they already have at a
  different major, which is the failure mode that makes libraries un-upgradable.

### Ship them as optional subpath entry points inside @nerey/core

Keep the implementations in the same package behind `@nerey/core/transport`, `@nerey/core/markdown` and
so on, tree-shaken and imported only if wanted.

* Good, because a consumer who wants the batteries gets them from one install with a guaranteed-matching
  version, and a consumer who does not never imports the subpath.
* Good, because it keeps the adapters in the same repository, so a change to the host contract and its
  adapters lands in one commit and one test run.
* Neutral, because bundlers do drop the unused subpaths, so shipped bytes are genuinely not the argument
  against this option.
* Bad, because subpaths do not change the *install*. The packages still appear in `dependencies` and are
  installed for everyone, or land in `peerDependencies` and produce warnings and version conflicts for
  consumers who never use them. AC-1 constrains the dependency tree, not the bundle.
* Bad, because one version number would cover a UI kernel and a model SDK binding, so the binding's
  breaking changes would force major versions of core (ADR 0029) — the coupling is in the release
  cadence, not the import graph.

## More Information

Implements FR-39, the v1 non-goals, and underwrites AC-1. It is the reason FR-4 lists only `react@^19`
as a peer dependency, and the reason four couplings in the extraction source — the application message
schema, Zod, the markdown renderer and TanStack Query — are all resolved as ports rather than carried
forward.

Read alongside the records that define each seam: ADR 0012 (injected fallback renderer, so removing
markdown does not remove the degradation path), ADR 0011 (Standard Schema, so removing Zod does not
remove validation), ADR 0014 (host-owned send, so removing transport does not remove interaction),
ADR 0016 (persistence port, so removing the data layer does not remove widget state), ADR 0028 (exports
map policy, which is what stops these arriving through a new subpath) and ADR 0035 (core ships two
widgets, for the same adoptability reason applied to the widget catalog).

Revisit per item, never as a set, and only with a second consumer to generalize against. A markdown
fallback and an AI SDK status adapter are the two most likely to graduate — as `@nerey/fallback-markdown`
and a similarly separate binding package, each with its own version line. Adding one to `@nerey/core`
itself would supersede this record.
