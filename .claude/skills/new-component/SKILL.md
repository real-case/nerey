---
name: new-component
description: 'Create a component in @nerey/theme — CSS Modules authoring, the variant/size/tone prop API, wrapping a Base UI primitive, and story coverage. Apply when adding or restyling any component under packages/theme/src/components, or when touching a *.module.css.'
metadata:
  filePattern:
    - 'packages/theme/src/components/**'
    - '**/*.module.css'
  priority: 85
---

# Adding a theme component

## First: does it need Base UI?

Split the work honestly, because wrapping a primitive that has no behaviour is pure overhead.

**No Base UI** — Button, Badge, Card, Separator, Spinner, Skeleton, Text, Stack. There is no
behaviour here, only markup and CSS. Write your own; it will be smaller and fit the design
better than a wrapper would.

**Base UI earns its place** — Dialog, Popover, Menu, Select, Tooltip, Combobox, Tabs, Toast,
Slider, anything with a portal or a listbox. Focus trapping, background inertness,
viewport-aware positioning, roving tabindex, typeahead, scroll locking and the ARIA graph are
expensive to write and you will get them wrong (ADR 0022).

## The files

```
packages/theme/src/components/<name>/
  <name>.tsx                 the component
  <name>.module.css          styling
  <name>.module.css.d.ts     generated — never hand-edited
  <name>.stories.tsx         CSF 3
  index.ts                   re-export
```

`packages/theme/src/components/button/` is the reference implementation. Match it.

## The prop API

Public props are **`variant` / `size` / `tone`** (ADR 0026).

```ts
export type ThingProps = {
  variant?: 'solid' | 'outline' | 'ghost'; // visual weight
  tone?: 'accent' | 'neutral' | 'danger'; // which semantic colour family
  size?: 'sm' | 'md' | 'lg';
  render?: ReactElement; // change the element, not the paint
};
```

Keep the axes orthogonal — variant × tone from separate rule blocks, not nine hand-written
pairs that drift apart the first time a token changes.

**No `className`, no `style`.** A className passthrough is passthrough styling of someone else's
DOM under a new name: features start styling the theme's internals, the class names become a
de-facto contract, and swapping the theme stops being a one-package change. Per-instance
deviation goes through the private `--_*` custom properties your stylesheet declares:

```css
.root {
  --_bg: var(--nerey-surface-accent, #138171);
  background: var(--_bg);
}
```

```tsx
<div style={{ '--_bg': 'var(--nerey-surface-danger)' } as CSSProperties}>
  <Thing />
</div>
```

`render` is allowed — it changes which element is produced, not how it is painted.

Declare props explicitly. **Never** `ComponentProps<typeof Base.X>`: that leaks Base UI into
Nerey's public type and makes it unswappable.

## Wrapping a Base UI primitive

Keep the compound API compound, under Nerey's own namespace:

```tsx
export const Dialog = { Root, Trigger, Portal, Backdrop, Popup, Title, Description, Close };
```

Flattening to `<Dialog title footer onClose />` feels tidy for a week and then grows
`headerSlot`, `renderFooter`, `hideCloseButton`.

Mirror the `open` / `defaultOpen` / `onOpenChange` state contract — it is what Base UI, Radix,
React Aria and Ark all use, so a future swap stays mechanical.

Never re-export Base UI. Never add a second behavioural library: two focus traps and two Escape
implementations are what users notice, long before bundle size.

### Base UI 1.7 facts that are easy to get wrong

- The polymorphic prop is **`render`**, not `asChild`.
- **`Portal` is required** for Dialog, AlertDialog, Popover, Menu and Tooltip — it throws
  otherwise. `Select.Portal` is optional.
- `Backdrop` goes **inside** `Portal`, as a sibling of `Positioner`.
- Positioning custom properties (`--available-height`, `--anchor-width`, `--transform-origin`)
  live on **`Positioner`**, not `Popup`. Put sizing constraints on Positioner and all visual
  styling on Popup.
- `Dialog.Viewport` **wraps** Popup; `Popover/Menu/Tooltip .Viewport` sits **inside** it.
- `CheckboxGroup` and `RadioGroup` are bare components, not namespaces.
- `Select.Item` uses `data-selected`; Checkbox, Radio and Menu use `data-checked`.
- Style from Base UI's own `data-*` state attributes. Do not maintain a parallel class-based
  state — it will disagree with the real one at some point, and the real one is right.

## CSS Modules

- camelCase class names describing the element's **role** (`optionRow`, not `flexRowGray`).
  Scoping is per file, so no prefixing.
- **Every value is `var(--nerey-token, <fallback>)`.** The fallback is not optional: a consumer
  who imports `theme.css` without `tokens.css` must still get a legible component (ADR 0024).
- Read the **semantic** layer. `--nerey-color-*` primitives are for tokens.css to point at; a
  component reading one defeats re-theming and fails the gate.
- No `@apply` / `@tailwind` / `@reference`. A separately-bundled module cannot see a utility
  framework's theme, and the failure mode is worse than an error: core utilities happen to
  compile while custom ones do not.
- **Assume no reset exists.** Set your own `box-sizing`, `margin`, `font`, `appearance`, list
  markers, image display. Inheriting the host's reset means breaking everywhere at once on the
  day they remove it (ADR 0025).
- A primitive owns no external margin. Spacing is the parent's job — that is what `Stack` is for.
- Missing token? Add it to `tokens.css` and run `npm run gen:tokens`. Never inline a value.

```bash
npm run gen:css-types    # after adding or renaming a class — commit the .d.ts
npm run check:tokens
```

## Accessibility

axe runs over every story at WCAG 2.2 AA and **fails** the build (ADR 0032).

The "no ARIA attributes" convention some codebases carry is deliberately not adopted here: it
was correct when a styled library supplied ARIA for free, and is actively harmful for a headless
library that emits interactive DOM.

Specifics that come up constantly:

- An icon-only control **must** have an accessible name. `IconButton` makes `label` required for
  exactly this reason.
- A tooltip is never the only source of an accessible name.
- Focus must be visible: `:focus-visible` with a real ring, never `outline: none` alone.
- Honour `prefers-reduced-motion` on anything that animates.
- State is never conveyed by colour alone.

## Stories

CSF 3, colocated, explicit `title`. Show the **full axis matrix** (every variant × tone × size),
not one example — these stories are the theme's visual documentation.

Cover: default, every variant, disabled, focus, loading, empty, error, long-content overflow,
and both themes (the toolbar toggles `data-nerey-theme`).

Interactive components need a `play` function with `storybook/test` — and for a Base UI wrapper,
`play` should assert the **keyboard** behaviour (arrows, typeahead, Escape, focus return). That
behaviour is the entire reason the dependency exists, so it is the thing worth testing.

```tsx
import { expect, userEvent, within } from 'storybook/test'; // NOT '@storybook/test'
```

## Before you call it done

```bash
npm run gen:css-types && npm run check:tokens && npm run check:stories && npm run typecheck
npx vitest run --project unit packages/theme/src/components/<name>
```
