---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0021. Headless primitives accept className and a polymorphic render prop

## Context and Problem Statement

The attribute contract of ADR 0020 covers the nodes core names. It does not cover the two things a
consumer integrating a headless library actually hits first: attaching their own class to a node so
their existing CSS pipeline applies to it, and changing what element a primitive renders — a
`<button>` that must become their `<Button>`, an anchor that must become a router `<Link>`, a root
that must be their layout component. Without either, integration means wrapping every primitive in a
`<div>`, which changes the box model of a component whose whole job is layout and positioning, or
reaching the node through `:has()` and child combinators off the data attributes, which couples the
consumer's CSS to core's element tree far more tightly than a class would.

This sits uncomfortably next to ADR 0026, which forbids `className` on themed components in the
strongest terms. The two rules must be reconciled explicitly or they will be read as an
inconsistency and one of them will be broken.

## Decision Drivers

* Core ships zero CSS, so there is nothing on these nodes for a consumer class to fight with.
* A consumer must be able to substitute their own element or component without losing the behaviour,
  refs, event handlers and ADR 0020 attributes the primitive attaches.
* The escape hatch must not become a second styling contract that competes with the data attributes.
* Whatever shape polymorphism takes has to survive TypeScript strict mode with
  `noUncheckedIndexedAccess` (ADR 0003) without producing inference that collapses to `any`.
* The wrapped behavioural dependency (ADR 0022) already has a polymorphism convention; diverging from
  it turns every wrapper into a translation layer.

## Considered Options

* `className` plus a polymorphic `render` prop
* Attribute contract only, with no `className` and no element control
* `asChild` child-cloning
* An `as` / `component` polymorphic prop

## Decision Outcome

Chosen option: "`className` plus a polymorphic `render` prop", because this is the one layer whose
entire purpose is being styled and composed from outside, and withholding the escape hatch here does
not prevent passthrough styling — it relocates it into consumer wrapper components, which is the
`pt={{}}` problem reproduced one level down with worse ergonomics and no type checking.

The rules attached to the decision:

* `className` is appended to the primitive's own attributes, never replaces them. Passing a class
  cannot remove `data-nerey-part`, `data-state` or `data-readonly` (ADR 0020).
* `render` accepts either a React element or a function `(props, state) => ReactNode`. The function
  form receives the merged DOM props and a flat, explicitly declared state object — never an
  inferred union — so the call site can decide what to spread and what to override.
* Whatever `render` returns still carries the contract attributes, the forwarded ref, and every
  keyboard and pointer handler the primitive installs. Substituting the element must not be able to
  silently remove behaviour.
* Props are forwarded explicitly. No `{...rest}` into a root element, so an unrecognised prop is a
  type error rather than a stray DOM attribute.

**Why this does not contradict ADR 0026.** The two rules are one rule applied to layers with
opposite ownership of the paint.

In `@nerey/core` there is no Nerey CSS on the node. A consumer's class is the only paint present:
nothing to override, no specificity contest, no internal names to freeze, and the primitive stays
replaceable because there is nothing to replace but behaviour.

In `@nerey/theme` the node already carries theme-owned hashed CSS Module classes (ADR 0023). A
consumer class there wins ties by stylesheet source order rather than by intent, mutates DOM the
theme owns, and — because the only way to write a useful override is to target the theme's element
structure — turns that structure into de-facto public API. Once that happens the theme cannot be
replaced without breaking consumers, which is the single property the package split exists to
preserve. Themed deviation therefore goes through `variant` / `size` / `tone` and scoped custom
properties instead.

The rule generalises: `className` is safe exactly where the library ships no CSS, and corrosive
exactly where it does.

### Consequences

* Good, because a consumer can adopt `@nerey/core` inside their own design system with no wrapper
  layer, which is the adoption path FR-27 is protecting.
* Good, because `render` covers element substitution, framework component substitution, and
  composition into a portal without core enumerating those cases as props.
* Good, because it matches the convention of the wrapped dependency (ADR 0022), so the wrapper for a
  Base UI primitive forwards `render` rather than reinventing polymorphism on top of it.
* Neutral, because there are now two escape hatches to document and to test on every primitive; the
  test is table-driven, so the marginal cost per primitive is one row.
* Bad, because `className` lets a consumer override layout the primitive depends on — a
  `position: static` on a floating anchor breaks positioning that has nothing to do with looks. This
  is documented and not preventable without withdrawing the prop.
* Bad, because the function form of `render` exposes internal state names in the public type, so the
  state object's shape is semver-bound under ADR 0029 and cannot be refactored freely.
* Bad, because polymorphic typing is the part of a React library most likely to degrade into `any`
  under strict mode. It is contained by keeping the state argument a declared interface and by
  rejecting inference-heavy generic signatures in review.

