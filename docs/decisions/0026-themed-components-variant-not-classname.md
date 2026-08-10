---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0026. Themed components expose variant, size and tone — never className

## Context and Problem Statement

ADR 0021 gives the headless primitives in `@nerey/core` a `className` prop and a polymorphic
`render` prop, on the argument that a layer whose entire purpose is to be styled from outside must
not withhold the escape hatch. The obvious next move is to give the themed components in
`@nerey/theme` the same prop, because that is what essentially every component library does and it
costs one `clsx` call.

Doing that would destroy the reason `@nerey/theme` is a separate package. A `className` on a themed
component is not configuration; it is a licence to write CSS against Nerey's DOM — its nesting, its
element choices, its hashed class names, its specificity. Once consumers have written that CSS, the
theme's internals are load-bearing for them: restructuring a widget breaks their overrides, and
their overrides fight the theme's own declarations on specificity, which ends in `!important` and a
direct AC-17 violation. Worse, it makes the theme *unreplaceable* — a consumer who later wants their
own visual layer must unpick per-instance overrides scattered across their feature code, so they
keep the theme forever and pay to override it, which is the exact anti-pattern the two-package split
exists to prevent.

This record settles the themed component prop surface and reconciles it with ADR 0021.

## Decision Drivers

* FR-33: themed components expose `variant` / `size` / `tone`, not `className`; per-instance
  deviation goes through CSS custom properties scoped to a container.
* AC-17: a full rebrand must be achievable by redeclaring custom properties, with no component
  override and no `!important` anywhere in the consumer's CSS.
* ADR 0023 makes class names hashed implementation details; a `className` merge silently promotes
  the surrounding DOM shape to public API even though the names stay opaque.
* The theme must stay replaceable. The documented path for a consumer with their own design system
  is `@nerey/core` plus their own CSS Modules against the `data-nerey-*` contract of ADR 0020 — not
  a patched `@nerey/theme`.
* ADR 0029 versions the theme semantically; if consumer CSS depends on internal structure, every
  visual refactor is a major.

## Considered Options

* Closed prop surface: `variant`, `size`, `tone`, with per-instance deviation via `--nerey-*`
  custom properties set on a container the consumer owns
* `className` passthrough merged with the theme's own classes, the near-universal library default
* A per-slot override map (`classNames={{ root, header, option }}` / `slotProps` / PrimeReact-style
  `pt={{}}`)

## Decision Outcome

Chosen option: "Closed prop surface: `variant`, `size`, `tone`, with per-instance deviation via
`--nerey-*` custom properties set on a container the consumer owns", because it is the only option
under which a consumer's visual intent is expressed in terms the theme defines and can therefore
keep honouring across refactors — and the only one that leaves the theme genuinely swappable.

The three axes are enumerated string unions, not open strings, so an unknown value is a type error
under ADR 0003 rather than a missing class at runtime:

* `variant` — structural treatment (`'solid' | 'outline' | 'ghost'`), selects a class.
* `size` — density (`'sm' | 'md' | 'lg'`), selects a class that sets the size-related tokens for
  the subtree.
* `tone` — semantic colour role (`'neutral' | 'accent' | 'positive' | 'critical'`), selects a class
  that remaps the colour tokens for the subtree.

Nothing else is accepted. No `className`, no `style`, no `classNames`/`slotProps`/`pt` map, no
`{...rest}` spread into the root, and no index signature on the props type. Data attributes
(ADR 0020) are emitted by the component, not accepted from the caller.

Per-instance deviation has one sanctioned mechanism: the consumer sets `--nerey-*` properties
(ADR 0024) on any element they own, and inheritance carries them into the Nerey subtree.

```css
/* consumer's own module — no Nerey class name, no !important */
.compactSidebar {
  --nerey-space-3: 0.5rem;
  --nerey-color-accent: var(--brand-500);
}
```

Reconciliation with ADR 0021, stated explicitly because the two records look contradictory: the two
packages sit on opposite sides of the styling boundary. `@nerey/core` primitives own no CSS and
exist to be styled from outside, so withholding `className` there would leave consumers with no way
to style anything — that is ADR 0021, and it stands unchanged. `@nerey/theme` components are a
*finished visual product* whose CSS is the deliverable; a `className` there is not an escape hatch
but a second, unversioned styling API layered over the first. The escape hatch for the theme is not
a prop, it is a package: drop to `@nerey/core`. Both records answer "who owns this DOM's
appearance", and they answer it differently because the answer differs.

### Consequences

* Good, because the theme's DOM and class names stay private and can be restructured without a
  breaking change under ADR 0029.
* Good, because AC-17 stays reachable: there is no per-instance override channel that could
  outrank a token redeclaration, so no consumer ever needs `!important`.
* Good, because the props type is small, enumerated and self-documenting, which is also what makes
  the theme legible to an agent generating usage.
* Good, because a consumer who outgrows the theme leaves cleanly — their styling lives in their own
  CSS against `data-nerey-*` (ADR 0020), not in props scattered across their JSX.
* Bad, because a genuine one-off — "this card needs 4px more padding on this one screen" — has no
  one-line answer; the consumer must define a container class with token overrides. That friction
  is deliberate and is the mechanism by which one-offs stay expressible in the design system's own
  vocabulary.
