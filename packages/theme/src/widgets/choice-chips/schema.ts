import { z } from 'zod';

import type { Lifecycle, Placement } from '@nerey/core';

/**
 * ADR 0011 — validation happens at the boundary, through Standard Schema. Zod is used here and
 * never in core: core depends on the *spec* so a consumer can bring their own validator, while a
 * theme widget is a reference implementation someone copies, and copying a hand-rolled validator
 * teaches the wrong lesson.
 */

export const CHOICE_CHIPS_TYPE = 'choice-chips';
export const CHOICE_CHIPS_VERSION = '1.0.0';

/**
 * The transcript, not the composer — and the composer was the other candidate, so here is why it
 * lost.
 *
 * `{ slot: 'input' }` is where a chat product usually pins quick replies, and it would suit a
 * widget that keeps working across turns: a filter, a mode switch, a composer takeover (ADR 0017).
 * A quick reply is none of those. It answers ONE message, it is offered by that message, and the
 * answer belongs beside the question in the record — which is also what makes
 * `afterExpiry: 'snapshot'` honest below. Pinned above the composer, an answered row would either
 * sit there permanently disabled or have to be hidden, and hiding it deletes the only evidence
 * that the choice was ever offered.
 */
export const CHOICE_CHIPS_PLACEMENT: Placement = { slot: 'message' };

/**
 * Two rules, and the second one is the whole difference from the poll.
 *
 * `{ on: 'interact' }` — unnamed, because this widget reports exactly one kind of interaction and
 * that one ends it.
 *
 * `{ on: 'message' }` — a quick reply is an answer to the message that offered it. Once the
 * conversation has moved on, pressing "Yes, book it" answers a question nobody is asking any more,
 * and the reply lands three turns downstream of the context that made sense of it. A poll
 * deliberately does NOT expire this way (an unanswered question stays answerable after it scrolls
 * out of view); a quick reply is the opposite kind of object, and treating them the same is how a
 * stale chip row below a continued conversation becomes noise nobody can explain.
 *
 * `afterExpiry: 'snapshot'` — disabled, not removed (ADR 0018). The row stops being live and stays
 * legible, so the transcript still shows what was offered and which one was taken.
 */
export const CHOICE_CHIPS_LIFECYCLE: Lifecycle = {
  persist: 'forever',
  expiry: [{ on: 'interact' }, { on: 'message' }],
  afterExpiry: 'snapshot',
};

export const DEFAULT_CHOICE_CHIPS_SEND_LABEL = 'Send';

/** The Send button's terminal label, for the multi-select mode that has a button at all. */
export const CHOICE_CHIPS_SENT_LABEL = 'Sent';

/**
 * The group's accessible name when the payload carries no prompt. Base UI renders `role="group"`
 * and a group with no name is announced as an unlabelled container — the user hears six unrelated
 * buttons instead of six answers to one question, and the WCAG 2.2 AA gate fails on it (ADR 0032).
 */
export const CHOICE_CHIPS_SINGLE_GROUP_LABEL = 'Quick replies';
export const CHOICE_CHIPS_MULTIPLE_GROUP_LABEL = 'Quick replies — choose any';

/** Shown when the write fails after the reply has already been sent (ADR 0016). */
export const CHOICE_CHIPS_SAVE_FAILED_NOTICE =
  'Your reply was sent. Saving it here failed, so these may look unanswered if you reload.';

export const choiceSchema = z.object({
  /** What identifies the choice. It travels in `meta`, never in the message text. */
  value: z.string().min(1),
  /**
   * What the chip says, and — unlike a poll option — what it sends verbatim. A quick reply is a
   * phrase, so the phrase is the whole message.
   */
  label: z.string().min(1),
});

export const choiceChipsPayloadSchema = z.object({
  prompt: z.string().min(1).optional(),
  /**
   * Non-empty. An empty chip row is a labelled group with nothing in it: it takes up space, reads
   * as a loading state, and can never be answered. Better to fail validation and let the message
   * text stand in (ADR 0012).
   */
  choices: z.array(choiceSchema).min(1, 'A quick-reply row needs at least one choice.'),
  multiple: z.boolean().optional(),
});

export type Choice = z.infer<typeof choiceSchema>;
export type ChoiceChipsPayload = z.infer<typeof choiceChipsPayloadSchema>;

/**
 * Declared by hand rather than inferred. `useWidgetState` constrains its state to
 * `WidgetStateRecord`, which an inferred type satisfies only by accident of how TypeScript grants
 * implicit index signatures, and the single/multiple asymmetry is worth being able to read here.
 */
export type ChoiceChipsState = { selected?: string | string[] };

/** Shared and frozen — a fresh `{}` per render is a new `initial` identity for `useWidgetState`. */
export const EMPTY_CHOICE_CHIPS_STATE: ChoiceChipsState = Object.freeze({});

export const choiceChipsStateSchema = z
  .object({
    selected: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  })
  // `.nullish()` before the transform because the renderer hands `undefined` to the state schema
  // for a widget nobody has touched (ADR 0016), and a bare `z.object` rejects it — which would
  // report a validation failure on every first render.
  .nullish()
  .transform((value): ChoiceChipsState => value ?? EMPTY_CHOICE_CHIPS_STATE);

/** One selection, in whichever shape the row's mode calls for. */
export function selectionValue(selected: readonly string[], multiple: boolean): string | string[] {
  const first = selected[0] ?? '';
  return multiple ? [...selected] : first;
}

/**
 * The message the row sends (ADR 0014).
 *
 * The label, verbatim — not the `value — label` form the poll uses. The two differ because the
 * questions differ: a poll asks the user to pick a record the agent enumerated, so the identifier
 * is how the agent finds it again, while a quick reply is a sentence the user would have typed
 * anyway. "yes_book — Yes, book it" is not something anybody types.
 *
 * Several labels join with a comma, which is how a person writes a short list of short phrases.
 * Values with no matching choice are dropped: they can only come from a state persisted against an
 * older payload (ADR 0030), and echoing one would send the agent a phrase it never offered.
 */
export function replyFor(payload: ChoiceChipsPayload, selected: readonly string[]): string {
  const labels: string[] = [];

  for (const value of selected) {
    const choice = payload.choices.find((candidate) => candidate.value === value);
    if (choice) labels.push(choice.label);
  }

  return labels.join(', ');
}
