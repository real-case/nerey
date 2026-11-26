import { NEVER_EXPIRES, defineWidgetContract, textContract as coreTextContract } from '@nerey/core/server';

import { textPayloadSchema } from './schema';
import type { TextPayload, TextState } from './schema';

/**
 * The React-free half of `textWidget` (ADR 0056), readable on the server where the entry is a
 * client reference. `./index.ts` builds the entry from it; the reasoning behind its fields is there.
 */
export const textContract = defineWidgetContract<TextPayload, TextState>({
  type: coreTextContract.type,
  version: coreTextContract.version,
  description:
    'Plain assistant prose, optionally with preformatted blocks. Every message that carries no ' +
    'widget renders through this, so a producer does not normally select it explicitly.',
  placement: { slot: 'message' },
  lifecycle: NEVER_EXPIRES,
  payloadSchema: textPayloadSchema,
});
