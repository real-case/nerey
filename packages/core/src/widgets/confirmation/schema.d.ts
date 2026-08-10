import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Placement } from '../../types';
/**
 * ADR 0011 — core depends on the Standard Schema *spec*, never on a validator, so the built-in
 * widgets cannot reach for Zod to describe their own payloads. These schemas are therefore
 * hand-rolled against the v1 interface: about forty lines, no runtime bytes beyond what they
 * validate, and they double as the executable proof that a non-vendor implementation of the
 * spec really does flow through `validateSync` and the error taxonomy (ADR 0013).
 */
export type ConfirmationPayload = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
};
export type ConfirmationState = {
  decision?: 'confirmed' | 'cancelled';
};
/** The terminal value of a confirmation. Named because both the widget and its meta carry it. */
export type ConfirmationDecision = NonNullable<ConfirmationState['decision']>;
export type ConfirmationTone = NonNullable<ConfirmationPayload['tone']>;
/**
 * Identity lives beside the schemas rather than in `index.ts` because the component needs it for
 * its `data-nerey-widget` / `data-nerey-version` / `data-nerey-slot` attributes (ADR 0020) and
 * the entry needs it for registration (ADR 0009). Importing it from the entry would make the
 * component depend on its own registration, and duplicating the literals is how a widget ends up
 * announcing a version the registry cannot resolve.
 */
export declare const CONFIRMATION_TYPE = 'confirmation';
export declare const CONFIRMATION_VERSION = '1.0.0';
export declare const CONFIRMATION_PLACEMENT: Placement;
export declare const DEFAULT_CONFIRM_LABEL = 'Confirm';
export declare const DEFAULT_CANCEL_LABEL = 'Cancel';
export declare const confirmationPayloadSchema: StandardSchemaV1<unknown, ConfirmationPayload>;
export declare const confirmationStateSchema: StandardSchemaV1<unknown, ConfirmationState>;
/** The label a decision was taken with, used as the outbound message text (ADR 0014). */
export declare function labelFor(payload: ConfirmationPayload, decision: ConfirmationDecision): string;
//# sourceMappingURL=schema.d.ts.map
