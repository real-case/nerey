import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { WidgetRenderer, asAnyWidget, composeRegistries } from '@nerey/core';
import type { WidgetRegistry, WidgetStatus } from '@nerey/core';
import { MockWidgetHost, mockRegistry, widgetMessage } from '@nerey/core/mock';

import { taskTreeWidget } from './index';
import { TASK_TREE_TYPE, TASK_TREE_VERSION } from './schema';
import type { TaskTreePayload, TaskTreeState } from './schema';

/**
 * ADR 0031 — every story goes through `WidgetRenderer` inside `MockWidgetHost` rather than calling
 * the component. Rendering the component directly would prove that some JSX works; rendering it
 * through the chain proves that the registry resolves `task-tree@1.0.0`, that the payload survives
 * its schema, that the lifecycle runtime hands down `readonly`, and that `useWidgetState` finds a
 * persistence port — which is the set of things that actually break.
 */

const registry: WidgetRegistry = composeRegistries(mockRegistry, [asAnyWidget(taskTreeWidget)]);

const MESSAGE_ID = 'task-tree-story';

/** The last line of the degradation chain (ADR 0012), and it has to read as a sentence. */
const FALLBACK_TEXT =
  'Supplier due-diligence run: the plan and the registry searches are done, ownership verification ' +
  'is in progress, and the sanctions screen and summary have not started.';

const MID_RUN: TaskTreePayload = {
  title: 'Supplier due-diligence run',
  tasks: [
    { id: 'plan', label: 'Draft the research plan', status: 'done' },
    {
      id: 'search',
      label: 'Search company registries',
      status: 'done',
      children: [
        { id: 'search-cn', label: 'China — SAIC filings', status: 'done', detail: '4 entities matched.' },
        { id: 'search-de', label: 'Germany — Handelsregister', status: 'done', detail: '1 entity matched.' },
      ],
    },
    {
      id: 'verify',
      label: 'Verify beneficial ownership',
      status: 'running',
      children: [
        { id: 'verify-cn', label: "Xi'an Huawei Technologies", status: 'running' },
        { id: 'verify-de', label: 'Bertram Logistik GmbH', status: 'pending' },
      ],
    },
    { id: 'sanctions', label: 'Screen against sanctions lists', status: 'pending' },
    { id: 'report', label: 'Write the summary', status: 'pending' },
  ],
};

const ALL_PENDING: TaskTreePayload = {
  title: 'Supplier due-diligence run',
  tasks: [
    { id: 'plan', label: 'Draft the research plan', status: 'pending' },
    { id: 'search', label: 'Search company registries', status: 'pending' },
    { id: 'verify', label: 'Verify beneficial ownership', status: 'pending' },
    { id: 'report', label: 'Write the summary', status: 'pending' },
  ],
};

const COMPLETED: TaskTreePayload = {
  title: 'Supplier due-diligence run',
  tasks: [
    { id: 'plan', label: 'Draft the research plan', status: 'done' },
    {
      id: 'search',
      label: 'Search company registries',
      status: 'done',
      children: [
        { id: 'search-cn', label: 'China — SAIC filings', status: 'done' },
        { id: 'search-de', label: 'Germany — Handelsregister', status: 'done' },
      ],
    },
    { id: 'verify', label: 'Verify beneficial ownership', status: 'done' },
    { id: 'report', label: 'Write the summary', status: 'done', detail: 'Delivered as supplier-review.md.' },
  ],
};

const FAILED: TaskTreePayload = {
  title: 'Pre-deploy checks',
  tasks: [
    { id: 'build', label: 'Build the bundle', status: 'done' },
    {
      id: 'test',
      label: 'Run the test suite',
      status: 'error',
      detail:
        'FAIL src/checkout/total.test.ts\n  ● applies the promotional code\n    Expected: 4200\n    Received: 4700',
      children: [
        { id: 'test-unit', label: 'Unit tests', status: 'done' },
        {
          id: 'test-e2e',
          label: 'End-to-end tests',
          status: 'error',
          detail: 'Timed out after 120s waiting for #checkout-summary to appear.',
        },
      ],
    },
    {
      id: 'deploy',
      label: 'Deploy to staging',
      status: 'skipped',
      detail: 'Not attempted: the suite has to be green first.',
    },
  ],
};

const DEEP: TaskTreePayload = {
  title: 'Monorepo release',
  tasks: [
    {
      id: 'l1',
      label: 'Release the workspace',
      status: 'running',
      children: [
        {
          id: 'l2',
          label: 'packages/core',
          status: 'running',
          children: [
            {
              id: 'l3',
              label: 'Type-check',
              status: 'running',
              children: [
                {
                  id: 'l4',
                  label: 'tsconfig.build.json',
                  status: 'running',
                  children: [
                    { id: 'l5a', label: 'src/render/widget-renderer.tsx', status: 'done' },
                    { id: 'l5b', label: 'src/state/use-widget-state.tsx', status: 'running' },
                    { id: 'l5c', label: 'src/slots/overlay-slot-host.tsx', status: 'pending' },
                  ],
                },
              ],
            },
            { id: 'l3b', label: 'Bundle', status: 'pending' },
          ],
        },
        { id: 'l2b', label: 'packages/theme', status: 'pending' },
      ],
    },
  ],
};

