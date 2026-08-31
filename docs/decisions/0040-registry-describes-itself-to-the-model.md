---
status: "accepted"
date: 2026-08-31
decision-makers: Yurii Anichkin
---

# 0040. The registry describes itself to the model, through an injected schema converter

## Context and Problem Statement

FR-11 says a widget's schema "keeps its documented dual role — prompt-side constraint for the
model, runtime validation at the boundary". Only the second half exists. `@nerey/core` validates
every payload it receives and offers nothing at all for the first half, so a consumer wiring Nerey
to a model writes the constraint a second time, by hand, in whatever shape their provider wants —
a tool definition, a JSON Schema in a system prompt, an MCP resource.

Two lists then have to agree, forever, with nothing checking that they do. And the failure when
they stop agreeing is the one this repository has already documented as the most common wiring bug
in the design (FR-10, ADR 0009):

> The poll widget shipped as `poll@1.0` precisely because the backend sends `"1.0"` and a
> registration as `"1.0.0"` would silently never match and fall back to text.

Exact-match resolution is right — an implicit range turns a version mismatch into a silent
fallback that looks exactly like a missing widget — but it makes the two lists agreeing a hard
requirement, and today nothing derives one from the other. The registry knows the exact
`type@version` it will accept and the exact schema it will validate against. The model is told
both by a human retyping them.

## Decision Drivers

- The strings the model emits must be **derived from the registry**, not restated beside it. A
  version string typed twice is a version string that will eventually differ.
- `@nerey/core` must gain no validator dependency. ADR 0011 depends on the Standard Schema *spec*
  precisely so a consumer's choice of Zod, Valibot or ArkType stays invisible to core, and
  ADR 0037 lists a schema library among the things core does not ship.
- `@nerey/core` must gain no LLM SDK binding. ADR 0037 makes provider tool formats a documented
  adapter point, and those formats churn faster than this library should.
- Standard Schema v1 has **no** JSON Schema conversion. It exposes `~standard.validate` and phantom
  types, and nothing else; anything that produces JSON Schema must come from the vendor.
- Whatever is emitted has to be usable without a converter at all — a consumer who writes their
  schemas by hand still wants the type, the version and the placement.

## Considered Options

- `describeRegistry(registry, { toJsonSchema })` — a neutral catalogue, converter injected
- A JSON Schema converter as a dependency of `@nerey/core`
- Provider-shaped tool builders in core — `toAnthropicTools`, `toOpenAITools`, `toAiSdkTools`
- Leave it to the consumer, as today

## Decision Outcome

Chosen option: "`describeRegistry(registry, { toJsonSchema })` — a neutral catalogue, converter
injected", because it derives every string the model needs from the registry that will actually
resolve them, while leaving both things core refuses to take on — a validator and a provider
binding — outside the package.

```ts
import { describeRegistry } from '@nerey/core';
import { z } from 'zod';

const catalog = describeRegistry(registry, { toJsonSchema: (schema) => z.toJSONSchema(schema) });
// → [
//     {
//       type: 'poll',
//       version: '1.0',
//       key: 'poll@1.0',
//       description: 'Ask the user to choose between listed options.',
//       placement: { slot: 'message' },
//       payloadSchema: <JSON Schema from the converter>,
//     },
//     ...
//   ]
```

The converter is a one-line lambda the consumer already has: Zod 4 ships `z.toJSONSchema`, and the
Valibot and ArkType equivalents are equally one line. Core never imports one, so ADR 0011 holds
unchanged, and the descriptor is a plain data structure the consumer shapes into whatever their
provider wants — which is what ADR 0037 means by "a documented adapter point, not a dependency".

Three things about the emitted shape are decisions rather than details:

- **`key` is emitted alongside `type` and `version`.** It is `` `${type}@${version}` `` — the
  registry's own lookup key, so a producer building a prompt cannot assemble it wrongly. The whole
  point is that nobody types `1.0.0` when the registry says `1.0`.
- **`stateSchema` is not emitted.** State is what the user did to the widget; the model neither
  produces it nor should be encouraged to think it can (ADR 0014, ADR 0016). Emitting it would
  invite a model to pre-fill an answer to its own question.
- **Lifecycle is not emitted.** It describes what happens after the model's job is finished —
  expiry, read-only-ness, snapshotting — and a model that reasons about it is reasoning about
  something it cannot influence (ADR 0018).

`WidgetRegistryEntry` gains an optional **`description`**. FR-9's field list predates this record
and did not need one, because nothing ever read the registry for anything but resolution. A
catalogue without it can state what a widget *is called* and not what it is *for*, which is the
one thing a model actually needs in order to choose between two of them. It is optional: an entry
that omits it still resolves, still validates, and simply describes itself less well.