### Confirmation

* `npm run check:public-api` → `scripts/check-public-api.mjs` extracts the rolled-up declaration
  file for each package and fails when an exported core primitive lacks `className?: string` or
  `render?`. The same gate fails when an exported themed component *has* `className`, so both this
  record and ADR 0026 are enforced by one check and cannot drift apart into a contradiction.
* `packages/core/src/primitives/__tests__/render-prop.contract.test.tsx` — table-driven over every
  exported primitive: a consumer `className` appears alongside rather than instead of the ADR 0020
  attributes; a `render` substitution still receives every `data-nerey-*` attribute, the forwarded
  ref, and the installed keyboard handlers; the function form receives the declared state shape.
* ESLint rule `@nerey/no-rest-spread-on-root` in `@nerey/eslint-config` rejects `{...rest}` and
  `{...props}` applied to a primitive's root element. Explicit forwarding is what keeps the prop list
  enumerable, and therefore checkable by the gate above.
* Both gates prove themselves against a planted violator per ADR 0033 and run at edit time through
  the hooks of ADR 0034.

## Pros and Cons of the Options

### `className` plus a polymorphic `render` prop

* Good, because it serves both integration needs — styling and element substitution — with two
  orthogonal props rather than one overloaded one.
* Good, because `render` is explicit about merged props: the call site sees what it is spreading and
  can override individual attributes deliberately.
* Good, because it degrades gracefully — a consumer who wants neither passes neither and styles
  through ADR 0020 attributes alone.
* Neutral, because the state argument becomes public API; that is a real cost, paid knowingly.
* Bad, because it hands the consumer enough rope to break behavioural CSS invariants.

### Attribute contract only, with no `className` and no element control

The strictest reading of the anti-passthrough position: the data attributes are the whole surface.

* Good, because it makes the contract of ADR 0020 unambiguous — there is exactly one way to style,
  and the internal element tree stays free to change.
* Good, because it removes any possibility of a consumer breaking layout invariants through CSS.
* Neutral, because for a purely presentational tree it would in fact be sufficient.
* Bad, because element substitution has no answer at all: a router `<Link>` or a design-system
  `<Button>` cannot be used, and the consumer wraps instead — adding DOM the primitive did not plan
  for, inside layouts that assume direct parent-child relationships.
* Bad, because the styling restriction is not enforceable in practice; it pushes consumers into
  wrapper components whose classes sit on an extra element, which is passthrough styling with an
  extra `<div>` tax.
* Bad, because a consumer using utility CSS has no mechanism at all — every rule must be written as
  an attribute selector in a global stylesheet, defeating their own build pipeline.

### `asChild` child-cloning

The Radix convention: the component clones its single child and merges props into it.

* Good, because the call site reads as ordinary JSX with no function indirection.
* Good, because it is widely known, so the pattern needs no documentation.
* Neutral, because prop merging semantics are equivalent to `render` when it works.
* Bad, because it requires exactly one element child and fails at runtime on fragments, conditional
  children, and text — a whole class of errors that appear only when a branch is taken.
* Bad, because merged props are invisible at the call site, so a consumer overriding `onClick` cannot
  see what they displaced.
* Bad, because it depends on the child forwarding refs, which third-party components frequently do
  not, producing silent behavioural loss rather than a type error.
* Bad, because the wrapped dependency (ADR 0022) uses `render`, so adopting `asChild` would mean
  translating between two polymorphism models inside every wrapper.

### An `as` / `component` polymorphic prop

* Good, because it is the simplest thing to type for the common case of swapping one intrinsic
  element for another.
* Neutral, because it covers substitution but says nothing about styling, so `className` is still
  needed alongside it.
* Bad, because generic inference over `as` is the classic source of unusable error messages and
  collapsed types in strict mode (ADR 0003), especially once ref forwarding is generic too.
* Bad, because it gives no control over how props are merged — the consumer's component receives
  whatever the primitive decided to pass, with no place to intervene.
* Bad, because it cannot express composition, only substitution: wrapping the rendered element in
  extra markup is impossible.

## More Information

Implements FR-27. The `render` prop shape mirrors the wrapped dependency's own convention as decided
in ADR 0022, which is what keeps those wrappers thin.

The relationship worth restating for anyone reading these records out of order: ADR 0020 defines the
styling contract, this record defines the escape hatch on the layer that ships no CSS, and ADR 0026
withdraws that escape hatch on the layer that does. Primitives are reachable only through the
`@nerey/core` entry point of ADR 0028 — there is no deep import into an internal primitive path, so
the props described here are the whole of what a consumer can reach.
