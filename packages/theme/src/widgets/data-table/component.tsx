import { useId, useMemo } from 'react';
import type { ReactElement } from 'react';

import { WidgetPart, WidgetRoot, useWidgetState } from '@nerey/core';
import type { NereyState, WidgetComponentProps } from '@nerey/core';

import { ChevronDownIcon, ChevronUpIcon } from '../../components/icons/icons';
import { cx } from '../../internal/cx';
import { useNereyLabels } from '../../labels/labels';
import styles from './data-table.module.css';
import { DATA_TABLE_PLACEMENT, DATA_TABLE_TYPE, DATA_TABLE_VERSION, rowComparator } from './schema';
import type { DataTableCell, DataTableColumn, DataTablePayload, DataTableState } from './schema';

export type DataTableWidgetProps = WidgetComponentProps<DataTablePayload, DataTableState>;

const EMPTY_STATE: DataTableState = Object.freeze({});

/** The glyph shown where a cell has no value. See `renderCell` for why it is `aria-hidden`. */
const EMPTY_CELL_GLYPH = '—';

const GLYPH_SIZE = 12;

/**
 * A real table: `<table>`, `<caption>`, `<th scope="col">`, one `<tr>` per row.
 *
 * The alternative — a grid of divs with `role="table"` bolted on — is the standard way to end up
 * with a table that a screen reader cannot navigate cell by cell, because the roles are only half
 * of what the native element provides. `scope="col"` is what makes a screen reader announce the
 * column heading when the reader arrives in a cell twelve rows down; nothing about a div does that
 * for free, and this widget renders model output that nobody proof-reads.
 *
 * Sorting is client-side and **sends nothing**. That is the load-bearing decision here: the rows
 * are already in the payload, so re-ordering them is a display concern (ADR 0014), and asking the
 * agent to re-run a query because the reader wanted a different column order would spend a model
 * turn and write a sentence into the transcript that the reader never said.
 */
