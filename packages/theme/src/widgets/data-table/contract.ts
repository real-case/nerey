import { defineWidgetContract } from '@nerey/core/server';

import {
  DATA_TABLE_LIFECYCLE,
  DATA_TABLE_PLACEMENT,
  DATA_TABLE_TYPE,
  DATA_TABLE_VERSION,
  dataTablePayloadSchema,
  dataTableStateSchema,
} from './schema';
import type { DataTablePayload, DataTableState } from './schema';

/**
 * The React-free half of `dataTableWidget` (ADR 0056), readable on the server where the entry is a
 * client reference. `./index.ts` builds the entry from it; the reasoning behind its fields is there.
 */
export const dataTableContract = defineWidgetContract<DataTablePayload, DataTableState>({
  type: DATA_TABLE_TYPE,
  version: DATA_TABLE_VERSION,
  description:
    'Present rows and columns of data you have already retrieved. Display only — it reports ' +
    'nothing back, so do not use it to ask for a selection.',
  placement: DATA_TABLE_PLACEMENT,
  lifecycle: DATA_TABLE_LIFECYCLE,
  payloadSchema: dataTablePayloadSchema,
  stateSchema: dataTableStateSchema,
});
