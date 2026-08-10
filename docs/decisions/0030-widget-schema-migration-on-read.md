---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0030. Tolerant reader and migration-on-read for widget schema evolution

## Context and Problem Statement

A widget's payload is a contract between a producer Nerey does not own and a component Nerey does. That contract changes: a field is added, a field is renamed, an enum gains a member, a nested shape flattens. Meanwhile the transcript is durable. A conversation from six months ago is re-rendered every time the user scrolls back to it, and the payload persisted in it was written against the contract as it stood then.

Exact `type@version` resolution (ADR 0009) makes this visible rather than silent — a `poll@1.0` payload does not resolve against a `poll@2.0` entry — but visibility alone means every historical message in the transcript degrades to text (ADR 0012). A library whose answer to "we improved a widget" is "your history turns into plain text" is not shippable.

The research pass behind the requirements found no primary-source practice for this in any surveyed generative-UI standard. MCP Apps explicitly deferred widget-state persistence; A2UI's catalog is versioned as a whole rather than per component; the AI SDK has no notion of a persisted tool part beyond the message store. This is the second of the two areas where Nerey is taking a position rather than implementing a settled one (the first is the lifecycle runtime, ADR 0018), so the position needs to be stated and defended rather than inherited.

## Decision Drivers

* Transcripts are durable and re-rendered indefinitely; a payload written once may be read hundreds of times over years.
* `@nerey/core` does not own the store. `MessagePersistence` is an injected port (ADR 0016), so Nerey cannot enumerate, rewrite or batch-process persisted messages even in principle.
* Validation is validator-agnostic through Standard Schema v1 (ADR 0011), so any rule here must hold under Zod, Valibot and ArkType without inspecting validator internals.
* Additive producer changes are the common case and must not be breaking. A backend that starts sending an extra field should not break clients that predate it.
* Failures must remain typed and degradable rather than thrown (ADR 0012, ADR 0013); "the migration crashed" cannot take the transcript with it.
* Streaming partials are explicitly not validated (FR-12, ADR 0019), so whatever runs before validation must not run on partial data either.
* Widgets perform no I/O (ADR 0015); a migration that fetches a mapping table would smuggle a network call into the render path.

## Considered Options

* Tolerant reader plus migration-on-read
* Batch migration at write or deploy time
* Parallel registration of every historical version

## Decision Outcome

Chosen option: "Tolerant reader plus migration-on-read", because it is the only option available to a library that does not own the store, and because it keeps the durable artefact — the persisted message — untouched, so a migration that turns out to be wrong is a code fix rather than a data-loss incident.

Two halves, both required:

**Tolerant reader.** A payload schema declares the fields the widget reads and ignores everything else. An unknown field is never a validation failure. This makes additive producer changes non-breaking in the direction that matters most — a newer backend against an older client — and it is the reason `poll@1.0` keeps working when the backend starts attaching an unread `analyticsId`. Schemas are therefore authored non-strict; strictness would convert every producer-side addition into a fallback render across the whole transcript at once.

**Migration on read.** A registry entry may declare `migrate(fromVersion, payload)` (FR-9, FR-25). The render path is ordered and fixed:

1. resolve `type@version` exactly (ADR 0009);
2. if the entry declares `migrate` and the payload's version differs from the entry's, call `migrate(fromVersion, payload)`;
3. validate the result — migrated or not — against the entry's `payloadSchema` (ADR 0011);
4. render.

Validation runs *after* migration, never before, so `migrate` is the only code that ever sees a historical shape and the component only ever sees a current one. A `migrate` that throws, or that returns something failing `payloadSchema`, produces `InvalidPayloadError` and degrades through the normal chain (ADR 0012, ADR 0013) — a bad migration renders text, it does not crash the transcript. `migrate` must be pure and synchronous; it takes the old payload and returns a new one, with no I/O (ADR 0015) and no access to the host.

The persisted payload is never rewritten. Nerey reads history; it does not edit it. Migration runs on every read, which is cheap because it is a pure synchronous transform over a small object, and safe because the source of truth remains whatever the producer originally wrote.

Migration does not run during streaming. Partial payloads are not validated (FR-12) and a partial object is not a historical one; `migrate` is invoked only once the tool part reaches a terminal input state (ADR 0019).

### Consequences

* Good, because a widget's payload contract can advance without breaking any persisted message, and AC-13 states the property directly: a `v2` entry with `migrate` reads a persisted `v1` payload and renders with no fallback.
* Good, because it requires nothing of the consumer's store, so it works identically against TanStack Query, a database, `localStorage`, or the in-memory implementation core ships.
* Good, because the original payload survives. A migration bug is fixed by editing a function and reloading, not by restoring a backup.
* Good, because it makes ADR 0009's strictness affordable: exact matching is what tells `migrate` which historical shape it is looking at, and `migrate` is what keeps strictness from costing the transcript.
* Bad, because migrations are cumulative and permanent. `migrate` must handle every version ever emitted, so the function grows monotonically and can only be trimmed when a version is provably absent from all stores — which a library cannot prove.
* Bad, because a tolerant reader cannot detect a *removed* field. A producer that stops sending something the widget reads yields a validation failure at read time, not at deploy time, so removals still require an explicit version bump on the producer side.
* Neutral, because migration cost is paid per render rather than once per record. Payloads are small and the transform is pure, so this is a deliberate trade of a negligible amount of CPU for the absence of a write path.

