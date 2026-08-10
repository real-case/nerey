---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0009. Exact type@version widget resolution

## Context and Problem Statement

The registry maps a key to a widget entry (ADR 0008). The key is `` `${type}@${version}` ``, which leaves one question: given a message carrying `type: "poll"`, `version: "1.0"`, which registered entries are allowed to match?

The question is not theoretical. In the shipped implementation the poll widget is registered as `poll@1.0` — not `poll@1.0.0` — because the backend emits `version: "1.0"` as a literal string. Registering it as `1.0.0` produced no error, no warning and no visible defect at build time. It produced a lookup miss on every poll message, which fell through the degradation chain to plain text (ADR 0012). The transcript still rendered, the tests that did not exercise poll still passed, and the failure looked like "the model stopped emitting polls" rather than "the registry key is wrong". The version string is a piece of backend-owned data being used as a client-side identifier, and any resolution rule that quietly bridges the gap between the two makes that class of mistake invisible.

This record fixes the matching rule for `@nerey/core`. It does not cover how the registry is constructed (ADR 0010) or how payloads from older versions are read (ADR 0030).

## Decision Drivers

* Failures in the resolution path are silent by construction: the degradation chain (ADR 0012) is designed to keep the transcript rendering, so a miss looks like an absence, not an error.
* The `version` field is produced by a system Nerey does not control. It is a string from a payload, not a validated semver object, and it may legitimately be `"1.0"`, `"2"`, `"2026-03"` or `"beta"`.
* Widget versions are contract versions for a payload shape, not release versions of a package. They advance when the payload changes, which is unrelated to the cadence of `@nerey/core`'s own semver (ADR 0029).
* Whatever rule is chosen must be observable in a test, because "it silently matched something else" is precisely the defect being designed against (AC-5).
* Resolution runs per message during streaming; it must be an O(1) map lookup, not a per-message scan with range satisfaction over every registered entry.
* The rule must not require a semver parser inside `@nerey/core`, which keeps its dependency list at `react@^19` (FR-4).

## Considered Options

* Exact string match on `type@version`
* Semver range resolution by default
* Normalising coercion to full semver
* No version in the key

## Decision Outcome

Chosen option: "Exact string match on `type@version`", because it is the only rule under which the `poll@1.0.0` versus `"1.0"` mismatch is a loud, reproducible, testable failure at authoring time rather than a widget that quietly stops appearing in production.

`createWidgetRegistry` keys entries as `` `${type}@${version}` `` with both parts used verbatim. Lookup is a single map access on the same template. No trimming, no lowercasing, no numeric parsing, no leading-zero normalisation, no `~`/`^` interpretation. A key that does not match character-for-character does not resolve, and the message degrades with an `UnknownWidgetError` naming the exact key that was sought (ADR 0013). The error text carries the miss, so the first time an author gets the string wrong, the diagnostic reads `no widget registered for poll@1.0.0` while the payload plainly says `"1.0"` — a two-second fix instead of a two-day investigation.

Ranged resolution remains available but is **opted into per entry**, never inferred. An entry may declare an explicit range predicate alongside its exact key; the registry then holds that entry in a separate, ordered list consulted only after the exact-match map misses. An entry that says nothing about ranges gets exact matching, and no global switch can change that.

### Consequences

* Good, because the failure is immediate and legible. AC-5 encodes it as a first-class acceptance criterion: `poll@1.0.0` against `version: "1.0"` must *not* resolve, and the fallback must render.
* Good, because resolution is a hash lookup with no parsing, so streaming messages cost nothing to resolve and the rule is trivially correct under `noUncheckedIndexedAccess` (ADR 0003).
* Good, because version strings that are not semver at all — `"2026-03"`, `"beta"`, `"2"` — are first-class rather than edge cases, which matters because the producer of that string is a backend Nerey has no authority over.
* Good, because it composes cleanly with migration-on-read (ADR 0030): the payload's version is treated as a historical fact to be read deliberately, not as an approximation to be rounded.
* Bad, because a patch-level payload addition that is genuinely backward compatible still requires either a new registration or an explicit `migrate` (ADR 0030). Strictness is paid for in registration churn.
* Bad, because consumers accumulate dead registrations as widget versions retire, and Nerey ships no deprecation channel in v1. This is a known, recorded gap rather than an oversight.
* Neutral, because the opt-in range mechanism exists for consumers who genuinely control both ends of the wire and want caret semantics; they take on the ambiguity knowingly, per entry.

### Confirmation

