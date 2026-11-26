import { toolsFromRegistry } from '@nerey/ai-sdk/server';
import { describeRegistry } from '@nerey/core/server';
import type { ReactElement } from 'react';
import { z } from 'zod';

import { Chat } from '../components/chat';
import type { KnownWidgetState } from '../lib/frames';
import { binding, serverContracts } from '../lib/contracts';
import { CONVERSATION_ID, stateKey, store } from '../lib/store';

// The transcript lives in memory and changes per request; nothing here may be prerendered.
export const dynamic = 'force-dynamic';

/**
 * A React Server Component. It does the two jobs that belong on the server:
 *
 * - derives what the model is told from the same contracts the client registry is built from
 *   (ADR 0040, 0052, 0056) — `describeRegistry` comes from `@nerey/core/server`, which a server
 *   component can call, where `@nerey/core` would hand it a client reference;
 * - reads the stored transcript and widget state, so the first frame — rendered here — already
 *   shows every widget as it is: a passed deadline from `createdAt` (ADR 0046), an answered call
 *   from its tool part (ADR 0055), the chosen option from the stored state.
 */
const toJsonSchema = (schema: unknown): unknown => z.toJSONSchema(schema as z.ZodType);

export default function Page(): ReactElement {
  const descriptors = describeRegistry(serverContracts, { toJsonSchema });
  // What `streamText({ tools })` would receive, derived from the same contracts (ADR 0055).
  const tools = Object.keys(toolsFromRegistry(serverContracts, { binding, toJsonSchema }));

  const { messages, widgetState } = store();
  const known: KnownWidgetState = {};
  const prefix = stateKey(CONVERSATION_ID, '');
  for (const [key, value] of widgetState) {
    if (key.startsWith(prefix)) known[key.slice(prefix.length)] = value;
  }

  return (
    <main>
      <h1>Nerey on Next.js</h1>
      <Chat conversationId={CONVERSATION_ID} initialMessages={messages} known={known} />
      <details className="prompt">
        <summary>What the model is told ({descriptors.length} widgets)</summary>
        <p data-testid="tools">Tools: {tools.join(', ')}</p>
        <pre data-testid="registry-description">{JSON.stringify(descriptors, null, 2)}</pre>
      </details>
    </main>
  );
}
