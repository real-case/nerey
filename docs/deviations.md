# Deviations

Places where the shipped code and an **accepted** ADR disagree, with what should happen next.

Accepted records are never edited in place (ADR 0001), so a divergence is resolved either by
changing the code to match the record, or by writing a superseding record. Neither is free, and
neither should happen silently — hence this file. Each entry names the direction of the fix.

Every deviation here was surfaced by a gate or by an implementing agent reading the record
against the code, which is the intended mechanism: a record whose `Confirmation` names a fitness
function gets checked, and a mismatch shows up as work rather than as drift.

A resolved entry is **kept and marked `Resolved`**, not deleted. What diverged and how it was
closed is the useful part of this file; a list that only ever shows open items loses the record of
which decisions needed a second attempt.

---

## D-1 · ADR 0036 describes commitlint; the gate does not use it

**Record says** (0036, Confirmation): `scripts/check-commits.mjs` "internally wraps `commitlint`
with `@commitlint/config-conventional`".

**Code does**: implements the Conventional Commits grammar directly, with zero dependencies.
`commitlint` is not in `devDependencies` and was deliberately not added — the grammar is roughly
forty lines, and a gate that must run inside an edit hook and in CI is better off without an
install step.

**Fix direction**: supersede 0036. The decision (Conventional Commits, scope vocabulary derived
from `workspaces`) is unchanged and correct; only the stated implementation is wrong.

**Resolved** — 2026-11-19. ADR 0050 restates the decision with the implementation as it is, was
accepted, and `npm run adr -- supersede --old 0036 --new 0050` has run.

## D-2 · ADR 0036's type and scope vocabularies are narrower than the gate's

**Record says**: types omit `style`; fixed scopes are `storybook`, `docs`, `repo`.

**Code does**: accepts 11 types including `style`, and 5 fixed scopes — the three above plus
`deps` and `adr`.

**Fix direction**: supersede alongside D-1. The additions are right (`deps` for dependency
bumps, `adr` for corpus work), the record simply predates them.

**Resolved** — 2026-11-19, by ADR 0050 alongside D-1. D-3 stays open: 0050 records its direction
(one shared resolver), and the code has not moved yet.

## D-3 · ADR 0036 claims citation resolution is delegated

**Record says**: `Refs: ADR NNNN` footers resolve "by reusing `scripts/check-adr-citations.mjs`".

**Code does**: `check-commits.mjs` resolves the corpus inline from `docs/decisions/`, because it
was written in parallel with the citations gate and neither could import the other.

**Fix direction**: code. `check-adr-citations.mjs` should export its resolver and
`check-commits.mjs`'s `loadAdrNumbers()` should call it — one shared implementation, which is
the same argument that made `post-edit.mjs` a dispatcher rather than a second copy of the rules.

## D-4 · `data-nerey-position` is contract-adjacent but not in `NEREY_ATTR`

**Record says** (0017, 0020): the placement attributes are part of the styling contract.

**Code does**: `packages/core/src/slots/placement.ts` declares `data-nerey-scope` and
`data-nerey-position` locally; only the attributes in `NEREY_ATTR` are baselined.
`check-data-contract.mjs` allows both through an explicit `EXTERNALLY_DECLARED_ATTRS` set rather
than failing.

**Fix direction**: code. Move both into `NEREY_ATTR` and re-baseline. That is itself a contract
change under ADR 0029 — additive, so MINOR — and should happen in one deliberate commit rather
than as a side effect of some other work.

**Resolved** — 2026-11-19. Both are `NEREY_ATTR.position` and `NEREY_ATTR.scope`, `placement.ts`
reads them from there, `check-data-contract.mjs` no longer carries an `EXTERNALLY_DECLARED_ATTRS`
escape hatch, and `data-contract.json` lists eleven attributes. The re-bless happened in that one
commit, under the pre-release rule in `docs/releasing.md`.

## D-5 · Error messages other than `unknown-widget` do not name the widget in prose

**Record says** (0013): errors carry the widget coordinates that identify them. They do.

**Code does**: `invalidPayloadError`, `invalidStateError`, `widgetRenderError` and
`persistenceError` identify the widget only through the `widgetType` / `widgetVersion` /
`messageId` fields. A host that logs `error.message` alone — which is the common case — loses
which widget failed.

