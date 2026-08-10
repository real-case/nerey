import { z } from 'zod';

import type { Lifecycle, Placement } from '@nerey/core';

/**
 * ADR 0011 — the payload is validated at the boundary, so the component below never asks whether a
 * column exists or whether a cell is a string.
 */

export const DATA_TABLE_TYPE = 'data-table';
export const DATA_TABLE_VERSION = '1.0.0';
export const DATA_TABLE_PLACEMENT: Placement = { slot: 'message' };

/**
 * Nothing expires a table (ADR 0018). Numbers the agent returned three turns ago are still the
 * numbers it returned, and a table that went read-only would take away the sort — the one thing a
 * reader does to a table, and the thing they do most when scrolling back to compare two answers.
 *
 * `persist: 'ephemeral'` is the deliberate half of the pair. The sort is a viewing preference, not
 * a fact about the conversation: it belongs to this reader in this session, and writing it into the
 * durable record would make one person's column choice everyone's on the next replay (ADR 0016).
 */
export const DATA_TABLE_LIFECYCLE: Lifecycle = {
  persist: 'ephemeral',
  expiry: [],
  afterExpiry: 'snapshot',
};

export const dataTableColumnSchema = z.object({
  /** The key this column reads out of each row. Rows are keyed maps, not positional arrays. */
  key: z.string().min(1),
  label: z.string().min(1),
  /**
   * Overrides the alignment `numeric` would otherwise imply. Present because "right-aligned" and
   * "compare these as numbers" are different questions with the same usual answer: an order
   * reference or a postcode is a right-aligned string, and sorting it arithmetically is wrong.
   */
  align: z.enum(['start', 'end']).optional(),
  numeric: z.boolean().optional(),
});

/** `null` is a value — "this cell is empty" — and is not the same as the key being absent. */
export const dataTableCellSchema = z.union([z.string(), z.number(), z.null()]);

export const dataTablePayloadSchema = z.object({
  caption: z.string().optional(),
  /**
   * At least one column. A table with none is not an empty table, it is a broken payload, and
   * degrading it to the message's plain text (ADR 0012) is more useful than rendering a hairline.
   * Empty `rows`, by contrast, is a perfectly good answer — the query matched nothing — and is
   * rendered as such.
   */
  columns: z.array(dataTableColumnSchema).min(1),
  rows: z.array(z.record(z.string(), dataTableCellSchema)),
});

/**
 * `.nullish()` before the transform because the renderer hands `undefined` to the state schema for
 * a widget nobody has sorted yet (ADR 0012), and a bare `z.object` rejects `undefined`.
 *
 * `sortDirection` uses the ARIA spelling rather than `asc`/`desc` so the persisted value is the
 * value that goes on `aria-sort`, with no lookup table in between to disagree with the CSS.
 */
export const dataTableStateSchema = z
  .object({
    sortKey: z.string().optional(),
    sortDirection: z.enum(['ascending', 'descending']).optional(),
  })
  .nullish()
  .transform((value) => value ?? {});

export type DataTableColumn = z.infer<typeof dataTableColumnSchema>;
export type DataTableCell = z.infer<typeof dataTableCellSchema>;
export type DataTableRow = z.infer<typeof dataTablePayloadSchema>['rows'][number];
export type DataTablePayload = z.infer<typeof dataTablePayloadSchema>;
export type DataTableState = z.infer<typeof dataTableStateSchema>;
export type DataTableSortDirection = NonNullable<DataTableState['sortDirection']>;

/** Names the scroll container when the payload carries no caption to name it with. */
export const DEFAULT_TABLE_LABEL = 'Data table';

/** Shown in place of the body when the answer is "nothing matched". */
export const DEFAULT_EMPTY_LABEL = 'No rows returned.';

/**
 * Collation is the reader's, not the widget's: `à` belongs next to `a` for a French reader and
 * after `z` for a Swedish one, and only the runtime knows which. `numeric: true` additionally puts
 * `item 9` before `item 10`, which is what anyone reading a column of labels expects and what a
 * code-unit comparison never does.
 *
 * Built once at module scope because constructing a collator is expensive and a comparator runs
 * O(n log n) times.
 */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'variant' });

/**
 * Orders two present cells. Absent and `null` cells never reach here — they are pinned to the end
 * by the caller, in both directions, because "unknown" is not a value that belongs at either
 * extreme of a range.
 */
function compareValues(left: string | number, right: string | number, numeric: boolean): number {
  if (numeric) {
    const a = typeof left === 'number' ? left : Number(left);
    const b = typeof right === 'number' ? right : Number(right);
    // A numeric column carrying `1,204` or `n/a` still has to sort somehow. Falling back to
    // collation keeps the order stable and readable rather than scattering NaNs through it.
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a - b;
  }
  return COLLATOR.compare(String(left), String(right));
}

/**
 * A comparator for one column, with empties last regardless of direction.
 *
 * Sorting is a **display** concern and is done here, on the client, over the rows already in the
 * payload. It sends nothing: asking the agent to re-run a query because the reader wanted a
 * different column order would spend a model turn on something the browser can do in a millisecond,
 * and would put a sentence into the transcript that the reader never said (ADR 0014).
 */
export function rowComparator(
  column: DataTableColumn,
  direction: DataTableSortDirection,
): (left: DataTableRow, right: DataTableRow) => number {
  const factor = direction === 'ascending' ? 1 : -1;

  return (left, right) => {
    const a = left[column.key];
    const b = right[column.key];
    const aEmpty = a === null || a === undefined;
    const bEmpty = b === null || b === undefined;

    if (aEmpty || bEmpty) {
      if (aEmpty && bEmpty) return 0;
      return aEmpty ? 1 : -1;
    }

    return factor * compareValues(a, b, column.numeric === true);
  };
}
