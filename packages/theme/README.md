# @nerey/theme

The reference visual layer for [`@nerey/core`](../core). CSS Modules compiled to a static
stylesheet, driven entirely by `--nerey-*` custom properties, built on
[Base UI](https://base-ui.com) for behaviour.

```bash
npm install @nerey/core @nerey/theme
```

```ts
import '@nerey/theme/tokens.css';
import '@nerey/theme/theme.css';
```

Peers: `react@^19`, `@nerey/core`. That is the whole setup — **no CSS Modules configuration for
`node_modules`**, because the transform is already applied in the published package.

---

## Whether you want this at all

If you own a design system, you probably do not. `@nerey/core` emits a documented `data-*`
contract and no class names, so styling it from your own CSS Modules is a first-class path and
the one the split exists to enable. Taking a styled layer means paying for someone else's CSS
and then paying again to override it.

This package is for the other cases: you want a working generative UI this afternoon, or you
want a reference implementation to read before writing your own.

## Re-theming

Redeclare custom properties. That is the entire mechanism — no fork, no component override, no
`!important`:

```css
:root {
  --nerey-surface-accent: var(--brand-primary);
  --nerey-text-accent: var(--brand-primary-text);
  --nerey-radius-md: 2px;
  --nerey-font-sans: var(--brand-font);
}
```

Scoped to a container works too, including for light/dark:

```html
<div data-nerey-theme="dark">…</div>
```

The token surface is 127 properties in two layers — primitive ramps, and the semantic names
components actually read. `docs/design-system/tokens.agent-rules.md` in the repository is the
generated reference. If you find yourself needing a component override, the token surface has a
gap; that is worth reporting rather than working around.

Three properties of the stylesheet are load-bearing and easy to miss:

- **Every value carries an inline fallback.** Importing `theme.css` without `tokens.css` gives
  you a plain but correct component, never an invisible one.
- **Nothing is inherited.** Each rule sets its own `box-sizing`, margins, list markers and
  image display. The theme does not depend on a reset, and shipping no reset is deliberate —
  that is the consumer's to own, and a component that quietly depends on Tailwind's Preflight
  breaks everywhere at once on the day Preflight is removed.
- **Class names are hashed and are not API.** Style through `data-*` if you need to reach in.

---

## Components

31 components. Anything with behaviour worth getting right — focus trapping, floating
positioning, roving tabindex, typeahead, scroll locking, the ARIA graph — wraps Base UI 1.7.
Anything without behaviour is Nerey's own markup, because wrapping a primitive that has none is
pure overhead.

| Group                 | Components                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Foundation            | `Surface` `Stack` `Text` `Badge` `Separator` `Spinner` `Skeleton` `VisuallyHidden` `Button` `IconButton` `Icons` |
| Overlays              | `Dialog` `AlertDialog` `Popover` `Tooltip`                                                                       |
| Selection             | `Menu` `Select` `Combobox` `ToggleGroup`                                                                         |
| Forms                 | `Field` `Form` `Input` `Textarea` `NumberField` `Checkbox` `RadioGroup` `Switch` `Slider`                        |
| Feedback & disclosure | `Toast` `Progress` `Meter` `Collapsible` `Accordion` `Tabs`                                                      |

Compound components keep their compound shape under Nerey's own namespace:

```tsx
<Dialog.Root>
  <Dialog.Trigger render={<Button>Open</Button>} />
  <Dialog.Portal>
    <Dialog.Backdrop />
    <Dialog.Popup>
      <Dialog.Title>Delete this report?</Dialog.Title>
      <Dialog.Description>This cannot be undone.</Dialog.Description>
      <Dialog.Footer>
        <Dialog.Close render={<Button variant="outline">Cancel</Button>} />
        <Button tone="danger">Delete</Button>
      </Dialog.Footer>
    </Dialog.Popup>
  </Dialog.Portal>
</Dialog.Root>
```

Flattening that to `<Dialog title footer onClose />` reads better for a week and then grows
`headerSlot`, `renderFooter`, `hideCloseButton`.

### The prop API

`variant` · `size` · `tone`. **No `className`, no `style`.**

A className passthrough is passthrough styling of someone else's DOM under a new name: features
start styling internals, the hashed class names become a de-facto contract, and replacing the
theme stops being a one-package change. Per-instance deviation goes through the CSS custom
properties each stylesheet declares, scoped to a container you own.

`render` is allowed and used constantly — it changes which _element_ is produced, not how it is
painted:

```tsx
<Button render={<a href="/docs" />}>Read the docs</Button>
```

Base UI is wrapped and never re-exported, so it stays swappable. Props are declared explicitly
rather than derived with `ComponentProps<typeof Base.X>`, which would leak the dependency into
the public type. State follows the de-facto `open` / `defaultOpen` / `onOpenChange` contract
shared by Base UI, Radix, React Aria and Ark.

---

## Widgets

11 widgets across the categories a chat actually needs.

| Widget             | `type@version`           | Slot    | Sends back                                              |
| ------------------ | ------------------------ | ------- | ------------------------------------------------------- |
| `poll`             | `poll@1.0.0`             | message | the chosen option, as `"3 — Xi'an Huawei Technologies"` |
| `choice-chips`     | `choice-chips@1.0.0`     | input   | the chosen quick reply                                  |
| `form`             | `form@1.0.0`             | message | a readable `label: value` summary                       |
| `filter-panel`     | `filter-panel@1.0.0`     | input   | the composed query                                      |
| `confirmation`     | `confirmation@1.0.0`     | message | the decision                                            |
| `task-tree`        | `task-tree@1.0.0`        | message | nothing — a record of agent work                        |
| `progress-tracker` | `progress-tracker@1.0.0` | message | nothing                                                 |
| `citations`        | `citations@1.0.0`        | message | a request to quote a source                             |
| `data-table`       | `data-table@1.0.0`       | message | nothing — sorting is a view concern                     |
| `text`             | `text@1.0.0`             | message | nothing                                                 |
| `toast-notice`     | `toast-notice@1.0.0`     | overlay | the action, if one is offered                           |

`text` and `confirmation` deliberately reuse core's `type@version`, which is how you re-skin a
built-in:

```ts
import { builtInWidgets, composeRegistries } from '@nerey/core';
import { themeWidgets } from '@nerey/theme';

const registry = composeRegistries({ override: true }, builtInWidgets, themeWidgets);
```

Without `{ override: true }` that throws on the duplicate key — replacing a widget should be a
deliberate act, not an accident of array order.

Widget components are **not** exported from the package root, on purpose. A widget is resolved
out of a registry by `type@version` and rendered through `WidgetRenderer`, which is what applies
migration, validation, lifecycle and the error boundary. Exporting the components would
advertise a second entrance that skips all of it, and the first bug that produces is a widget
rendered with an unvalidated payload.

### `poll`, in more detail

The most instructive widget in the package, because its behaviour is the accumulated result of
getting it wrong in production:

- Selection is **two-step**. Clicking an option sets a freely changeable highlight and sends
  nothing; a Submit button commits. A one-click poll over ten near-identical company names is a
  poll people are afraid to touch.
- Submit does three things in order: locks optimistically, sends the reply, persists.
- **A failed persist leaves the poll locked.** The reply is already in the transcript, and
  re-enabling invites a duplicate answer.
- Descriptions render with line breaks preserved. Real payloads use single `\n` between
  `key: value` lines, which a markdown renderer would collapse into one.
- A restored `state.selected` renders locked on mount and sends nothing.

---

## Accessibility

Every story runs axe-core at WCAG 2.2 AA in a real browser, and a violation **fails the build**.
That gate is why the theme sets its own roles and labels rather than inheriting a convention
that ARIA arrives for free — nothing upstream is supplying it here.

Two things it has already caught and that are worth knowing if you write against this package:
Base UI does not give a `Select` popup an accessible name (the wrapper threads one), and
`--nerey-text-muted` had to move a ramp step darker to clear 4.5:1 on the canvas surface.

---

## Working on it

```bash
npm run storybook
```

The workbench loads `tokens.css` and the theme's own stylesheets and nothing else — no host
design system, no utility framework. A component that looks right there looks right in your app,
which is only true because of what the preview refuses to load.

MIT.
