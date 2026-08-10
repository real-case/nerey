import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { WidgetRenderer, asAnyWidget, composeRegistries } from '@nerey/core';
import type { WidgetRegistry, WidgetStatus } from '@nerey/core';
import { MockWidgetHost, mockRegistry, widgetMessage } from '@nerey/core/mock';

import { dataTableWidget } from './index';
import { DATA_TABLE_TYPE, DATA_TABLE_VERSION } from './schema';
import type { DataTablePayload, DataTableState } from './schema';

/**
 * ADR 0031 — rendered through `WidgetRenderer` inside `MockWidgetHost`, never by calling the
 * component. The chain is what ships, and it is where a stale sort key, a state schema that
 * rejects `undefined`, or a payload the columns rule turns away would actually surface.
 */

const registry: WidgetRegistry = composeRegistries(mockRegistry, [asAnyWidget(dataTableWidget)]);

const MESSAGE_ID = 'data-table-story';

const FALLBACK_TEXT =
  "Shortlisted suppliers: Xi'an Huawei Technologies (34 days), Boréal Composites (12 days), " +
  'Aachen Präzision GmbH (21 days), Tampere Metalli Oy (lead time unknown).';

const SENT_PREFIX = 'Sent to the agent: ';

type HarnessProps = {
  payload: DataTablePayload;
  state?: DataTableState;
  status?: WidgetStatus;
  readonly?: boolean;
};

/**
 * The sent-message log is on screen for a widget that must never send one. An assertion that
 * nothing was sent is the whole point of the sorting stories, and it needs somewhere to look.
 */
function DataTableHarness({
  payload,
  state,
  status = 'ready',
  readonly = false,
}: HarnessProps): ReactElement {
  const [sent, setSent] = useState<readonly string[]>([]);

  const message = useMemo(
    () =>
      widgetMessage({
        id: MESSAGE_ID,
        type: DATA_TABLE_TYPE,
        version: DATA_TABLE_VERSION,
        payload,
        state,
        text: FALLBACK_TEXT,
      }),
    [payload, state],
  );

  return (
    <MockWidgetHost
      registry={registry}
      onSend={(text) => {
        setSent((all) => [...all, text]);
      }}
    >
      <WidgetRenderer message={message} status={status} readonly={readonly} />
      <p>{`${SENT_PREFIX}${sent.join(' · ')}`}</p>
    </MockWidgetHost>
  );
}

const meta = {
  title: 'Widgets/DataTable',
  component: DataTableHarness,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof DataTableHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

const LEAD_TIME_LABEL = 'Lead time (days)';

/**
 * `country` is deliberately two-letter ASCII. The comparator collates in the reader's locale, so a
 * fixture containing `Boréal` would let the expected order depend on which locale the browser
 * happened to start in — the kind of story that passes for a year and then fails in CI.
 */
const TYPICAL: DataTablePayload = {
  caption: 'Shortlisted suppliers for the 6 mm bracket, quoted 12 August',
  columns: [
    { key: 'supplier', label: 'Supplier' },
    { key: 'country', label: 'Country' },
    { key: 'leadTimeDays', label: LEAD_TIME_LABEL, numeric: true },
    { key: 'unitPrice', label: 'Unit price (EUR)', numeric: true },
    { key: 'reference', label: 'Quote reference', align: 'end' },
  ],
  rows: [
    {
      supplier: "Xi'an Huawei Technologies",
      country: 'CN',
      leadTimeDays: 34,
      unitPrice: 12.4,
      reference: 'Q-2291',
    },
    {
      supplier: 'Boréal Composites',
      country: 'CA',
      leadTimeDays: 12,
      unitPrice: 18.9,
      reference: 'Q-2288',
    },
    {
      supplier: 'Aachen Präzision GmbH',
      country: 'DE',
      leadTimeDays: 21,
      unitPrice: 22.15,
      reference: 'Q-2290',
    },
    {
      supplier: 'Tampere Metalli Oy',
      country: 'FI',
      leadTimeDays: null,
      unitPrice: 19.5,
      reference: null,
    },
  ],
};

/** The rendered text of one column, top to bottom, in whatever order the table is currently in. */
const columnText = (canvasElement: HTMLElement, position: number): string[] =>
  Array.from(
    canvasElement.querySelectorAll(`tbody tr td:nth-child(${position})`),
    (cell) => cell.textContent?.trim() ?? '',
  );

/**
 * Sorting, end to end: three states on one column, empties pinned last in both directions, and not
 * one message sent to the agent for any of it.
 */
export const Default: Story = {
  args: { payload: TYPICAL },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const producerOrder = ['CN', 'CA', 'DE', 'FI'];

    await expect(canvas.getByRole('table')).toBeVisible();
    await expect(columnText(canvasElement, 2)).toEqual(producerOrder);

    const leadTime = canvas.getByRole('button', { name: LEAD_TIME_LABEL });
    const header = leadTime.closest('th');
    await expect(header).toHaveAttribute('aria-sort', 'none');

    await userEvent.click(leadTime);
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    // 12, 21, 34, then the supplier whose lead time is unknown.
    await expect(columnText(canvasElement, 2)).toEqual(['CA', 'DE', 'CN', 'FI']);

    await userEvent.click(leadTime);
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    // Reversed — except the empty, which stays last. "Unknown" is not the largest value.
    await expect(columnText(canvasElement, 2)).toEqual(['CN', 'DE', 'CA', 'FI']);

    await userEvent.click(leadTime);
    await expect(header).toHaveAttribute('aria-sort', 'none');
    await expect(columnText(canvasElement, 2)).toEqual(producerOrder);

    // The claim the whole widget rests on: sorting is a display concern and never becomes a turn
    // in the conversation (ADR 0014).
    await expect(canvas.getByText(SENT_PREFIX.trim())).toBeVisible();
  },
};

