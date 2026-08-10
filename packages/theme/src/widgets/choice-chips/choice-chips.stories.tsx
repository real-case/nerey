import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { WidgetRenderer, asAnyWidget, createWidgetRegistry } from '@nerey/core';
import type { MessagePersistence, WidgetRegistry } from '@nerey/core';
import { MockWidgetHost, widgetMessage } from '@nerey/core/mock';

import { Button } from '../../components/button/button';
import { Stack } from '../../components/stack/stack';
import { choiceChipsWidget } from './index';
import { CHOICE_CHIPS_TYPE, CHOICE_CHIPS_VERSION } from './schema';
import type { ChoiceChipsPayload, ChoiceChipsState } from './schema';

/**
 * ADR 0031 / 0032 — every story goes through `WidgetRenderer` inside `MockWidgetHost` rather than
 * rendering `ChoiceChipsWidget` directly. Half of what this widget is responsible for only exists
 * once the chain is wired: `{ on: 'message' }` expiry lives in the lifecycle runtime, the sent
 * message goes through the host boundary, and `readonly` is something the runtime decides rather
 * than something a story can set on the component.
 */

const registry: WidgetRegistry = createWidgetRegistry([asAnyWidget(choiceChipsWidget)]);

type ChipsStoryProps = {
  payload: ChoiceChipsPayload;
  state?: ChoiceChipsState;
  /** Forces the read-only path, as a replayed or disabled transcript would. */
  readonly?: boolean;
  /** Drives the `{ on: 'message' }` rule — the conversation moving on past this row. */
  messageCount?: number;
  onSend?: (text: string, meta?: Record<string, unknown>) => void;
  persistence?: MessagePersistence;
};

function ChipsStory({
  payload,
  state,
  readonly,
  messageCount,
  onSend,
  persistence,
}: ChipsStoryProps): ReactElement {
  const message = useMemo(
    () =>
      widgetMessage({
        id: 'chips-story',
        type: CHOICE_CHIPS_TYPE,
        version: CHOICE_CHIPS_VERSION,
        payload,
        state,
      }),
    [payload, state],
  );

  return (
    <MockWidgetHost registry={registry} onSend={onSend} persistence={persistence} messageCount={messageCount}>
      <WidgetRenderer message={message} readonly={readonly} />
    </MockWidgetHost>
  );
}

const meta = {
  title: 'Widgets/ChoiceChips',
  component: ChipsStory,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof ChipsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

const BOOKING: ChoiceChipsPayload = {
  prompt: 'The 09:40 to Bologna has two seats left.',
  choices: [
    { value: 'book', label: 'Book it' },
    { value: 'later', label: 'Show me later trains' },
    { value: 'cancel', label: 'Never mind' },
  ],
};

const DIETARY: ChoiceChipsPayload = {
  prompt: 'Anything to note for the kitchen?',
  multiple: true,
  choices: [
    { value: 'vegetarian', label: 'Vegetarian' },
    { value: 'no_nuts', label: 'No nuts' },
    { value: 'no_dairy', label: 'No dairy' },
    { value: 'halal', label: 'Halal' },
  ],
};

/** Rejects every write, so the "sent but not saved" branch is reachable without a backend. */
const failingPersistence: MessagePersistence = {
  getWidgetState: () => Promise.resolve(undefined),
  updateWidgetState: () => Promise.reject(new Error('widget state store is offline')),
};

function widgetRoot(canvasElement: HTMLElement): Element | null {
  return canvasElement.querySelector(`[data-nerey-widget='${CHOICE_CHIPS_TYPE}']`);
}

/**
 * Single-select sends on the press. No Submit button, and that is the entire point of a quick
 * reply — the press IS the decision, so asking for a second one would cost the keystroke the
 * widget exists to save.
 */
export const Default: Story = {
  args: { payload: BOOKING, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('group', { name: /09:40 to Bologna/ })).toBeInTheDocument();
    await expect(args.onSend).not.toHaveBeenCalled();

    await userEvent.click(canvas.getByRole('button', { name: 'Book it' }));

    // The label verbatim — a phrase a person would have typed, not `book — Book it` (ADR 0014).
    await expect(args.onSend).toHaveBeenCalledWith('Book it', { selected: 'book' });

    // Locked, not removed: the chosen chip stays pressed and the row goes inert (ADR 0018).
    await waitFor(async () => {
      await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'locked');
    });
    await expect(canvas.getByRole('button', { name: 'Book it' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('button', { name: 'Show me later trains' })).toBeDisabled();

    await userEvent.click(canvas.getByRole('button', { name: 'Show me later trains' }));
    await expect(args.onSend).toHaveBeenCalledTimes(1);
  },
};

/**
 * Multi-select cannot send on press — there is no press that means "and that is my final answer" —
 * so it grows the Submit button single-select deliberately does without.
 */
export const MultipleSelect: Story = {
  args: { payload: DIETARY, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Vegetarian' }));
    await userEvent.click(canvas.getByRole('button', { name: 'No nuts' }));

    await expect(canvas.getByRole('button', { name: 'Vegetarian' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('button', { name: 'No nuts' })).toHaveAttribute('aria-pressed', 'true');
    await expect(args.onSend).not.toHaveBeenCalled();

    await userEvent.click(canvas.getByRole('button', { name: 'Send' }));
    await expect(args.onSend).toHaveBeenCalledWith('Vegetarian, No nuts', {
      selected: ['vegetarian', 'no_nuts'],
    });

    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: /Sent/ })).toBeDisabled();
    });
  },
};