const LONG_LABELS: TaskTreePayload = {
  title: 'Reconciliation over an unusually verbose plan',
  tasks: [
    {
      id: 'long-1',
      label:
        'Reconcile every ledger entry recorded between 2024-07-01 and 2024-09-30 against the counterparty statement, flagging any line whose value differs by more than 0.5% or whose settlement date falls outside the agreed window',
      status: 'running',
      children: [
        {
          id: 'long-2',
          label:
            'urn:ledger:eu-west-1:acct-88213004:journal:2024Q3:reconciliation-batch-000000000417-retry-2',
          status: 'error',
          detail:
            'Rejected by the settlement gateway: SETTLEMENT_WINDOW_CLOSED (the batch was submitted 41 minutes after the cut-off, and the gateway does not queue late batches).',
        },
      ],
    },
  ],
};

/**
 * A payload caught mid-delta: the last task has half a label and no status yet, and the tail of the
 * plan has not arrived at all. It is deliberately NOT a valid `TaskTreePayload` — ADR 0019 skips
 * validation while `status === 'streaming'` precisely because a partial object fails a complete
 * schema by definition, and this story exists to prove the component survives what that lets
 * through.
 */
const STREAMING = {
  title: 'Supplier due-diligence run',
  tasks: [
    { id: 'plan', label: 'Draft the research plan', status: 'done' },
    { id: 'search', label: 'Search company registries', status: 'running' },
    { id: 'verify', label: 'Verify benefic' },
  ],
} as unknown as TaskTreePayload;

const EMPTY: TaskTreePayload = { title: 'Supplier due-diligence run', tasks: [] };

type HarnessProps = {
  payload: TaskTreePayload;
  state?: TaskTreeState;
  status?: WidgetStatus;
  /** Forces read-only regardless of lifecycle — a replayed transcript, a closed conversation. */
  readonly?: boolean;
};

/**
 * A stand-in for the host, so the story's controls are the three things a host actually varies.
 *
 * There is no `onSend` panel here, unlike the citations harness: this widget has no outbound
 * channel at all. A task tree reports; it never asks, so there is nothing for the host to receive.
 */
function TaskTreeHarness({ payload, state, status = 'ready', readonly = false }: HarnessProps): ReactElement {
  // Memoised, so a re-render from a keystroke does not hand `WidgetRenderer` a brand-new message
  // object and re-run the whole chain underneath a tree the reader is navigating.
  const message = useMemo(
    () =>
      widgetMessage({
        id: MESSAGE_ID,
        type: TASK_TREE_TYPE,
        version: TASK_TREE_VERSION,
        payload,
        state,
        text: FALLBACK_TEXT,
      }),
    [payload, state],
  );

  return (
    <MockWidgetHost registry={registry}>
      <WidgetRenderer message={message} status={status} readonly={readonly} />
    </MockWidgetHost>
  );
}

const meta = {
  title: 'Widgets/Task tree',
  component: TaskTreeHarness,
  parameters: { layout: 'padded' },
  args: { payload: MID_RUN },
} satisfies Meta<typeof TaskTreeHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A run in flight: two branches done, one running, two steps still queued. */
export const MidRun: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const tree = canvas.getByRole('tree', { name: 'Supplier due-diligence run' });
    await expect(tree).toBeInTheDocument();

    const plan = canvas.getByRole('treeitem', { name: /Draft the research plan/ });
    await expect(plan).toHaveAttribute('aria-level', '1');
    await expect(plan).toHaveAttribute('aria-setsize', '5');
    await expect(plan).toHaveAttribute('aria-posinset', '1');
    // A leaf is not expandable, so it must not claim to be. `aria-expanded="false"` on a node with
    // nothing inside it announces a disclosure that never opens.
    await expect(plan).not.toHaveAttribute('aria-expanded');

    const nested = canvas.getByRole('treeitem', { name: /China — SAIC filings/ });
    await expect(nested).toHaveAttribute('aria-level', '2');

    // One tab stop for the whole composite, on the first row. That is the contract `role="tree"`
    // signs up to, and getting it wrong puts every task in the page's tab order.
    await userEvent.tab();
    await expect(plan).toHaveFocus();
    await expect(plan).toHaveAttribute('tabindex', '0');
    await expect(nested).toHaveAttribute('tabindex', '-1');

    await userEvent.keyboard('{ArrowDown}');
    const search = canvas.getByRole('treeitem', { name: /Search company registries/ });
    await expect(search).toHaveFocus();
    await expect(search).toHaveAttribute('aria-expanded', 'true');
  },
};

