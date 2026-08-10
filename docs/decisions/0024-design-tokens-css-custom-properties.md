---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0024. Design tokens as --nerey-* custom properties with inline fallbacks

## Context and Problem Statement

`@nerey/theme` must be rebrandable by redeclaring properties alone — no fork, no component
override, no `!important` (FR-35, AC-17) — and it must also survive being imported *partially*: a
consumer who loads `theme.css` and forgets `tokens.css` has to get a plain but correct component,
never invisible text or a zero-height box (FR-31, AC-16). Those two requirements pull in opposite
directions. Full indirection through a variable makes retheming trivial and makes a missing
definition catastrophic.

There is a second problem underneath the first. A token surface is only useful if the set of tokens
is knowable — by a TypeScript consumer, by the lint rule that forbids raw literals, and by an agent
editing a `*.module.css`. Three hand-maintained copies of the same list is three chances to be
wrong, and the wrongness is silent: an undeclared token in a `var()` simply falls back and nobody
notices until the rebrand doesn't take.

## Decision Drivers

* AC-17: redeclaring `--nerey-*` in `:root` must fully rebrand the UI with no component override
  and no `!important` in the consumer's CSS.
* AC-16: `theme.css` without `tokens.css` must render every component legibly.
* FR-30: `tokens.css` is a standalone entry declaring the token surface and nothing else — no
  component rules, no reset, no framework at-rules — because Storybook loads it alone (ADR 0031)
  and that is what makes the workbench a truthful reference.
* A namespaced surface: `@nerey/theme` lives inside applications that already have design tokens,
  and `--color-primary` would collide on day one.
* One source of truth for the token list, mechanically propagated to every place that needs it.
* No raw color or size literal may survive in a component stylesheet, or the rebrand is partial and
  the failure is invisible.

## Considered Options

* Namespaced `--nerey-*` custom properties, every use site written `var(--nerey-x, <fallback>)`,
  tokens shipped as a separate entry point
* Namespaced `--nerey-*` custom properties with no fallbacks, `tokens.css` a required import
* Build-time substitution: author against Sass/PostCSS variables and flatten to literal values
* A JavaScript theme object supplied through a React provider and applied as inline styles

## Decision Outcome

Chosen option: "Namespaced `--nerey-*` custom properties, every use site written
`var(--nerey-x, <fallback>)`, tokens shipped as a separate entry point", because it is the only
option under which the same declaration is simultaneously overridable at runtime by a consumer who
loads `tokens.css` and self-sufficient for one who does not — and because the redundancy the
fallbacks introduce is exactly the kind of redundancy a generator can own.

Every declaration in the theme reads its value through a variable with an inline fallback:

```css
.pollOption {
  padding: var(--nerey-space-3, 0.75rem) var(--nerey-space-4, 1rem);
  color: var(--nerey-color-text, #1a1a1a);
  border: var(--nerey-border-width, 1px) solid var(--nerey-color-border, #d4d4d4);
  border-radius: var(--nerey-radius-md, 0.5rem);
}
```

The fallback is the *plain but correct* value, not a debug value. `theme.css` alone is a monochrome,
correctly spaced, legibly contrasted component; `tokens.css` is what makes it branded.

`packages/theme/src/tokens.css` is the single source of truth for the surface, and it contains
nothing but custom-property declarations. From it, `npm run gen:tokens` generates and overwrites:

* `packages/theme/src/tokens.generated.ts` — the `NereyToken` string-literal union and a
  `TOKENS` record of default values, exported from `@nerey/theme` so a consumer's own theming code
  is type-checked against the real surface under ADR 0003.
* `packages/eslint-config/generated/token-allowlist.json` — the allowlist the lint rule uses to
  reject an unknown `--nerey-*` name.
* `.claude/rules/tokens.md` — the agent-facing rules file listing every token, its role and its
  fallback, so an agent editing a `*.module.css` picks an existing token instead of inventing
  `--nerey-color-primary-hover-2`.

None of the three is ever edited by hand. All three are committed, and CI fails on drift.

### Consequences

* Good, because retheming is a stylesheet of custom-property declarations on any element the
  consumer owns; scoping a subtree is the same mechanism with a narrower selector, at no extra
  cost.
* Good, because a partial import degrades to plain instead of broken, which removes an entire class
  of "I installed it and everything is invisible" reports.
* Good, because the token list cannot drift from its type, its lint allowlist, or its
  documentation — a token exists in exactly one file.
* Good, because light and dark reduce to swapping values behind the same names (ADR 0027) instead
  of touching any component rule.
* Bad, because every declaration is longer and the fallback duplicates the token's default value in
  two files. Accepted precisely because the duplication is generated, not typed.
* Bad, because a token renamed in `tokens.css` still resolves at every use site via its fallback,
  so the rename looks like it worked. The gate below closes this by rejecting `var(--nerey-*)`
  names that are not declared.
* Neutral, because custom properties resolve at computed-value time and cannot be used in media
  query conditions; the theme's breakpoint values therefore live in the modules as literals with an
  explicit exemption, and container queries carry the rest.

