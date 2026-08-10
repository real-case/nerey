import type { ConfirmationPayload, ConfirmationState } from './schema';
/**
 * ADR 0035 — one of exactly two built-ins. The lifecycle is the interesting part of the record:
 *
 * `persist: 'forever'` — the decision is a fact about the conversation, not a UI detail, so it
 * outlives the session and the transcript replays with it (ADR 0016).
 *
 * `expiry: [{ on: 'interact' }]` — one interaction ends it. Not `{ on: 'message' }`: a question the
 * user has not answered stays answerable even after the agent says something else, which is what a
 * confirmation that scrolled out of view needs to be (ADR 0018).
 *
 * `afterExpiry: 'snapshot'` — disabled, not removed (FR-24). Replacing an answered confirmation
 * with its fallback text would erase which button the user pressed from the transcript, and hiding
 * it would erase that the question was asked at all.
 */
export declare const confirmationWidget: import('../..').WidgetRegistryEntry<
  ConfirmationPayload,
  ConfirmationState,
  unknown
>;
export { ConfirmationWidget } from './component';
export type { ConfirmationWidgetProps } from './component';
export {
  CONFIRMATION_PLACEMENT,
  CONFIRMATION_TYPE,
  CONFIRMATION_VERSION,
  confirmationPayloadSchema,
  confirmationStateSchema,
  DEFAULT_CANCEL_LABEL,
  DEFAULT_CONFIRM_LABEL,
  labelFor,
} from './schema';
export type {
  ConfirmationDecision,
  ConfirmationPayload,
  ConfirmationState,
  ConfirmationTone,
} from './schema';
//# sourceMappingURL=index.d.ts.map
