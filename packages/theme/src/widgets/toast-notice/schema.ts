import { z } from 'zod';

import type { Lifecycle, Placement } from '@nerey/core';

export const TOAST_NOTICE_TYPE = 'toast-notice';
export const TOAST_NOTICE_VERSION = '1.0.0';

/**
 * The overlay slot (ADR 0017): above the conversation rather than in it, because a notice about the
 * session — a token expiring, a background job finishing, a rate limit — is not a turn in the
 * dialogue and reading it as one puts an event nobody said into the transcript.
 *
 * `scope: 'chat'` and not `'page'`: the notice is about this conversation, and ADR 0017 records
 * `'page'` as an unsolved problem rather than a supported one. `dismissible: true` hands the close
 * control to the host, which is the only layer that can actually remove the message from its list.
 */
export const TOAST_NOTICE_PLACEMENT: Placement = { slot: 'overlay', scope: 'chat', dismissible: true };

/** The default deadline. Long enough to read two lines aloud, short enough not to become furniture. */
export const NOTICE_TIMEOUT_MS = 8000;

/**
 * The one widget in this theme where `afterExpiry: 'hide'` is right, and it is worth being precise
 * about why — the default everywhere else is `snapshot`, because an acted-upon widget is disabled
 * and not removed (ADR 0018).
 *
 * A notice is the exception because it was never part of the record. `persist: 'ephemeral'` says so:
 * "your session expires in five minutes" is true for five minutes and is noise forever after, and a
 * snapshot of it would leave a permanent, disabled, no-longer-true banner floating over a
 * conversation it has nothing to do with. Nothing is lost by hiding it either — the message's own
 * `text` is still in the transcript, so the exchange stays complete.
 *
 * The two rules answer the two ways a notice stops being current. `{ on: 'timeout' }` is the notice
 * having been on screen long enough to have been read. `{ on: 'message' }` is the conversation
 * having moved on — and it is what keeps the overlay layer sane: only one notice can be live at a
 * time, because a second one arrives in a later message and that arrival is what retires the first.
 * Without it, two overlay widgets would render two fixed-position stacks on top of each other.
 *
 * `{ on: 'interact' }` is deliberately absent even though the action button ends the notice's life:
 * pressing it sends a message, and the message rule already fires on the turn that produces. Adding
 * the interact rule would say the same thing twice and would make the notice's disappearance
 * depend on which of the two the runtime noticed first.
 */
export const TOAST_NOTICE_LIFECYCLE: Lifecycle = {
  persist: 'ephemeral',
  expiry: [{ on: 'timeout', ms: NOTICE_TIMEOUT_MS }, { on: 'message' }],
  afterExpiry: 'hide',
};

export const toastNoticeToneSchema = z.enum(['neutral', 'accent', 'success', 'warning', 'danger']);

export const toastNoticeActionSchema = z.object({
  label: z.string().min(1),
  /**
   * The message sent when the button is pressed — written by the producer, in the user's voice,
   * because the agent reads it as user input (ADR 0014). `"Show me the failed rows"`, never
   * `"{\"action\":\"retry\"}"`.
   */
  value: z.string().min(1),
});

export const toastNoticePayloadSchema = z.object({
  /**
   * Required, unlike every other widget's tone. A notice with no tone is a notice whose urgency the
   * reader has to infer from the wording, and this is the one surface that interrupts them — so the
   * producer has to say whether it is interrupting with good news or bad.
   */
  tone: toastNoticeToneSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  /** At most one. Two buttons in a notification is a dialog wearing a disguise. */
  action: toastNoticeActionSchema.optional(),
});

/**
 * `.nullish()` before the transform because the renderer hands `undefined` to the state schema on
 * first render (ADR 0012), and a bare `z.object` rejects `undefined`.
 */
export const toastNoticeStateSchema = z
  .object({ acted: z.boolean().optional() })
  .nullish()
  .transform((value) => value ?? {});

export type ToastNoticeTone = z.infer<typeof toastNoticeToneSchema>;
export type ToastNoticeAction = z.infer<typeof toastNoticeActionSchema>;
export type ToastNoticePayload = z.infer<typeof toastNoticePayloadSchema>;
export type ToastNoticeState = z.infer<typeof toastNoticeStateSchema>;

/** The action reported through `onInteraction`. */
export const NOTICE_ACTION = 'notice-action';
