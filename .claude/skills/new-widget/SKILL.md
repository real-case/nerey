---
name: new-widget
description: 'Create a new generative-UI widget in @nerey/theme — schema, component, stylesheet, registry entry, stories and conformance test. Apply when adding a widget to the catalog, or when asked to make the model able to render some new kind of interactive block.'
metadata:
  filePattern:
    - 'packages/theme/src/widgets/**'
    - 'packages/core/src/widgets/**'
  priority: 90
---

# Adding a widget

A widget is the unit the model can choose. Getting one wrong is cheap to write and expensive to
discover, because most of its failure modes only appear on someone's reload.

## Before writing anything

**Does it need to be a widget?** If the model is only conveying information, plain text through
the fallback renderer is better — it costs no schema, no version, no migration path. A widget
earns its place when the user must _do_ something, or when the data has structure a paragraph
would destroy (a table, a task tree, a set of sources).

**Which category?** The research catalog uses six: input & clarification, data display,
progress & status, actions & confirmations, navigation, multimodal. If yours does not fit one,
that is a signal to look harder at whether it is two widgets.

**Does one already exist?** Check `packages/theme/src/widgets/`. A `poll` with different labels
is not a new widget; it is a payload.

## The files

```
packages/theme/src/widgets/<name>/
  schema.ts              Zod 4 payload + state schemas, inferred types
  component.tsx          the WidgetComponent
  <name>.module.css      styling, keyed off data-*
  <name>.module.css.d.ts generated — never hand-edited
  index.ts               defineWidget entry
  <name>.stories.tsx     CSF 3, rendered through WidgetRenderer
  <name>.test.tsx        behaviour + conformance
```

Then add the entry to `packages/theme/src/widgets/catalog.ts`. That file is the only place that
knows the composition — nothing registers itself on import (ADR 0010).

## Decisions you must make deliberately

### `version`

Start at `'1.0.0'`. It must **exactly** match what the producer sends. Registering `'1.0.0'`
against a backend emitting `"1.0"` resolves to nothing and renders the text fallback, which
looks identical to forgetting to register at all (ADR 0009). Confirm the literal string against
a real payload, not against what the API docs say.

### `placement`

- `{ slot: 'message' }` — almost always right.
- `{ slot: 'input', position: 'above' }` — a composer affordance: a filter, a suggestion row.
  Only the last input-placed widget renders.
- `{ slot: 'overlay', scope: 'chat', dismissible: true }` — a transient notice.

### `lifecycle` — the part people get wrong

Do not default to "never expires" without thinking (ADR 0018).

| The widget…                      | expiry                                       | afterExpiry |
| -------------------------------- | -------------------------------------------- | ----------- |
| is committed by a Submit button  | `[{ on: 'interact', action: 'submit' }]`     | `snapshot`  |
| commits on first click           | `[{ on: 'interact' }]`                       | `snapshot`  |
| is a quick reply that goes stale | `[{ on: 'interact' }, { on: 'message' }]`    | `snapshot`  |
| is a transient notice            | `[{ on: 'timeout', ms }, { on: 'message' }]` | `hide`      |
| is a record of what happened     | `[]`                                         | `snapshot`  |

`snapshot` is the default answer: an acted-upon widget is **disabled, not removed**, so
reloading leaves the transcript legible. Reach for `hide` only when the widget genuinely leaves
no trace worth keeping, and for `fallback` when the plain text says the same thing better.

### The message it sends

`onInteraction(action, { text, meta })`. `text` goes into the conversation as user input, so
write what a human would plausibly have typed:

```ts
onInteraction('submit', { text: `3 — ${option.title}`, meta: { value: '3' } }); // yes
onInteraction('submit', { text: JSON.stringify({ selected: 3 }) }); // no
```

Structured data belongs in `meta`, which the host may forward or log.

### Two-step or one-step?

If the choice is reversible in the user's mind — picking one of ten companies — make it
**two-step**: clicking sets a tentative highlight and sends nothing; a Submit button commits.
If it is a quick reply, one step is the point. Getting this wrong is the difference between a
widget people use and one they are afraid to touch.

## Hard rules

- **No I/O.** Only `onInteraction` and `useWidgetState`. Enforced by `@nerey/eslint-config`.
- **`readonly` renders the terminal appearance and fires nothing.** Check it at the top.
- **A failed persist does not roll back.** The reply is already in the transcript; re-enabling
  invites a duplicate. Show the error, keep the lock (ADR 0016).
- **Render sensibly while `status === 'streaming'`** if the payload can arrive incrementally.
  It is not validated in that state.
- Wrap in `WidgetRoot`; mark regions with `WidgetPart`. That is what puts the `data-*` contract
  on the DOM (ADR 0020).
- Real ARIA — roles, names, `aria-describedby`. axe runs at WCAG 2.2 AA and **fails** the build.
- Every CSS value is `var(--nerey-token, <fallback>)`, semantic layer only, no raw literals.
- Public props are `variant` / `size` / `tone`. Never `className`.

## Stories

Render through `WidgetRenderer` inside `MockWidgetHost` — never by calling the component
directly. That is what exercises resolution, validation, lifecycle and the error boundary
together, which is the whole chain a real message goes through.

Cover, at minimum: initial, mid-interaction, committed/locked, **restored from persisted
state**, persist failure, `readonly`, empty payload edge, and long-content overflow. Interactive
stories need a `play` function using `storybook/test`.

## Before you call it done

```bash
npm run gen:css-types      # then commit the generated .d.ts
npm run check:tokens
npm run check:stories
npm run typecheck
npx vitest run --project unit packages/theme/src/widgets/<name>
```

And run the conformance kit — it checks nine rules including the ones easy to miss:

```ts
import { expectWidgetConformance } from '@nerey/core/testing';

await expectWidgetConformance(myWidget, {
  validPayload: { … },
  invalidPayloads: [{}, { wrong: true }, null],
  source: await readFile(new URL('./component.tsx', import.meta.url), 'utf8'),
});
```

## Adding a widget to `@nerey/core` instead

Don't, unless it is genuinely unavoidable for every consumer. Core ships `text` and
`confirmation` and that is the whole catalog by design (ADR 0035) — everything else is a design
decision, and a design decision in a headless package is one the consumer has to undo.
