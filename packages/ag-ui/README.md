# @nerey/ag-ui

The [AG-UI](https://docs.ag-ui.com) protocol adapter for [`@nerey/core`](../core). It folds an
agent's event stream into the frames `WidgetRenderer` takes, answers widget tool calls and
interrupts through the protocol, and derives the tool definitions the agent is offered from your
widget registry. The mapping is recorded in ADR 0054.

```sh
npm install @nerey/ag-ui @nerey/core @ag-ui/core react
```

`@nerey/core`, `@ag-ui/core` and `react` are peers. The adapter has no dependencies of its own,
imports `@ag-ui/core` for its types only, and does not need `@ag-ui/client`: any agent with
`addMessage` and `runAgent` works, and `HttpAgent` is one.

## Wiring

```tsx
import { useEffect } from 'react';
import { HttpAgent } from '@ag-ui/client';
import { WidgetHostProvider, WidgetRenderer, createWidgetRegistry, builtInWidgets } from '@nerey/core';
import { createAgUiHost, createAgUiTranscript, subscribeTranscript, useAgUiFrames } from '@nerey/ag-ui';

const registry = createWidgetRegistry([...builtInWidgets /* , your widgets */]);
const agent = new HttpAgent({ url: '/api/agent' });
const transcript = createAgUiTranscript();
const adapterHost = createAgUiHost({ agent, transcript });

function Chat() {
  useEffect(() => subscribeTranscript(agent, transcript), []);
  const frames = useAgUiFrames(transcript);
  return (
    <WidgetHostProvider value={{ ...yourHostValue, registry, ...adapterHost }}>
      {frames.map(({ message, status }) => (
        <WidgetRenderer key={message.id} message={message} status={status} />
      ))}
    </WidgetHostProvider>
  );
}
```

Offer the widgets to the agent with tools derived from the same registry, never written by hand:

```ts
import { toolsFromRegistry } from '@nerey/ag-ui';
import { z } from 'zod';

const tools = toolsFromRegistry(registry, { toJsonSchema: (schema) => z.toJSONSchema(schema) });
await agent.runAgent({ tools });
```

## How a tool call names a widget

Lookup is an exact match on `type@version` (ADR 0009), and the adapter never guesses. Two
bindings are available, and both can be on at once:

- **The generic tool** (default name `render_widget`): the arguments are
  `{ type, version, payload }`, and the version is whatever the model wrote. `"1.0"` against a
  registered `1.0.0` renders as a fallback with an `unknown-widget` error, which is the point.
- **A table**: `tools: { table: { ask_poll: { type: 'poll', version: '1.0.0' } } }`. The arguments
  are the payload. `toolsFromRegistry` throws at startup when a row names a `type@version` the
  registry does not hold.

Pass the same `tools` option to `createAgUiTranscript` and `toolsFromRegistry`.

## What the adapter does with the stream

- One frame per text message, and one per widget tool call keyed by its `toolCallId`, which is also
  the envelope's `correlationId`. Tool calls that are not widget calls render nothing.
- While the arguments stream, the frame is `streaming` and its payload is a partial parse, never
  validated. `TOOL_CALL_END` makes it `ready`, and core validates it once.
- `respond` sends a `role: "tool"` message carrying `{ action, text, result? }` as JSON. When the run
  ended on an interrupt naming that call, the answer also goes out as a resolved `ResumeEntry`. The
  agent runs once every widget call of the turn is answered.
- A user message typed while interrupts are open cancels them on the next run.
- An answered call is expired, and so is one whose interrupt `expiresAt` has passed;
  `useAgUiFrames` re-renders at that deadline.

## Reloads and time

A `MESSAGES_SNAPSHOT` rebuilds the transcript: answered widgets come back read-only on the first
frame. The protocol carries no widget state, so read it through your persistence port before you
render:

```ts
transcript.apply(snapshotEvent);
await hydrateWidgetStates(transcript, persistence, conversationId);
```

`createdAt` comes from `metadata.nerey.createdAt` on the message or tool call, then from the
event's `timestamp`, then from the moment the event arrived. **A producer that sends neither
leaves a `timeout` rule to restart on every reload**, so have your agent stamp
`metadata.nerey.createdAt` on assistant messages if you use timeouts.