/** The tentative window multi-select has and single-select does not: chips move, nothing is sent. */
export const TentativeSelection: Story = {
  args: { payload: DIETARY, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const halal = canvas.getByRole('button', { name: 'Halal' });

    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();

    await userEvent.click(halal);
    await expect(halal).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeEnabled();

    // Pressed off again, and the row is back to having nothing to send.
    await userEvent.click(halal);
    await expect(halal).toHaveAttribute('aria-pressed', 'false');
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
    await expect(args.onSend).not.toHaveBeenCalled();
    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'idle');
  },
};

/**
 * A reloaded transcript. The persisted reply arrives through the envelope, the row renders locked,
 * and nothing is sent — replaying a message must never re-fire the interaction that produced it.
 */
export const RestoredFromPersistedState: Story = {
  args: { payload: BOOKING, state: { selected: 'later' }, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('button', { name: 'Show me later trains' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(canvas.getByRole('button', { name: 'Book it' })).toBeDisabled();
    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'locked');
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * The write fails after the reply is already with the agent, and the row STAYS LOCKED (ADR 0016).
 * Re-enabling it is the intuitive fix and the wrong one: the reply is in the transcript, and an
 * enabled row invites the second press that sends it twice.
 */
export const PersistFailure: Story = {
  args: { payload: BOOKING, onSend: fn(), persistence: failingPersistence },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Never mind' }));
    await expect(args.onSend).toHaveBeenCalledWith('Never mind', { selected: 'cancel' });

    await waitFor(async () => {
      await expect(canvas.getByRole('status')).toHaveTextContent(/Saving it here failed/);
    });

    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'locked');
    await expect(canvas.getByRole('button', { name: 'Book it' })).toBeDisabled();
    await expect(args.onSend).toHaveBeenCalledTimes(1);
  },
};

/**
 * `{ on: 'message' }`, which is the rule the poll deliberately does not have. Once the
 * conversation has moved on, pressing "Book it" would answer a question nobody is asking any more
 * and land three turns downstream of the context that made sense of it.
 */
export const SupersededByNewMessage: Story = {
  args: { payload: BOOKING, onSend: fn() },
  render: function SupersededStory(args) {
    const [messageCount, setMessageCount] = useState(1);

    return (
      <Stack gap={4} align="start">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setMessageCount((previous) => previous + 1);
          }}
        >
          The assistant says something else
        </Button>
        <ChipsStory {...args} messageCount={messageCount} />
      </Stack>
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('button', { name: 'Book it' })).toBeEnabled();

    await userEvent.click(canvas.getByRole('button', { name: 'The assistant says something else' }));

    // `afterExpiry: 'snapshot'` — still on screen, still legible, no longer live.
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: 'Book it' })).toBeDisabled();
    });
    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-readonly', '');

    await userEvent.click(canvas.getByRole('button', { name: 'Book it' }));
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/** Nine choices in a transcript column. Chips wrap; a segmented bar would not, which is why the
 *  widget picks the variant rather than leaving it to the theme. */
export const LongChoiceList: Story = {
  args: {
    payload: {
      prompt: 'Which region should I filter to?',
      choices: [
        { value: 'emea', label: 'EMEA' },
        { value: 'apac', label: 'APAC' },
        { value: 'latam', label: 'LATAM' },
        { value: 'namer', label: 'North America' },
        { value: 'dach', label: 'DACH' },
        { value: 'benelux', label: 'Benelux' },
        { value: 'nordics', label: 'Nordics' },
        { value: 'iberia', label: 'Iberia' },
        { value: 'anz', label: 'Australia and New Zealand' },
      ],
    },
    onSend: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole('group', { name: /Which region/ });

    await expect(within(group).getAllByRole('button')).toHaveLength(9);

    await userEvent.click(canvas.getByRole('button', { name: 'Australia and New Zealand' }));
    await expect(args.onSend).toHaveBeenCalledWith('Australia and New Zealand', { selected: 'anz' });
  },
};

/** A label long enough to be a sentence. The chip grows to hold it rather than truncating an
 *  answer the user is being asked to choose between. */
export const VeryLongLabels: Story = {
  args: {
    payload: {
      prompt: 'How should I handle the duplicate rows?',
      choices: [
        {
          value: 'keep_first',
          label: 'Keep the first occurrence of each duplicate and delete the rest permanently',
        },
        {
          value: 'merge',
          label: 'Merge every duplicate into one row, keeping the most recent value for each field',
        },
        { value: 'report', label: 'Just show me the list' },
      ],
    },
    onSend: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: /Merge every duplicate/ }));
    await expect(args.onSend).toHaveBeenCalledWith(
      'Merge every duplicate into one row, keeping the most recent value for each field',
      { selected: 'merge' },
    );
  },
};

/**
 * A row the host mounted read-only — a replayed transcript, a closed conversation. It renders its
 * terminal appearance and fires nothing, including for a row that was never answered.
 */
export const Readonly: Story = {
  args: { payload: BOOKING, readonly: true, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByRole('button', { name: 'Book it' });

    await expect(chip).toBeDisabled();
    await userEvent.click(chip);
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(args.onSend).not.toHaveBeenCalled();
    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-readonly', '');
  },
};
