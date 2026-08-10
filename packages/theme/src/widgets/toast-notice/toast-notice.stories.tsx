import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import {
  DEFAULT_DISMISS_LABEL,
  OverlaySlotHost,
  WidgetRenderer,
  asAnyWidget,
  composeRegistries,
  defineWidget,
} from '@nerey/core';
import type { WidgetRegistry, WidgetStatus } from '@nerey/core';
import { MockWidgetHost, mockRegistry, widgetMessage } from '@nerey/core/mock';

import { toastNoticeWidget } from './index';
import { NOTICE_TIMEOUT_MS, TOAST_NOTICE_TYPE, TOAST_NOTICE_VERSION } from './schema';
import type { ToastNoticePayload, ToastNoticeState } from './schema';

/**
 * ADR 0031 / 0017 — the overlay widget is rendered through `OverlaySlotHost`, because placement is
 * the half of this widget that the component cannot demonstrate on its own: `{ slot: 'overlay' }`
 * is read by the host, not by the component, so a notice that renders beautifully and is placed
 * into the transcript looks exactly like a notice that works.
 */

const MESSAGE_ID = 'toast-notice-story';

const FALLBACK_TEXT = 'Your export finished: 4,182 rows are ready to download.';

const SENT_PREFIX = 'Sent to the agent: ';

/**
 * A registry whose notice carries a different deadline.
 *
 * The lifecycle is part of the registry entry, not a prop, so a story that wants to SHOW the
 * timeout expire has to register a differently-tuned entry — which is the honest way round: it
 * demonstrates the real mechanism at a speed a test can watch, rather than mocking the clock. No
 * fake timers anywhere in this file; the widget's own `setTimeout` runs, and the play function
 * waits for the DOM to catch up (ADR 0031).
 */
function registryFor(timeoutMs: number): WidgetRegistry {
  const entry = defineWidget<ToastNoticePayload, ToastNoticeState>({
    ...toastNoticeWidget,
    lifecycle: {
      ...toastNoticeWidget.lifecycle,
      expiry: [{ on: 'timeout', ms: timeoutMs }, { on: 'message' }],
    },
  });

  return composeRegistries(mockRegistry, [asAnyWidget(entry)]);
}

type HarnessProps = {
  payload: ToastNoticePayload;
  state?: ToastNoticeState;
  /** The notice's own deadline, in milliseconds. Shortened by the story that watches it expire. */
  timeoutMs?: number;
  /** Wires the host's dismiss control. Without a handler the host renders none — see ADR 0017. */
  dismissible?: boolean;
  status?: WidgetStatus;
  readonly?: boolean;
};

/**
 * Sending a message bumps `messageCount`, which is what a real host does and what makes
 * `{ on: 'message' }` fire. Keeping that wiring in the harness rather than hard-coding a count is
 * the difference between demonstrating the lifecycle and asserting a constant.
 */
function ToastNoticeHarness({
  payload,
  state,
  timeoutMs = NOTICE_TIMEOUT_MS,
  dismissible = false,
  status = 'ready',
  readonly = false,
}: HarnessProps): ReactElement {
  const [sent, setSent] = useState<readonly string[]>([]);
  const [messageCount, setMessageCount] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const registry = useMemo(() => registryFor(timeoutMs), [timeoutMs]);

  const message = useMemo(
    () =>
      widgetMessage({
        id: MESSAGE_ID,
        type: TOAST_NOTICE_TYPE,
        version: TOAST_NOTICE_VERSION,
        payload,
        state,
        text: FALLBACK_TEXT,
      }),
    [payload, state],
  );

  // `OverlaySlotHost`'s props are fixed by ADR 0017 and include neither `status` nor `readonly` —
  // a host that mounts overlays has no opinion about either. The two stories that need to FORCE
  // them therefore go one layer down, to the renderer, and say so rather than pretending otherwise.
  const forced = status !== 'ready' || readonly;

  return (
    <MockWidgetHost
      registry={registry}
      messageCount={messageCount}
      onSend={(text) => {
        setSent((all) => [...all, text]);
        setMessageCount((count) => count + 1);
      }}
    >
      <p>Assistant: the export you asked for has finished running.</p>

      {forced ? (
        <WidgetRenderer message={message} status={status} readonly={readonly} />
      ) : (
        <OverlaySlotHost
          messages={dismissed ? [] : [message]}
          scope="chat"
          onDismiss={
            dismissible
              ? () => {
                  setDismissed(true);
                }
              : undefined
          }
        />
      )}

      <p>{`${SENT_PREFIX}${sent.join(' · ')}`}</p>
    </MockWidgetHost>
  );
}

