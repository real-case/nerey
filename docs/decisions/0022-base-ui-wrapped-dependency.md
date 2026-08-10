---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0022. Base UI as a wrapped, never re-exported behavioural dependency

## Context and Problem Statement

Some of the chrome Nerey has to render is interactive in ways that are expensive to implement and
notoriously easy to get subtly wrong: focus trapping and restoration, viewport-aware floating
positioning with collision handling, roving tabindex, typeahead selection, scroll locking, and the
ARIA relationships that hold those behaviours together. An overlay-slot widget (ADR 0017) needs most
of them at once. Writing them by hand is weeks of work whose defects surface as accessibility bugs in
someone else's product; taking a dependency puts a third party's DOM, release cadence and types
inside a library whose entire pitch is that it does not impose choices on its consumer.

The decision is therefore not only which behavioural library to use, but how much of it is allowed to
be visible from outside `@nerey/core`.

## Decision Drivers

* Behaviour of this kind must be correct on day one; the accessibility gate of ADR 0032 fails builds
  rather than warning, so a hand-rolled focus trap is a blocked release, not a backlog item.
* No dependency may appear in `@nerey/core`'s public types, or every consumer inherits it at
  type-resolution time and a swap becomes a breaking change under ADR 0029.
* The vendor must stay swappable: this space has four credible implementations and has churned twice
  in three years.
* The styling contract of ADR 0020 must remain Nerey's, not the vendor's.
* `@nerey/core` ships zero CSS, so the dependency must ship none either.

## Considered Options

* Wrap `@base-ui/react` behind Nerey primitives and never re-export it
* Re-export Base UI as part of the public surface, with it as a peer dependency
* Hand-roll the behaviour with no behavioural dependency
* Build on React Aria hooks instead

## Decision Outcome

Chosen option: "Wrap `@base-ui/react` behind Nerey primitives and never re-export it", because it is
the only option that buys the behaviour without selling the boundary: the consumer gets a focus trap
that works, and Nerey keeps the right to replace the thing that implements it without a major
release.

Base UI v1.7 supplies focus trap and focus restoration, floating positioning, roving tabindex,
typeahead, scroll lock, and the ARIA wiring for the behaviour it owns. Everything without behaviour
is Nerey's own markup.

The terms of the wrapping:

* `@base-ui/react@^1.7` is a regular runtime dependency of `@nerey/core`, deliberately not a peer.
  The consumer never installs it, never resolves its types, and cannot land on a version the wrapper
  was not tested against.
* Props are declared explicitly on every wrapper. `ComponentProps<typeof Base.Popover.Root>` and
  every variant of that trick are banned: a derived prop type puts `@base-ui/react` into the emitted
  declaration file, which makes the dependency a type-level peer for every consumer and turns a
  runtime-only swap into a breaking type change no matter how faithful the wrapper is.
* The state contract is `open` / `defaultOpen` / `onOpenChange`, the shape Base UI, Radix, React Aria
  and Ark independently converged on. A wrapper is then prop mapping rather than semantic
  translation, and a future swap is mechanical work in one directory instead of a redesign.
* Compound APIs stay compound under Nerey's own namespace — `Popover.Root`, `Popover.Trigger`,
  `Popover.Positioner`, `Popover.Popup` — rather than being flattened into a single component with a
  prop bag. Flattening removes the ability to place trigger and popup independently and reintroduces
  the passthrough problem of ADR 0021 for every part it hides.
* Base UI's own `data-open` / `data-closed` markers are not public. The wrapper maps them into
  Nerey's `data-state` (ADR 0020); an unmapped vendor attribute reaching the DOM means the public
  styling contract has silently become the vendor's.
* `render` is forwarded rather than reimplemented, since ADR 0021 chose the same polymorphism shape
  Base UI uses.

**The ARIA convention is deliberately reversed.** The origin codebase forbade writing ARIA
attributes by hand. That rule was correct in its context: PrimeReact supplied roles and `aria-*` for
its own components, and hand-added attributes could only contradict them. Nerey is a headless library
that emits interactive DOM with no vendor chrome. If it does not set roles, `aria-expanded`,
`aria-controls`, labelling relationships and live-region semantics for its own markup, nobody does —
the consumer cannot reach inside to add them, and the WCAG 2.2 AA gate of ADR 0032 would fail with no
legitimate way to pass. Base UI supplies ARIA for the behaviour it owns; Nerey's own markup supplies
the rest, and the ban is not carried into this codebase.

### Consequences

* Good, because focus management, collision-aware positioning and typeahead are not Nerey's defect
  surface, and their fixes arrive as dependency updates.
* Good, because a swap is confined to `packages/core/src/primitives/**`. No consumer type, no
  selector, and no widget changes, which is what makes the swap a minor release rather than a
  migration.
* Good, because ARIA that Nerey writes itself is testable — ADR 0032 can assert it, which a
  no-ARIA convention would have made impossible.
* Neutral, because it adds one runtime dependency to a package whose selling point is having almost
  none. The ban list of ADR 0037 and FR-4 is about ports — transport, LLM SDK, markdown, HTTP — not
  about behavioural primitives, and Base UI ships no CSS, so the zero-CSS rule is untouched.
* Bad, because the wrapper is real code with real tests for props that re-exporting would have given
  away free, and every new Base UI capability needs a deliberate wrapper before consumers can use it.
