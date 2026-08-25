import { z } from 'zod';

import type { Placement } from '@nerey/core';

/**
 * ADR 0011 — core validates through the Standard Schema *spec* and may not depend on a validator,
 * which is why its two built-ins hand-roll forty lines of `~standard` object. The theme is under
 * no such constraint, and its widgets are reference implementations somebody will copy: they are
 * written the way a consumer would write them, in Zod 4, which implements the spec and therefore
 * drops straight into `payloadSchema` with no adapter in between.
 */

export const POLL_TYPE = 'poll';
export const POLL_VERSION = '1.0.0';

/**
 * A poll is the record of a question the assistant asked, and the answer is part of the exchange
 * rather than a control that hangs off the composer — so it belongs beside the message that asked
 * it (ADR 0017).
 */
export const POLL_PLACEMENT: Placement = { slot: 'message' };

export const DEFAULT_POLL_SUBMIT_LABEL = 'Submit';

/**
 * The submit button's terminal label. The button stays in the DOM and goes disabled rather than
 * disappearing (ADR 0018), so it needs something true to say once the answer is gone.
 */
export const POLL_ANSWERED_LABEL = 'Answer sent';

/** The disclosure that reveals one option's description. */
export const POLL_DETAILS_LABEL = 'Details';

/**
 * What a "none of the above" choice actually sends.
 *
 * Every other option replies in the `value — title` form, because the agent listed those options
 * and the identifier is how it finds the one the user meant. The none option is the absence of a
 * pick, and its label is free text a producer chooses ("Something else", "Skip this"), so
 * `4 — Something else` would read to the model as a fifth item it never offered. A fixed phrase
 * is unambiguous in a way neither the value nor the label can be; the real value still travels in
 * `meta` for a host that wants it.
 */
export const POLL_NONE_REPLY = 'None of the above.';

/**
 * The accessible name for the option group when the payload carries no question. A radio group
 * with no name is announced as an unlabelled container, and the WCAG 2.2 AA gate fails on it
 * (ADR 0032) — so there is always a name, even when the producer gave us nothing to build one
 * from.
 */
export const POLL_SINGLE_GROUP_LABEL = 'Choose one option';
export const POLL_MULTIPLE_GROUP_LABEL = 'Choose one or more options';

/**
 * Shown when the write fails after the reply has already been sent. It says what happened rather
 * than offering a retry: the poll stays locked either way (ADR 0016), so a button that promised
 * to fix it would be lying about what it can still change.
 */
export const POLL_SAVE_FAILED_NOTICE =
  'Your answer was sent. Saving it here failed, so the poll may look unanswered if you reload.';

export const pollOptionSchema = z.object({
  value: z.string().min(1, 'An option needs a value — it is what identifies the answer.'),
  title: z.string().min(1, 'An option needs a title — it is the accessible name of the choice.'),
  /**
   * Free-form and rendered with line breaks preserved. Real payloads put one `key: value` per
   * line here, which a markdown renderer would fold into a single paragraph — see the
   * `pre-wrap` rule in the stylesheet, which is the other half of this decision.
   */
  description: z.string().optional(),
});

export const pollPayloadSchema = z.object({
  question: z.string().min(1).optional(),
  /**
   * Non-empty. A poll with no options is not a question, and rendering one produces a group with
   * nothing in it and a submit button that can never enable — better to fail validation and let
   * the degradation chain show the message text instead (ADR 0012).
   */
  options: z.array(pollOptionSchema).min(1, 'A poll needs at least one option.'),
  multiple: z.boolean().optional(),
  noneOption: z
    .object({
      value: z.string().min(1),
      label: z.string().min(1),
    })
    .optional(),
});

export type PollOption = z.infer<typeof pollOptionSchema>;
export type PollPayload = z.infer<typeof pollPayloadSchema>;

/**
 * Declared by hand rather than inferred, for two reasons. `useWidgetState` constrains its state to
 * `WidgetStateRecord`, which an inferred type only satisfies by accident of how TypeScript grants
 * implicit index signatures; and the single/multiple asymmetry is the interesting part of this
 * widget, so it is worth being able to read it without resolving a generic.
 */
export type PollState = { selected?: string | string[] };

/**
 * Shared and frozen. A fresh `{}` per render would be a new `initial` identity for
 * `useWidgetState` on every pass, and freezing turns a widget that mutates its own state object
 * into a loud failure here rather than a silent divergence from what the port stored.
 */
export const EMPTY_POLL_STATE: PollState = Object.freeze({});

export const pollStateSchema = z
  .object({
    selected: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  })
  // A poll nobody has answered has no persisted record, and the port answers `undefined` for it
  // (ADR 0016). Without this the state schema would reject every freshly rendered poll, report an
  // `invalid-state` error per message, and hand the widget a state it already had.
  .nullish()
  .transform((value): PollState => value ?? EMPTY_POLL_STATE);

/** One selection, in whichever shape the poll's mode calls for. */
export function selectionValue(selected: readonly string[], multiple: boolean): string | string[] {
  const first = selected[0] ?? '';
  return multiple ? [...selected] : first;
}

/**
 * The message the poll sends (ADR 0014). It has to be something a human would plausibly have
 * typed, because the agent reads it as user input: `3 — Xi'an Huawei Technologies`, never
 * `{"selected":3}`.
 *
 * Several picks are joined with newlines rather than commas. Each entry already contains an em
 * dash and a title that may itself contain commas, so a comma-joined list stops being parseable
 * by eye at exactly the point it matters — and a person answering a multi-select question in
 * prose writes a list, not a sentence.
 *
 * Values with no matching option are dropped rather than echoed. They can only come from a
 * persisted state written against an older payload (ADR 0030), and inventing a line for one would
 * send the agent an identifier it never offered.
 */
/**
 * ADR 0041 — `noneReply` is REPLY text, not chrome: the agent reads it as something the user
 * typed (ADR 0014). Optional and defaulted, so every existing call is unchanged; the widget
 * passes the value from the labels context so a non-English deployment does not put an English
 * sentence in its user's mouth.
 */
export function replyFor(
  payload: PollPayload,
  selected: readonly string[],
  labels: { noneReply?: string } = {},
): string {
  const lines: string[] = [];

  for (const value of selected) {
    if (payload.noneOption?.value === value) {
      lines.push(labels.noneReply ?? POLL_NONE_REPLY);
      continue;
    }
    const option = payload.options.find((candidate) => candidate.value === value);
    if (option) lines.push(`${option.value} — ${option.title}`);
  }

  return lines.join('\n');
}