const meta = {
  title: 'Widgets/ToastNotice',
  component: ToastNoticeHarness,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ToastNoticeHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

const TYPICAL: ToastNoticePayload = {
  tone: 'warning',
  title: 'Export finished with 6 skipped rows',
  description: 'Rows 118, 402, 403, 977, 1204 and 1660 had no supplier code and were left out.',
  action: { label: 'Show the skipped rows', value: 'Show me the six rows that were skipped.' },
};

/** The notice's live region, which the widget renders in place rather than portalling (ADR 0020). */
const notice = (canvasElement: HTMLElement) =>
  within(canvasElement).getByRole('region', { name: 'Notifications' });

/**
 * Asserts the card is on screen, after its entrance rather than during it.
 *
 * `toast.module.css` starts the card at `opacity: 0` under Base UI's `data-starting-style` and
 * transitions it to 1, and `toBeVisible()` reads *computed* opacity — so a bare assertion in the
 * frame the toast mounts in is an assertion about the first frame of an animation, not about
 * whether the notice arrived. Every other assertion in this file stays plain; only visibility is
 * time-dependent, and the honest way to state a time-dependent fact is to wait for it.
 */
const expectVisible = async (find: () => HTMLElement): Promise<void> => {
  await waitFor(async () => {
    await expect(find()).toBeVisible();
  });
};

/**
 * The whole chain in one story: the placement routes the widget to the overlay slot, the action
 * sends a sentence a person would have typed, the send bumps the conversation's message count, and
 * `{ on: 'message' }` retires the notice — which, at `afterExpiry: 'hide'`, means it goes away.
 */
export const Default: Story = {
  args: { payload: TYPICAL },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const region = within(notice(canvasElement));

    await expectVisible(() => region.getByText('Export finished with 6 skipped rows'));
    await expect(region.getByText(/no supplier code/)).toBeVisible();

    await userEvent.click(region.getByRole('button', { name: 'Show the skipped rows' }));

    await expect(canvas.getByText(/Show me the six rows that were skipped\./)).toBeVisible();

    // The notice is gone rather than disabled, and that is the one place in this theme where
    // removal is right: a notice was never part of the record, and the message's own text is still
    // in the transcript (ADR 0018).
    await waitFor(async () => {
      await expect(canvas.queryByText('Export finished with 6 skipped rows')).toBeNull();
    });
  },
};

/**
 * The minimum payload: a tone and a title. Nothing else is required, and nothing else is rendered —
 * no empty description line, no button with nowhere to go.
 */
export const TitleOnly: Story = {
  args: { payload: { tone: 'success', title: 'Your export is ready to download.' } },
  play: async ({ canvasElement }) => {
    const region = within(notice(canvasElement));

    await expectVisible(() => region.getByText('Your export is ready to download.'));
    await expect(region.queryByRole('button')).toBeNull();
  },
};

/** Long copy wraps and the card grows. A notification never truncates the half that says why. */
export const Overflowing: Story = {
  args: {
    payload: {
      tone: 'warning',
      title: 'The export finished, but the supplier reconciliation step was skipped for 1,204 rows',
      description:
        'Those rows reference a supplier code that is not in the current master list, which usually ' +
        'means they were created against last quarter’s catalogue. They are present in the file and ' +
        'flagged in the `reconciled` column, so nothing has been lost — but the totals in the summary ' +
        'sheet exclude them and will not match the row count.',
      action: {
        label: 'Explain which supplier codes are missing',
        value: 'Which supplier codes are missing from the master list?',
      },
    },
  },
  play: async ({ canvasElement }) => {
    const region = notice(canvasElement);

    await expect(region).toHaveTextContent(/will not match the row count/);
    // The card grows downward; the page never grows sideways.
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  },
};

