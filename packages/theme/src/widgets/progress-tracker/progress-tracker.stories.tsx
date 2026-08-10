import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { WidgetRenderer, asAnyWidget, composeRegistries } from '@nerey/core';
import type { WidgetRegistry, WidgetStatus } from '@nerey/core';
import { MockWidgetHost, mockRegistry, widgetMessage } from '@nerey/core/mock';

import { Button } from '../../components/button/button';
import { progressTrackerWidget } from './index';
import { PROGRESS_TRACKER_TYPE, PROGRESS_TRACKER_VERSION } from './schema';
import type { ProgressTrackerPayload } from './schema';

/**
 * ADR 0031 — the widget is rendered through `WidgetRenderer` inside `MockWidgetHost`, never by
 * calling the component. The chain is what ships: envelope → registry → schema → lifecycle →
 * component, and it is where a version typo, a state schema that rejects `undefined`, or an expiry
 * rule that fires on mount would show up.
 */

const registry: WidgetRegistry = composeRegistries(mockRegistry, [asAnyWidget(progressTrackerWidget)]);

const MESSAGE_ID = 'progress-tracker-story';

/** The last line of the degradation chain (ADR 0012), and it has to read as a sentence. */
const FALLBACK_TEXT = 'Migrating the workspace: 2 of 5 steps done, currently rewriting import specifiers.';

const STEPS = [
  { id: 'snapshot', label: 'Snapshot the current lockfile' },
  { id: 'bump', label: 'Bump the workspace dependencies' },
  { id: 'imports', label: 'Rewrite import specifiers' },
  { id: 'typecheck', label: 'Type-check every package' },
  { id: 'changeset', label: 'Write the changeset' },
];

const LABEL = 'Migrating the workspace';

const MID_RUN: ProgressTrackerPayload = { label: LABEL, steps: STEPS, currentStep: 2 };

const QUEUED: ProgressTrackerPayload = { label: LABEL, steps: STEPS, currentStep: -1 };

const COMPLETED: ProgressTrackerPayload = { label: LABEL, steps: STEPS, currentStep: STEPS.length };

/** `percent` overrides the derived fraction: the type-check is most of the wall-clock time. */
const WEIGHTED: ProgressTrackerPayload = {
  label: LABEL,
  steps: STEPS,
  currentStep: 3,
  percent: 41,
};

const INDETERMINATE: ProgressTrackerPayload = {
  label: 'Waiting for the build server',
  steps: [
    { id: 'queue', label: 'Queued behind 3 other jobs' },
    { id: 'build', label: 'Build' },
  ],
  currentStep: 0,
  determinate: false,
};

const LONG_LABELS: ProgressTrackerPayload = {
  label:
    'Reconciling every ledger entry recorded between 2024-07-01 and 2024-09-30 against the counterparty statement',
  steps: [
    {
      id: 'pull',
      label:
        'Pull the counterparty statement from the settlement gateway and normalise its column names, dates and currency codes into the internal ledger schema',
    },
    {
      id: 'match',
      label: 'urn:ledger:eu-west-1:acct-88213004:journal:2024Q3:reconciliation-batch-000000000417',
    },
    { id: 'report', label: 'Report' },
  ],
  currentStep: 1,
};

/**
 * A payload caught mid-delta: three of the five steps have arrived and the last one has half a
 * label. It is deliberately NOT a valid `ProgressTrackerPayload` — ADR 0019 skips validation while
 * `status === 'streaming'`, and this story exists to prove the component survives what that lets
 * through.
 */
const STREAMING = {
  label: LABEL,
  steps: [
    { id: 'snapshot', label: 'Snapshot the current lockfile' },
    { id: 'bump', label: 'Bump the workspace dependencies' },
    { id: 'imports', label: 'Rewrite import spec' },
  ],
  currentStep: 1,
} as unknown as ProgressTrackerPayload;

const EMPTY: ProgressTrackerPayload = { label: LABEL, steps: [], currentStep: 0 };

