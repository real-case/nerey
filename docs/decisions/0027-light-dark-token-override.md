---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0027. Light and dark as a token-value override

## Context and Problem Statement

`@nerey/theme` ships light and dark (FR-34). Two behaviours must hold simultaneously: values follow
the operating system through `prefers-color-scheme`, and an explicit `[data-nerey-theme="light"]` or
`[data-nerey-theme="dark"]` overrides the system preference **in both directions** (AC-19) — an
application whose user chose light must stay light on a machine set to dark, and vice versa. Most
implementations get one direction right, because a naive media query and a naive attribute selector
have the same specificity and the media query is usually written last.

The structural question underneath is which layer owns the difference between light and dark. If
components own it, every component grows a second appearance to write, review, test and keep in
sync, and every consumer-authored widget must implement dark mode itself or look broken next to the
built-ins. If values own it, light and dark are the same stylesheet resolved against a different set
of numbers, and a component author never thinks about it.

## Decision Drivers

* AC-19: `data-nerey-theme` set to `light` or `dark` overrides `prefers-color-scheme` in both
  directions.
* FR-35: rebranding by redeclaring custom properties alone; a scheme mechanism that requires
  swapping stylesheets or classes breaks that promise.
* A consumer must be able to invert a subtree — a dark sidebar in a light application — without a
  second copy of the CSS.
* No flash of the wrong scheme on first paint, and no requirement for JavaScript to establish the
  scheme.
* Adding a widget must cost exactly one appearance, so that consumer-authored widgets styled against
  the same tokens get dark for free.
* No `!important` anywhere in the theme, which ADR 0025's gate already enforces on the built CSS.

## Considered Options

* Token-value override in `tokens.css`: a `prefers-color-scheme` block and attribute selectors that
  rewrite the same custom-property names
* Two stylesheets, `theme-light.css` and `theme-dark.css`, with the consumer loading or swapping one
* Component-level dark treatment: a `colorScheme` prop or React context that selects dark variants
  of each component's classes

## Decision Outcome

Chosen option: "Token-value override in `tokens.css`: a `prefers-color-scheme` block and attribute
selectors that rewrite the same custom-property names", because light and dark differ only in
values, and expressing that as values keeps every component rule, every consumer stylesheet and
every future widget scheme-agnostic by construction.

`packages/theme/src/tokens.css` declares light as the base, then two overrides:

```css
:root {
  color-scheme: light;
  --nerey-color-surface: #ffffff;
  --nerey-color-text: #1a1a1a;
  /* remaining light token values */
}

/* system preference, but never against an explicit light choice */
@media (prefers-color-scheme: dark) {
  :root:not([data-nerey-theme='light']) {
    color-scheme: dark;
    --nerey-color-surface: #16181c;
    --nerey-color-text: #ececf1;
  }
}

/* explicit choice, either direction, on any element */
[data-nerey-theme='light'] { color-scheme: light; /* light values */ }
[data-nerey-theme='dark']  { color-scheme: dark;  /* dark values  */ }
```

Three details carry the decision and are not incidental:

1. The `:not([data-nerey-theme='light'])` qualifier is what makes the *system-dark, explicit-light*
   direction work. Without it the media-query block and the attribute block have equal specificity
   and source order decides, so one of the two directions silently loses. With it, the media rule
   scores 0-2-0 against the attribute rule's 0-1-0 for the dark direction and simply does not match
   for the light one. No `!important`, no cascade layer required.
2. The attribute selectors are **not** anchored to `:root`. `[data-nerey-theme='dark']` on any
   element redeclares the tokens on that element, and custom properties inherit, so a subtree
   inverts with one attribute and zero extra CSS. This is the same mechanism as the container-scoped
   deviation of ADR 0026, applied to the colour axis.
3. `color-scheme` is declared alongside the tokens so that UA-rendered surfaces the theme does not
   style — scrollbars, form control internals, the canvas behind a transparent page — follow the
   same decision. Without it a "dark" widget sits on a white scrollbar.

Light and dark are therefore a **value-layer override, never a component change**. No
`*.module.css` in the theme may contain a `prefers-color-scheme` query or a dark-specific class; a
component rule that resolves correctly in light resolves correctly in dark because it only ever
names tokens (ADR 0024). Setting the attribute is the consumer's business — server-rendered from a
cookie, written by a script before hydration, or never set at all — and Nerey ships no scheme
provider, no toggle component and no `localStorage` access.

### Consequences

* Good, because a new widget, whether Nerey's or a consumer's, gets dark mode by using tokens; no
  second appearance exists to fall out of sync.
* Good, because with no attribute set, the correct scheme is applied by CSS at first paint — no
  JavaScript, no flash, and it works in a Server Component render.
* Good, because per-subtree inversion is free, and the same attribute mechanism serves an
  application-level toggle and a single dark panel.
* Good, because consumers who rebrand under FR-35 get both schemes if they redeclare both blocks,
  and a partial redeclaration still resolves through the theme's own values rather than breaking.
* Bad, because every colour token must exist in both schemes; a token added to light and forgotten
  in dark resolves to the light value and produces a low-contrast element that no type system
  catches. The symmetry check below exists for exactly this.
