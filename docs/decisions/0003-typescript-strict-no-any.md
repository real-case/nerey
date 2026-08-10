---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0003. TypeScript strict mode, noUncheckedIndexedAccess, no any

## Context and Problem Statement

For a headless library the type surface is a substantial part of the product. `defineWidget` must
preserve `<P, S, E>` end to end so that a widget author gets `payload`, `state` and reducer `event`
inferred rather than asserted; `onInteraction` must narrow its second argument by action so that
`{ text: 123 }` is a compile error in the consumer's editor. Those guarantees are emitted into the
bundled `.d.ts` and consumed by people who never read our source, so a weakness in our own type
settings becomes a weakness in their code.

Two properties of the runtime make the default `strict` setting insufficient on its own. First, widget
resolution is a keyed lookup: the registry is a map from `` `${type}@${version}` `` to an entry, and
the miss is not an edge case — it is degradation step 1 (ADR 0012), the path that produced the
`poll@1.0` versus `poll@1.0.0` failure that ADR 0009 exists to prevent. Under default settings that
lookup types as `WidgetRegistryEntry`, non-optional, and the branch that handles the miss looks
unreachable to the compiler. Second, every payload Nerey renders originates from a model and arrives
untrusted; if `any` is available, the path of least resistance is to cast it at the boundary and lose
the validation step entirely.

## Decision Drivers

* Generic inference through `defineWidget` and the registry must survive `.d.ts` emit, since that is
  the artefact consumers type against.
* Registry misses and optional-payload reads must be visible to the compiler, because the degradation
  chain is specified behaviour, not defensive coding.
* Untrusted input must be typed `unknown` and narrowed by validation (ADR 0011), never widened to
  `any`.
* Strictness must not tax the parts of the codebase where it buys nothing — explicit prop forwarding
  through optional props is pervasive in the primitives layer.
* The setting must be enforced identically in editors, `tsc`, and the test run, with no per-package
  relaxation.

## Considered Options

* `strict` plus `noUncheckedIndexedAccess`, with `any` banned at lint level
* `strict` alone, with `any` allowed as a deliberate escape hatch
* Maximal strictness — every strictness flag, including `exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature`

## Decision Outcome

Chosen option: "`strict` plus `noUncheckedIndexedAccess`, with `any` banned at lint level", because
`noUncheckedIndexedAccess` is the one non-default flag that directly models Nerey's central operation
— a keyed registry lookup that can miss — while the remaining maximalist flags impose their cost on
prop forwarding, which is where Nerey deliberately writes explicit, optional-heavy code.

`tsconfig.base.json` is the single source of these settings and every package extends it without
overrides. Beyond `strict` it sets `noUncheckedIndexedAccess`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, and `declaration` with
`declarationMap`, and it leaves `exactOptionalPropertyTypes` at `false`.

`exactOptionalPropertyTypes` is off for a specific reason, not out of laziness. Nerey forwards props
explicitly and never spreads a rest object into a root element, so optional props are written out one
by one — `position?: 'above' | 'below' | 'replace'`, `dismissible?: boolean`, `cancellable?: boolean`.
Under `exactOptionalPropertyTypes`, forwarding `position={props.position}` where the value may be
`undefined` is an error distinct from omitting the key, so every explicit forward needs a conditional
spread or a cast. That converts a convention we adopted for clarity into per-site ceremony, and it
does so against third-party types (React's own, and Base UI's) that are not authored for the flag.

`any` is banned by ESLint rather than by the compiler, because TypeScript has no flag for it.
`@typescript-eslint/no-explicit-any` is an error, and the type-checked `no-unsafe-assignment`,
`no-unsafe-member-access`, `no-unsafe-argument`, `no-unsafe-return` and `no-unsafe-call` rules close
the route through implicitly-`any` values from untyped imports. The sanctioned replacement is
`unknown` narrowed by a Standard Schema validation (ADR 0011) at the one place the boundary is
crossed. `@ts-expect-error` is permitted with a mandatory description; `@ts-ignore` is not permitted
at all, since it does not fail when the underlying error disappears.

### Consequences

* Good, because a registry lookup types as `WidgetRegistryEntry | undefined`, so the unknown-widget
  branch of the degradation chain is a branch the compiler insists on rather than one a reviewer must
  remember.
* Good, because `// @ts-expect-error` becomes a real assertion: the compile-time narrowing of
  `onInteraction` is verified by an expectation that fails the build if the narrowing is ever widened
  (AC-9).
