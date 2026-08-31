---
status: "accepted"
date: 2026-08-31
decision-makers: Yurii Anichkin
---

# 0038. Semantic versioning for published packages, gated by generated surface snapshots

## Context and Problem Statement

ADR 0029 established what this repository treats as public API — the export surface, the
`data-nerey-*` attribute vocabulary and the `--nerey-*` token names — and how each maps onto a
SemVer bump. That decision is unchanged and this record restates it verbatim in intent.

What is wrong is the mechanism 0029 named. Its `Confirmation` describes a release gate built on
API Extractor, writing `api/<package>.api.md`, `api/<package>.attributes.json`,
`api/theme.tokens.json` and `api/eslint-config.rules.json`, cross-checked against a `!` breaking
marker in the release range. None of that exists. There is no `api/` directory, no
`@microsoft/api-extractor` in the dependency tree, and no cross-check against commit markers.
What exists is `scripts/check-public-api.mjs`, which snapshots **export names and a type-only
flag** into `docs/design-system/public-api.json`.

The gap between the two is not cosmetic. A signature is API, and the gate cannot see one:

```ts
// Both of these pass check:public-api unchanged. Both break every consumer.
export function sendUserMessage(text: string): void;
export function sendUserMessage(text: string, meta: Meta): void; // added required parameter

export type ExpiryRule = { on: 'timeout'; ms: number } | { on: 'message' };
export type ExpiryRule = { on: 'timeout'; ms: number };           // removed a union member
```

The name `sendUserMessage` is still exported, still a value, and the baseline still matches. The
break surfaces in a consumer's build after publication — which is precisely the failure ADR 0029
exists to prevent, and the reason it reached for API Extractor in the first place.

Two properties of the existing gate turn out to be load-bearing and must survive whatever
replaces it. It runs in **0.14 s** and is wired into the `PostToolUse` dispatcher (ADR 0034), so
it fires on every edit to a barrel. And it reads **source, not `dist`** — deliberately, because
ADR 0028 makes the `exports` map closed, so a barrel's re-exports are the reachable surface, and
a gate that needs a build first is a gate that does not run on a clean checkout.

## Decision Drivers

- A change to an exported symbol's type must fail a gate before it is published, not after.
- The snapshot must be **reviewable in a pull request**. A hash tells a reviewer that something
  changed; the whole argument of 0029 is that the diff shows *what*.
- The snapshot must be **byte-deterministic across machines**. A baseline that reorders itself or
  embeds an absolute path produces a phantom diff, and a gate with phantom diffs is one people
  learn to re-bless without reading.
- The fast, edit-time name check must stay fast and edit-time. Whatever captures signatures may be
  slower, but it must not slow the loop that already works.
- No gate may require a prior build, for the reason ADR 0028 already gives.
- New dependencies in the toolchain are a cost paid by every clean install and every audit.

## Considered Options

- A checker-derived signature snapshot, in a second gate beside the existing name gate
- API Extractor, as ADR 0029 describes
- Leave the gap and record it as a known limitation

## Decision Outcome

Chosen option: "A checker-derived signature snapshot, in a second gate beside the existing name
gate", because it closes the hole with no new dependency, no build step and no cost to the
edit-time loop — and because the artifact it produces is the same thing API Extractor's `.api.md`
is for, a reviewable declaration listing, without the machinery around it.

The release surface is therefore covered by four gates, not one:

| Surface                       | Gate                            | Baseline                                  |
| ----------------------------- | ------------------------------- | ----------------------------------------- |
| Export names and kinds        | `check:public-api` (0.14 s)     | `docs/design-system/public-api.json`       |
| Export **signatures**         | `check:api-signatures` (~2 s)   | `docs/design-system/api-signatures.json`   |
| `data-nerey-*` attributes     | `check:data-contract`           | `docs/design-system/data-contract.json`    |
| `--nerey-*` token names       | `check:tokens` + `gen:tokens`   | `tokens.allowlist.json`, `tokens.generated.ts` |

Splitting names from signatures rather than merging them into one gate is the point of the shape:
the name check keeps its place in the edit hook, and the signature check — which builds a
TypeScript program and cannot be sub-second — runs in `check:all` and in CI.