/** Nothing has started. Every row is a leaf, so the tree is flat and nothing is expandable. */
export const AllPending: Story = {
  args: { payload: ALL_PENDING },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('treeitem')).toHaveLength(4);
    await expect(canvas.getAllByText('Pending')).toHaveLength(4);
    await expect(canvas.getByText('0/4 done')).toBeInTheDocument();
  },
};

/** ArrowLeft closes a branch, ArrowRight opens it again, and the panel really unmounts. */
export const KeyboardNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');

    const search = canvas.getByRole('treeitem', { name: /Search company registries/ });
    await expect(search).toHaveFocus();

    await userEvent.keyboard('{ArrowLeft}');
    await expect(search).toHaveAttribute('aria-expanded', 'false');
    // Collapsible unmounts the panel once its exit transition finishes, so the children are gone
    // rather than merely hidden — which is what makes the keyboard walk skip them.
    await waitFor(async () => {
      await expect(canvas.queryByRole('treeitem', { name: /SAIC filings/ })).toBeNull();
    });

    await userEvent.keyboard('{ArrowRight}');
    await expect(search).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('treeitem', { name: /SAIC filings/ })).toBeInTheDocument();

    // A second ArrowRight walks INTO the open branch rather than doing nothing.
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('treeitem', { name: /SAIC filings/ })).toHaveFocus();

    // …and ArrowLeft on a leaf climbs back out to its parent.
    await userEvent.keyboard('{ArrowLeft}');
    await expect(search).toHaveFocus();

    await userEvent.keyboard('{End}');
    await expect(canvas.getByRole('treeitem', { name: /Write the summary/ })).toHaveFocus();
  },
};

/**
 * A failed branch. Its detail is open on arrival because an error nobody expands is an error nobody
 * reads, and the skipped step says out loud why it never ran.
 */
export const ErrorBranch: Story = {
  args: { payload: FAILED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const failed = canvas.getByRole('treeitem', { name: /Run the test suite — Failed/ });
    await expect(failed).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByText(/applies the promotional code/)).toBeVisible();
    await expect(canvas.getByText(/Timed out after 120s/)).toBeVisible();

    // The failure is on the widget root too, so a consumer can style a bad run without walking
    // the payload (ADR 0020).
    const root = canvasElement.querySelector('[data-nerey-widget="task-tree"]');
    await expect(root).toHaveAttribute('data-state', 'error');
    await expect(canvas.getByText('2 failed')).toBeInTheDocument();
  },
};

/** Everything terminal. The summary badge flips to success and no spinner is left running. */
export const Completed: Story = {
  args: { payload: COMPLETED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('6/6 done')).toBeInTheDocument();
    // Nothing is still claiming to be in flight — a finished run with a "Running" row left on it
    // is the failure mode a completed-state story exists to catch.
    await expect(canvas.queryByText('Running')).toBeNull();
  },
};

/**
 * Mid-stream. The payload has been through no schema at all (ADR 0019): the last task has half a
 * label and no status, and the rest of the plan has not arrived.
 */
export const Streaming: Story = {
  args: { payload: STREAMING, status: 'streaming' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const root = canvasElement.querySelector('[data-nerey-widget="task-tree"]');
    await expect(root).toHaveAttribute('data-nerey-status', 'streaming');

    await expect(canvas.getAllByRole('treeitem')).toHaveLength(3);
    // A task whose status has not arrived has not started as far as anyone can tell — it must not
    // be guessed into "done" and it must not blank the row.
    await expect(canvas.getByRole('treeitem', { name: /Verify benefic — Pending/ })).toBeInTheDocument();
    await expect(canvas.getByText(/Planning the remaining steps/)).toBeVisible();
  },
};

/** Five levels. Indentation and the connector line both carry the depth; neither is a colour. */
export const DeeplyNested: Story = {
  args: { payload: DEEP },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const deepest = canvas.getByRole('treeitem', { name: /use-widget-state\.tsx/ });
    await expect(deepest).toHaveAttribute('aria-level', '5');
  },
};

/** A sentence-long label and an unbreakable identifier, both of which must stay inside the card. */
export const LongContent: Story = {
  args: { payload: LONG_LABELS },
};

/** A plan the model never filled in. Rendering an empty `role="tree"` would be worse than prose. */
export const Empty: Story = {
  args: { payload: EMPTY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('tree')).toBeNull();
    await expect(canvas.getByText(/No tasks were recorded/)).toBeVisible();
  },
};

/**
 * Replayed rather than watched. The disclosures are inert and the running row shows the static arc
 * instead of a spinner — a transcript that keeps spinning is claiming work is happening now.
 */
export const ReadOnly: Story = {
  args: { readonly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = canvas.getByRole('treeitem', { name: /Search company registries/ });
    await expect(search).toHaveAttribute('aria-expanded', 'true');

    await userEvent.click(canvas.getByText('Search company registries'));
    await expect(search).toHaveAttribute('aria-expanded', 'true');

    const root = canvasElement.querySelector('[data-nerey-widget="task-tree"]');
    await expect(root).toHaveAttribute('data-readonly', '');
  },
};