/** A string column, to show that collation and numeric comparison are separate decisions. */
export const SortedByText: Story = {
  args: { payload: TYPICAL },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Country' }));
    await expect(columnText(canvasElement, 2)).toEqual(['CA', 'CN', 'DE', 'FI']);

    // `12.4` before `18.9` before `19.5` before `22.15`. Compared as text, `12.4` would still lead
    // but `19.5` would come before `22.15` for the wrong reason and any three-digit figure would
    // sort between `1` and `2` — which is what `numeric` exists to prevent.
    await userEvent.click(canvas.getByRole('button', { name: 'Unit price (EUR)' }));
    await expect(columnText(canvasElement, 4)).toEqual(['12.4', '18.9', '19.5', '22.15']);
  },
};

/** The query matched nothing. A real answer, and it has to look like one rather than like a bug. */
export const NoRows: Story = {
  args: { payload: { ...TYPICAL, caption: 'Suppliers within 10 days of the bracket spec', rows: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText('No rows returned.')).toBeVisible();
    // The columns survive: what was asked for is still legible even though nothing answered it.
    await expect(canvas.getByRole('columnheader', { name: /Supplier/ })).toBeVisible();
  },
};

const LONG_NOTE =
  'Tooling amortised over the first 5,000 units; the quoted price assumes the customer supplies ' +
  'the anodising specification, and a change of finish after PPAP is re-quoted at the prevailing ' +
  'rate rather than absorbed.';

/** Nine columns and a paragraph in a cell. The table scrolls; the page must not. */
export const WideAndOverflowing: Story = {
  args: {
    payload: {
      caption: 'Full quote comparison, all requested attributes',
      columns: [
        { key: 'supplier', label: 'Supplier' },
        { key: 'country', label: 'Country' },
        { key: 'leadTimeDays', label: LEAD_TIME_LABEL, numeric: true },
        { key: 'unitPrice', label: 'Unit price (EUR)', numeric: true },
        { key: 'moq', label: 'Minimum order quantity', numeric: true },
        { key: 'tooling', label: 'Tooling charge (EUR)', numeric: true },
        { key: 'incoterm', label: 'Incoterm' },
        { key: 'certification', label: 'Certification' },
        { key: 'notes', label: 'Commercial notes' },
      ],
      rows: [
        {
          supplier: "Xi'an Huawei Technologies",
          country: 'CN',
          leadTimeDays: 34,
          unitPrice: 12.4,
          moq: 500,
          tooling: 4200,
          incoterm: 'FOB Shanghai',
          certification: 'ISO 9001:2015',
          notes: LONG_NOTE,
        },
        {
          supplier: 'Aachen Präzision GmbH',
          country: 'DE',
          leadTimeDays: 21,
          unitPrice: 22.15,
          moq: 100,
          tooling: 0,
          incoterm: 'DAP Rotterdam',
          certification: 'ISO 9001:2015, IATF 16949',
          notes: 'Tooling waived against a two-year call-off.',
        },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scroller = canvas.getByRole('group', {
      name: 'Full quote comparison, all requested attributes',
    });

    // Focusable, because the columns past the right edge belong to keyboard users too — axe
    // reports the omission as `scrollable-region-focusable` (ADR 0032).
    await expect(scroller).toHaveAttribute('tabindex', '0');
    scroller.focus();
    await expect(scroller).toHaveFocus();

    // The overflow is contained: the page itself never gains a horizontal scrollbar, whatever the
    // model decided to put in a cell.
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  },
};

/**
 * `status: 'error'` — the tool call reached its terminal state without a complete result set
 * (ADR 0019). Whatever arrived stays readable; sorting is withdrawn, because re-ordering rows that
 * are known to be incomplete presents a partial answer as a ranked one.
 */
export const Errored: Story = {
  args: { payload: TYPICAL, status: 'error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvasElement.querySelector('[data-nerey-widget="data-table"]');

    await expect(root).toHaveAttribute('data-nerey-status', 'error');
    await expect(root).toHaveAttribute('data-state', 'error');
    await expect(canvas.getByRole('button', { name: LEAD_TIME_LABEL })).toBeDisabled();
    await expect(canvas.getByRole('cell', { name: "Xi'an Huawei Technologies" })).toBeVisible();
  },
};

/**
 * A replayed transcript, with the sort the reader had applied. The order is restored from persisted
 * state and the controls are withdrawn — an acted-upon widget is disabled, not reset (ADR 0018).
 */
export const Readonly: Story = {
  args: {
    payload: TYPICAL,
    state: { sortKey: 'leadTimeDays', sortDirection: 'descending' },
    readonly: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvasElement.querySelector('[data-nerey-widget="data-table"]');

    await expect(root).toHaveAttribute('data-readonly', '');
    await expect(columnText(canvasElement, 2)).toEqual(['CN', 'DE', 'CA', 'FI']);

    const leadTime = canvas.getByRole('button', { name: LEAD_TIME_LABEL });
    await expect(leadTime).toBeDisabled();
    await expect(leadTime.closest('th')).toHaveAttribute('aria-sort', 'descending');
  },
};
