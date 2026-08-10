---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0020. data-* attributes are the public styling API

## Context and Problem Statement

`@nerey/core` renders DOM it owns — the three slot hosts, the widget root, and the parts inside the
two built-in widgets (ADR 0035) — and ships no CSS at all. A consumer who takes core alone must be
able to style every one of those nodes, in every state, from their own `.module.css`, without
importing `@nerey/theme` and without knowing a single Nerey class name. That requires a selector
surface: a documented set of hooks in the rendered markup that a stylesheet can target and that
internal refactors are forbidden to move. The decision is what those hooks are made of, and what
declaring them "public" obliges us to afterwards.

## Decision Drivers

* A consumer must reach all eight documented states — idle, hover, tentative selection, submitting,
  locked, expired, error fallback, read-only replay — with no wrapper components and no `!important`.
* State that core already tracks (the `readonly` flag driven by the lifecycle runtime, ADR 0018; the
  placement slot, ADR 0017) should reach CSS without a second mechanism bolted on.
* `@nerey/theme` compiles to hashed CSS Module class names (ADR 0023); those names can never become
  the thing a consumer selects on, or replacing the theme breaks their stylesheet.
* The chosen surface becomes public API and inherits the versioning obligations of ADR 0029.
* Drift must be caught by a gate. "We documented it" is not a mechanism.

## Considered Options

* `data-*` attributes as the styling contract
* Stable, documented class names
* Per-part class-name injection through a passthrough prop

## Decision Outcome

Chosen option: "`data-*` attributes as the styling contract", because it is the only option that
carries identity *and* state in the same mechanism, occupies a namespace the consumer's own class
names cannot collide with, and cannot be overwritten by the `className` that core primitives accept
(ADR 0021) — a class-name contract shares one attribute with consumer input and is therefore one
careless `className=` away from being erased.

The surface is exhaustive and closed:

* `data-nerey-widget="<type>"` on the widget root — the registry `type` only, never `type@version`.
  Resolution is exact-match on the versioned key (ADR 0009), but the selector deliberately is not:
  a consumer's CSS must not break the day a widget moves from `poll@1.0` to `poll@2.0`.
* `data-nerey-part="<part>"` on every node core owns inside a widget.
* `data-nerey-slot="message" | "input" | "overlay"` on the slot hosts of ADR 0017.
* `data-state="idle" | "selected" | "submitting" | "locked" | "expired" | "error"` — one value at a
  time, on the node the state belongs to, never a space-separated set.
* `data-readonly` — valueless, present or absent, written by the lifecycle runtime of ADR 0018.

Streaming is not a `data-state` value. The four-state tool-part machine reaches a widget as the
`status` prop (ADR 0019) and the widget decides whether that becomes visible DOM state; folding it
into `data-state` would put a host-level concern and a widget-level concern in one enumeration.

### Consequences

* Good, because an attribute selector has the same specificity as a class (0,1,0), so
  `[data-nerey-part="option"][data-state="locked"]` outranks a single-attribute rule on merit and
  still loses to a consumer's own two-class selector. No specificity arms race in either direction.
* Good, because `@nerey/theme` selects on exactly the same attributes (ADR 0023, ADR 0026,
  ADR 0027). There is one contract, not two, and a consumer who starts with the theme and later
  replaces it keeps every selector they already wrote.
* Good, because state core owns is legible to CSS with no prop plumbing and no class-name mapper —
  the lifecycle runtime writes `data-readonly` and the consumer's stylesheet reacts.
* Neutral, because attribute strings cannot be minified, so the contract ships verbatim in the DOM.
  At the size of a chat transcript this is noise, not weight.
* Bad, because renaming an attribute, adding a `data-state` value, or relocating a part is now a
  MAJOR release under ADR 0029 — the surface is as expensive to change as an exported function
  signature, and it is far easier to change by accident.
* Bad, because every state core knows must be mirrored into the DOM whether or not core itself uses
  it. That creates a defect class with no symptom inside core: state tracked correctly in React,
  never reflected in an attribute, discovered only in a consumer's stylesheet.

### Confirmation

* `npm run check:data-contract` → `scripts/check-data-contract.mjs` renders every registered widget
  through the conformance kit in each documented state and diffs the emitted attribute set against
  `docs/contracts/data-attributes.json`. An undeclared attribute, a missing state, or a `data-state`
  value outside the enumeration fails the gate.
* The same script treats a modified `docs/contracts/data-attributes.json` as a major-bump trigger:
  the contract file and the package version must move together or the gate fails, which is how
  ADR 0029 is enforced for a surface that has no TypeScript signature to diff.
