# Adopting Nerey in an existing chat

This is the guide for wiring Nerey into an application that already has a working chat and now
wants the assistant to render interactive widgets. It assumes you have a message list, a way to
send a message, and a backend you do not control on your own schedule.

The order below is deliberate. Each step is independently shippable and independently
revertible, and none of them requires the backend to change first.

---

## Step 0 — the two things to settle before writing code

**Who owns the widget contract?** Nerey resolves on an exact `type@version` string. Somebody has
to decide what those strings are and where they are written down. If the backend emits
`"version": "1.0"` and you register `'1.0.0'`, nothing resolves and every message falls back to
text — which looks exactly like having forgotten to register the widget. Agree the literal
strings, and check them against a captured payload rather than against the API documentation.

**What does a widget do when the write fails?** Nerey's answer is that the widget stays
committed. Make sure whoever owns the product understands that a failed save leaves the choice
locked and shows an error, rather than silently re-opening. The alternative — rolling back —
means the user can answer twice, and the first answer is already in the transcript.

---

## Step 1 — adapt your message type

Nerey never imports your schema. Write one function.

```ts
import type { NereyMessage } from '@nerey/core';

export function toNereyMessage(m: ApiChatMessage): NereyMessage {
  return {
    id: m.id,
    role: m.isAssistant ? 'assistant' : 'user',
    text: m.text,
    widget: m.widget ?? null,
  };
}
```

`text` is required even for a widget message. It is the last line of the degradation chain, and
it is what the user reads when the widget cannot render. If your backend does not send a text
rendering alongside the widget, get it to — that is the single highest-value change on the
server side, and it costs one field.

## Step 2 — mount the host, render nothing new

```tsx
const registry = createWidgetRegistry(builtInWidgets); // module scope; it is immutable

function ChatProvider({ children }: { children: ReactNode }) {
  const { mutate: submit } = useSendMessage();
  const queryClient = useQueryClient();

  const host = useMemo<WidgetHostValue>(
    () => ({
      registry,
      conversationId: String(chatId),
      sendUserMessage: (text) => submit({ text }),
      persistence: createQueryPersistence(queryClient),
      renderFallback: (text) => <Markdown>{text}</Markdown>,
      onWidgetError: (error) => logger.warn('nerey', error),
      messageCount: messages.length,
    }),
    [chatId, submit, queryClient, messages.length],
  );

  return <WidgetHostProvider value={host}>{children}</WidgetHostProvider>;
}
```

`useMemo` here is deliberate: `WidgetHostProvider` does **not** memoise the value for you,
because silently memoising someone else's object hides a real re-render bug from them.

Then swap your message renderer:

```tsx
// before
<Markdown>{message.text}</Markdown>

// after
<WidgetRenderer message={toNereyMessage(message)} />
```

At this point nothing looks different. Every message has no widget, so `resolveEnvelope`
synthesises a text envelope and `renderFallback` renders exactly what you rendered before. That
is the point: ship this, watch production, confirm parity. The interesting code paths are now
live and doing nothing.

## Step 3 — implement the persistence port

```ts
export function createQueryPersistence(queryClient: QueryClient): MessagePersistence {
  return {
    async getWidgetState(conversationId, messageId) {
      const messages = queryClient.getQueryData<ApiChatMessage[]>(['chat', conversationId, 'messages']);
      return messages?.find((m) => m.id === messageId)?.widget?.state;
    },
    async updateWidgetState(conversationId, messageId, state, options) {
      await patchWidgetState(conversationId, messageId, state, options);
    },
  };
}
```

Two things worth guarding here, both learned the hard way:

- Refuse to persist against a non-positive or optimistic message id. An optimistic message has
  no server row yet, and the write will 404 in a way that looks like a permissions problem.
- Honour `options.signal`. Nerey aborts a superseded write and aborts on unmount; ignoring the
  signal means a stale write can land after a newer one.

## Step 4 — your first widget

