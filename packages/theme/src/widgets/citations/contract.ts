import { defineWidgetContract } from '@nerey/core/server';

import {
  CITATIONS_LIFECYCLE,
  CITATIONS_PLACEMENT,
  CITATIONS_TYPE,
  CITATIONS_VERSION,
  citationsPayloadSchema,
  citationsStateSchema,
} from './schema';
import type { CitationsPayload, CitationsState } from './schema';

/**
 * The React-free half of `citationsWidget` (ADR 0056), readable on the server where the entry is a
 * client reference. `./index.ts` builds the entry from it; the reasoning behind its fields is there.
 */
export const citationsContract = defineWidgetContract<CitationsPayload, CitationsState>({
  type: CITATIONS_TYPE,
  version: CITATIONS_VERSION,
  description:
    'Show the sources behind a claim so the user can open one or quote it back into the ' +
    'conversation. Use it when an answer rests on retrieved material.',
  placement: CITATIONS_PLACEMENT,
  lifecycle: CITATIONS_LIFECYCLE,
  payloadSchema: citationsPayloadSchema,
  stateSchema: citationsStateSchema,
});