**Fix direction**: code, probably. Not a record violation, but a real ergonomic gap.
`unknown-widget` is the only one that reads well standalone, and it is also the only one anybody
has needed to debug so far, which is not a coincidence worth relying on. `errors.test.ts` asserts
the current behaviour explicitly so the change is a deliberate one.

## D-6 · ADR 0029's release gate describes API Extractor and a surface the gate never checked

**Record says** (0029, Confirmation): the release gate builds three surfaces into committed
snapshots under `api/` — `api/<package>.api.md` via **API Extractor** ("exports and signatures"),
`api/<package>.attributes.json`, `api/theme.tokens.json` and `api/eslint-config.rules.json` — and
fails a removal unless the release range carries a `!` breaking marker for that scope.

**Code does**: there is no `api/` directory and no `@microsoft/api-extractor` anywhere in the
tree. `scripts/check-public-api.mjs` snapshots **export names and a type-only flag** into
`docs/design-system/public-api.json`. Attributes are covered by `check:data-contract` and token
names by `check:tokens` / `gen:tokens`, both under `docs/design-system/`, neither under `api/`.
Nothing snapshots the eslint-config rule set, and nothing joins a snapshot failure to the `!`
marker.

The consequence was not cosmetic: **a signature change passed the release gate in silence.**
Adding a required parameter to an exported function, or dropping a member from an exported union,
left every name and kind identical and the baseline matching.

**Fix direction**: superseded. ADR 0038 restates 0029's versioning rules unchanged and replaces the
mechanism with what the repository actually wants: a second gate, `check:api-signatures`, that
renders every exported symbol through the TypeScript checker into
`docs/design-system/api-signatures.json`. It closed the signature hole on 2026-08-24.

**Resolved** — 2026-08-31. ADR 0038 was accepted and `npm run adr -- supersede --old 0029 --new
0038` has run; 0029 now reads `superseded by ADR 0038`.

The two promises this entry recorded as deliberately not carried over have both since been kept,
by later records rather than by 0038:

- the `@nerey/eslint-config` rule snapshot is `check:eslint-rules` (ADR 0045), which renders the
  resolved config surface to `docs/design-system/eslint-rules.json` and fails in **both**
  directions;
- the two-signal cross-check against the `!` commit marker is `gen-release.mjs`'s
  `undeclared-break` refusal (ADR 0039) — the author declares the bump, the gates derive it, and a
  disagreement blocks.

One edge of that cross-check is narrower than it reads, and is worth writing down here rather than
discovering at a release: `undeclared-break` inspects `public-api.json` and `api-signatures.json`
only, and `@nerey/eslint-config` owns no barrel in either. A ban removed from the published lint
config would therefore be caught by `check:eslint-rules` — which compares against its baseline —
but would not, on its own, force a `!` on the release. Widening it means reading a third baseline,
which is a change to what ADR 0039 says `undeclared-break` reads, so it needs a record rather than
a patch.

## D-7 · ADR 0037 claimed chrome strings were overridable through props

**Record says** (0037): Nerey ships no i18n layer, and the chrome strings it emits "are English
literals **and overridable through props**".

**Code did**: the first half held; the second was false. `DEFAULT_DISMISS_LABEL` in
`OverlaySlotHost` had no way in at all — the source said so in a comment — and `@nerey/theme`'s
thirty-nine strings were module constants reaching widgets whose props are fixed by
`WidgetComponentProps` (ADR 0008 / 0014), so there was no seam to be overridable through.

The consequence was not cosmetic. Several of those strings are **accessible names**, and the WCAG
2.2 AA gate cannot catch a wrong language — axe checks that a name exists, never what language it
is in (ADR 0032). Several others are **reply text the agent reads as the user's own words**
(ADR 0014).

**Fix direction**: code, and it landed on 2026-08-25. ADR 0041 adds `NereyLabelsProvider` /
`useNereyLabels` to `@nerey/theme` and one `dismissLabel` prop to core's `OverlaySlotHost` — a prop
rather than a context, so core still has no locale anything and 0037's non-goal holds. 0037's claim
is now true rather than aspirational, so this entry records a gap that was real rather than one
that is open.

## D-8 · ADR 0018's lifecycle measures time from mount and does not persist expiry

