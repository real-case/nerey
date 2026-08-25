import { defineWidget } from '@nerey/core';

import { DataTableWidget } from './component';
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
 * The registry entry (ADR 0010). It carries a `stateSchema` even though the widget sends no
 * message: the sort survives a reload through the persistence port, so it crosses a boundary and
 * therefore gets validated like anything else that does (ADR 0011 / 0016).
 *
 * `acceptsVersion` and `migrate` are absent on purpose — exact resolution (ADR 0009), and 1.0.0 is
 * the only shape there has ever been (ADR 0030).
 */
export const dataTableWidget = defineWidget<DataTablePayload, DataTableState>({
  type: DATA_TABLE_TYPE,
  version: DATA_TABLE_VERSION,
  component: DataTableWidget,
  description:
    'Present rows and columns of data you have already retrieved. Display only — it reports ' +
    'nothing back, so do not use it to ask for a selection.',
  placement: DATA_TABLE_PLACEMENT,
  lifecycle: DATA_TABLE_LIFECYCLE,
  payloadSchema: dataTablePayloadSchema,
  stateSchema: dataTableStateSchema,
});

export { DataTableWidget } from './component';
export type { DataTableWidgetProps } from './component';
export {
  DATA_TABLE_LIFECYCLE,
  DATA_TABLE_PLACEMENT,
  DATA_TABLE_TYPE,
  DATA_TABLE_VERSION,
  DEFAULT_EMPTY_LABEL,
  DEFAULT_TABLE_LABEL,
  dataTableCellSchema,
  dataTableColumnSchema,
  dataTablePayloadSchema,
  dataTableStateSchema,
  rowComparator,
} from './schema';
export type {
  DataTableCell,
  DataTableColumn,
  DataTablePayload,
  DataTableRow,
  DataTableSortDirection,
  DataTableState,
} from './schema';