### Confirmation

* `packages/core/src/registry/__tests__/migration.test.ts` — AC-13. A `poll@2.0` entry with `migrate` renders a persisted `1.0` payload with no fallback and no `onWidgetError` call. Adjacent cases assert the ordering: a `migrate` that throws yields exactly one `InvalidPayloadError` and the fallback renders; a `migrate` whose output fails `payloadSchema` does the same; `migrate` is never invoked while `status` is `'streaming'`.
* Legacy fixture corpus. Every payload shape ever emitted is committed under `packages/core/src/mock/fixtures/legacy/**/*.json` with its `type` and `version`, and `packages/core/src/registry/__tests__/legacy-corpus.test.ts` globs the directory and asserts that every fixture resolves and renders under the current registry with no fallback. Deleting or breaking a `migrate` branch fails the run and names the fixture, so migration coverage is enforced by data rather than by remembering to write a test.
* Tolerant-reader assertion in the conformance kit (FR-38): `assertTolerantReader(entry)` clones the entry's valid fixture, adds an unrecognised key, and asserts validation still passes. It reads only the Standard Schema v1 result (ADR 0011), so it is validator-agnostic and runs unchanged under Zod, Valibot or ArkType. Every built-in widget is subject to it (ADR 0035).
* ESLint, via `@nerey/eslint-config` (ADR 0015): the no-I/O rule covers registry entry modules as well as widget components, so a `migrate` cannot reach for `fetch` or an HTTP client.
* `npm run check:gates` (ADR 0033) plants a strict schema that rejects an extra field and a legacy fixture with no migration path, and fails if either gate passes them.

## Pros and Cons of the Options

### Tolerant reader plus migration-on-read

Unknown fields ignored; `migrate(fromVersion, payload)` transforms historical payloads at render time, before validation.

* Good, because it needs no access to the store, which is the only kind of solution available behind an injected persistence port (ADR 0016).
* Good, because the durable artefact is never mutated, so migrations are reversible by editing code.
* Good, because additive producer changes are non-breaking without any coordination between producer and client deploys.
* Good, because failures land in the existing typed-error and degradation machinery instead of needing their own.
* Neutral, because it costs a pure transform per render.
* Bad, because migration logic accumulates and can never be safely pruned by a library.
* Bad, because the tolerant half is a convention about how schemas are authored; it is enforced by a conformance assertion rather than by a type.

### Batch migration at write or deploy time

A job walks the persisted transcript and rewrites old payloads to the current version, so read-time code only ever sees current shapes.

* Good, because the read path stays simple: one shape, one schema, no branching on version.
* Good, because migration cost is paid once per record rather than on every render.
* Good, because it is the well-understood approach from database schema evolution, with mature tooling and mental models.
* Neutral, because it relocates the compatibility question from the render path to the release process, which is the right place for it in a system that owns both ends — and the wrong place for a library that owns neither.
* Bad, because Nerey cannot do it. `MessagePersistence` exposes `getWidgetState` and `updateWidgetState` per message (FR-19); there is no enumeration, no transaction, and no authority to rewrite a consumer's store.
* Bad, because it is destructive. A wrong migration overwrites the original payload, and the recovery path is a backup restore rather than a code change.
* Bad, because it demands a deploy-ordering guarantee — migrate before shipping the new client — which is impossible when clients are long-lived browser tabs.
* Bad, because it would push a migration runner into `@nerey/core`, contradicting the no-transport, port-only boundary (ADR 0037).

### Parallel registration of every historical version

Keep `poll@1.0` and `poll@2.0` both registered, each with its own component; exact matching (ADR 0009) then routes old payloads to old code automatically.

* Good, because it requires no new mechanism at all — the registry and the matching rule already do it, and the old payload renders in exactly the UI it was designed for.
* Good, because historical fidelity is perfect: a v1 transcript looks the way it looked.
* Neutral, because it makes version count and component count the same number, which is honest but expensive.
* Bad, because every historical component stays in the bundle forever, including its markup, reducer, styles and dependencies. Cost scales with the product of widget count and version count.
* Bad, because a bug fix or accessibility correction has to be applied to every live version separately, or old messages keep the defect.
* Bad, because it directly worsens the dead-registration accumulation already flagged as an open question against ADR 0009 — thirty widgets across three versions is ninety registrations to reason about.
* Bad, because it does not help with the common case at all: most contract changes are additive and want one component reading two shapes, not two components.

## More Information

Grounded in FR-25, FR-9 and FR-12; acceptance criterion AC-13. Depends on exact resolution (ADR 0009) to know which historical shape is in hand, on Standard Schema v1 (ADR 0011) for the validation step that follows migration, on ADR 0012 and ADR 0013 for what a failed migration does, and on ADR 0016 for the reason a write-time approach is unavailable. Streaming interaction is governed by ADR 0019. A widget version bump is a payload-contract change and is independent of the package's own release version (ADR 0029).

The tolerant-reader half is borrowed from message-schema evolution practice rather than from any generative-UI standard, which is stated plainly in the documentation because it is a position Nerey is taking in an unstandardised space. Revisit if a standard emerges — MCP Apps taking up widget-state persistence would be the trigger — or if the accumulated-migration cost becomes concrete enough to justify a supported pruning story.
