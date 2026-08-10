# The Nerey design system

Three files in this directory are **generated or baselined**. None of them is hand-edited, and a
`PreToolUse` hook refuses the edit if you try.

| File                    | What it is                                                           | Owner                                              |
| ----------------------- | -------------------------------------------------------------------- | -------------------------------------------------- |
| `tokens.agent-rules.md` | Generated token reference — every `--nerey-*` property and its value | `npm run gen:tokens`                               |
| `data-contract.json`    | Baseline of the public `data-*` styling contract                     | `npm run check:data-contract -- --update-baseline` |
| `public-api.json`       | Baseline of every exported symbol per package entry point            | `npm run check:public-api -- --update-baseline`    |

The two baselines are **not** files you update to make a check pass. They are updated
deliberately, in the same commit as the version bump the change implies (ADR 0029). A gate that
you silence by rewriting its expectations is a gate that has stopped doing anything.

---

## The token layers

```
tokens.css
├─ primitive   --nerey-color-slate-500, --nerey-space-4, --nerey-radius-md, …
└─ semantic    --nerey-surface-raised, --nerey-text-muted, --nerey-border-focus, …
```

**Components read the semantic layer only.** The primitive ramps exist so the semantic layer has
something to point at; a component reading `--nerey-color-teal-500` directly defeats re-theming
and fails `npm run check:tokens`.

That is the whole reason for the split. A consumer who wants their brand colour sets
`--nerey-surface-accent` once. A consumer who reads primitives from components has to find every
place teal appears and decide, per occurrence, whether it meant "accent" or "just teal".

### Every value carries a fallback

```css
background: var(--nerey-surface-raised, #ffffff);
```

Not a style preference — a requirement (ADR 0024). A consumer may import `theme.css` without
`tokens.css`, and when they do they must get a plain but **correct** component, never an
invisible one. The gate rejects a `var()` with no fallback.

### Light and dark

A value override on the same token names, never a component change (ADR 0027):

1. `:root` — light defaults
2. `@media (prefers-color-scheme: dark)` — dark, unless an ancestor pinned light
3. `[data-nerey-theme="light" | "dark"]` — explicit, wins in both directions, and works on any
   container rather than only on `:root`

A component never branches on theme. If you find yourself writing `[data-nerey-theme='dark'] .foo`
inside a component stylesheet, the token surface has a gap.

---

## Adding a token

1. Add it to `packages/theme/src/tokens.css`, in the right layer, in all three theme blocks if
   it is semantic.
2. `npm run gen:tokens`.
3. Commit the three regenerated artifacts alongside it.

CI drift-checks all three. Skipping step 2 fails the build with the exact file that is stale.

---

## The `data-*` contract

`@nerey/core` emits a fixed attribute vocabulary, and it is **public API** — see
`data-contract.json` for the baseline and ADR 0020 for the reasoning.

| Attribute             | Values                                                              | Open?              |
| --------------------- | ------------------------------------------------------------------- | ------------------ |
| `data-nerey-widget`   | the widget type                                                     | open               |
| `data-nerey-version`  | the resolved entry version                                          | open               |
| `data-nerey-slot`     | `message` · `input` · `overlay`                                     | closed             |
| `data-nerey-part`     | a region name inside a widget                                       | **open by design** |
| `data-nerey-status`   | `streaming` · `ready` · `error`                                     | closed             |
| `data-state`          | `idle` · `selected` · `submitting` · `locked` · `expired` · `error` | closed             |
| `data-readonly`       | present (valueless) when read-only                                  | closed             |
| `data-nerey-fallback` | why a fallback rendered                                             | closed             |

`data-nerey-part` is open because a widget's internal regions are its own business. `data-state`
is closed because a widget inventing its own state vocabulary is how a styling contract rots —
`npm run check:data-contract` fails on a `data-state` value outside the list.

Renaming any of these, or removing a value from a closed set, is a MAJOR bump. **Adding** a
`data-state` value is MINOR, and only because core is obliged to stay additive-safe: base
presentation must never key on the _absence_ of a state.

---

## Where the rules are enforced

| Rule                                                         | Gate                                             |
| ------------------------------------------------------------ | ------------------------------------------------ |
| No raw colour or size literal outside a `var()` fallback     | `check:tokens`                                   |
| No primitive ramp read from a component                      | `check:tokens`                                   |
| Every `var(--nerey-*)` has a fallback and names a real token | `check:tokens`                                   |
| No `@apply` / `@tailwind` / `@reference` in a module         | `check:tokens`                                   |
| Generated token artifacts are current                        | `gen:tokens -- --check`                          |
| CSS Module declarations are current, with no orphans         | `gen:css-types -- --check`                       |
| The `data-*` contract matches its baseline                   | `check:data-contract`                            |
| The export surface matches its baseline                      | `check:public-api`                               |
| Every component and widget has stories                       | `check:stories`                                  |
| Contrast, names, roles, focus order                          | `addon-a11y` (axe, WCAG 2.2 AA) over every story |

And `npm run check:gates` proves each of those still rejects its own violator — because a rule
that silently stopped firing is worse than no rule, since it puts a green check over a real
violation.
