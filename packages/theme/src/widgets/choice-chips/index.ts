import { defineWidget } from '@nerey/core';

import { ChoiceChipsWidget } from './component';
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
 * The placement and the lifecycle are the load-bearing parts of this record and both are argued
 * for beside their constants in `schema.ts`, where the component can see them too — restating the
 * reasoning here would give it two homes and one of them would go stale.
 */
export const choiceChipsWidget = defineWidget<ChoiceChipsPayload, ChoiceChipsState>({
  type: CHOICE_CHIPS_TYPE,
  version: CHOICE_CHIPS_VERSION,
  component: ChoiceChipsWidget,
  placement: CHOICE_CHIPS_PLACEMENT,
  lifecycle: CHOICE_CHIPS_LIFECYCLE,
  payloadSchema: choiceChipsPayloadSchema,
  stateSchema: choiceChipsStateSchema,
});

export { ChoiceChipsWidget } from './component';
export type { ChoiceChipsWidgetProps } from './component';
export {
  CHOICE_CHIPS_LIFECYCLE,
  CHOICE_CHIPS_MULTIPLE_GROUP_LABEL,
  CHOICE_CHIPS_PLACEMENT,
  CHOICE_CHIPS_SAVE_FAILED_NOTICE,
  CHOICE_CHIPS_SENT_LABEL,
  CHOICE_CHIPS_SINGLE_GROUP_LABEL,
  CHOICE_CHIPS_TYPE,
  CHOICE_CHIPS_VERSION,
  DEFAULT_CHOICE_CHIPS_SEND_LABEL,
  choiceChipsPayloadSchema,
  choiceChipsStateSchema,
  choiceSchema,
  replyFor,
} from './schema';
export type { Choice, ChoiceChipsPayload, ChoiceChipsState } from './schema';
