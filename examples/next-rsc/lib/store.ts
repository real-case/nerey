// Type-only, so importing the client entry costs nothing at runtime on the server.
import type { LifecycleRecord, WidgetStateRecord } from '@nerey/core';
import type { UIMessage } from 'ai';

import { SCRIPTED_NOW } from './clock';
import { OFFER_TIMEOUT_MS } from './widgets/offer/contract';

/**
 * The example's whole backend: one in-memory conversation, the widget state and the expiry markers
 * written through the persistence port. A real application keeps the same three things in its own
 * database; nothing here is Nerey's, which is the point of the port (ADR 0047).
 *
 * On `globalThis` so the route handlers and the page share one copy under `next dev` too.
 */

export type ExampleMetadata = { createdAt: number };
export type ExampleMessage = UIMessage<ExampleMetadata>;

type Store = {
  messages: ExampleMessage[];
  widgetState: Map<string, WidgetStateRecord>;
  lifecycle: Map<string, LifecycleRecord>;
};

export const CONVERSATION_ID = 'demo';

/**
 * The transcript the page opens on. Its offer was made ten minutes before the scripted "now", and it
 * lasts one, so the server render must already show it closed (ADR 0046).
 */
function seed(): ExampleMessage[] {
  const offerMadeAt = SCRIPTED_NOW - 10 * OFFER_TIMEOUT_MS;
  return [
    {
      id: 'seed-user',
      role: 'user',
      metadata: { createdAt: offerMadeAt - 1_000 },
      parts: [{ type: 'text', text: 'Is there anything on offer today?' }],
    },
    {
      id: 'seed-assistant',
      role: 'assistant',
      metadata: { createdAt: offerMadeAt },
      parts: [
        { type: 'text', text: 'There is, for one minute only.' },
        {
          type: 'tool-make_offer',
          toolCallId: 'call-offer',
          state: 'input-available',
          input: { title: 'Early access to the beta', acceptLabel: 'Accept the offer' },
        },
      ],
    },
  ];
}

const globalStore = globalThis as typeof globalThis & { __nereyExampleStore?: Store };

function fresh(): Store {
  return { messages: seed(), widgetState: new Map(), lifecycle: new Map() };
}

export function store(): Store {
  globalStore.__nereyExampleStore ??= fresh();
  return globalStore.__nereyExampleStore;
}

/** Puts the conversation back to its seed, so a smoke run can start from a known transcript. */
export function resetStore(): void {
  globalStore.__nereyExampleStore = fresh();
}

export function stateKey(conversationId: string, messageId: string | number): string {
  return `${conversationId}/${String(messageId)}`;
}
