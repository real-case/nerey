import { defineWidgetContract } from '@nerey/core/server';

import { FORM_PLACEMENT, FORM_TYPE, FORM_VERSION, formPayloadSchema, formStateSchema } from './schema';
import type { FormPayload, FormState } from './schema';

/**
 * The React-free half of `formWidget` (ADR 0056), readable on the server where the entry is a
 * client reference. `./index.ts` builds the entry from it; the reasoning behind its fields is there.
 */
export const formContract = defineWidgetContract<FormPayload, FormState>({
  type: FORM_TYPE,
  version: FORM_VERSION,
  description:
    'Collect several related fields in one submit. Use it when the answer needs more than a ' +
    'single choice; fields are flat and primitive.',
  placement: FORM_PLACEMENT,
  lifecycle: {
    persist: 'forever',
    expiry: [{ on: 'interact', action: 'submit' }],
    afterExpiry: 'snapshot',
  },
  payloadSchema: formPayloadSchema,
  stateSchema: formStateSchema,
});
