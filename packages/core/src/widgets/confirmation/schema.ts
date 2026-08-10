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

export type ConfirmationState = { decision?: 'confirmed' | 'cancelled' };

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
export const CONFIRMATION_TYPE = 'confirmation';
export const CONFIRMATION_VERSION = '1.0.0';
export const CONFIRMATION_PLACEMENT: Placement = { slot: 'message' };

export const DEFAULT_CONFIRM_LABEL = 'Confirm';
export const DEFAULT_CANCEL_LABEL = 'Cancel';

const TONES: readonly ConfirmationTone[] = ['default', 'danger'];

type Issue = StandardSchemaV1.Issue;
type Result<T> = StandardSchemaV1.Result<T>;

/** Enough of the value to make an issue message actionable, without printing user content back. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a value of type ${typeof value}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(
  source: Record<string, unknown>,
  key: string,
  issues: Issue[],
): string | undefined {
  const value = source[key];
  // An explicit `undefined` and an absent key are the same absence. JSON round-tripping drops
  // the key, so treating them differently would make a widget behave differently before and
  // after a reload — the exact class of bug the persistence port exists to expose (ADR 0016).
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    issues.push({ message: `\`${key}\` must be a string, received ${describe(value)}.`, path: [key] });
    return undefined;
  }
  return value;
}

export const confirmationPayloadSchema: StandardSchemaV1<unknown, ConfirmationPayload> = {
  '~standard': {
    version: 1,
    vendor: 'nerey',
    validate(value: unknown): Result<ConfirmationPayload> {
      if (!isRecord(value)) {
        return {
          issues: [{ message: `A confirmation payload must be an object, received ${describe(value)}.` }],
        };
      }

      const issues: Issue[] = [];

      const rawTitle = value['title'];
      let title: string | undefined;
      if (typeof rawTitle !== 'string') {
        issues.push({
          message: `\`title\` is required and must be a string, received ${describe(rawTitle)}.`,
          path: ['title'],
        });
      } else if (rawTitle.trim() === '') {
        // Not pedantry: the title is the accessible name of the confirmation group, so an empty
        // one produces a `role="group"` that a screen reader announces as nothing at all, and
        // ADR 0032 fails the build on it. Better to degrade to the message text (ADR 0012).
        issues.push({
          message: '`title` must not be blank — it is the accessible name of the confirmation.',
          path: ['title'],
        });
      } else {
        title = rawTitle;
      }

      const description = readOptionalString(value, 'description', issues);
      const confirmLabel = readOptionalString(value, 'confirmLabel', issues);
      const cancelLabel = readOptionalString(value, 'cancelLabel', issues);

      const rawTone = value['tone'];
      let tone: ConfirmationTone | undefined;
      if (rawTone !== undefined && rawTone !== null) {
        if (rawTone === 'default' || rawTone === 'danger') tone = rawTone;
        else {
          issues.push({
            message: `\`tone\` must be one of ${TONES.join(' | ')}, received ${describe(rawTone)}.`,
            path: ['tone'],
          });
        }
      }

      // One exit for both failure modes. `title === undefined` is reachable only after a title
      // issue was recorded, so `issues` is never empty here — and returning the whole list rather
      // than the first problem is what lets a model fix its output in one turn.
      if (title === undefined || issues.length > 0) return { issues };

      // Rebuilt key by key instead of spread from the input. The declared type then describes the
      // runtime value exactly, so nothing a model invented — `onClick`, `style`, an id the host
      // would trust — survives validation just because the schema did not mention it.
      const parsed: ConfirmationPayload = { title };
      if (description !== undefined) parsed.description = description;
      if (confirmLabel !== undefined) parsed.confirmLabel = confirmLabel;
      if (cancelLabel !== undefined) parsed.cancelLabel = cancelLabel;
      if (tone !== undefined) parsed.tone = tone;

      return { value: parsed };
    },
  },
};

export const confirmationStateSchema: StandardSchemaV1<unknown, ConfirmationState> = {
  '~standard': {
    version: 1,
    vendor: 'nerey',
    validate(value: unknown): Result<ConfirmationState> {
      // A widget nobody has touched has no persisted record, and the port answers `undefined`
      // for it (ADR 0016). Failing that through the state schema would report every freshly
      // rendered confirmation as corrupt and drop it into the fallback (ADR 0012).
      if (value === undefined || value === null) return { value: {} };

      if (!isRecord(value)) {
        return {
          issues: [{ message: `Confirmation state must be an object, received ${describe(value)}.` }],
        };
      }

      const decision = value['decision'];
      if (decision === undefined || decision === null) return { value: {} };
      if (decision === 'confirmed' || decision === 'cancelled') return { value: { decision } };

      return {
        issues: [
          {
            message: `\`decision\` must be "confirmed" or "cancelled", received ${describe(decision)}.`,
            path: ['decision'],
          },
        ],
      };
    },
  },
};

/** The label a decision was taken with, used as the outbound message text (ADR 0014). */
export function labelFor(payload: ConfirmationPayload, decision: ConfirmationDecision): string {
  return decision === 'confirmed'
    ? (payload.confirmLabel ?? DEFAULT_CONFIRM_LABEL)
    : (payload.cancelLabel ?? DEFAULT_CANCEL_LABEL);
}
