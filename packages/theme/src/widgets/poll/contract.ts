import { defineWidgetContract } from '@nerey/core/server';

import { POLL_PLACEMENT, POLL_TYPE, POLL_VERSION, pollPayloadSchema, pollStateSchema } from './schema';
import type { PollPayload, PollState } from './schema';

/**
 * The React-free half of `pollWidget` (ADR 0056), readable on the server where the entry is a
 * client reference. `./index.ts` builds the entry from it; the reasoning behind its fields is there.
 */
export const pollContract = defineWidgetContract<PollPayload, PollState>({
  type: POLL_TYPE,
  version: POLL_VERSION,
  description:
    'Ask the user to pick one of the options you list, or several when `multiple` is set. Use it ' +
    'for a question with a closed set of answers; the reply names the chosen option.',
  placement: POLL_PLACEMENT,
  lifecycle: {
    persist: 'forever',
    expiry: [{ on: 'interact', action: 'submit' }],
    afterExpiry: 'snapshot',
  },
  payloadSchema: pollPayloadSchema,
  stateSchema: pollStateSchema,
});
