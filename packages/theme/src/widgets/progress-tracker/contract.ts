import { defineWidgetContract } from '@nerey/core/server';

import {
  PROGRESS_TRACKER_PLACEMENT,
  PROGRESS_TRACKER_TYPE,
  PROGRESS_TRACKER_VERSION,
  progressTrackerPayloadSchema,
  progressTrackerStateSchema,
} from './schema';
import type { ProgressTrackerPayload, ProgressTrackerState } from './schema';

/**
 * The React-free half of `progressTrackerWidget` (ADR 0056), readable on the server where the entry is a
 * client reference. `./index.ts` builds the entry from it; the reasoning behind its fields is there.
 */
export const progressTrackerContract = defineWidgetContract<ProgressTrackerPayload, ProgressTrackerState>({
  type: PROGRESS_TRACKER_TYPE,
  version: PROGRESS_TRACKER_VERSION,
  description:
    'Show how far a multi-step operation already under way has got. Display only — it reports ' +
    'nothing back and does not advance on its own.',
  placement: PROGRESS_TRACKER_PLACEMENT,
  lifecycle: {
    persist: 'forever',
    expiry: [{ on: 'message' }],
    afterExpiry: 'snapshot',
  },
  payloadSchema: progressTrackerPayloadSchema,
  stateSchema: progressTrackerStateSchema,
});
