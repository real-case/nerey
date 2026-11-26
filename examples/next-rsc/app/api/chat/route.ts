import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';

import { nextTurn } from '../../../lib/script';
import { store } from '../../../lib/store';
import type { ExampleMessage } from '../../../lib/store';

/**
 * The chat endpoint `useChat` posts to. Where a real app calls `streamText` with the tools derived
 * from `serverContracts`, this replays the scripted turn — same chunk protocol, same persistence
 * hook, nothing nondeterministic.
 */

/** Spacing between chunks, so the client really does see a streaming tool call. */
const CHUNK_DELAY_MS = 40;

let generated = 0;

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as { messages: ExampleMessage[] };
  const messages = body.messages;

  const stream = createUIMessageStream<ExampleMessage>({
    originalMessages: messages,
    generateId: () => `scripted-${++generated}`,
    execute: async ({ writer }) => {
      for (const chunk of nextTurn(messages)) {
        writer.write(chunk);
        await new Promise((resolve) => setTimeout(resolve, CHUNK_DELAY_MS));
      }
    },
    onFinish: ({ messages: finished }) => {
      store().messages = finished;
    },
  });

  return createUIMessageStreamResponse({ stream });
}