export function DataTableWidget(props: DataTableWidgetProps): ReactElement {
  const { messageId, payload, state, readonly, status } = props;
  const labels = useNereyLabels();

  /**
   * The default debounce window, unlike the confirmation widget's zero. A reader hunting for a
   * column clicks three headers in two seconds, and every click is a complete, valid sort — so
   * coalescing them into one write is exactly what the window is for, and there is no reply racing
   * it into the transcript that would make the delay visible (ADR 0016).
   */
  const { state: persisted, setState } = useWidgetState<DataTableState>(messageId, state ?? EMPTY_STATE);

  // A partial payload is a partial table (ADR 0019): it renders, because half a result set is
  // still readable, but it is not something to sort — the rows below the fold have not arrived yet
  // and the order would silently change under the reader as they did.
  const sortable = status === 'ready' && !readonly;

  const rootState: NereyState = readonly
    ? 'locked'
    : status === 'error'
      ? 'error'
      : persisted.sortKey === undefined
        ? 'idle'
        : 'selected';

  const scope = useId();
  const captionId = `${scope}caption`;

  const sortedRows = useMemo(() => {
    const { sortKey, sortDirection } = persisted;
    if (sortKey === undefined || sortDirection === undefined) return payload.rows;

    // A key from a persisted sort that the current payload no longer has a column for. It is
    // dropped rather than repaired: an updated payload is allowed to change its columns, and the
    // right response to "sorted by a column that is gone" is the order the producer chose.
    const column = payload.columns.find((candidate) => candidate.key === sortKey);
    if (column === undefined) return payload.rows;

    // Copied before sorting. `Array.prototype.sort` mutates, and the array it would mutate is the
    // validated payload — shared with the memo above it and with every other render of this
    // message. `sort` is stable in every engine that matters, so equal cells keep the producer's
    // order rather than shuffling on each pass.
    return [...payload.rows].sort(rowComparator(column, sortDirection));
  }, [payload.rows, payload.columns, persisted]);

  function toggleSort(key: string): void {
    if (!sortable) return;

    // Three states, not two: ascending, descending, and back to the order the producer chose.
    // That third stop is what makes sorting reversible — without it the agent's own ordering,
    // which is often the answer to the question that was asked, is gone for good after one click.
    setState((previous) => {
      if (previous.sortKey !== key) return { sortKey: key, sortDirection: 'ascending' };
      if (previous.sortDirection === 'ascending') return { sortKey: key, sortDirection: 'descending' };
      return {};
    });
  }

  function alignmentClass(column: DataTableColumn): string | undefined {
    const align = column.align ?? (column.numeric === true ? 'end' : 'start');
    return align === 'end' ? styles.alignEnd : undefined;
  }

  function renderCell(value: DataTableCell | undefined): ReactElement | string {
    if (value === null || value === undefined) {
      // The dash is `aria-hidden`, which leaves the cell's accessible content empty — and an empty
      // cell is announced as empty, which is the truth. Reading the glyph out instead would have a
      // screen reader say "em dash" thirty times in a column of missing values.
      return (
        <span aria-hidden="true" className={styles.emptyCell}>
          {EMPTY_CELL_GLYPH}
        </span>
      );
    }
    return String(value);
  }

  return (
    <WidgetRoot
      type={DATA_TABLE_TYPE}
      version={DATA_TABLE_VERSION}
      slot={DATA_TABLE_PLACEMENT.slot}
      status={status}
      state={rootState}
      readonly={readonly}
      className={styles.root}
    >
      <WidgetPart
        part="scroll"
        render={(partProps) => (
          <div
            {...partProps}
            className={styles.scroller}
            /*
             * A scroll container has to be reachable from the keyboard, or the rows past the right
             * edge belong to pointer users only — axe reports the omission as
             * `scrollable-region-focusable` and ADR 0032 fails the build over it. `role="group"`
             * plus a name is what stops that focus stop being an anonymous one.
             */
            tabIndex={0}
            role="group"
            aria-labelledby={payload.caption === undefined ? undefined : captionId}
            aria-label={payload.caption === undefined ? labels.dataTable.label : undefined}
          />
        )}
      >
        <table className={styles.table}>
          {payload.caption !== undefined && (
            <WidgetPart
              part="caption"
              render={(partProps) => <caption {...partProps} id={captionId} className={styles.caption} />}
            >
              {payload.caption}
            </WidgetPart>
          )}

          <thead>
            <tr>
              {payload.columns.map((column) => {
                const active = persisted.sortKey === column.key;
                const direction = active ? persisted.sortDirection : undefined;

                return (
                  <WidgetPart
                    key={column.key}
                    part="column-header"
                    state={active ? 'selected' : undefined}
                    render={(partProps) => (
                      <th
                        {...partProps}
                        scope="col"
                        className={cx(
                          styles.header,
                          alignmentClass(column),
                          column.numeric === true && styles.numeric,
                        )}
                        // The sort state lives here, on the header, because that is where the ARIA
                        // table pattern puts it and where a screen reader looks for it. The button
                        // inside carries the label and nothing else, so it is never announced as
                        // "ascending, ascending".
                        aria-sort={direction ?? 'none'}
                      />
                    )}
                  >
                    <button
                      type="button"
                      className={styles.sort}
                      disabled={!sortable}
                      onClick={() => {
                        toggleSort(column.key);
                      }}
                    >
                      <span className={styles.sortLabel}>{column.label}</span>
                      <span className={styles.sortGlyph}>
                        {direction === 'ascending' ? (
                          <ChevronUpIcon size={GLYPH_SIZE} />
                        ) : (
                          <ChevronDownIcon size={GLYPH_SIZE} />
                        )}
                      </span>
                    </button>
                  </WidgetPart>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <WidgetPart
                  part="empty"
                  render={(partProps) => (
                    <td {...partProps} colSpan={payload.columns.length} className={styles.empty} />
                  )}
                >
                  {labels.dataTable.empty}
                </WidgetPart>
              </tr>
            ) : (
              sortedRows.map((row, index) => (
                /*
                 * The index of the SORTED array is the key, because a row in this payload has no
                 * identity of its own — there is no id column, and a value-derived key would
                 * collide the moment two rows agree. Re-sorting therefore re-renders every cell
                 * rather than moving nodes, which is free here: a cell holds text and nothing that
                 * owns state, so there is nothing for React to carry to the wrong row.
                 */
                <WidgetPart
                  key={index}
                  part="row"
                  render={(partProps) => <tr {...partProps} className={styles.row} />}
                >
                  {payload.columns.map((column) => (
                    <td
                      key={column.key}
                      className={cx(
                        styles.cell,
                        alignmentClass(column),
                        column.numeric === true && styles.numeric,
                      )}
                    >
                      {renderCell(row[column.key])}
                    </td>
                  ))}
                </WidgetPart>
              ))
            )}
          </tbody>
        </table>
      </WidgetPart>
    </WidgetRoot>
  );
}
