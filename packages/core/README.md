# @nerey/core

Headless generative UI for React. Ships zero CSS.

A model does not generate interface code. It picks a widget you already declared and fills in
its payload. `@nerey/core` is the part that turns that payload into a rendered, interactive,
persistable component — and nothing else. No transport, no LLM SDK, no markdown renderer, no
styling.

```bash
npm install @nerey/core
```

Peer: `react@^19`. The only runtime dependency is `@standard-schema/spec`, which is types-only.

---

## Why a registry

Between 2024 and 2026 three independent specifications converged on the same answer. MCP Apps
(SEP-1865) declares UI templates as `ui://` resources referenced from tool metadata. Google's
A2UI has the agent send declarative JSON that the client renders from a pre-approved catalog.
The Vercel AI SDK binds a tool result to a React component you registered. None of them let a
model emit executable UI.

Nerey takes the same position, and the registry is the load-bearing abstraction: the model
chooses among things you wrote, so the worst a bad generation can do is fail validation.

## Five minutes

```tsx
import {
  WidgetHostProvider,
  MessageSlotHost,
  createWidgetRegistry,
  composeRegistries,
  builtInWidgets,
  defineWidget,
  createMemoryPersistence,
  type NereyMessage,
} from '@nerey/core';
import { z } from 'zod';

// 1. Declare a widget.
const ratingSchema = z.object({ question: z.string(), max: z.number().int().default(5) });

const ratingWidget = defineWidget<z.infer<typeof ratingSchema>, { score?: number }>({
  type: 'rating',
  version: '1.0.0',
  payloadSchema: ratingSchema,
  placement: { slot: 'message' },
  lifecycle: { persist: 'forever', expiry: [{ on: 'interact' }], afterExpiry: 'snapshot' },
  component: ({ payload, readonly, onInteraction }) => (
    <fieldset disabled={readonly}>
      <legend>{payload.question}</legend>
      {Array.from({ length: payload.max }, (_, i) => i + 1).map((score) => (
        <button
          key={score}
          onClick={() => onInteraction('rate', { text: `I'd rate it ${score}/${payload.max}.` })}
        >
          {score}
        </button>
      ))}
    </fieldset>
  ),
});

// 2. Compose a registry. Explicitly — nothing registers itself on import.
const registry = composeRegistries(builtInWidgets, [ratingWidget]);

