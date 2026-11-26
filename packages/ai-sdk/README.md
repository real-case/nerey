# @nerey/ai-sdk

The [Vercel AI SDK](https://ai-sdk.dev) adapter for `@nerey/core`. Ships no CSS and has no runtime
dependencies.

```bash
npm install @nerey/ai-sdk @nerey/core ai @ai-sdk/react
```

Peers: `@nerey/core@^0.1`, `ai@^7`, `react@^19`. A new AI SDK major is a new major of this package,
never of core.

The AI SDK owns the transport, the model call and the chat state. Nerey owns the widget contract: the
exact `type@version` lookup, validation, the lifecycle and the reply channel. This package is the
seam between them, and it keeps the rules core relies on (ADR 0055):

- A widget tool call becomes one `NereyMessage` whose `id` and `correlationId` are the `toolCallId`.
- `input-streaming` renders as `streaming`, so a partial payload is never validated. The complete
  payload is validated once.
- `type` and `version` are passed through untouched. A model that sends `"1.0"` for an entry
  registered as `1.0.0` gets the fallback and an `unknown-widget` error, not a near match.
- A widget's answer goes back as `addToolOutput` on the call it answers, or as
  `addToolApprovalResponse` when the call is waiting for approval.
- An answered call renders read-only after a reload, from the transcript alone.

## Binding tool calls to widgets

Declare which tool calls are widgets. Nothing else is.

```ts
import type { AiSdkBinding } from '@nerey/ai-sdk';

// One tool, `render_widget`, whose input is { type, version, payload }.
export const binding: AiSdkBinding = { mode: 'render-widget' };

// Or one tool per widget, with the version in the table.
export const tableBinding: AiSdkBinding = {
  mode: 'tools',
  tools: { ask_user: { type: 'poll', version: '1.0.0' } },
};
```

## Server: the model's tools, from the registry

```ts
// app/api/chat/route.ts
import { toolsFromRegistry } from '@nerey/ai-sdk/server';
import { convertToModelMessages, streamText } from 'ai';
import { z } from 'zod';

const tools = toolsFromRegistry(registry, {
  binding,
  toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
});

export async function POST(request: Request) {
  const { messages } = await request.json();
  const result = streamText({ model, tools, messages: await convertToModelMessages(messages) });
  return result.toUIMessageStreamResponse({
    // A fixed creation time per message, so a `timeout` rule does not restart on reload.
    messageMetadata: ({ part }) => (part.type === 'start' ? { createdAt: Date.now() } : undefined),
  });
}
```

The tools have no `execute`: the person answers them in the browser. `@nerey/ai-sdk/server` has no
`'use client'` banner and imports `describeRegistry` from `@nerey/core/server`, so it runs in a route
handler or a server component.

## Client: frames and the host

```tsx
'use client';
import { useChat } from '@ai-sdk/react';
import { DEFAULT_HOST_VALUE, WidgetHostProvider, WidgetRenderer, createMemoryPersistence } from '@nerey/core';
import { useAiSdkHost, useAiSdkWidgetFrames } from '@nerey/ai-sdk';

const persistence = createMemoryPersistence();

export function Chat() {
  const chat = useChat();
  const frames = useAiSdkWidgetFrames(chat.messages, { binding });
  const host = useAiSdkHost(chat);

  return (
    <WidgetHostProvider
      value={{ ...DEFAULT_HOST_VALUE, registry, conversationId: chat.id, persistence, ...host }}
    >
      {frames.map((frame) => (
        <WidgetRenderer key={frame.message.id} message={frame.message} status={frame.status} />
      ))}
    </WidgetHostProvider>
  );
}
```

Text parts are yours to render as you already do; the frames cover the widget tool calls only. Each
widget message's `text` is the turn's text, so a widget that cannot render still leaves it readable.

Outside React, `createWidgetFrameMapper({ binding })` and `createAiSdkHost({ chat })` do the same over
an AI SDK `Chat` instance, and `toWidgetFrames(message, { binding, createdAt })` is the pure mapping
for one stored `UIMessage`.

## Approvals

A call in `approval-requested` is answered with `addToolApprovalResponse`. `approved` is
`result.approved` when the widget sent a boolean there, and otherwise `action === 'confirm'`, which is
what the built-in `confirmation` widget sends. Pass `approvalOf` to `useAiSdkHost` or
`createAiSdkHost` to decide it yourself.

## Testing an adapter

This package runs `expectAdapterConformance` from `@nerey/core/testing` in both binding modes. A
fork or a custom adapter can run the same kit.