type HarnessProps = {
  payload: ProgressTrackerPayload;
  status?: WidgetStatus;
  /** Forces read-only regardless of lifecycle — a replayed transcript, a closed conversation. */
  readonly?: boolean;
  /**
   * Renders a control that advances the host's message count, which is what fires this widget's
   * `{ on: 'message' }` expiry rule. Off by default, because a story that can expire itself makes a
   * poor screenshot of the state it is supposed to show.
   */
  showAgentReply?: boolean;
};

/**
 * A stand-in for the host. There is no `onSend` panel, unlike the citations harness: this widget
 * has no outbound channel at all — it reports on work the host already started.
 */
function ProgressTrackerHarness({
  payload,
  status = 'ready',
  readonly = false,
  showAgentReply = false,
}: HarnessProps): ReactElement {
  const [messageCount, setMessageCount] = useState(1);

  const message = useMemo(
    () =>
      widgetMessage({
        id: MESSAGE_ID,
        type: PROGRESS_TRACKER_TYPE,
        version: PROGRESS_TRACKER_VERSION,
        payload,
        text: FALLBACK_TEXT,
      }),
    [payload],
  );

  return (
    <MockWidgetHost registry={registry} messageCount={messageCount}>
      <WidgetRenderer message={message} status={status} readonly={readonly} />
      {showAgentReply && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setMessageCount((count) => count + 1);
          }}
        >
          The agent replies
        </Button>
      )}
    </MockWidgetHost>
  );
}

const meta = {
  title: 'Widgets/Progress tracker',
  component: ProgressTrackerHarness,
  parameters: { layout: 'padded' },
  args: { payload: MID_RUN },
} satisfies Meta<typeof ProgressTrackerHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two steps done, one running, two to go. */
export const MidRun: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const bar = canvas.getByRole('progressbar', { name: LABEL });
    await expect(bar).toHaveAttribute('aria-valuenow', '40');
    await expect(canvas.getByText('2 of 5')).toBeInTheDocument();

    // The announcement is the widget's only speech, so it is asserted as a whole sentence rather
    // than as whichever fragment happened to change.
    const announcement = canvas.getByRole('status');
    await expect(announcement).toHaveTextContent('Step 3 of 5: Rewrite import specifiers');
    await expect(announcement).toHaveAttribute('aria-live', 'polite');
    await expect(announcement).toHaveAttribute('aria-atomic', 'true');

    // Exactly one row is "where we are", and it is the running one.
    const steps = canvas.getAllByRole('listitem');
    await expect(steps).toHaveLength(5);
    await expect(steps.filter((step) => step.getAttribute('aria-current') === 'step')).toHaveLength(1);
    await expect(steps[2]).toHaveAttribute('aria-current', 'step');
  },
};

/** Queued behind other work: the operation exists, nothing has started, the bar is at zero. */
export const AllPending: Story = {
  args: { payload: QUEUED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('progressbar', { name: LABEL })).toHaveAttribute('aria-valuenow', '0');
    await expect(canvas.getByRole('status')).toHaveTextContent('Queued: 5 steps to run.');
    await expect(canvas.getByText('0 of 5')).toBeInTheDocument();
    // Nothing is current, because nothing is happening — an `aria-current` on a queued row would
    // point a screen reader at work that has not begun.
    const current = canvas.getAllByRole('listitem').filter((step) => step.hasAttribute('aria-current'));
    await expect(current).toHaveLength(0);
  },
};

/** Everything finished. The bar completes and turns, and no step is left claiming to be running. */
export const Completed: Story = {
  args: { payload: COMPLETED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = canvas.getByRole('progressbar', { name: LABEL });
    await expect(bar).toHaveAttribute('aria-valuenow', '100');
    await expect(bar).toHaveAttribute('data-complete');
    await expect(canvas.getByRole('status')).toHaveTextContent('All 5 steps complete.');
    const current = canvas.getAllByRole('listitem').filter((step) => step.hasAttribute('aria-current'));
    await expect(current).toHaveLength(0);
  },
};

