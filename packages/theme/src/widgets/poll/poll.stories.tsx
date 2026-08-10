import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { WidgetRenderer, asAnyWidget, createWidgetRegistry } from '@nerey/core';
import type { MessagePersistence, WidgetRegistry } from '@nerey/core';
import { MockWidgetHost, widgetMessage } from '@nerey/core/mock';

import { pollWidget } from './index';
import { POLL_TYPE, POLL_VERSION } from './schema';
import type { PollPayload, PollState } from './schema';

/**
 * ADR 0031 / 0032 — every story here goes through `WidgetRenderer` inside `MockWidgetHost` rather
 * than rendering `PollWidget` directly. Calling the component would prove the markup and nothing
 * else; going through the renderer exercises the whole chain the widget actually lives in —
 * schema validation, the lifecycle runtime that decides `readonly`, the persistence port, and the
 * host boundary that turns `onInteraction` into a sent message. Half the behaviour this widget is
 * responsible for only exists once those are wired up.
 */

const registry: WidgetRegistry = createWidgetRegistry([asAnyWidget(pollWidget)]);

type PollStoryProps = {
  payload: PollPayload;
  state?: PollState;
  /** Forces the read-only path, as a replayed or disabled transcript would. */
  readonly?: boolean;
  onSend?: (text: string, meta?: Record<string, unknown>) => void;
  persistence?: MessagePersistence;
};

function PollStory({ payload, state, readonly, onSend, persistence }: PollStoryProps): ReactElement {
  // Memoised on the inputs it is built from. `WidgetRenderer` keys its validation memo on the
  // message identity, so a fresh object per render would re-run the chain on every keystroke
  // elsewhere in the page — cheap here, but it is also what the real host has to get right.
  const message = useMemo(
    () => widgetMessage({ id: 'poll-story', type: POLL_TYPE, version: POLL_VERSION, payload, state }),
    [payload, state],
  );

  return (
    <MockWidgetHost registry={registry} onSend={onSend} persistence={persistence}>
      <WidgetRenderer message={message} readonly={readonly} />
    </MockWidgetHost>
  );
}

const meta = {
  title: 'Widgets/Poll',
  component: PollStory,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof PollStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The payload shape this widget was extracted for: a disambiguation question, where each option
 * carries a block of record fields the user needs in order to tell three near-identical companies
 * apart. The descriptions use single newlines between `key: value` lines on purpose — that is
 * exactly the input the `pre-wrap` rule in the stylesheet exists for.
 */
const SUPPLIERS: PollPayload = {
  question: 'Three supplier records match "Huawei". Which one should I update?',
  options: [
    {
      value: '1',
      title: 'Shenzhen Rongsheng Precision',
      description: 'Registered: 2011-04-02\nCity: Shenzhen\nTax ID: 91440300MA5D***\nLast order: 2026-05-18',
    },
    {
      value: '2',
      title: 'Guangzhou Wanlida Electric',
      description: 'Registered: 2008-11-27\nCity: Guangzhou\nTax ID: 91440101MA59***\nLast order: 2026-02-03',
    },
    {
      value: '3',
      title: "Xi'an Huawei Technologies",
      description: 'Registered: 2015-06-30\nCity: Xian\nTax ID: 91610100MA6X***\nLast order: 2026-07-21',
    },
  ],
  noneOption: { value: 'none', label: 'None of these — I meant a different company' },
};

const PLAIN: PollPayload = {
  question: 'How should I sort the export?',
  options: [
    { value: 'date', title: 'By date, newest first' },
    { value: 'amount', title: 'By amount, largest first' },
    { value: 'supplier', title: 'By supplier name' },
  ],
};

/** Rejects every write, so the "sent but not saved" branch is reachable without a backend. */
const failingPersistence: MessagePersistence = {
  getWidgetState: () => Promise.resolve(undefined),
  updateWidgetState: () => Promise.reject(new Error('widget state store is offline')),
};

function widgetRoot(canvasElement: HTMLElement): Element | null {
  return canvasElement.querySelector(`[data-nerey-widget='${POLL_TYPE}']`);
}

/** Nothing chosen, nothing sent, and no way to send yet. */
export const Unanswered: Story = {
  args: { payload: SUPPLIERS, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // The group is named by the question. Base UI supplies `role="radiogroup"`; the name is the
    // widget's own doing, and without it the options are announced with nothing to hang them on.
    await expect(canvas.getByRole('radiogroup', { name: /Three supplier records/ })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'idle');
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * Step one of two. The highlight moves as often as the user likes and NOTHING leaves the widget —
 * this is the whole reason the poll has a Submit button, and the regression it exists to prevent.
 */
export const TentativeSelection: Story = {
  args: { payload: SUPPLIERS, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const first = canvas.getByRole('radio', { name: 'Shenzhen Rongsheng Precision' });
    const third = canvas.getByRole('radio', { name: "Xi'an Huawei Technologies" });

    await userEvent.click(first);
    await expect(first).toBeChecked();
    await expect(args.onSend).not.toHaveBeenCalled();

    // Freely changeable. A poll that had already replied would now have two answers in the
    // transcript and a model turn spent on the wrong one.
    await userEvent.click(third);
    await expect(third).toBeChecked();
    await expect(first).not.toBeChecked();
    await expect(args.onSend).not.toHaveBeenCalled();

    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'selected');
    await expect(canvas.getByRole('button', { name: 'Submit' })).toBeEnabled();
  },
};

/** Step two: one message, in the `value — title` form, and the poll closes for good. */
export const SubmittedAndLocked: Story = {
  args: { payload: SUPPLIERS, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('radio', { name: "Xi'an Huawei Technologies" }));
    await userEvent.click(canvas.getByRole('button', { name: 'Submit' }));

    // Something a human would plausibly have typed — the agent reads it as user input (ADR 0014).
    await expect(args.onSend).toHaveBeenCalledWith("3 — Xi'an Huawei Technologies", { selected: '3' });

    await waitFor(async () => {
      await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'locked');
    });
    await expect(canvas.getByRole('button', { name: /Answer sent/ })).toBeDisabled();

    // Disabled, not removed (ADR 0018): the chosen option is still on screen and still announced.
    await expect(canvas.getByRole('radio', { name: "Xi'an Huawei Technologies" })).toBeChecked();

    // And a second press on a different option changes nothing and sends nothing.
    await userEvent.click(canvas.getByRole('radio', { name: 'Shenzhen Rongsheng Precision' }));
    await expect(canvas.getByRole('radio', { name: 'Shenzhen Rongsheng Precision' })).not.toBeChecked();
    await expect(args.onSend).toHaveBeenCalledTimes(1);
  },
};