* Bad, because the axes must be designed up front, and adding a fourth axis later is an additive
  API change on every component that takes it.
* Neutral, because a consumer who truly needs arbitrary CSS is not blocked — they wrap the themed
  component in their own element and style that, or they drop to core.

### Confirmation

`npm run check:public-api` is the primary gate, wired into `npm run check:all` with a planted
violator per ADR 0033. It builds the API report for `@nerey/theme`
(`packages/theme/api/theme.api.md`, committed and diffed) and fails if any exported component's
props type: declares `className`, `style`, `classNames`, `slotProps` or `pt`; extends
`HTMLAttributes`, `ComponentProps` or any DOM prop type; or carries an index signature. It also
fails if `variant`, `size` or `tone` is typed as `string` rather than a literal union.

Three supporting checks:

* `packages/theme/src/__tests__/props.test-d.ts` — type-level assertions, `@ts-expect-error` on
  `<Card className="x" />`, `<Card style={{}} />` and `<Card tone="fuchsia" />`, so the refusal is
  proven at the type layer and not merely absent from the report.
* A runtime test asserting that an unknown prop passed through `as any` does not appear as an
  attribute on the rendered root — proof that no implicit spread survives.
* `@nerey/no-classname-on-themed`, an ESLint rule shipped in `@nerey/eslint-config` next to the I/O
  boundary rule of ADR 0015 and enabled by the flat config of ADR 0005, which flags a `className`
  or `style` JSX attribute on any component imported from `@nerey/theme` in consumer code. This
  catches the `as any` workaround at the call site, where the type gate cannot.

## Pros and Cons of the Options

### Closed prop surface: `variant`, `size`, `tone`, with per-instance deviation via `--nerey-*` custom properties set on a container the consumer owns

* Good, because every consumer-expressible variation is one the theme defined and can preserve.
* Good, because token-based deviation composes and cascades — it scopes to a container, a route or
  a whole application with the same syntax, and it is the same mechanism light/dark uses (ADR 0027).
* Good, because there is no specificity contest, therefore no `!important`.
* Neutral, because it demands more design work before the first release.
* Bad, because unanticipated one-offs are awkward and require a container class.
* Bad, because a new visual axis is an API change rather than a CSS change.

### `className` passthrough merged with the theme's own classes, the near-universal library default

What almost every component library ships: `class={clsx(styles.root, className)}`. Zero
implementation cost, matches consumer expectation, and unblocks every one-off instantly.

* Good, because it is familiar, expected, and removes all friction from ad-hoc adjustment.
* Good, because it composes trivially with Tailwind-style utility classes in the consumer's stack.
* Neutral, because it does not by itself expose class names — the theme's own remain hashed.
* Bad, because it exposes the *DOM shape*: consumer CSS is written against Nerey's nesting and
  element choices, so any structural refactor silently breaks their styling and every visual change
  becomes a major version under ADR 0029.
* Bad, because merged classes and theme declarations have equal specificity, so the outcome depends
  on stylesheet order across package boundaries. The reliable fix consumers reach for is
  `!important`, which is an explicit AC-17 failure.
* Bad, because it makes the theme unreplaceable: overrides accumulate in feature code, so leaving
  `@nerey/theme` becomes a migration rather than an import change — the outcome the two-package
  split was designed to prevent.
* Bad, because it duplicates ADR 0020: the same styling need is already served by `data-nerey-*`
  attributes on stable, documented, tested nodes, and offering both means the untested channel wins
  by convenience.

### A per-slot override map (`classNames={{ root, header, option }}` / `slotProps` / PrimeReact-style `pt={{}}`)

The "more principled" version, and a genuine step up in granularity: it names the parts instead of
dumping one class on the root.

* Good, because it reaches inner elements without descendant selectors, so consumer CSS is at least
  addressed to named parts.
* Good, because the part names can be documented and typed.
* Neutral, because it is strictly more expressive than a single `className`.
* Bad, because it publishes the internal part tree as API — a stronger commitment than `className`,
  since now both the DOM shape *and* its decomposition are frozen.
* Bad, because it is `className` N times over: the same specificity contest, the same `!important`
  endgame, multiplied by the number of slots.
* Bad, because FR-27 names this pattern explicitly as the problem being avoided; reproducing it in
  the theme after ADR 0021 avoided it in core would be a round trip to nowhere.

## More Information

Implements FR-33 and protects AC-17. Reconciles with ADR 0021, which is unchanged and continues to
govern `@nerey/core`. The consumer's supported styling channel is the data-attribute contract of
ADR 0020; the deviation mechanism is the token surface of ADR 0024; the hashed class names that must
stay private come from ADR 0023; light and dark are token overrides, not variants, per ADR 0027.
Import-time enforcement of the package boundary is ADR 0028, and the versioning consequence of a
private DOM is ADR 0029. The reference `poll` widget lives in this package and is the first real
test of whether three axes are enough.

Revisit if a fourth axis proves necessary across most components, or if a consumer's concrete
one-off cannot be expressed as a container-scoped token override — that case would be evidence the
token surface is under-factored (ADR 0024), not that `className` should return.
