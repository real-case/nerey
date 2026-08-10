---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0011. Standard Schema v1 for payload and state validation

## Context and Problem Statement

Every registry entry declares a `payloadSchema` and a `stateSchema` (ADR 0008). Those schemas carry two
distinct jobs. Prompt-side, the host serialises the payload schema into the tool definition the model is
given, so the schema is the constraint that makes a widget parameterisable at all. Runtime-side, the same
schema is the check at the boundary where a model-authored, untrusted object becomes React props — the
gate that decides whether step 2 of the degradation chain fires (ADR 0012).

The extraction source imports `zod` directly in `registry.types.ts` and types `payloadSchema` as
`ZodType`. That makes a validation library a hard runtime dependency of the kernel, which FR-4 and AC-1
forbid: `@nerey/core` must ship with an empty `dependencies` object. The coupling is not only about bytes.
A consumer standardised on Valibot pays for a second validator they never call. A consumer on Zod 3 while
core pins Zod 4 ends up with two copies in the graph, and every `instanceof` check inside core silently
fails against schemas built by the consumer's copy — the dual-instance failure mode, which surfaces as
"valid payload always falls back" and is expensive to diagnose.

The question this record settles: what type does `@nerey/core` accept for `payloadSchema` and
`stateSchema`, such that the consumer chooses the validator and core depends on none?

## Decision Drivers

* FR-4 and AC-1: `npm pack @nerey/core` must produce a tree containing no validation library.
* The schema's dual role must survive — one declaration serves both the prompt and the boundary check.
* End-to-end generic inference: `defineWidget` must infer `P` and `S` from the schemas (FR-8), not require
  a second type argument that can drift from the runtime schema.
* No dual-instance hazard: core must never branch on `instanceof` against a consumer-constructed schema.
* Validation is on the render path, so the common case must be synchronous and allocation-light.
* Consumers already own a validator; forcing a second one is a migration cost with no benefit.

## Considered Options

* Standard Schema v1 as the accepted schema interface
* A hard dependency on Zod 4
* A hand-rolled minimal validator interface owned by Nerey
* JSON Schema documents validated with ajv

## Decision Outcome

Chosen option: "Standard Schema v1 as the accepted schema interface", because it is the only option that
lets the consumer keep the validator they already use while leaving core's `dependencies` literally empty,
and it is the only one whose type-level contract carries both the input and output types needed for
`defineWidget` to infer `P` and `S` without a second type argument.

Concretely, `payloadSchema` and `stateSchema` are typed as `StandardSchemaV1<unknown, P>` and
`StandardSchemaV1<unknown, S>`. Core validates by calling `schema['~standard'].validate(input)` and
branching on whether the result carries `issues`. It never imports a vendor, never inspects `vendor`, and
never uses `instanceof`. Zod 4, Valibot and ArkType all implement the interface natively, so a consumer
passes their existing schema object unchanged.

`@standard-schema/spec` is a types-only package, but it is declared a **devDependency**, not a dependency,
and the interface Nerey accepts is re-declared in `packages/core/src/validation/standard-schema.ts`. This
keeps core's runtime `dependencies` an empty object, which makes the packaging assertion a flat "is empty"
check rather than an allowlist that drifts. A type-level test pins the local declaration to the upstream
one, so divergence fails typecheck rather than shipping.

Two rules bound the contract. First, validation is synchronous on the render path: `validate` may return a
`Promise` under the spec, and a schema that does so is rejected with `InvalidPayloadError` carrying a
documented message rather than being awaited mid-render. Second, validation runs after
migration-on-read (ADR 0030) and only once the payload has reached a terminal input state (ADR 0019) —
partial streamed payloads are never handed to a schema.

Prompt-side JSON Schema generation stays with the consumer. Standard Schema v1 exposes validation, not
introspection, so core cannot derive a JSON Schema from an arbitrary implementation. This is consistent
with ADR 0037: core has no LLM SDK binding, and the tool definition is assembled where the model call is
made, using the vendor's own converter (`z.toJSONSchema`, `toJsonSchema` in Valibot, `.toJsonSchema()` in
ArkType).

### Consequences

* Good, because a consumer adds zero dependencies to adopt Nerey's validation — they pass the schema object
  they already wrote for their own API layer.
* Good, because the dual-instance failure mode is structurally impossible: the contract is a property on the
  object (`~standard`), so nothing depends on class identity or module resolution.
* Good, because `defineWidget` infers `P` and `S` from `StandardSchemaV1.InferOutput`, keeping FR-8's
  end-to-end generics with no explicit type argument at the authoring site.
* Neutral, because the issue shape core receives is the spec's `ReadonlyArray<{ message, path? }>`, not the
  vendor's rich error object. `InvalidPayloadError` therefore reports paths and messages, and a consumer who
  needs vendor-specific diagnostics reads them from their own schema.
* Bad, because core cannot introspect a schema, so nothing in core can generate the model-facing JSON Schema
  or a documentation table from a registry. That work is duplicated in each consumer's prompt assembly.
* Bad, because async-only validators (a Zod schema using `.refine` with a promise, for example) are
  unusable as a `payloadSchema`. The rejection is explicit and typed rather than silent, but it is a real
  restriction on what a consumer may pass.
* Bad, because Standard Schema is a young interface; if a v2 lands with an incompatible property name, core
  ships a major (ADR 0029) or supports both properties for a deprecation window.

### Confirmation

Four automated checks, no manual review:

1. `npm run check:core-purity` (`scripts/check-core-purity.mjs`) fails if `packages/core/package.json`
   declares a non-empty `dependencies` object, and fails if `zod`, `valibot`, `arktype`, `ajv` or
   `@standard-schema/spec` appear anywhere other than `devDependencies`. This is the gate that keeps the
   decision from eroding one convenience import at a time.
2. `packages/core/src/validation/standard-schema.types.test.ts` asserts the locally declared interface is
   mutually assignable with the upstream `StandardSchemaV1` from the dev dependency, so an upstream change
   breaks `npm run typecheck` instead of breaking consumers.
3. `packages/core/src/validation/validate-payload.test.ts` runs one shared table of valid and invalid
   payloads against schemas built with Zod 4, Valibot and ArkType, asserting identical accept/reject
   outcomes and identical `InvalidPayloadError` issue paths across all three vendors.
4. The packaging test behind AC-1 unpacks the built tarball and asserts no validator appears in the
   resolved tree, catching a transitive reintroduction that the manifest check would miss.

Per ADR 0033, `check:core-purity` self-tests by running against a fixture manifest that declares `zod` as a
dependency and failing if that fixture passes.

## Pros and Cons of the Options

### Standard Schema v1 as the accepted schema interface

A specification-only package (`@standard-schema/spec`) defining a `~standard` property carrying `version`,
`vendor`, `validate` and phantom `types`. Implemented natively by Zod 4, Valibot, ArkType and others.

* Good, because it costs zero runtime bytes and zero transitive dependencies.
* Good, because the consumer's validator choice becomes invisible to core — a swap from Zod to Valibot is a
  change in the consumer's catalog file only.
* Good, because `InferOutput` gives type-level extraction, which is what makes `defineWidget`'s inference
  work without asserting.
* Neutral, because `validate` is permitted to be async; core narrows this to sync by policy rather than by
  type.
* Bad, because there is no introspection, so schema-derived prompt artefacts must be produced outside core.
* Bad, because the interface is versioned by a single number on an object property, so a v2 migration is a
  runtime branch rather than a type error.

### A hard dependency on Zod 4

Type `payloadSchema` as `z.ZodType<P>` and depend on `zod` from `@nerey/core`.

* Good, because it is the shortest path from the extraction source — the shipped code already does this.
* Good, because it gives introspection: `z.toJSONSchema` in core could generate the model-facing schema and
  a widget documentation table.
* Neutral, because Zod 4's bundle cost is far below Zod 3's and would not be noticeable for most consumers.
* Bad, because it violates FR-4 and fails AC-1 outright, which is a k.o. criterion.
* Bad, because it exposes every consumer to the dual-instance failure, where a schema built by the app's
  copy of Zod fails an `instanceof` check inside core's copy and every widget silently degrades to text.
* Bad, because it makes Nerey's major-version cadence hostage to Zod's: a Zod 5 with breaking types forces a
  Nerey major even if nothing in Nerey changed.

### A hand-rolled minimal validator interface owned by Nerey

Define `NereyValidator<T> = { parse(input: unknown): { ok: true; value: T } | { ok: false; issues: Issue[] } }`
and require consumers to wrap their schema in an adapter.

* Good, because core owns the contract completely and can shape it around exactly what the render path
  needs — synchronous, no promise branch, no version field.
* Good, because it also keeps `dependencies` empty.
* Neutral, because the adapter is three lines per schema and could be generated by a helper.
* Bad, because it is Standard Schema with a worse ecosystem: every consumer writes and maintains the
  adapter that Zod, Valibot and ArkType already ship natively.
* Bad, because the adapter is an extra place for the runtime type and the TypeScript type to diverge, which
  is the exact class of bug FR-8's end-to-end generics exist to prevent.
* Bad, because widgets published by third parties would carry Nerey-shaped adapters, making them unusable
  outside Nerey — an interop cost paid for no gain over an existing standard.

### JSON Schema documents validated with ajv

Declare `payloadSchema` as a plain JSON Schema object; core validates with ajv.

* Good, because the prompt-side role becomes trivial: the schema is already in the format tool definitions
  want, so no converter is needed anywhere.
* Good, because it is the most portable on-the-wire representation, and it matches how MCP describes tool
  inputs.
* Neutral, because ajv could be a peer dependency, keeping core's own `dependencies` empty.
* Bad, because TypeScript inference from a JSON Schema literal requires either heavy `as const` gymnastics
  or a code generation step, so `defineWidget` loses inference and widget authors hand-write `P` — the
  drift FR-8 forbids.
* Bad, because ajv compiles schemas at runtime with `new Function`, which is blocked under a strict CSP and
  is a poor fit for a library that runs inside arbitrary consumer applications.
* Bad, because it forces every widget author to write JSON Schema by hand for the runtime check while their
  whole codebase uses a schema library, which is the interop cost the previous option had, inverted.

## More Information

Implements FR-11 and the `@nerey/core` half of FR-4; verified by AC-1. Related records: ADR 0008 for why
the registry parameterises pre-declared widgets rather than executing model-authored UI, ADR 0009 for exact
`type@version` resolution as the step that precedes validation, ADR 0012 for what happens when validation
fails, ADR 0013 for the shape of `InvalidPayloadError`, ADR 0019 for the rule that partial streamed payloads
are never validated, ADR 0030 for migration-on-read running before validation, and ADR 0037 for why
prompt-side schema conversion lives in the consumer. ADR 0003 supplies the strict TypeScript settings the
inference chain relies on.

Revisit if Standard Schema publishes a v2, or if an introspection companion specification lands that would
let core generate model-facing schemas without a vendor dependency.