* Bad, because a Base UI patch release can change rendered DOM structure without changing its types,
  which breaks the `data-state` mapping in a way TypeScript cannot see.

### Confirmation

* `npm run check:public-api` → `scripts/check-public-api.mjs` scans every emitted `.d.ts` for
  `@base-ui` and for `ComponentProps<typeof`, failing on either. A type-level leak is caught at build
  time rather than in a consumer's `tsc` output.
* `@nerey/eslint-config` ships a `no-restricted-imports` rule permitting `@base-ui/react` only under
  `packages/core/src/primitives/**`. An import from a widget, a host, or `@nerey/theme` is an error
  with the documented message.
* `packages/core/src/__tests__/no-reexport.test.ts` compares the module namespace of the
  `@nerey/core` entry point (ADR 0028) against Base UI's own export list and fails if any identifier
  is passed through.
* `npm run check:data-contract` (ADR 0020) covers the attribute mapping: a vendor `data-open`
  reaching rendered output is an undeclared attribute and fails the contract gate.
* The accessibility gate of ADR 0032 — axe at WCAG 2.2 AA, failing rather than advisory — is the
  confirmation for the ARIA reversal. Claiming to write ARIA is worth nothing unless it is checked.
* Vendor DOM drift is the one risk with no forward-looking gate; the mitigation is that dependency
  updates run the full suite, with the data-contract and accessibility gates as the tripwire. Any
  gate here self-tests against a planted violator per ADR 0033.

## Pros and Cons of the Options

### Wrap `@base-ui/react` behind Nerey primitives and never re-export it

* Good, because the hardest behaviour is bought, and the boundary that makes it replaceable is kept.
* Good, because the wrapper is the natural place to enforce ADR 0020 attributes and ADR 0021 props
  uniformly, which a re-export cannot do.
* Good, because Base UI's `render` prop and `open`/`onOpenChange` contract match the shapes already
  chosen, so wrappers are thin.
* Neutral, because the dependency is invisible to consumers, which is a benefit until someone wants
  a Base UI feature Nerey has not wrapped.
* Bad, because every capability needs explicit surfacing work, and wrapper drift against upstream is
  ongoing maintenance.

### Re-export Base UI as part of the public surface, with it as a peer dependency

* Good, because it is nearly free: the full capability of the dependency is available immediately,
  with no wrapper to write or maintain.
* Good, because consumers already using Base UI share one instance and one version.
* Neutral, because documentation could be delegated upstream.
* Bad, because the vendor becomes permanent public API — swapping it is then a major release for
  everyone, which is exactly the option value this record exists to keep.
* Bad, because Base UI's `data-*` and prop names become the styling and integration contract,
  overriding ADR 0020 with something Nerey does not control.
* Bad, because a peer dependency pushes version management onto the consumer, and a mismatched
  version produces broken behaviour rather than a clear install error.
* Bad, because it defeats the packaging position of ADR 0028: the surface would grow by everything
  upstream exports, including parts Nerey never uses or tests.

### Hand-roll the behaviour with no behavioural dependency

* Good, because zero dependencies is the cleanest possible boundary, with nothing to leak and
  nothing to swap.
* Good, because DOM output and attribute contract are fully ours by construction.
* Neutral, because the simplest pieces — a scroll lock, a basic roving tabindex — are genuinely
  small.
* Bad, because focus restoration across portals, collision-aware positioning, and typeahead with
  composition events are where the real defects live, and they are the ones that appear only in
  screen readers, on Safari, or under an on-screen keyboard.
* Bad, because ADR 0032 fails the build on accessibility defects, so this option converts a
  dependency choice into an open-ended blocking workstream.
* Bad, because it is the option most likely to be quietly abandoned halfway, leaving a
  half-implemented focus trap that is worse than either alternative.

### Build on React Aria hooks instead

* Good, because it is the most rigorously tested accessibility implementation available, with the
  broadest assistive-technology coverage.
* Good, because hooks return props rather than components, so Nerey would own all the DOM outright.
* Neutral, because it would be wrapped and hidden on exactly the same terms as Base UI, so the
  boundary argument is unchanged — this is a vendor choice, not a policy choice.
* Bad, because owning all the DOM also means owning all the composition: each primitive becomes an
  assembly job across several hooks, which is materially more wrapper code than mapping props onto a
  component.
* Bad, because its state contract does not use `open` / `defaultOpen` / `onOpenChange`, so adopting
  it as the base would either impose a different public shape or require semantic translation in
  every wrapper — the mechanical-swap property is lost at the start rather than kept in reserve.
* Bad, because the redesign work already completed for the chat surface is expressed in Base UI
  compound components; rebasing it would repeat that work with no user-visible gain.

## More Information

Implements FR-28 and carries forward the prior decisions recorded in the technical context: the
`open` / `defaultOpen` / `onOpenChange` state contract, explicitly declared props instead of derived
ones, compound APIs kept compound, and explicit prop forwarding with no `{...rest}` into a root
(ADR 0021).

The "deliberately not carried in" item is recorded here rather than left as tribal knowledge,
because a convention inherited from a styled component library is exactly the kind of rule that gets
re-imposed by habit during review. The reversal has a gate behind it: ADR 0032.

Boundary enforcement is shared with ADR 0028 on the packaging side and ADR 0015 on the lint side —
the same `@nerey/eslint-config` that keeps I/O out of widgets keeps Base UI out of everything but the
primitives directory.