Start with something the model already wants to do. A disambiguation poll — "which of these ten
companies did you mean?" — is the usual first candidate, because the alternative is asking the
user to retype a name from a numbered list.

Put it in a widgets directory and add the boundary rule immediately, not later:

```js
import nerey from '@nerey/eslint-config';
export default [...nerey.widgets({ files: ['src/chat/widgets/**/*.{ts,tsx}'] })];
```

The rule is worth adding on day one. It is the invariant that keeps a widget portable, and it
is the one that quietly stops being true the first time someone needs "just one" API call.

## Step 5 — the mock layer, before the backend is ready

You do not need the server to emit widgets in order to build them.

```tsx
import { MockWidgetHost, widgetMessage } from '@nerey/core/mock';

<MockWidgetHost registry={registry} onSend={console.log}>
  <WidgetRenderer message={widgetMessage({ type: 'poll', payload: samplePayload })} />
</MockWidgetHost>;
```

In development, wrap your registry so a miss is loud:

```ts
const registry = createDevRegistry(baseRegistry, { enabled: import.meta.env.DEV });
```

A silent fallback in development is the wrong default. It looks like the model produced plain
text, and it hides the version-mismatch bug that is by far the most common wiring failure.

---

## Step 6 — tell the model what it may render

The registry knows the exact `type@version` it will resolve and the exact schema it will validate
against. Do not retype either into a prompt or a tool definition — derive them:

```ts
import { describeRegistry } from '@nerey/core';
import { z } from 'zod';

const catalog = describeRegistry(registry, { toJsonSchema: (schema) => z.toJSONSchema(schema) });
```

Each entry comes out as `{ type, version, key, description?, placement, payloadSchema? }`, where
`key` is `` `${type}@${version}` `` — the registry's own lookup key. Shape it into whatever your
provider wants; Nerey emits no tool format of its own, because a provider binding is a non-goal
(ADR 0037).

```ts
const tools = catalog.map((widget) => ({
  name: `render_${widget.type}`,
  description: widget.description,
  input_schema: widget.payloadSchema,
}));
```

The converter is injected rather than imported: `@nerey/core` depends on the Standard Schema
_spec_, which has no JSON Schema conversion in it, so taking one as a dependency would put a
validator back in the package a consumer chose it to stay out of (ADR 0011 / 0040). Zod 4 ships
`z.toJSONSchema`; Valibot and ArkType are the same one-liner.

Two things worth knowing:

- **Omit the converter and no `payloadSchema` is emitted at all** — you get types, versions and
  descriptions, and no error. That is deliberate, and it is the one way to hand a model a widget
  with no constraints, so pass the converter unless you are attaching schemas yourself.
- **`description` is what a model chooses on.** It is optional on an entry and absent from the
  descriptor when unset. A widget with no description tells the model what it is called and not
  what it is for.

This is the half of the loop that used to be hand-maintained. When it drifts, the payload's
version stops matching an entry, and the message renders as plain text — indistinguishable from a
model that simply chose not to use a widget.

---

## Localising the chrome

Nerey's widgets render a small number of strings of their own — `Details`, `Answer sent`,
`No matching options.` — and they are English by default. A widget cannot take a prop for them,
because its props are fixed by `WidgetComponentProps`, so they resolve through context instead:

```tsx
import { NereyLabelsProvider } from '@nerey/theme';

<NereyLabelsProvider labels={{ poll: { details: 'Подробнее', answered: 'Ответ отправлен' } }}>
  {yourChat}
</NereyLabelsProvider>;
```

An override replaces any subset and keeps everything it does not name. Mounting the provider is
optional; without it the defaults apply.

Two things are worth knowing before you skip this section:

- **Some of these strings are accessible names.** `Choose one option`, ` for {option}`,
  `{label}, {n} results` are what a screen reader announces. The a11y gate cannot catch a wrong
  language — axe checks that a name exists, never what language it is in — so a non-English
  deployment that skips this ships English to the users who most depend on the announcement.