/**
 * A reloaded transcript. The persisted answer arrives through the envelope, the poll renders
 * locked on mount, and — the part that matters — nothing is sent, because replaying a message must
 * never re-fire the interaction that produced it.
 */
export const RestoredFromPersistedState: Story = {
  args: { payload: SUPPLIERS, state: { selected: '2' }, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('radio', { name: 'Guangzhou Wanlida Electric' })).toBeChecked();
    await expect(canvas.getByRole('button', { name: /Answer sent/ })).toBeDisabled();
    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'locked');
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * The write fails after the reply is already with the agent, and the poll STAYS LOCKED (ADR 0016).
 *
 * Re-enabling the options here is the intuitive fix and the wrong one: the answer is in the
 * transcript, the model is answering it, and an enabled poll invites the second press that sends
 * it twice. A lost state record is recoverable and visible on reload; a duplicated reply is
 * neither.
 */
export const PersistFailure: Story = {
  args: { payload: PLAIN, onSend: fn(), persistence: failingPersistence },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('radio', { name: 'By amount, largest first' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Submit' }));
    await expect(args.onSend).toHaveBeenCalledWith('amount — By amount, largest first', {
      selected: 'amount',
    });

    await waitFor(async () => {
      await expect(canvas.getByRole('status')).toHaveTextContent(/Saving it here failed/);
    });

    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'locked');
    await expect(canvas.getByRole('button', { name: /Answer sent/ })).toBeDisabled();
    await expect(args.onSend).toHaveBeenCalledTimes(1);
  },
};

/**
 * Descriptions are a disclosure per option, and the trigger sits OUTSIDE the label — otherwise
 * reading about an option would choose it.
 */
export const WithDescriptions: Story = {
  args: { payload: SUPPLIERS, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: /Details for Shenzhen Rongsheng Precision/ });

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByText(/Registered: 2011-04-02/)).toBeVisible();

    // The load-bearing assertion: opening a description is not an answer.
    await expect(canvas.getByRole('radio', { name: 'Shenzhen Rongsheng Precision' })).not.toBeChecked();
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/** The way out of a list that does not contain the answer. It sends a fixed phrase, not an index. */
export const NoneOfTheAbove: Story = {
  args: { payload: SUPPLIERS, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('radio', { name: /None of these/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'Submit' }));

    // `none — None of these — I meant a different company` would read to the model as a fourth
    // supplier it never offered.
    await expect(args.onSend).toHaveBeenCalledWith('None of the above.', { selected: 'none' });
  },
};

