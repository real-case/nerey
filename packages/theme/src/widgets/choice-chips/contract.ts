import { defineWidgetContract } from '@nerey/core/server';

import {
  CHOICE_CHIPS_LIFECYCLE,
  CHOICE_CHIPS_PLACEMENT,
  CHOICE_CHIPS_TYPE,
  CHOICE_CHIPS_VERSION,
  choiceChipsPayloadSchema,
  choiceChipsStateSchema,
} from './schema';
import type { ChoiceChipsPayload, ChoiceChipsState } from './schema';

/**
 * The React-free half of `choiceChipsWidget` (ADR 0056), readable on the server where the entry is a
 * client reference. `./index.ts` builds the entry from it; the reasoning behind its fields is there.
 */
export const choiceChipsContract = defineWidgetContract<ChoiceChipsPayload, ChoiceChipsState>({
  type: CHOICE_CHIPS_TYPE,
  version: CHOICE_CHIPS_VERSION,
  description:
    'Offer a short row of quick replies. Use it when each option is a complete answer on its own ' +
    'and no separate submit step is wanted.',
  placement: CHOICE_CHIPS_PLACEMENT,
  lifecycle: CHOICE_CHIPS_LIFECYCLE,
  payloadSchema: choiceChipsPayloadSchema,
  stateSchema: choiceChipsStateSchema,
});
