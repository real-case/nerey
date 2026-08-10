---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0025. The theme is self-sufficient in the cascade

## Context and Problem Statement

`@nerey/theme` renders inside an application whose cascade it does not control and cannot inspect.
The host may ship Tailwind Preflight, `normalize.css`, a hand-rolled reset, several of them layered,
or nothing at all. Every one of those changes the initial value of properties the theme silently
depends on: `box-sizing`, default `margin` on headings and paragraphs, `list-style` on `ul`,
`display` on `img`, `font: inherit` on form controls, `border-width: 0` on every element.

The failure this record designs out is concrete and has a date attached. A component authored while
Preflight was present looks correct, ships, and stays correct for a year. Preflight is removed — a
framework upgrade, a migration off Tailwind, a decision to scope the reset to one route — and every
Nerey widget in the product breaks at once: buttons grow a UA border, lists grow bullets and
indentation, `box-sizing` reverts to `content-box` and every width computation is off by the padding.
Nothing in Nerey changed, nothing in Nerey's tests changed, and the regression is unattributable.

The scope of this decision is the theme's own rendered output. The related question — whether Nerey
should ship a reset for the consumer's page — is answered here too, in the negative.

## Decision Drivers

* AC-18: a page shipping no CSS reset must render `@nerey/theme` identically to one shipping
  Preflight.
* Nerey has no knowledge of the host's cascade and must not acquire a dependency on it.
* Whatever the theme does must be confined to elements the theme renders. Nerey styling a
  consumer's `<h1>` is a worse bug than Nerey's own heading having a stray margin.
* ADR 0021 lets consumers substitute elements via a polymorphic `render` prop, so any rule written
  as "every descendant" will eventually apply to DOM the consumer authored.
* The rules must be enforceable on the built artifact, not on intent.

## Considered Options

* Self-sufficiency: every property a reset would normalise is declared explicitly on the theme's own
  elements, and no global reset is shipped
* Ship a scoped reset: a universal-selector block confined to a Nerey root class
* Declare a required peer reset and document it as a prerequisite

## Decision Outcome

Chosen option: "Self-sufficiency: every property a reset would normalise is declared explicitly on
the theme's own elements, and no global reset is shipped", because it is the only option whose
correctness is independent of anything outside the package, and the only one that cannot reach
elements the consumer authored.

Every class in the theme declares, on the element it targets, the properties a reset would otherwise
have supplied:

* `box-sizing: border-box` on every element the theme renders, written per class rather than
  inherited from a `*` rule.
* Explicit `margin` and `padding` on every text-flow element the theme emits — headings,
  paragraphs, lists, `figure`, `blockquote` — never relying on the UA default being zeroed.
* `list-style: none` and zeroed `padding-inline-start` on the theme's own lists.
* `display: block` and `max-width: 100%` on the theme's own images.
* `font: inherit`, `color: inherit`, `background: none`, `border: 0` and `appearance: none` on every
  button and form control the theme renders, since UA defaults there are the largest and least
  portable.
* `line-height` and `font-family` declared at the theme's root element rather than assumed from the
  host.

**Nerey ships no global reset.** There is no `@nerey/theme/reset.css`, and `theme.css` contains no
bare element selector, no `*` selector, and no `:where(...)` descendant blanket. The page-level reset
is the consumer's to own — it is a whole-document decision, and a component library that makes it on
the consumer's behalf is a component library that breaks their unrelated markup on upgrade.

Because ADR 0023 hashes every class name, "declares on its own elements" has a precise mechanical
meaning: every selector in the built `theme.css` begins with a hashed class. That is what the gate
checks.

### Consequences

* Good, because the theme renders identically under Preflight, under `normalize.css`, and under
  nothing, which is AC-18 restated.
* Good, because removing or scoping a reset in a consumer application is a safe operation with
  respect to Nerey — the class of unattributable, everywhere-at-once regressions described above
  cannot occur.
* Good, because the theme cannot damage consumer markup: with no bare-element and no descendant
  selectors, there is no rule that can reach DOM Nerey did not render, including children passed
  through the `render` prop of ADR 0021.
* Bad, because the stylesheet is more verbose and the same three or four declarations repeat across
  many classes. This is real duplication with no DRY escape that does not reintroduce a universal
  selector; it is paid in bytes, which gzip largely reclaims.
* Bad, because a newly authored component can omit a declaration and still look right on the
  author's machine, where a reset happens to be loaded. The gate exists because review does not
  catch this.
