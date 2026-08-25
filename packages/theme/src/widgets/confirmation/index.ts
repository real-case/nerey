import {
  CONFIRMATION_PLACEMENT,
  CONFIRMATION_TYPE,
  CONFIRMATION_VERSION,
  EXPIRE_ON_INTERACT,
  defineWidget,
} from '@nerey/core';

import { ConfirmationWidget } from './component';
import { confirmationPayloadSchema, confirmationStateSchema } from './schema';
import type { ConfirmationPayload, ConfirmationState } from './schema';

/**
 * The theme's `confirmation@1.0.0`, registered at the same coordinates as core's built-in so that
 * `composeRegistries({ override: true }, builtInWidgets, themeWidgets)` replaces it (ADR 0010).
 *
 * Identity comes from core rather than from local literals. A styled replacement whose `type` or
 * `version` drifted would not collide and would not throw — it would register alongside the
 * original, lose every lookup, and look exactly like a theme that failed to load.
 *
 * The lifecycle is core's, restated through the shared constant:
 *
 * `persist: 'forever'` — the decision is a fact about the conversation, not a UI detail, so it
 * outlives the session and the transcript replays with it (ADR 0016).
 *
 * `expiry: [{ on: 'interact' }]` — one interaction ends it. Not `{ on: 'message' }`: a question
 * the user has not answered stays answerable after the agent says something else, which is what a
 * confirmation that scrolled out of view needs to be (ADR 0018).
 *
 * `afterExpiry: 'snapshot'` — disabled, not removed (FR-24). Replacing an answered confirmation
 * with its fallback text would erase which button was pressed; hiding it would erase that the
 * question was asked at all.
 */
export const confirmationWidget = defineWidget<ConfirmationPayload, ConfirmationState>({
  type: CONFIRMATION_TYPE,
  version: CONFIRMATION_VERSION,
  component: ConfirmationWidget,
  description:
    'Ask the user to confirm or cancel one action before it is taken. Use it when the action has ' +
    'a consequence worth pausing for; the reply names which choice was made.',
  placement: CONFIRMATION_PLACEMENT,
  lifecycle: EXPIRE_ON_INTERACT,
  payloadSchema: confirmationPayloadSchema,
  stateSchema: confirmationStateSchema,
});

export { ConfirmationWidget } from './component';
export type { ConfirmationWidgetProps } from './component';
export { CONFIRMATION_TONES, confirmationPayloadSchema, confirmationStateSchema } from './schema';
export type {
  ConfirmationDecision,
  ConfirmationPayload,
  ConfirmationState,
  ConfirmationTone,
} from './schema';
