import { defineWidget } from '@nerey/core';

import { PollWidget } from './component';
import { POLL_PLACEMENT, POLL_TYPE, POLL_VERSION, pollPayloadSchema, pollStateSchema } from './schema';
import type { PollPayload, PollState } from './schema';

/**
 * The lifecycle is the part of this record worth arguing about, so here is the argument.
 *
 * `persist: 'forever'` — a poll answer is a fact about the conversation and not a UI detail. It
 * outlives the session, and the transcript replays with the chosen option still showing (ADR 0016).
 *
 * `expiry: [{ on: 'interact', action: 'submit' }]` — named rather than the bare `{ on: 'interact' }`
 * the confirmation uses, because this widget has more than one kind of interaction to report and
 * only one of them ends it. If a later version reports an expand or a highlight through
 * `onInteraction`, an unnamed rule would expire the poll the first time somebody opened a
 * description — a question closed by reading it.
 *
 * Not `{ on: 'message' }`: a poll the user has not answered stays answerable after the agent says
 * something else, which is what a question that scrolled out of view needs to be (ADR 0018).
 *
 * `afterExpiry: 'snapshot'` — disabled, not removed. Replacing an answered poll with its fallback
 * text would erase which option was chosen from the transcript, and hiding it would erase that the
 * question was ever asked.
 */
export const pollWidget = defineWidget<PollPayload, PollState>({
  type: POLL_TYPE,
  version: POLL_VERSION,
  component: PollWidget,
  description:
    'Ask the user to pick one of the options you list, or several when `multiple` is set. Use it ' +
    'for a question with a closed set of answers; the reply names the chosen option.',
  placement: POLL_PLACEMENT,
  lifecycle: {
    persist: 'forever',
    expiry: [{ on: 'interact', action: 'submit' }],
    afterExpiry: 'snapshot',
  },
  payloadSchema: pollPayloadSchema,
  stateSchema: pollStateSchema,
});

export { PollWidget } from './component';
export type { PollWidgetProps } from './component';
export {
  DEFAULT_POLL_SUBMIT_LABEL,
  POLL_ANSWERED_LABEL,
  POLL_DETAILS_LABEL,
  POLL_MULTIPLE_GROUP_LABEL,
  POLL_NONE_REPLY,
  POLL_PLACEMENT,
  POLL_SAVE_FAILED_NOTICE,
  POLL_SINGLE_GROUP_LABEL,
  POLL_TYPE,
  POLL_VERSION,
  pollOptionSchema,
  pollPayloadSchema,
  pollStateSchema,
  replyFor,
} from './schema';
export type { PollOption, PollPayload, PollState } from './schema';