### Confirmation

`npm run check:tokens` is the gate, wired into `npm run check:all` and shipping planted-violator
fixtures per ADR 0033. It fails on any of:

1. **Drift** — it re-runs the generator into a temporary directory and byte-compares against the
   three committed artifacts. A hand-edited `tokens.generated.ts` or a stale allowlist fails.
2. **Undeclared token** — any `var(--nerey-…)` in any `packages/theme/src/**/*.module.css` whose
   name is absent from `tokens.css`.
3. **Missing fallback** — any `var(--nerey-…)` with no comma-separated fallback argument.
4. **Raw literal** — any hex color, `rgb(`/`hsl(`/`oklch(` call, or length literal other than `0`
   inside a `*.module.css`, outside the declared breakpoint exemption.
5. **Contaminated tokens file** — any rule in `tokens.css` that is not a custom-property
   declaration block, including `@import`, `@theme`, `@apply` and any component selector.

Two behavioural tests run in the Storybook browser project of ADR 0006:
`packages/theme/src/__tests__/tokens-absent.test.ts` mounts every component with `theme.css` only
and asserts, for each element, non-zero border box and a computed foreground/background contrast
ratio above the ADR 0032 threshold — AC-16 as an assertion rather than a screenshot.
`packages/theme/src/__tests__/rebrand.test.ts` injects a `:root` sheet redeclaring every token,
asserts the computed value changed on every component, and asserts the injected sheet contains no
`!important` — AC-17.

## Pros and Cons of the Options

### Namespaced `--nerey-*` custom properties, every use site written `var(--nerey-x, <fallback>)`, tokens shipped as a separate entry point

* Good, because overriding is runtime, cascading and scopable — `:root`, a container, or one
  element, with no rebuild and no JavaScript.
* Good, because the fallback makes the component's correctness independent of load order, which
  matters because bundlers do not guarantee the relative order of two CSS imports.
* Good, because the namespace prevents collision with the host application's own token surface.
* Neutral, because it commits the theme to a generator; that generator is one script and its output
  is diffable.
* Bad, because the source is noisier to read than a bare literal.
* Bad, because it cannot express breakpoints, so a small literal exemption remains.

### Namespaced `--nerey-*` custom properties with no fallbacks, `tokens.css` a required import

The DRY version of the same idea, and what most token-driven libraries actually ship.

* Good, because the source is clean and each value exists in exactly one place.
* Good, because a missing token is loudly broken in development, which some teams prefer to a quiet
  fallback.
* Neutral, because the required import is one documented line.
* Bad, because it fails AC-16 outright: without `tokens.css`, `color` resolves to the inherited
  value, `background` to transparent and `padding` to `0`. The result is not "unstyled", it is
  illegible — the exact report this package must never generate.
* Bad, because correctness now depends on CSS import order across two files from the same package,
  which is bundler-dependent and not something the theme can assert about a consumer's build.

### Build-time substitution: author against Sass/PostCSS variables and flatten to literal values

* Good, because the published CSS is the smallest and fastest possible: no variable indirection, no
  resolution cost.
* Good, because it works in every context custom properties do not, including media query
  conditions.
* Neutral, because authoring ergonomics are comparable.
* Bad, because retheming requires a rebuild of the package. AC-17 and FR-35 are then unsatisfiable
  by construction — a consumer would have to fork, which is the failure mode the whole theme layer
  is designed to avoid.
* Bad, because per-subtree theming and the light/dark override of ADR 0027 both become impossible
  without shipping N stylesheets.

### A JavaScript theme object supplied through a React provider and applied as inline styles

* Good, because tokens are typed at the source with no generation step, and TypeScript autocompletes
  them natively.
* Good, because a consumer can compute theme values at runtime from application state.
* Neutral, because it is the familiar pattern from the CSS-in-JS era.
* Bad, because it forces styling through React: every themed node needs a `style` attribute,
  inline styles beat every consumer stylesheet on specificity, and overriding then demands
  `!important` — an explicit AC-17 violation.
* Bad, because it makes `@nerey/theme` un-styleable from plain CSS and unusable outside a React
  tree, and it re-couples the visual layer to the component layer that ADR 0026 keeps apart.

## More Information

Implements FR-30, FR-31 and FR-35; satisfies AC-16 and AC-17. The modules that consume these tokens
are compiled per ADR 0023; `@nerey/theme/tokens.css` is a distinct export-map entry under ADR 0028
so it can be loaded alone by Storybook (ADR 0031). Light and dark are value overrides on this same
surface (ADR 0027), and the self-sufficiency rules that keep `theme.css` correct without a host
reset are ADR 0025. The lint rule consuming the generated allowlist ships in `@nerey/eslint-config`
alongside the I/O boundary rule of ADR 0015, under the flat config of ADR 0005.

Revisit the breakpoint exemption if `@custom-media` reaches baseline support, and revisit the
namespace if a token specification with cross-library semantics is adopted.
