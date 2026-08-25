import { defineWidget } from '@nerey/core';

import { FormWidget } from './component';
import { FORM_PLACEMENT, FORM_TYPE, FORM_VERSION, formPayloadSchema, formStateSchema } from './schema';
import type { FormPayload, FormState } from './schema';

/**
 * The elicitation widget. The lifecycle is the part worth arguing about:
 *
 * `persist: 'forever'` — what the user answered is a fact about the conversation, not a UI
 * detail, so it outlives the session and the transcript replays with it (ADR 0016). It is also
 * what makes a half-filled form survive a reload, which is the difference between a form people
 * finish and a form people abandon.
 *
 * `expiry: [{ on: 'submit' }]` — spelled as `{ on: 'interact', action: 'submit' }`, narrowed to
 * the ONE action rather than any interaction, because this widget will grow others (a "skip", a
 * "save draft") and an unqualified rule would end the form on the first of them. Not
 * `{ on: 'message' }` either: a form the user has not sent stays fillable after the agent says
 * something else, which is what a long form scrolled out of view needs to be (ADR 0018).
 *
 * `afterExpiry: 'snapshot'` — disabled, not removed (FR-24). Replacing a submitted form with its
 * fallback text would erase the answers from the transcript, and hiding it would erase that the
 * questions were ever asked.
 */
export const formWidget = defineWidget<FormPayload, FormState>({
  type: FORM_TYPE,
  version: FORM_VERSION,
  component: FormWidget,
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

export { FormWidget, SUBMITTED_BADGE_LABEL } from './component';
export type { FormWidgetProps } from './component';
export {
  DEFAULT_SELECT_PLACEHOLDER,
  DEFAULT_SUBMIT_LABEL,
  EMPTY_SUBMISSION_TEXT,
  FORM_PLACEMENT,
  FORM_TYPE,
  FORM_VERSION,
  defaultValueFor,
  fieldIssue,
  formatValue,
  formFieldSchema,
  formPayloadSchema,
  formStateSchema,
  formValueSchema,
  formValuesSchema,
  readValue,
  summarise,
  valuesFor,
} from './schema';
export type { FormField, FormFieldKind, FormFieldOption, FormPayload, FormState, FormValue } from './schema';