* `packages/core/src/registry/__tests__/resolution.test.ts` encodes AC-5 directly: register `poll@1.0.0`, render a message with `version: "1.0"`, assert the widget component never mounts, the fallback renders, and `onWidgetError` receives exactly one `UnknownWidgetError` whose `type`/`version` fields are `"poll"`/`"1.0"`. The same file asserts the negative-space cases — whitespace, casing and leading zeros all fail to match — so a future "helpful" normalisation cannot be added without breaking a test that says why it must not exist.
* `npm run check:public-api` — the exported API snapshot must contain no `normalizeVersion`, `coerceVersion`, `parseVersion` or `satisfies` export. The snapshot diff is the review gate against reintroducing implicit leniency through a utility.
* `npm run check:widget-versions` (`scripts/check-widget-versions.mjs`) — cross-checks every `version` literal appearing in a widget entry against the `version` field of the fixtures in `@nerey/core/mock` and `packages/*/src/**/fixtures/**`. A registration whose key no fixture can reach fails the gate, which catches the original incident at CI time rather than at demo time.
* `npm run check:gates` (ADR 0033) plants a violator for each of the above — a registration whose version differs from its fixture, a smuggled coercion helper — and fails if the gate passes it.
* Coverage of the resolution module is held by the merged threshold gate (ADR 0007), so the miss path cannot become untested code.

## Pros and Cons of the Options

### Exact string match on `type@version`

`registry.get(`${type}@${version}`)`, both parts verbatim.

* Good, because a mismatch is deterministic and reproducible, and the diagnostic names both the sought key and the payload's version.
* Good, because it makes no assumption about the version string's grammar, so non-semver producers are supported without special cases.
* Good, because lookup is O(1) with zero dependencies and no parser.
* Neutral, because it pushes compatibility decisions to an explicit place — `migrate` (ADR 0030) — instead of burying them in a matching rule.
* Bad, because backward-compatible payload changes still require an explicit registration or migration, so registries grow.

### Semver range resolution by default

Entries register `poll@^1.0.0`; the payload's version is tested for satisfaction against every registered range for that type.

* Good, because additive payload changes need no registry change, which is the ergonomic case this option exists to serve.
* Good, because it matches the mental model engineers already have from package managers.
* Neutral, because it requires an ordering rule for overlapping ranges — highest match wins — which is one more thing to specify and test.
* Bad, because it presumes the payload's `version` is valid semver. `"1.0"` is not, and the shipped incident is exactly a producer emitting a two-segment string; a satisfaction check against `"1.0"` either throws or, worse, coerces.
* Bad, because it drags a semver implementation into `@nerey/core`, violating the peer-dependencies-only constraint (FR-4).
* Bad, because resolution degrades from a map lookup to a scan with satisfaction checks, per message, during streaming.
* Bad, because it makes wrong matches *more* silent, not less: a payload written for `1.4` matched against an entry registered `^1.0.0` renders a widget that never saw those fields, and the failure surfaces as a subtly wrong UI rather than a fallback.

### Normalising coercion to full semver

Coerce both the registered version and the payload version to full semver before comparing, so `1.0` and `1.0.0` are the same key.

* Good, because it makes the exact incident that motivated this record disappear without any authoring discipline.
* Neutral, because it is a small amount of code and keeps O(1) lookup on the normalised key.
* Bad, because it fixes the symptom by removing the signal. The registration and the wire format genuinely disagree; hiding that means nobody ever reconciles them, and the next disagreement — `"2"` versus `"2.0.0-rc.1"`, or `"1.10"` versus `"1.1"` — resolves to something arbitrary.
* Bad, because coercion has no defined behaviour for the non-semver strings a backend is free to send, so it needs a fallback rule which is itself a silent branch.
* Bad, because it is unobservable in a test in the way AC-5 requires: the acceptance criterion is that the mismatch *does not* resolve, and coercion makes that criterion unwritable.

### No version in the key

Bind on `type` alone; ignore the payload's `version` entirely. This is what the Vercel AI SDK effectively does with tool→component bindings, so it is not a naive option.

* Good, because it is the simplest possible rule and removes an entire class of key-mismatch bug.
* Good, because it has real precedent in a widely used reference implementation.
* Neutral, because it works well when the same team ships both ends and deploys them together.
* Bad, because it makes payload evolution unrepresentable. A persisted transcript containing a v1 payload rendered by a v2 component is undetectable, which forecloses ADR 0030's migration-on-read entirely.
* Bad, because it discards information the producer already sends; the `version` field exists precisely because the payload contract changes over time.
* Bad, because a rolling deployment where the backend has advanced and some clients have not becomes a corrupted-render scenario instead of a clean fallback.

## More Information

Grounded in FR-10 and AC-5. Depends on the envelope shape fixed by ADR 0008 and the registry construction in ADR 0010; the leniency this record refuses is supplied deliberately and per entry by ADR 0030's `migrate`. Diagnostics for a miss are typed by ADR 0013 and rendered by ADR 0012.

Requirements Open Question 1 — whether Nerey ships a deprecation channel for accumulating dead registrations at thirty-plus widgets — is left open by this record and is the most likely reason to revisit it. A deprecation channel would extend the entry shape, not the matching rule; the matching rule is not expected to change.