* Bad, because non-colour tokens that legitimately differ by scheme — shadow opacity, border
  contrast — must be modelled as tokens too, or the dark surface looks flat. This constrains how
  ADR 0024's surface is factored.
* Neutral, because the theme takes no position on how the attribute gets set, which means the
  common "remember the user's choice" flow is documented recipe rather than shipped code.

### Confirmation

`packages/theme/src/__tests__/color-scheme.test.ts` runs in the Storybook browser project of
ADR 0006 and asserts the full AC-19 matrix by emulating the media feature and reading computed
custom-property values on a themed element: system-light with no attribute, system-dark with no
attribute, system-light with `data-nerey-theme="dark"`, system-dark with `data-nerey-theme="light"`,
and both explicit values under both system settings. The two cross cases are the ones that fail in
naive implementations, and they are asserted by value, not by class presence. A sixth case asserts
that an element carrying the attribute inverts its subtree while a sibling outside it does not.

`npm run check:tokens` (ADR 0024) is extended with three static checks, each with a planted violator
per ADR 0033:

* **Symmetry** — every custom property declared in the `:root` light block must be declared in the
  dark media block and in both attribute blocks, and no block may introduce a property the others
  lack.
* **No scheme logic in components** — any `@media (prefers-color-scheme` or `[data-nerey-theme`
  occurrence in a `packages/theme/src/**/*.module.css` fails the gate. Scheme handling exists only
  in `tokens.css`.
* **No `!important` in `tokens.css`**, which would indicate the specificity relationship above was
  not actually achieved.

The accessibility gate of ADR 0032 runs the full story set twice, once per scheme, so a dark palette
that drops below WCAG 2.2 AA contrast fails the build rather than shipping.

## Pros and Cons of the Options

### Token-value override in `tokens.css`: a `prefers-color-scheme` block and attribute selectors that rewrite the same custom-property names

* Good, because the component layer never learns that schemes exist, so the cost of a scheme is
  paid once for the whole library.
* Good, because it is pure CSS: correct at first paint, correct without JavaScript, correct under
  SSR.
* Good, because subtree scoping and application-level switching are the same mechanism.
* Neutral, because it requires the deliberate `:not()` specificity construction, which is easy to
  get wrong and therefore must be tested rather than reviewed.
* Bad, because token symmetry across four blocks is a real maintenance obligation.
* Bad, because scheme-dependent non-colour values (shadows, borders) must be promoted to tokens
  that might otherwise have stayed literals.

### Two stylesheets, `theme-light.css` and `theme-dark.css`, with the consumer loading or swapping one

The straightforward packaging answer, and what a number of libraries ship.

* Good, because each stylesheet is trivially readable and a consumer loads exactly one.
* Good, because there is no specificity subtlety at all.
* Neutral, because build cost is low — the same modules compiled against two token sets.
* Bad, because `prefers-color-scheme` is not honoured without consumer JavaScript that swaps the
  link element, which reintroduces a first-paint flash and breaks the no-JS path.
* Bad, because per-subtree inversion is impossible: a stylesheet is document-scoped.
* Bad, because it doubles the shipped CSS and doubles the surface ADR 0025's cascade gate has to
  validate, while the two files differ only in a few dozen values.
* Bad, because a consumer rebrand under FR-35 now has to be applied twice, once per file.

### Component-level dark treatment: a `colorScheme` prop or React context that selects dark variants of each component's classes

* Good, because the scheme is explicit in the component tree and trivially inspectable in React
  devtools.
* Good, because a component could in principle change *structure* in dark mode, not merely colour.
* Neutral, because it matches the mental model of teams coming from JS-theming libraries.
* Bad, because it makes light/dark a component concern: every widget grows a second appearance,
  every consumer-authored widget must implement its own, and the two drift.
* Bad, because it requires JavaScript to establish the scheme, so the initial render is either
  wrong or blocked — a flash on every page load, and nothing at all for a non-React consumer of
  `theme.css`.
* Bad, because it cannot honour `prefers-color-scheme` without a `matchMedia` subscription, which
  is state the theme has no business owning.
* Bad, because it violates FR-35 directly: rebranding would then require touching components, and
  it collides with ADR 0026 by adding a fourth axis whose values are not tokens.

## More Information

Implements FR-34 and satisfies AC-19. Built entirely on the token surface and the inline-fallback
rule of ADR 0024 — a consumer loading `theme.css` without `tokens.css` gets the light fallbacks,
which is the documented plain-but-correct rendering of AC-16, not a broken dark page. The
component-layer stylesheets that must stay scheme-free are compiled per ADR 0023 and constrained by
the cascade rules of ADR 0025; the subtree-scoping mechanism is the one ADR 0026 sanctions for all
per-instance deviation. Storybook (ADR 0031) exposes the scheme as a global toolbar control that
sets `data-nerey-theme` on the preview root, so every story is reviewable in both schemes with the
same attribute a consumer would use, and the contrast assertions are ADR 0032.

Revisit if the `light-dark()` CSS function reaches baseline support across the theme's target
browsers — it would collapse the four blocks into one pair of values per token and remove the
symmetry obligation, though the explicit-attribute override would still need the `:not()`
construction.