/** `multiple: true` is checkbox semantics, not a relaxed radio group. */
export const MultipleChoice: Story = {
  args: {
    payload: {
      question: 'Which columns should the export include?',
      multiple: true,
      options: [
        { value: 'invoice_no', title: 'Invoice number' },
        { value: 'issued_at', title: 'Issue date' },
        { value: 'net_total', title: 'Net total' },
        { value: 'vat', title: 'VAT' },
      ],
    },
    onSend: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('checkbox', { name: 'Invoice number' }));
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Net total' }));

    // Both stay ticked — the thing a radio group cannot do — and still nothing has been sent.
    await expect(canvas.getByRole('checkbox', { name: 'Invoice number' })).toBeChecked();
    await expect(canvas.getByRole('checkbox', { name: 'Net total' })).toBeChecked();
    await expect(args.onSend).not.toHaveBeenCalled();

    await userEvent.click(canvas.getByRole('button', { name: 'Submit' }));
    await expect(args.onSend).toHaveBeenCalledWith('invoice_no — Invoice number\nnet_total — Net total', {
      selected: ['invoice_no', 'net_total'],
    });
  },
};

/**
 * Twelve options, which is where building on `RadioGroup` rather than on divs stops being a
 * detail: one tab stop for the whole group and arrow keys to move inside it, instead of twelve
 * tab stops the user has to walk through to reach the button.
 */
export const LongOptionList: Story = {
  args: {
    payload: {
      question: 'Which cost centre should this be booked to?',
      options: Array.from({ length: 12 }, (_unused, index) => ({
        value: `CC-${String(index + 1).padStart(3, '0')}`,
        title: `Cost centre ${index + 1} — ${['Operations', 'Logistics', 'Facilities'][index % 3] ?? ''}`,
      })),
    },
    onSend: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('radio')).toHaveLength(12);

    // Arrow keys move within the group and take the selection with them — the APG behaviour that
    // comes free from the real control and would have to be hand-written on a list of divs. Focus
    // is set directly rather than tabbed to, so the assertion does not depend on what else the
    // page happens to have in its tab order.
    //
    // The regexes are anchored on the separator because this list runs to twelve: an unanchored
    // /Cost centre 1/ also matches "Cost centre 10", "11" and "12", so the query resolved to four
    // elements and threw before it ever reached the keyboard assertion.
    canvas.getByRole('radio', { name: /^Cost centre 1 —/ }).focus();
    await userEvent.keyboard('{ArrowDown}');

    const second = canvas.getByRole('radio', { name: /^Cost centre 2 —/ });
    await expect(second).toHaveFocus();
    await expect(second).toBeChecked();
  },
};

/** Titles that wrap. The control stays on the first line, beside the text it belongs to. */
export const VeryLongTitles: Story = {
  args: {
    payload: {
      question: 'Which clause should I amend?',
      options: [
        {
          value: 'c7',
          title:
            'Clause 7.2 — Limitation of liability for indirect, incidental, special, consequential or punitive damages arising out of or relating to the performance or non-performance of this agreement',
        },
        {
          value: 'c9',
          title:
            'Clause 9.1 — Termination for convenience by either party on ninety (90) days written notice delivered to the address set out in Schedule 3, together with settlement of all outstanding invoices',
        },
      ],
    },
    onSend: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const clause = canvas.getByRole('radio', { name: /Clause 9\.1/ });

    await userEvent.click(clause);
    await userEvent.click(canvas.getByRole('button', { name: 'Submit' }));
    await expect(args.onSend).toHaveBeenCalledWith(
      expect.stringContaining('c9 — Clause 9.1 — Termination for convenience'),
      { selected: 'c9' },
    );
  },
};

/**
 * A poll the host mounted read-only — a replayed transcript, a conversation that has been closed.
 * It renders its terminal appearance and fires nothing, including for a poll that was never
 * answered: there is no answer to show, and no way to give one.
 */
export const Readonly: Story = {
  args: { payload: PLAIN, readonly: true, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const option = canvas.getByRole('radio', { name: 'By date, newest first' });

    await expect(canvas.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await userEvent.click(option);
    await expect(option).not.toBeChecked();
    await expect(args.onSend).not.toHaveBeenCalled();
    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-readonly', '');
  },
};
