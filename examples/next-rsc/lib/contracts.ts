import type { AnyWidgetContract } from '@nerey/core/server';
import { themeWidgetContracts } from '@nerey/theme/server';

import { offerContract } from './widgets/offer/contract';

/**
 * What the server knows about the catalog (ADR 0056). It mirrors `registry.tsx` one for one — the
 * theme's catalog, then the application's own — and is what both the prompt and the tool
 * definitions are derived from. Nothing here imports React, so a server component can read it.
 */
export const serverContracts: readonly AnyWidgetContract[] = [...themeWidgetContracts, offerContract];

/** Which tool the scripted model calls for which widget. A real app derives this the same way. */
export const TOOL_WIDGETS = {
  ask_poll: { type: 'poll', version: '1.0.0' },
  make_offer: { type: 'offer', version: '1.0.0' },
} as const;

export type ToolName = keyof typeof TOOL_WIDGETS;