How a signature is rendered is a decision in its own right, because the naive readings are both
wrong. Printing the **expanded structural type** produces a 1.4 MB baseline, because a themed
component's props expand every DOM attribute React declares, and it churns whenever an upstream
type changes. Printing the **declaration's source text** embeds formatting and doc comments, so a
reworded comment reads as an API change. The rendering adopted here is neither:

- **Types** (`interface`, `type`, `enum`) are printed from the AST through the TypeScript printer
  with `removeComments`, which yields the declared form — `type ButtonProps = NativeButtonProps &
  { variant?: ButtonVariant; tone?: ButtonTone; size?: ButtonSize }` — and is unaffected by
  comments and whitespace.
- **Values** are printed by the checker as a type string, which is formatting-independent by
  construction: `<S extends WidgetStateRecord>(messageId: string | number, initial: S, options?:
  { debounceMs?: number; }) => UseWidgetStateResult<S>`.
- **Classes** are expanded structurally into construct signatures plus member types, so a
  refactor inside a method body cannot move the baseline.
- Every `import("/abs/path").T` the checker emits is rewritten to `T`, or to `pkg.T` for a type
  from `node_modules`. Absolute paths are the one thing that would make the artifact
  machine-dependent, and the rewrite removes them entirely rather than normalising a prefix.

That produces 83 KB across four barrels and, when this record was written, 472 symbols —
byte-identical between runs. The symbol count moves with every release and is not itself the
invariant; what the gate asserts is that it moves deliberately.

### Consequences

- Good, because the class of break that motivated ADR 0029 — a compiling change that breaks a
  consumer — now fails a gate, and fails it with a diff a reviewer can read.
- Good, because `NereyToken` and `NEREY_SEMANTIC_TOKENS` are exported from the theme barrel, so
  the token union lands in the signature baseline as a side effect. A token rename is now visible
  in two places rather than one.
- Good, because there is no new dependency: `typescript` is already the toolchain.
- Neutral, because the baseline is regenerated whenever TypeScript itself changes how it prints a
  type. That is a real cost on a compiler upgrade, and it is the cost API Extractor charges too;
  the mitigation is that the diff is reviewable, so a printing change looks like a printing change.
- Bad, because a change confined to a type's *documentation* is invisible here, and a change in an
  upstream type that this repository re-exports structurally is invisible too. The gate versions
  the surface this repository declares, not the transitive closure of everything it points at.
- Bad, because two gates now cover one surface, so a reviewer must know which of the two blesses
  what. The failure messages name the other gate explicitly for that reason.

### Confirmation

`npm run check:api-signatures` (`scripts/check-api-signatures.mjs`) builds a TypeScript program
over the four barrels of ADR 0028, renders each exported symbol as described above, and diffs the
result against `docs/design-system/api-signatures.json`:

- `signature-changed` — **fails**, but not as a verdict of "breaking". An added optional field is
  additive and a narrowed parameter is not, and both render as one changed line; classifying them
  needs a reader. So the gate prints both shapes and stops, and the classification — and therefore
  the bump under the rules restated below — is made by the person re-blessing the baseline.
- `signature-added` / `signature-removed` — reported, does not fail. Names are `check:public-api`'s
  surface and it already fails on a removal; reporting them here without failing keeps one verdict
  per fact instead of two gates blocking on the same removal.
- `--update-baseline` re-blesses, printing every change it just accepted, so a bump can be checked
  against this record rather than assumed.
- `--self-test` plants a violator per rule and asserts each fires, per ADR 0033. It is registered
  in the `GATES` manifest of `scripts/check-gates.mjs` as `ci-only`, with the reason recorded
  there, and reached by `npm run check:all`.

The three supporting gates named in the table above are unchanged and continue to run
continuously, each fixture-covered per ADR 0033.

**The SemVer rules themselves are carried over from ADR 0029 unchanged**: three surfaces, three
snapshots; independent per-package versions; a removal or rename on any surface is MAJOR; an
addition is MINOR; pre-1.0 the classification shifts one place, so a MAJOR-class change bumps
MINOR on `0.x` and MINOR and PATCH classes both bump PATCH. `1.0.0` is cut when AC-23 passes.

**What this record deliberately does not claim**, because ADR 0029 claimed it and it was not true:

- There was **no snapshot of `@nerey/eslint-config`'s rule ids and messages** when this record was
  written; its surface was covered by its own tests only. That gap is closed by ADR 0045, which
  gives it the separate record this line asked for — and found, on its first run, that the surface
  it snapshots has two failure directions rather than one.
- There is **no cross-check between a failing snapshot and a `!` commit marker**. `check:commits`
  validates the marker (ADR 0036) and these gates validate the surface, but nothing joins them
  into the two-signal design 0029 described. Joining them is a release-runbook concern and there
  is no release runbook yet.
- What no snapshot can judge is whether a *behavioural* change is breaking. Reordering the
  degradation chain (ADR 0012), changing when a lifecycle rule fires (ADR 0018) or altering
  debounce timing in `useWidgetState` breaks a consumer with an identical surface. That stays
  manual review at release, and it is why these gates are a floor on the bump rather than the
  final word on it.

## Pros and Cons of the Options

### A checker-derived signature snapshot, in a second gate beside the existing name gate

Build a program with the TypeScript compiler API — already a devDependency — enumerate each
barrel's exports through the checker, render each as described above, and diff against a committed
JSON baseline.

- Good, because it needs no build: the program is created over `packages/*/src`, the same way
  `npm run typecheck` already resolves `@nerey/core` through `paths`.
- Good, because the rendering is chosen per symbol kind, which is what keeps the artifact both
  small (83 KB, not 1.4 MB) and stable against comment and formatting edits.
- Good, because it composes with the existing gate rather than replacing it, so the 0.14 s edit
  hook is untouched.
- Neutral, because it is roughly 300 lines of gate to maintain — the same trade this repository
  already made twice, in `check-commits.mjs` against commitlint and in `check-public-api.mjs`
  against a hand-listed export enum.
- Bad, because the rendering is this repository's own convention, so a reader must learn it. The
  gate's header documents it; API Extractor's format would have been familiar to more people.

### API Extractor, as ADR 0029 describes

Add `@microsoft/api-extractor`, run it over each package's emitted declarations, and commit the
generated `api/<package>.api.md` reports.

- Good, because `.api.md` is a well-known, well-designed review artifact, and the tool is
  maintained by people who have thought about this problem far longer than this repository has.
- Good, because it understands release tags (`@public`, `@beta`, `@internal`), which this
  repository does not currently use but plausibly would.
- Bad, because it consumes **emitted `.d.ts`**, so the gate requires `npm run build` first. That
  contradicts the reason `check-public-api.mjs` reads barrels, and it is exactly the dependency
  that made the first CI run fail — a suite that silently required a prior build (see
  `docs/verification.md`).
- Bad, because it wants one entry point per package and a rollup configuration per package; three
  packages with four barrels between them means four configurations to keep aligned with the
  `exports` map, which is a second place for the surface to be described.
- Bad, because it is a substantial dependency tree for a repository whose stated position on
  toolchain weight is visible in three separate records.

### Leave the gap and record it as a known limitation

Add the divergence to `docs/deviations.md` with a direction of fix, and ship `0.1.0` with a
release gate that checks names only.

- Good, because it costs nothing now and is honest, which is more than the current state manages —
  today an accepted record describes a gate that does not exist.
- Bad, because the packages are about to be published for the first time. A signature baseline
  taken *before* the first release costs nothing to establish and cannot be established
  retroactively for a version already in the wild.
- Bad, because the gap is not theoretical: this repository's own history records a packaging
  defect that every bundler resolved and only `attw` caught. A signature break is the same shape —
  invisible locally, total for the consumer who hits it.

## More Information

Supersedes ADR 0029. The versioning rules are
carried over unchanged; only the mechanism that confirms them differs. 0029 stays on disk and is
never edited (ADR 0001) — it is the record of what was decided before anything had been built, and
its `Confirmation` is the reason this record exists.

Related: ADR 0028 (what the surface is), ADR 0033 (why the gate self-tests), ADR 0034 (why the
fast gate stays in the edit hook), ADR 0036 (the `!` marker this record declines to join to the
snapshot yet).

The rendering rules were arrived at by measurement rather than argument: the structural expansion
was implemented first and produced a 1.4 MB baseline, and the source-text rendering was
implemented second and moved on a comment edit. Both numbers are reproducible by changing
`renderSymbol` in the gate.