* Neutral, because consumers who *do* want a reset are unaffected — the theme neither needs nor
  fights one. Inherited typography still reaches the theme through `font-family`/`color` inheritance
  where the theme deliberately inherits.

### Confirmation

Two gates, each with a planted violator per ADR 0033.

`scripts/check-cascade.mjs` parses the **built** `packages/theme/dist/theme.css` (so it validates
the artifact consumers get, per ADR 0023) and fails on: any selector whose leftmost compound is not
a hashed class; any use of `*`; any bare element selector; any `!important`. It additionally asserts
that no file named `reset.css` is present in the packed tarball and that `theme.css` declares
`box-sizing` on at least every class that also declares `padding` or `border`.

`packages/theme/src/__tests__/reset-independence.test.ts` runs in the Storybook browser project of
ADR 0006 and is the direct expression of AC-18: it mounts every story twice — once in a document
with no author stylesheet other than the theme, once with Preflight loaded first — walks the whole
rendered subtree, and asserts `getComputedStyle` equality across the two runs for `box-sizing`,
`margin`, `padding`, `border-width`, `list-style-type`, `display`, `font-family`, `font-size` and
`line-height`. A property that differs names the exact element and the exact property, which is a
better failure report than the screenshot comparison AC-18 describes; the screenshot pair is kept as
a secondary check for the properties computed styles do not capture.

## Pros and Cons of the Options

### Self-sufficiency: every property a reset would normalise is declared explicitly on the theme's own elements, and no global reset is shipped

* Good, because correctness has no external precondition; the theme is a closed system.
* Good, because the blast radius of the theme's CSS is exactly the nodes it renders.
* Good, because it composes with any host reset, present or absent, in either order.
* Neutral, because the verbosity is mechanical and generated diffs stay readable.
* Bad, because declarations repeat and the stylesheet grows.
* Bad, because omissions are invisible locally and need automated detection.

### Ship a scoped reset: a universal-selector block confined to a Nerey root class

The pragmatic middle ground, and what several component libraries ship — `.nerey-root, .nerey-root *
{ box-sizing: border-box; margin: 0; }` gives self-sufficiency in a dozen lines instead of hundreds.

* Good, because it is dramatically less code and no component author can forget a declaration.
* Good, because it still avoids touching the document outside the Nerey subtree.
* Neutral, because the specificity cost of the descendant universal selector is negligible on
  modern engines.
* Bad, because `*` under a root reaches consumer DOM: children passed into message and overlay
  slots (ADR 0017), and any element substituted through the polymorphic `render` prop of ADR 0021,
  are inside that subtree. Zeroing their margins is Nerey silently restyling markup it does not own.
* Bad, because it is a global reset with a narrower selector — it has the same failure shape, just
  aimed at the consumer instead of at Nerey.
* Bad, because it defeats the gate: once `*` is permitted, "every selector starts with a hashed
  class" is no longer checkable, and omissions inside components become undetectable again.

### Declare a required peer reset and document it as a prerequisite

* Good, because it is free to implement and the theme's CSS stays minimal.
* Good, because most target applications already ship a reset, so it works on day one almost
  everywhere.
* Neutral, because the requirement can at least be stated in the README and in the Storybook docs.
* Bad, because it makes correctness depend on an artifact Nerey neither controls nor can detect at
  runtime, and the dependency is invisible until it is violated.
* Bad, because "which reset" is unanswerable: Preflight and `normalize.css` disagree — Preflight
  zeroes headings and removes list markers, `normalize.css` deliberately preserves both — so the
  theme would have to pick one and inherit its opinions, coupling `@nerey/theme` to a Tailwind
  version.
* Bad, because it fails AC-18 by definition, and it institutionalises the everywhere-at-once
  breakage this record exists to prevent.

## More Information

Implements FR-32 and satisfies AC-18. Depends on the hashed-class output of ADR 0023 for its
enforceability, and on the token fallbacks of ADR 0024 so that self-sufficiency covers values as
well as structural properties. The slot hosts whose children must not be reached are ADR 0017; the
polymorphic escape hatch that puts consumer DOM inside the theme's subtree is ADR 0021. Contrast and
focus-visibility assertions that run over the same rendered output are ADR 0032.

The reset question is a documentation obligation as well as a code one: `@nerey/theme`'s README must
state plainly that Nerey ships no reset and that the page-level reset remains the consumer's
decision, so its absence reads as intent rather than oversight. Revisit if the theme's stylesheet
size becomes a measured problem, in which case the repetition — not the principle — is what gets
optimised, most likely by a build-time rule merger.