### Consequences

- Good, because the exact-match strings the model must emit now come from the same object that
  will resolve them, which retires the FR-10 class of bug by construction rather than by care.
- Good, because a consumer without a converter still gets a useful catalogue — type, version, key,
  description, placement — and can attach hand-written schemas to it.
- Good, because it costs core nothing: no dependency, no bytes beyond one small module, and no
  knowledge of any provider.
- Neutral, because the quality of the catalogue now depends on `description` prose that nothing
  can check. A wrong description is worse than none, and no gate will catch it.
- Bad, because the shape of the JSON Schema is the converter's business, so two consumers on
  different validators can hand their models materially different constraints for the same widget.
  That is inherent to depending on the spec rather than on a validator, and it is the same trade
  ADR 0011 already made knowingly.
- Bad, because `describeRegistry` is one more piece of public surface to version, and its output
  shape is now covered by the ADR 0038 signature baseline — a field added to `WidgetDescriptor` is
  a release event.

### Confirmation

Colocated tests in `packages/core/src/describe.test.ts`, and one of them is the fitness function
that matters:

- **Round-trip.** For every descriptor `describeRegistry` emits, `registry.get(d.type, d.version)`
  must resolve to the entry it came from, and `d.key` must equal `` `${d.type}@${d.version}` ``.
  This is the assertion that the catalogue and the resolver cannot drift: it fails the moment the
  describer starts emitting a string the registry would not accept.
- **Coverage.** Every entry in `builtInWidgets` and in `@nerey/theme`'s catalog appears in the
  descriptor exactly once, so a widget added to a registry cannot be silently missing from what the
  model is told about.
- **No converter, no schema.** With `toJsonSchema` omitted, no descriptor carries a `payloadSchema`
  key at all — rather than carrying `undefined`, which serialises into a prompt as noise.
- **No state, no lifecycle.** Asserted explicitly, because both are the kind of field somebody adds
  later out of helpfulness.

`check:core-purity` (ADR 0011 / 0033) continues to fail if a schema library appears in core's
dependency tree at any depth, which is what keeps the converter injected rather than imported.

## Pros and Cons of the Options

### `describeRegistry(registry, { toJsonSchema })` — a neutral catalogue, converter injected

- Good, because the one thing core cannot do without a dependency is the one thing it asks for.
- Good, because the output is data, so it survives a provider changing its tool format.
- Neutral, because the consumer writes one lambda. That is a real ergonomic cost, paid once.
- Bad, because a consumer who forgets the converter gets a catalogue with no constraints in it and
  no error — the schemas are simply absent. The tests pin the behaviour; the docs have to warn.

### A JSON Schema converter as a dependency of `@nerey/core`

- Good, because `describeRegistry(registry)` would need no options at all, which is a materially
  nicer API.
- Good, because the emitted schema would be identical for every consumer, so the model's constraint
  would not vary with the validator someone happened to pick.
- Bad, because it reintroduces the exact dependency ADR 0011 removed, and `check:core-purity` fails
  the build on it by name. A consumer on Valibot would install a Zod-shaped converter to describe
  Valibot schemas.
- Bad, because no converter handles every Standard Schema implementation, so the "identical for
  every consumer" benefit is partly illusory — it would work well for one vendor and badly for the
  rest.

### Provider-shaped tool builders in core

- Good, because it removes the last step: a consumer would call `toAnthropicTools(registry)` and
  pass the result straight to the API.
- Bad, because ADR 0037 makes an LLM SDK binding a non-goal by name, and this is one in all but
  imports.
- Bad, because provider formats change on their own schedule, so core's version number would start
  tracking other people's API revisions — the same argument ADR 0011 makes about being hostage to
  Zod's major versions.
- Bad, because there are at least four shapes worth supporting and no principled way to choose
  which three to omit.

### Leave it to the consumer, as today

- Good, because it is free and nothing is wrong with the code that exists.
- Good, because a consumer with an unusual pipeline is not fighting an abstraction.
- Bad, because it leaves FR-11 half-built while claiming otherwise, and leaves FR-10's failure mode
  live in every integration — silently, because a version mismatch renders as plain text and looks
  like a model that simply chose not to use a widget.

## More Information

Extends FR-9's field list with `description` and completes FR-11. Related: ADR 0009 (why
resolution is exact, which is why the strings must be derived), ADR 0011 (why the converter is
injected), ADR 0037 (why no provider binding), ADR 0038 (the signature baseline that now versions
`WidgetDescriptor`).

The name is `describeRegistry` rather than `toTools` or `toCatalog` because what it returns is a
description of what the registry will accept, not a thing to call — the calling is the consumer's,
and the difference is the whole boundary this record is drawing.
