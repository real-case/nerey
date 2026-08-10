# Deviations

Places where the shipped code and an **accepted** ADR disagree, with what should happen next.

Accepted records are never edited in place (ADR 0001), so a divergence is resolved either by
changing the code to match the record, or by writing a superseding record. Neither is free, and
neither should happen silently — hence this file. Each entry names the direction of the fix.

Every deviation here was surfaced by a gate or by an implementing agent reading the record
against the code, which is the intended mechanism: a record whose `Confirmation` names a fitness
function gets checked, and a mismatch shows up as work rather than as drift.

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

## D-2 · ADR 0036's type and scope vocabularies are narrower than the gate's

**Record says**: types omit `style`; fixed scopes are `storybook`, `docs`, `repo`.

**Code does**: accepts 11 types including `style`, and 5 fixed scopes — the three above plus
`deps` and `adr`.

**Fix direction**: supersede alongside D-1. The additions are right (`deps` for dependency
bumps, `adr` for corpus work), the record simply predates them.

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

---

## Not deviations

Recorded here because each looks like one at a glance:

- **The bootstrap corpus was accepted in bulk** on 2026-08-09, before any package contained code.
  ADR 0001 records this, along with its consequence: the `proposed → accepted` transition first
  runs for real on 0038.
- **`check:exports` and `check:spelling` are outside `check:all`.** `check:exports` needs a built
  `dist` and a packed tarball; `cspell` has no project dictionary yet and reports several hundred
  unknown words, which makes it a nuisance rather than a gate. Both are recorded in
  `CHECK_ALL_EXEMPT` inside `check-gates.mjs` with those reasons, so the harness does not warn.
- **ADR 0032's `check:a11y` gate now exists.** It was named in the record's `Confirmation`
  before it was written, which briefly made the record aspirational. `scripts/check-a11y-waivers.mjs`
  and the `check:a11y` script landed on 2026-08-10 and are registered in the ADR 0033 harness, so
  the record is now true. Kept here only because the gap was real for part of the build.
- **`@nerey/theme` depends on Zod.** ADR 0011 forbids a validator in `@nerey/core`, not in the
  theme. The theme's widgets are reference implementations, and demonstrating the Standard Schema
  contract with a real validator is the point.