/**
 * `tone: 'danger'` is the only tone announced assertively, because assertive announcement cuts
 * across whatever a screen-reader user was reading — right for a failure, rude for a confirmation.
 *
 * Base UI mirrors a high-priority toast into its own `role="alert"` and hides the visible card from
 * the accessibility tree so the message is announced once. The card stays focusable throughout, so
 * the resting state is `aria-hidden` on a focusable element — a WCAG 4.1.2 failure that axe reports
 * as `aria-hidden-focus` (ADR 0032). Engaging with the viewport hands the card back, which is what
 * the last step below does; the theme's own Toast stories record the same workaround.
 */
export const Assertive: Story = {
  args: {
    payload: {
      tone: 'danger',
      title: 'The export failed',
      description: 'The warehouse connection dropped after 812 rows. Nothing was written.',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = await waitFor(() => canvas.getByRole('alert'));
    await expect(alert).toHaveTextContent('The export failed');

    const region = notice(canvasElement);
    await userEvent.click(region);
    await waitFor(async () => {
      await expect(region.querySelector('[role="alertdialog"]')).not.toHaveAttribute('aria-hidden');
    });
  },
};

/**
 * A deadline short enough to watch. The mechanism is the real one — the lifecycle runtime's own
 * `setTimeout` — and the assertion is a `waitFor` against the DOM, so nothing here depends on a
 * mocked clock or on how long the machine took to get to this line.
 */
export const ExpiresOnTimeout: Story = {
  args: { payload: TYPICAL, timeoutMs: 600 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expectVisible(() => canvas.getByText('Export finished with 6 skipped rows'));

    await waitFor(
      async () => {
        await expect(canvas.queryByText('Export finished with 6 skipped rows')).toBeNull();
      },
      // Comfortably more than the deadline, and not a substitute for it: the assertion is that the
      // notice goes away on its own, not that it goes away at a particular millisecond.
      { timeout: 4000 },
    );
  },
};

/**
 * `dismissible: true` in the placement means the close control belongs to the host, which is the
 * only layer that can remove the message from the list it owns. Core ships that control with an
 * accessible name and no glyph and no CSS, on purpose: `[data-nerey-part='dismiss']` is where a
 * consumer puts their × (ADR 0017 / 0020), and this story is where its absence is visible.
 */
export const DismissedByHost: Story = {
  args: { payload: TYPICAL, dismissible: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expectVisible(() => canvas.getByText('Export finished with 6 skipped rows'));

    await userEvent.click(canvas.getByRole('button', { name: DEFAULT_DISMISS_LABEL }));
    await waitFor(async () => {
      await expect(canvas.queryByText('Export finished with 6 skipped rows')).toBeNull();
    });
  },
};

/**
 * `status: 'error'` — the tool call that produced this notice reached its terminal state badly
 * (ADR 0019). The notice still says what it can; the action is withdrawn, because the turn it would
 * start is the one that just failed.
 */
export const Errored: Story = {
  args: { payload: TYPICAL, status: 'error' },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector('[data-nerey-widget="toast-notice"]');

    await expect(root).toHaveAttribute('data-nerey-status', 'error');
    await expect(root).toHaveAttribute('data-state', 'error');
    await expect(
      within(notice(canvasElement)).getByRole('button', { name: 'Show the skipped rows' }),
    ).toBeDisabled();
  },
};

/**
 * Mounted read-only with the press already recorded. The button stays visible, stays labelled and
 * stays disabled: an acted-upon widget is disabled, not removed (ADR 0018) — and `data-state` on
 * the part is what a consumer styles that with (ADR 0020).
 */
export const Readonly: Story = {
  args: { payload: TYPICAL, state: { acted: true }, readonly: true },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector('[data-nerey-widget="toast-notice"]');
    const region = notice(canvasElement);

    await expect(root).toHaveAttribute('data-readonly', '');
    await expect(root).toHaveAttribute('data-state', 'locked');

    const action = within(region).getByRole('button', { name: 'Show the skipped rows' });
    await expect(action).toBeDisabled();
    await expect(action).toHaveAttribute('data-state', 'selected');
    await expect(within(canvasElement).getByText(SENT_PREFIX.trim())).toBeVisible();
  },
};