/**
 * The error branch. There is no `status: 'error'` field on the payload and there should not be one:
 * the renderer already carries the tool-part state machine's terminal error (ADR 0019), and a
 * second copy on the payload would be a second thing to keep in step.
 */
export const Failed: Story = {
  args: { payload: MID_RUN, status: 'error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Step 3 of 5 failed: Rewrite import specifiers',
    );

    // The failed row keeps `aria-current`: it is still where the run got to, and moving the marker
    // off it would leave the list with no current row at the moment a reader most wants one.
    const steps = canvas.getAllByRole('listitem');
    await expect(steps[2]).toHaveAttribute('aria-current', 'step');

    const root = canvasElement.querySelector('[data-nerey-widget="progress-tracker"]');
    await expect(root).toHaveAttribute('data-state', 'error');
    await expect(canvasElement.querySelectorAll('[data-nerey-part="step"][data-state="error"]')).toHaveLength(
      1,
    );
  },
};

/**
 * Mid-stream. The plan is still arriving, so the bar travels rather than filling: a denominator
 * that is still growing makes every percentage one that has to be taken back.
 */
export const Streaming: Story = {
  args: { payload: STREAMING, status: 'streaming' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const bar = canvas.getByRole('progressbar', { name: LABEL });
    await expect(bar).not.toHaveAttribute('aria-valuenow');
    await expect(bar).toHaveAttribute('data-indeterminate');

    await expect(canvas.getAllByRole('listitem')).toHaveLength(3);

    // The sentence names the running step and withholds the total, for the same reason the bar is
    // indeterminate: three of the five steps have arrived, so `steps.length` is how much has turned
    // up rather than how much there is. Announcing "of 3" here would be taken back on the next
    // delta — in a `polite`, `aria-atomic` region that re-reads the whole sentence each time.
    const announcement = canvas.getByRole('status');
    await expect(announcement).toHaveTextContent('Step 2: Bump the workspace dependencies');
    await expect(announcement).not.toHaveTextContent(/of \d/);
  },
};

/** `determinate: false` — the producer knows the steps but not how long the queue is. */
export const Indeterminate: Story = {
  args: { payload: INDETERMINATE },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('progressbar', { name: 'Waiting for the build server' });
    await expect(bar).toHaveAttribute('data-indeterminate');
  },
};

/** `percent` moves the fill; the caption keeps counting steps, because they answer different questions. */
export const WeightedPercent: Story = {
  args: { payload: WEIGHTED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('progressbar', { name: LABEL })).toHaveAttribute('aria-valuenow', '41');
    await expect(canvas.getByText('3 of 5')).toBeInTheDocument();
  },
};

/** A paragraph-long label and an unbreakable identifier, both of which must stay inside the card. */
export const LongContent: Story = {
  args: { payload: LONG_LABELS },
};

/** A tracker for an operation that reported no steps at all. */
export const Empty: Story = {
  args: { payload: EMPTY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('list')).toBeNull();
    await expect(canvas.getByText(/reported no steps/)).toBeVisible();
    await expect(canvas.getByRole('status')).toHaveTextContent('Nothing to do.');
  },
};

/**
 * The lifecycle, exercised rather than described: `{ on: 'message' }` freezes the tracker the moment
 * the agent's next message arrives, because from then on nothing can confirm the work is still in
 * flight. `afterExpiry: 'snapshot'` keeps the bar exactly where it stopped.
 */
export const FreezesOnNextMessage: Story = {
  args: { payload: MID_RUN, showAgentReply: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const selector = '[data-nerey-widget="progress-tracker"]';
    await expect(canvasElement.querySelector(selector)).not.toHaveAttribute('data-readonly');

    await userEvent.click(canvas.getByRole('button', { name: 'The agent replies' }));

    // Still rendered — `snapshot`, not `hide` — and now read-only.
    const frozen = canvasElement.querySelector(selector);
    await expect(frozen).toHaveAttribute('data-readonly', '');
    await expect(frozen).toHaveAttribute('data-state', 'locked');
    await expect(canvas.getByRole('progressbar', { name: LABEL })).toHaveAttribute('aria-valuenow', '40');
  },
};