* `packages/core/src/__tests__/data-contract.snapshot.test.tsx` locks the rendered markup of the
  `text` and `confirmation` widgets (ADR 0035) attribute by attribute, so a refactor that quietly
  drops `data-nerey-part` fails in CI instead of in a consumer's CSS three releases later.
* ESLint rule `@nerey/no-undeclared-data-attribute`, shipped in `@nerey/eslint-config`, rejects any
  `data-nerey-*` JSX attribute whose name is absent from the contract file — invention is caught at
  edit time through the hooks of ADR 0034, not at review time.
* The gate proves itself against a planted violator per ADR 0033, and runs inside `check:all`.

## Pros and Cons of the Options

### `data-*` attributes as the styling contract

Attributes carry both identity (`data-nerey-part="option"`) and state (`data-state="locked"`) in a
namespace reserved for the library.

* Good, because identity and state use one mechanism, so a state change is an attribute value
  change rather than the addition and removal of class names.
* Good, because `data-nerey-*` is a namespace no consumer stylesheet writes into by accident, and no
  bundler or CSS Modules pipeline rewrites.
* Good, because the attribute survives `className` — a consumer can pass, replace, or forget their
  own class and the contract is untouched.
* Good, because the same selectors work in a plain stylesheet, a CSS Module, and a Tailwind
  arbitrary variant, which matters when core has no idea what the consumer's pipeline is.
* Neutral, because the surface is small enough to keep in one JSON contract file and large enough
  that the file has to be maintained deliberately.
* Bad, because selectors are more verbose than a class name and read worse in review.
* Bad, because DOM attributes are visible to anyone with devtools, so the contract will be used in
  ways we did not intend and will have to be honoured anyway.

### Stable, documented class names

The BEM-flavoured approach every styled component library takes: ship `nerey-widget`,
`nerey-widget__option`, `nerey-widget__option--locked` and document them.

* Good, because it is the most familiar mechanism in front-end work and needs no explanation.
* Good, because a single class token is shorter to type and cheaper to read than an attribute
  selector.
* Neutral, because specificity is identical to the attribute approach, so nothing is gained or lost
  in the cascade.
* Bad, because class names and the consumer's `className` (ADR 0021) share one DOM attribute. Any
  primitive that lets the consumer pass a class also lets them clobber the contract, and the two
  features cannot both be safe.
* Bad, because state has to be encoded as extra class names, so the name count multiplies with every
  state and each one is separately breakable.
* Bad, because `@nerey/theme` hashes its CSS Module class names by design (ADR 0023). Shipping a
  second, unhashed, contractual set means the theme and core disagree about what a class name is.
* Bad, because class names live in a flat global namespace shared with the consumer's own CSS, and
  `.option` collides in a way `data-nerey-part="option"` cannot.

### Per-part class-name injection through a passthrough prop

A `classNames={{ root, option, label }}` or `pt={{}}` object on every widget, the mechanism
PrimeReact and MUI expose.

* Good, because targeting is precise and typed — the consumer sees the available parts in
  autocomplete.
* Good, because it needs no attribute contract at all; the DOM can be refactored freely as long as
  the prop keys stay.
* Neutral, because it composes with a design system that is already prop-driven.
* Bad, because the internal element tree becomes public API in prop form, which is the same
  obligation as the attribute contract with none of the cascade benefits.
* Bad, because styling becomes a JavaScript concern applied per instance: the consumer repeats the
  object at every call site, or writes a wrapper component per widget, which is the wrapper layer
  the headless split exists to avoid.
* Bad, because a `.module.css` alone can no longer style anything — every rule needs a matching prop
  wired through the render tree.
* Bad, because this is precisely the `pt={{}}` failure carried by the origin codebase; reproducing
  it under a new name would make the extraction pointless.

## More Information

Implements FR-26 and the styling half of AC-14 and AC-17.

The contract binds both packages: ADR 0023, ADR 0026 and ADR 0027 all select on these attributes
rather than on theme-internal names, which is what keeps `@nerey/theme` replaceable rather than
merely optional.

Two adjacent records complete the picture. ADR 0021 provides the escape hatch for nodes the contract
does not name, and explains why `className` is safe on this layer. ADR 0022 governs the attributes
emitted by the wrapped behavioural dependency: Base UI's own `data-open` / `data-closed` markers are
*not* part of this surface and must be mapped into `data-state` by the wrapper, otherwise the public
styling contract silently becomes a vendor's and a future swap breaks every consumer stylesheet.