* Good, because banning `any` forces untrusted payloads through validation, which is the same boundary
  the degradation chain and the typed error taxonomy (ADR 0013) are defined at.
* Bad, because `noUncheckedIndexedAccess` produces noise on array iteration where an index is provably
  in range; the accepted response is destructuring, `at()` with an explicit check, or `for…of` — never
  a non-null assertion, which reintroduces the hole the flag closed.
* Bad, because generic-preserving signatures are harder to write and much harder to change; a widening
  of `defineWidget`'s constraints is a breaking change to inference even when it is source-compatible
  (ADR 0029).
* Neutral, because `exactOptionalPropertyTypes` remains available later; turning it on is a mechanical
  migration confined to the props layer, not a redesign.

### Confirmation

* `npm run typecheck` (`tsc --build --force`) over the root project references — a required CI step.
  `--force` prevents a stale `.tsbuildinfo` from reporting a green build that was never performed.
* ESLint, via `npm run lint` with `--max-warnings=0` in CI: `@typescript-eslint/no-explicit-any` at
  error, the type-checked `no-unsafe-*` set enabled with a TypeScript program, and
  `@typescript-eslint/ban-ts-comment` configured as `{ 'ts-expect-error': 'allow-with-description',
  'ts-ignore': true, 'ts-nocheck': true }` (ADR 0005).
* `packages/core/src/__tests__/interaction-contract.test.tsx` — compile-time assertions written as
  `@ts-expect-error`. Because an unused `@ts-expect-error` is itself an error, this file fails
  `typecheck` in both directions: if the narrowing breaks, and if the narrowing is silently loosened.
* `npm run check:public-api` — snapshots the emitted `.d.ts` surface of each package so a change to
  inference or to an exported type shows up as a reviewable diff rather than as a consumer's bug
  report (ADR 0028).

## Pros and Cons of the Options

### `strict` plus `noUncheckedIndexedAccess`, with `any` banned at lint level

* Good, because it models the registry-miss case, which is not an edge case in this codebase but a
  specified behaviour with its own acceptance criterion (AC-5, AC-6).
* Good, because the ban on `any` is enforced with a rule that reports a location, unlike a compiler
  flag that would not exist.
* Good, because it is one setting in `tsconfig.base.json` inherited by all packages, so no package can
  quietly opt out.
* Neutral, because it accepts index-access noise as the price of the guarantee.
* Bad, because `unknown` at the boundary means more explicit narrowing code than a cast would need —
  which is the point, but it is still code.

### `strict` alone, with `any` allowed as a deliberate escape hatch

* Good, because it is the setting most contributors already have muscle memory for, and the one most
  third-party types are authored against.
* Good, because prop forwarding and array access stay quiet.
* Bad, because `registry[key]` types as non-optional, so the fallback path looks dead to the compiler
  and can be deleted or mis-ordered without a type error — the failure mode that motivates ADR 0012.
* Bad, because a single `as any` at the payload boundary silently disables validation, and it is
  precisely the place under time pressure where someone would reach for it.
* Bad, because `any` in an exported signature propagates into consumer code, where we cannot see it.

### Maximal strictness — every strictness flag, including `exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature`

* Good, because `exactOptionalPropertyTypes` genuinely distinguishes "absent" from "present and
  undefined", which is a real distinction in a props API.
* Good, because it eliminates a class of bug where an explicitly-`undefined` prop overrides a default.
* Neutral, because the additional flags beyond the two named here (`noImplicitReturns`,
  `useUnknownInCatchVariables`, already implied by `strict`) are either free or already on.
* Bad, because it collides head-on with explicit prop forwarding: every optional prop passed through a
  wrapper needs a conditional spread, which is exactly the `{...rest}` pattern the architecture
  rejects.
* Bad, because React's and Base UI's published types are not written for the flag, so the errors it
  produces are frequently about someone else's declarations and are resolved by casts — a net loss in
  type safety.

## More Information

The type surface interacts with several other records: validation via Standard Schema is ADR 0011, the
typed error union raised at those boundaries is ADR 0013, the interaction contract whose narrowing is
type-tested is ADR 0014, and the exports-map policy that decides which types are public at all is
ADR 0028. The React Compiler is enabled, so manual `useMemo`/`useCallback` are absent by convention
and the compiler's own lint rules run alongside the rules named above (ADR 0005).

Revisit `exactOptionalPropertyTypes` once the primitives layer is stable and Base UI's types support
it; the migration is confined to explicit prop forwarding sites and can be done package by package.
