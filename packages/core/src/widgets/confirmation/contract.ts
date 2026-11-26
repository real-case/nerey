import { defineWidgetContract } from '../../registry';
import {
  CONFIRMATION_PLACEMENT,
  CONFIRMATION_TYPE,
  CONFIRMATION_VERSION,
  confirmationPayloadSchema,
  confirmationStateSchema,
} from './schema';
import type { ConfirmationPayload, ConfirmationState } from './schema';

/**
 * The confirmation's React-free half (ADR 0056), readable on the server where `confirmationWidget`
 * is a client reference. The entry in `./index.ts` is this plus the component.
 */
export const confirmationContract = defineWidgetContract<ConfirmationPayload, ConfirmationState>({
  type: CONFIRMATION_TYPE,
  version: CONFIRMATION_VERSION,
  description:
    'Ask the user to confirm or cancel one action before it is taken. Use it when the action has ' +
    'a consequence worth pausing for; the reply names which choice was made.',
  placement: CONFIRMATION_PLACEMENT,
  lifecycle: {
    persist: 'forever',
    expiry: [{ on: 'interact' }],
    afterExpiry: 'snapshot',
  },
  payloadSchema: confirmationPayloadSchema,
  stateSchema: confirmationStateSchema,
});