- **Some of them are not display strings at all.** `poll.noneReply`, `filterPanel.queryPrefix` and
  `form.emptySubmission` are the **reply text a widget sends**, which the agent reads as something
  the user typed (ADR 0014). Leaving those English puts a sentence in your user's mouth that they
  did not write.

Nerey has no locale concept: it does not detect one, negotiate one, or pluralise anything. If you
have an i18n library, resolve the strings with it and pass the result. Interpolation, where it
exists, is a typed function rather than a format string:

```tsx
<NereyLabelsProvider labels={{ poll: { detailsFor: ({ title }) => `, вариант «${title}»` } }} />
```

`@nerey/core` has exactly one such string — the overlay's dismiss control — and it is a prop:
`<OverlaySlotHost dismissLabel="Закрыть" … />`.

---

## Styling: two paths

### You own a design system

Do not install `@nerey/theme`. Style from your own CSS Modules against the `data-*` contract:

```css
.transcript [data-nerey-widget='poll'] { … }
.transcript [data-nerey-widget='poll'][data-state='locked'] {
  opacity: 0.55;
  pointer-events: none;
}
.transcript [data-nerey-part='option'][data-state='selected'] { … }
```

No class names to learn, and no version of Nerey can change your styling without changing an
attribute — which is a MAJOR bump.

### You want it to look finished

```ts
import '@nerey/theme/tokens.css';
import '@nerey/theme/theme.css';
```

Then re-theme by redeclaring custom properties in your own CSS, scoped wherever you like:

```css
:root {
  --nerey-surface-accent: var(--brand-primary);
  --nerey-text-accent: var(--brand-primary-text);
  --nerey-radius-md: 2px;
  --nerey-font-sans: var(--brand-font);
}
```

That is the whole re-theming mechanism. If you find yourself writing a component override or
reaching for `!important`, the token surface has a gap — report it rather than working around
it.

**Import order matters**: `tokens.css` first. And if you are mid-migration off a utility
framework, remember Nerey's stylesheets are self-sufficient — they do not depend on Preflight or
any other reset, and they will not break on the day you remove it.

---

## Coexisting with a Tailwind or styled-library migration

If the surrounding app is mid-migration, two things are worth knowing.

**Cascade layers.** Legacy library CSS imported without a layer beats anything layered, at equal
specificity. Import it into a layer so the new CSS wins without a single hack:

```css
@layer legacy;
@import 'old-library/theme.css' layer(legacy);
```

Nerey's own stylesheet is unlayered, so it sits above anything you layer.

**Seams, not leaves.** A Nerey widget rendered inside an un-migrated dialog or table cell will
inherit that library's `font-family` and `font-size` and fall under its descendant selectors. It
will look correct in Storybook and wrong in the app, and you will lose an afternoon to it.
Migrate by container — the whole dialog, the whole transcript — not leaf by leaf.

---

## Rollout

A feature flag on the registry is enough:

```ts
const registry = flags.widgets
  ? composeRegistries(builtInWidgets, appWidgets)
  : createWidgetRegistry(builtInWidgets);
```

With widgets off, every widget message falls back to its `text`. That is a real, readable
degradation rather than a broken screen, which makes the flag genuinely safe to flip in either
direction — including for a single tenant, and including at 2am.

## Where things go wrong

| Symptom                                       | Almost always                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Every widget renders as plain text            | `type@version` mismatch. Log `onWidgetError`; the `unknown-widget` message names both sides. |
| Widget renders in Storybook, wrong in the app | Inherited styles from an un-migrated container. Migrate the container.                       |
| Widget re-enables after a failed save         | You rolled back state. Don't — the reply is already sent.                                    |
| Widget resets on every keystroke elsewhere    | The host value is a new object each render. `useMemo` it.                                    |
| Widget flashes a fallback while streaming     | You passed `status="ready"` during streaming, so a partial payload got validated.            |
| Two widgets fight over the composer           | Two `input`-placed messages. Only the last renders; that is intended.                        |
