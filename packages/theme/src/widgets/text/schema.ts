import { z } from 'zod';

/**
 * ADR 0011 — core depends on the Standard Schema *spec* and never on a validator, which leaves
 * its own built-ins hand-writing the `~standard` interface. The theme is under no such
 * constraint: Zod 4 implements the spec, `defineWidget` accepts any implementation of it, and a
 * reference layer whose widgets are written the way a consumer would write them is worth more
 * than one that demonstrates an interface nobody hand-rolls twice.
 *
 * The shape is not the theme's to choose. This entry replaces `text@1.0.0` at exactly those
 * coordinates (ADR 0009 / 0035), so it has to accept every payload the built-in accepts — a
 * producer has no way to know which of the two packages is rendering its message.
 */
export const textPayloadSchema = z.object({
  /**
   * Deliberately not `.min(1)`. An empty assistant turn is a legitimate message, and rejecting
   * it here would route it into the fallback (ADR 0012) — which renders the same nothing, with
   * an `invalid-payload` report attached to it.
   */
  content: z.string(),
});

export type TextPayload = z.infer<typeof textPayloadSchema>;

/**
 * `text` persists nothing. It has no controls, so there is no user decision to store and no
 * state schema to validate; the uninhabited record says so in the type rather than leaving
 * `unknown` for a future `useWidgetState` call to quietly fill in (ADR 0016).
 */
export type TextState = Record<string, never>;
