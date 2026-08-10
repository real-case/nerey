import { defineWidget } from '@nerey/core';

import { ProgressTrackerWidget } from './component';
import {
  PROGRESS_TRACKER_PLACEMENT,
  PROGRESS_TRACKER_TYPE,
  PROGRESS_TRACKER_VERSION,
  progressTrackerPayloadSchema,
  progressTrackerStateSchema,
} from './schema';
import type { ProgressTrackerPayload, ProgressTrackerState } from './schema';

/**
 * The lifecycle, and why it differs from the task tree's.
 *
 * `persist: 'forever'` — "the migration ran and stopped at step 3 of 7" is a fact about the
 * conversation, and the reason someone scrolls back a week later (ADR 0016).
 *
 * `expiry: [{ on: 'message' }]` — the one rule that fits. A tracker is a LIVE view, and the agent's
 * next message is the outcome of the thing it was tracking; past that point a bar still showing a
 * spinner is asserting that work is in flight, which nothing can any longer confirm. Note the
 * contrast with the task tree, which takes no expiry at all: a tree keeps streaming rows while the
 * agent talks, so `{ on: 'message' }` there would freeze it mid-run. `{ on: 'interact' }` is
 * meaningless — there is nothing to interact with — and `{ on: 'timeout' }` would put a clock on
 * an operation whose whole point is that its duration is unknown.
 *
 * `afterExpiry: 'snapshot'` — the bar stays exactly where it stopped, and `readonly` swaps the
 * spinner for the static arc so the frozen view does not keep claiming to be live. `fallback` would
 * replace it with one line of prose and `hide` would delete the only account of how far it got.
 */
export const progressTrackerWidget = defineWidget<ProgressTrackerPayload, ProgressTrackerState>({
  type: PROGRESS_TRACKER_TYPE,
  version: PROGRESS_TRACKER_VERSION,
  component: ProgressTrackerWidget,
  placement: PROGRESS_TRACKER_PLACEMENT,
  lifecycle: {
    persist: 'forever',
    expiry: [{ on: 'message' }],
    afterExpiry: 'snapshot',
  },
  payloadSchema: progressTrackerPayloadSchema,
  stateSchema: progressTrackerStateSchema,
});

export { ProgressTrackerWidget } from './component';
export type { ProgressTrackerWidgetProps } from './component';
export {
  DEFAULT_PROGRESS_LABEL,
  DEFAULT_RUNNING_LABEL,
  DEFAULT_STEPS_LABEL,
  PROGRESS_TRACKER_PLACEMENT,
  PROGRESS_TRACKER_TYPE,
  PROGRESS_TRACKER_VERSION,
  announcement,
  clampPercent,
  clampStep,
  progressStepSchema,
  progressTrackerPayloadSchema,
  progressTrackerStateSchema,
  readSteps,
  stepStateAt,
} from './schema';
export type { ProgressStep, ProgressTrackerPayload, ProgressTrackerState, StepState } from './schema';
