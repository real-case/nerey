import { z } from 'zod';

/**
 * ADR 0011 — core validates through the Standard Schema *spec* and can therefore never reach for
 * a validator, which is why its own `confirmation` hand-rolls the `~standard` interface twice
 * over. The theme has no such constraint: Zod 4 implements the spec, `defineWidget` takes any
 * implementation of it, and the same rules come out in a fifth of the lines.
 *
 * The shapes are not the theme's to choose. This entry replaces `confirmation@1.0.0` at exactly
 * those coordinates (ADR 0009 / 0035), so it has to accept every payload and every persisted
 * state the built-in accepts. A model does not know which package is rendering, and a transcript
 * persisted against one must replay against the other.
 */

export const CONFIRMATION_TONES = ['default', 'danger'] as const;

export const confirmationPayloadSchema = z.object({
  /**
   * Trimmed then required, not merely present. The title is the accessible name of the
   * `role="group"`, so a blank one produces a group a screen reader announces as nothing at all
   * and the WCAG 2.2 AA gate fails on it (ADR 0032). Degrading to the message's plain text
   * (ADR 0012) is the better outcome, and rejecting it here is what causes that.
   */
  title: z.string().trim().min(1, 'A confirmation needs a title — it names the group for a screen reader.'),
  description: z.string().optional(),
  confirmLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
  /**
   * Read by the theme and ignored by core, which is the division ADR 0035 draws: `tone` is a
   * presentation hint, the ADR 0020 attribute vocabulary has no slot for one, and core will not
   * invent `data-tone` to carry it. Here it becomes a red confirm button and a warning glyph.
   */
  tone: z.enum(CONFIRMATION_TONES).optional(),
});

export type ConfirmationPayload = z.infer<typeof confirmationPayloadSchema>;
export type ConfirmationTone = (typeof CONFIRMATION_TONES)[number];

const confirmationDecisionSchema = z.enum(['confirmed', 'cancelled']);

/** The terminal value of a confirmation. Named because both the widget and its meta carry it. */
export type ConfirmationDecision = z.infer<typeof confirmationDecisionSchema>;

const confirmationStateRecordSchema = z.object({
  decision: confirmationDecisionSchema.optional(),
});

export type ConfirmationState = z.infer<typeof confirmationStateRecordSchema>;

/**
 * `preprocess` rather than a bare object, because absence is the common case and not a fault: a
 * widget nobody has touched has no persisted record and the port answers `undefined` for it
 * (ADR 0016). Failing that through the state schema would report every freshly rendered
 * confirmation as corrupt and drop a live question into the fallback (ADR 0012).
 *
 * `null` is normalised with it. A record that round-tripped through JSON, or through a store that
 * spells absence as `null`, is the same absence and must not behave differently after a reload.
 */
export const confirmationStateSchema = z.preprocess((value) => value ?? {}, confirmationStateRecordSchema);
