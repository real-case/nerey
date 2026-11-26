import type { AnyWidgetContract } from '@nerey/core/server';
import type { AiSdkBinding } from '@nerey/ai-sdk/server';
import { themeWidgetContracts } from '@nerey/theme/server';

import { offerContract } from './widgets/offer/contract';

/**
 * What the server knows about the catalog (ADR 0056). It mirrors `registry.tsx` one for one — the
 * theme's catalog, then the application's own — and is what both the prompt and the tool
 * definitions are derived from. Nothing here imports React, so a server component can read it.
 */
export const serverContracts: readonly AnyWidgetContract[] = [...themeWidgetContracts, offerContract];

/**
 * Which tool means which widget — `@nerey/ai-sdk`'s `tools` binding (ADR 0055). One table, read by
 * `toolsFromRegistry` on the server and by the frame mapper on the client. React-free, so both can
 * import it.
 */
export const binding = {
  mode: 'tools',
  tools: {
    ask_poll: { type: 'poll', version: '1.0.0' },
    make_offer: { type: 'offer', version: '1.0.0' },
  },
} as const satisfies AiSdkBinding;
