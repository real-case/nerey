import {
  EXPIRE_ON_INTERACT,
  confirmationContract as coreConfirmationContract,
  defineWidgetContract,
} from '@nerey/core/server';

import { confirmationPayloadSchema, confirmationStateSchema } from './schema';
import type { ConfirmationPayload, ConfirmationState } from './schema';

/**
 * The React-free half of `confirmationWidget` (ADR 0056), readable on the server where the entry is a
 * client reference. `./index.ts` builds the entry from it; the reasoning behind its fields is there.
 */
export const confirmationContract = defineWidgetContract<ConfirmationPayload, ConfirmationState>({
  type: coreConfirmationContract.type,
  version: coreConfirmationContract.version,
  description:
    'Ask the user to confirm or cancel one action before it is taken. Use it when the action has ' +
    'a consequence worth pausing for; the reply names which choice was made.',
  placement: coreConfirmationContract.placement,
  lifecycle: EXPIRE_ON_INTERACT,
  payloadSchema: confirmationPayloadSchema,
  stateSchema: confirmationStateSchema,
});