// 3. Give the host what only it can know.
function Chat({ messages, send }: { messages: NereyMessage[]; send: (text: string) => void }) {
  return (
    <WidgetHostProvider
      value={{
        registry,
        conversationId: 'chat-1',
        sendUserMessage: send,
        persistence: createMemoryPersistence(),
        renderFallback: (text) => <p>{text}</p>,
        onWidgetError: (error) => reportToSentry(error),
        messageCount: messages.length,
      }}
    >
      <MessageSlotHost messages={messages} />
    </WidgetHostProvider>
  );
}
```

The model produces a message like:

```json
{
  "id": 42,
  "role": "assistant",
  "text": "How would you rate that answer, 1 to 5?",
  "widget": {
    "type": "rating",
    "version": "1.0.0",
    "payload": { "question": "How would you rate that answer?", "max": 5 }
  }
}
```

`text` is not optional. It is the last line of the degradation chain, and a widget that cannot
render must still leave a readable transcript.

---

## The contracts

### Resolution is exact

`registry.get(type, version)` matches `type@version` exactly. There is no implicit semver
range, because an implicit range fails silently: a widget registered as `poll@1.0.0` against a
backend sending `"1.0"` never resolves, falls back to plain text, and looks exactly like a
widget you forgot to register. Exact matching makes that loud.

An entry can opt in per-widget:

```ts
defineWidget({ type: 'poll', version: '2.0.0', acceptsVersion: (v) => v.startsWith('2.'), … });
```

### Degradation, in four steps

Every step renders something readable and emits a typed error to `onWidgetError`:

| Step | Cause                          | Rendered                                          | Error code        |
| ---- | ------------------------------ | ------------------------------------------------- | ----------------- |
| 1    | no entry for `type@version`    | fallback, `data-nerey-fallback="unknown-widget"`  | `unknown-widget`  |
| 2    | payload fails its schema       | fallback, `data-nerey-fallback="invalid-payload"` | `invalid-payload` |
| 3    | the component throws           | fallback, `data-nerey-fallback="render-error"`    | `widget-render`   |
| 4    | no `renderFallback` configured | `message.text` as plain text                      | —                 |

Persisted **state** failing validation is deliberately _not_ a fallback: the widget renders with
empty state and reports `invalid-state`. A corrupt saved selection should not make the whole
message unreadable.

### Streaming payloads are never validated

```tsx
<WidgetRenderer message={message} status="streaming" />
```

A partial object fails a complete schema by definition, so validating mid-stream would turn
every stream into a fallback. Validation runs once `status` reaches `ready`. Widgets receive
`status` and can render a skeleton while it is `streaming`.

The three values map onto the tool-part state machine the AI SDK standardised —
`input-streaming` → `input-available` → `output-available` → `output-error`.

### A widget's only outbound channel

```ts
onInteraction('submit', { text: "3 — Xi'an Huawei Technologies", meta: { value: '3' } });
```

The widget composes the message; the host owns sending it, optimistic insertion, the thinking
indicator and error handling. Write `text` as something a human would plausibly have typed — the
agent reads it as user input, and `{"selected":3}` reads as noise.

Widgets perform **no I/O**. `@nerey/eslint-config` ships that boundary as a lint rule so it
survives being copied into a new project:

```js
import nerey from '@nerey/eslint-config';
export default [...nerey.configs.recommended];
```

### Persistence is a port

```ts
type MessagePersistence = {
  getWidgetState(conversationId, messageId): Promise<Record<string, unknown> | undefined>;
  updateWidgetState(conversationId, messageId, state, options?): Promise<void>;
};
```

Core ships `createMemoryPersistence()`; you supply the real one (TanStack Query, SWR, a plain
fetch). Inside a widget:

```tsx
const { state, setState, status, error } = useWidgetState(messageId, { selected: undefined });
```

Optimistic, debounced, coalesced, aborted on unmount — and **a failed write does not roll
back**. That inverts the usual optimistic pattern on purpose: by the time a widget persists it
has normally already sent a reply into the transcript, and re-enabling it invites a duplicate.
The write failure surfaces as `status: 'error'` and a `persistence` error instead.

### Lifecycle is evaluated, not just declared

```ts
lifecycle: {
  persist: 'forever',
  expiry: [{ on: 'interact', action: 'submit' }, { on: 'timeout', ms: 60_000 }],
  afterExpiry: 'snapshot',
}
```

Rules are OR-ed; the first to fire expires the widget and flips `readonly`.

| Rule                    | Fires when                                           |
| ----------------------- | ---------------------------------------------------- |
| `{ on: 'interact' }`    | any interaction; with `action`, only that one        |
| `{ on: 'timeout', ms }` | `ms` after mount                                     |
| `{ on: 'message' }`     | a later message arrives (`messageCount` on the host) |
| `{ on: 'navigate' }`    | the conversation is left                             |
| `{ on: 'event', name }` | the host adds `name` to `firedEvents`                |

`afterExpiry` decides what an expired widget becomes: `snapshot` (read-only, showing its
terminal state), `fallback` (plain text) or `hide` (nothing). Prefer `snapshot` — an acted-upon
widget should be disabled, not removed, so reloading the page leaves the transcript legible.

This is the part of the design with no standard to copy. MCP Apps explicitly deferred widget
state persistence and rehydration; the OpenAI Apps SDK is the only system with a documented
full contract. Everything above is Nerey's answer, and it is deliberately opinionated.

### Placement

```ts
{ slot: 'message' }                                     // in the transcript
{ slot: 'input', position: 'above' | 'below' | 'replace' }  // in the composer
{ slot: 'overlay', scope: 'chat' | 'page', dismissible: true }
```

Rendered by `MessageSlotHost`, `InputSlotHost` and `OverlaySlotHost`. Only the last
input-placed widget renders — two widgets fighting over the composer is a bug, and rendering
both makes it look intentional.

`OverlaySlotHost` does not portal. `scope: 'page'` implies escaping the conversation subtree,
which collides with your own portal and z-index layering; you position the container.

### Schema migration

A persisted transcript outlives the schema that produced it.

```ts
defineWidget({
  type: 'poll',
  version: '2.0.0',
  migrate: (from, payload) => (from === '1.0.0' ? upgradeV1(payload) : undefined),
});
```

`migrate` runs before validation, so only it ever sees a historical shape. Returning `undefined`
means "I cannot read that version" and the degradation chain takes over. Returning `null`
succeeds — `null` is a payload a schema may legitimately accept.

---

## Styling

Core ships no CSS and no class names. Every node it owns carries documented attributes:

| Attribute             | Values                                                              |
| --------------------- | ------------------------------------------------------------------- |
| `data-nerey-widget`   | the widget type                                                     |
| `data-nerey-version`  | the resolved entry version                                          |
| `data-nerey-slot`     | `message` · `input` · `overlay`                                     |
| `data-nerey-part`     | a named region inside a widget                                      |
| `data-nerey-status`   | `streaming` · `ready` · `error`                                     |
| `data-state`          | `idle` · `selected` · `submitting` · `locked` · `expired` · `error` |
| `data-readonly`       | present (valueless) when read-only                                  |
| `data-nerey-fallback` | why a fallback rendered                                             |

That is the whole styling API. From your own CSS Modules:

```css
.widget[data-nerey-widget='poll'][data-state='locked'] {
  opacity: 0.55;
  pointer-events: none;
}
```

`data-state` deliberately reuses the unprefixed name Base UI, Radix and React Aria all use, so
one selector idiom covers your whole UI.

It is public API: renaming an attribute is a MAJOR version bump, and a contract snapshot test
makes an accidental change visible in review.

Want it styled for you? `@nerey/theme` is a complete CSS Modules theme driven by `--nerey-*`
custom properties. Or don't — that is the point of the split.

---

## Building widgets without a backend

```tsx
import { MockWidgetHost, widgetMessage, createSendRecorder, createDevRegistry } from '@nerey/core/mock';
```

`MockWidgetHost` wires an in-memory host; `createSendRecorder()` captures what a widget sends;
`createDevRegistry(base)` replaces the silent fallback with a diagnostic card naming the missing
`type@version` and listing what _is_ registered — because in development, a silent fallback
looks like the model produced plain text and hides the most common wiring bug there is.

## Proving a widget conforms

```ts
import { expectWidgetConformance } from '@nerey/core/testing';

it('conforms', async () => {
  await expectWidgetConformance(ratingWidget, {
    validPayload: { question: 'How was it?', max: 5 },
    invalidPayloads: [{}, { question: 42 }, null],
    source: await readFile('./rating/component.tsx', 'utf8'),
  });
});
```

Nine rules: identity, schema accepts valid, schema rejects invalid, schema is synchronous,
renders, `data-*` contract, read-only is inert, lifecycle declared coherently, and no I/O.

---

## What this package deliberately is not

No WebSocket, SSE or polling. No MCP client. No LLM SDK binding. No iframe sandbox. No i18n.
No markdown renderer. No charts.

Each is an adapter point, not a dependency. Shipping any of them in v1 would make the package
unusable to anyone whose stack differs by one choice — and the markdown renderer alone would put
three transitive packages in every consumer's install for a path most of them replace.

## Reference

Every decision above is recorded as an ADR in the repository under `docs/decisions/`, with the
options that were considered and rejected. The relevant ones here are 0008–0022 and 0030.

MIT.
