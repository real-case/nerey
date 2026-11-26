import { describeRegistry } from '@nerey/core/server';
import type { ReactElement } from 'react';
import { z } from 'zod';

import { Chat } from '../components/chat';
import type { KnownWidgetState } from '../lib/frames';
import { serverContracts } from '../lib/contracts';
import { CONVERSATION_ID, stateKey, store } from '../lib/store';

// The transcript lives in memory and changes per request; nothing here may be prerendered.
export const dynamic = 'force-dynamic';

/**
 * A React Server Component. It does the two jobs that belong on the server:
 *
 * - derives what the model is told from the same contracts the client registry is built from
 *   (ADR 0040, 0052, 0056) — `describeRegistry` comes from `@nerey/core/server`, which a server
 *   component can call, where `@nerey/core` would hand it a client reference;
 * - reads the stored transcript, widget state and expiry markers, so the first frame — rendered
 *   here — already shows every widget as it is, expired ones included (ADR 0046).
 */
export default function Page(): ReactElement {
  const descriptors = describeRegistry(serverContracts, {
    toJsonSchema: (schema) => z.toJSONSchema(schema as z.ZodType),
  });

  const { messages, widgetState, lifecycle } = store();
  const known: KnownWidgetState = { state: {}, expiry: {} };
  const prefix = stateKey(CONVERSATION_ID, '');
  for (const [key, value] of widgetState)
    if (key.startsWith(prefix)) known.state[key.slice(prefix.length)] = value;
  for (const [key, value] of lifecycle)
    if (key.startsWith(prefix)) known.expiry[key.slice(prefix.length)] = value;

  return (
    <main>
      <h1>Nerey on Next.js</h1>
      <Chat conversationId={CONVERSATION_ID} initialMessages={messages} known={known} />
      <details className="prompt">
        <summary>What the model is told ({descriptors.length} widgets)</summary>
        <pre data-testid="registry-description">{JSON.stringify(descriptors, null, 2)}</pre>
      </details>
    </main>
  );
}