**Record says** (0018): a `timeout` deadline is "computed from the widget's message timestamp rather
than from mount, so a reload does not restart the clock". Expiry "is recorded, not recomputed": when
a rule fires, core writes a marker through the persistence port (ADR 0016), alongside the widget's
own state, and reads it back before first paint, which is what makes `snapshot` deterministic.

**Code does**: measures from mount. `useWidgetLifecycle` takes `mountedAt: Date.now()` in a lazy
state initialiser and re-takes it whenever `messageId` changes
(`packages/core/src/lifecycle/use-widget-lifecycle.tsx`). Interactions live in `useState` and die with
the component. `NereyMessage` (`packages/core/src/types.ts`) carries no time at all, so there is no
message timestamp to compute from, and no marker is written or read anywhere. The `ExpiryRule` doc
comment documents the shipped behaviour ("`ms` after the widget first mounted"), so the code and its
comments agree with each other and both disagree with the record.

The test files the record's `Confirmation` names (`lifecycle/__tests__/evaluate-lifecycle.test.ts`,
`lifecycle-runtime.test.tsx`, `after-expiry.test.tsx`) do not exist under those paths. The lifecycle
is tested in `expiry.test.ts` and `use-widget-lifecycle.test.tsx`, and neither asserts the reload
case. Every gate checks form, none checks this behaviour, so the gap passed all of them.

**Consequence**: `snapshot` survives a reload only for a widget that derives its own lock from its
persisted state. The built-in `poll` does (`locked = readonly || answered`), so the reference widgets
look correct. A third-party widget without that discipline is interactive again after a reload, and a
second press sends a duplicate reply: the exact failure ADR 0018 was written against. A `timeout`
widget restarts its full interval on every reload.

**Fix direction**: code. The decision in 0018 is right; the implementation is missing. ADR 0046 adds
the anchor the record assumed (`NereyMessage.createdAt`, required) and fixes how a reload reads the
marker, and ADR 0047 adds the port methods that store it. Both were accepted on 2026-11-19.

**Resolved** — 2026-11-19. `NereyMessage.createdAt` is required and `timeout` is measured from it
against the host's injected `now`; a fired rule writes a `LifecycleRecord` through
`updateLifecycleRecord` and a remount reads it back through `getLifecycleRecord` (or takes it from
`NereyWidgetEnvelope.expiry`), and an action-bearing widget stays read-only while that read is
pending or failed. `lifecycle-reload.test.tsx` asserts the reload case with a widget that has no lock
of its own, `lifecycle-ssr.test.tsx` the server/client agreement, and the conformance kit's
`remount-respects-marker` rule carries the same check into a widget author's repository.
`check:mutants` re-plants both defects described above and requires the reload test to fail
against each, so the gap that passed every gate the first time now has one that sees it.

---

## Not deviations

Recorded here because each looks like one at a glance:

- **The bootstrap corpus was accepted in bulk** on 2026-08-09, before any package contained code.
  ADR 0001 records this, along with its consequence: the `proposed → accepted` transition first
  runs for real on 0038.
- **`check:exports` is outside `check:all`.** It needs a built `dist` and a packed tarball, so CI
  runs it after `npm run build`. Recorded in `CHECK_ALL_EXEMPT` inside `check-gates.mjs` with that
  reason, so the harness does not warn.
- **`check:spelling` used to be exempt too**, because `cspell` had no project dictionary and
  reported 812 unknown words across 57 files — a nuisance rather than a gate, while ADR 0001's
  `Confirmation` named it as one. A `cspell.json` accepting both English variants and a reviewed
  `project-words.txt` brought that to zero on 2026-08-26, so the exemption is gone and `check:all`
  runs it. Kept here because an accepted record naming a gate that did not run was real for the
  whole build, and is the same shape as ADR 0032's `check:a11y` above.
- **ADR 0032's `check:a11y` gate now exists.** It was named in the record's `Confirmation`
  before it was written, which briefly made the record aspirational. `scripts/check-a11y-waivers.mjs`
  and the `check:a11y` script landed on 2026-08-10 and are registered in the ADR 0033 harness, so
  the record is now true. Kept here only because the gap was real for part of the build.
- **`@nerey/theme` depends on Zod.** ADR 0011 forbids a validator in `@nerey/core`, not in the
  theme. The theme's widgets are reference implementations, and demonstrating the Standard Schema
  contract with a real validator is the point.
