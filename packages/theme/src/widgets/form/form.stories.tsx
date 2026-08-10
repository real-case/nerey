import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { WidgetRenderer, asAnyWidget, createWidgetRegistry } from '@nerey/core';
import type { WidgetRegistry } from '@nerey/core';
import { MockWidgetHost, widgetMessage } from '@nerey/core/mock';

import { formWidget } from './index';
import { FORM_TYPE, FORM_VERSION } from './schema';
import type { FormField, FormPayload, FormState } from './schema';

/**
 * ADR 0031 / 0032 — every story here goes through `WidgetRenderer` inside `MockWidgetHost` rather
 * than rendering `FormWidget` directly. Calling the component would prove the markup and nothing
 * else; going through the renderer exercises the chain the widget actually lives in — schema
 * validation, the lifecycle runtime that decides `readonly`, the persistence port that makes a
 * half-filled form survive a reload, and the host boundary that turns `onInteraction` into a sent
 * message. Most of what this widget is responsible for only exists once those are wired up.
 */

const registry: WidgetRegistry = createWidgetRegistry([asAnyWidget(formWidget)]);

type FormStoryProps = {
  payload: FormPayload;
  state?: FormState;
  /** Forces the read-only path, as a replayed or disabled transcript would. */
  readonly?: boolean;
  onSend?: (text: string, meta?: Record<string, unknown>) => void;
};

function FormStory({ payload, state, readonly, onSend }: FormStoryProps): ReactElement {
  // Memoised on the inputs it is built from: `WidgetRenderer` keys its validation memo on the
  // message identity, so a fresh object per render would re-run the chain on every keystroke.
  const message = useMemo(
    () => widgetMessage({ id: 'form-story', type: FORM_TYPE, version: FORM_VERSION, payload, state }),
    [payload, state],
  );

  return (
    <MockWidgetHost registry={registry} onSend={onSend}>
      <WidgetRenderer message={message} readonly={readonly} />
    </MockWidgetHost>
  );
}

const meta = {
  title: 'Widgets/Form',
  component: FormStory,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof FormStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * One field of every kind, which is also the payload this widget was designed against: an agent
 * that has decided what it needs and is asking for it in one turn rather than in seven.
 */
const TRIP: FormPayload = {
  title: 'Before I book, a few details',
  description: 'The airline needs the name exactly as it appears on the passport.',
  fields: [
    {
      kind: 'text',
      name: 'passenger',
      label: 'Passenger name',
      required: true,
      placeholder: 'As printed on the passport',
    },
    { kind: 'date', name: 'depart', label: 'Departure date', required: true },
    {
      kind: 'number',
      name: 'bags',
      label: 'Checked bags',
      min: 0,
      max: 3,
      step: 1,
      description: 'Three is the maximum on this fare.',
    },
    {
      kind: 'select',
      name: 'cabin',
      label: 'Cabin',
      required: true,
      options: [
        { value: 'economy', label: 'Economy' },
        { value: 'premium', label: 'Premium economy' },
        { value: 'business', label: 'Business' },
      ],
    },
    {
      kind: 'multiselect',
      name: 'meals',
      label: 'Meal preferences',
      options: [
        { value: 'vegetarian', label: 'Vegetarian' },
        { value: 'halal', label: 'Halal' },
        { value: 'gluten-free', label: 'Gluten free' },
      ],
    },
    { kind: 'boolean', name: 'alerts', label: 'Text me gate changes' },
    {
      kind: 'text',
      name: 'notes',
      label: 'Anything else',
      multiline: true,
      placeholder: 'Seat us together, wheelchair assistance…',
    },
  ],
  submitLabel: 'Confirm details',
};

/** Two fields, so a story about the submit path is not a story about seven controls. */
const CONTACT: FormPayload = {
  title: 'Where should I send the summary?',
  fields: [
    { kind: 'text', name: 'email', label: 'Email', required: true, placeholder: 'you@example.com' },
    { kind: 'boolean', name: 'copy', label: 'Copy me on the thread' },
  ],
};

/** Nothing required, so submitting it untouched is legal — and has to say something anyway. */
const OPTIONAL_ONLY: FormPayload = {
  title: 'Anything you want me to know before I start?',
  fields: [{ kind: 'text', name: 'notes', label: 'Notes', multiline: true }],
};

function widgetRoot(canvasElement: HTMLElement): Element | null {
  return canvasElement.querySelector(`[data-nerey-widget='${FORM_TYPE}']`);
}

/** A form nobody has touched: every control at its default, nothing sent, nothing red. */
export const Empty: Story = {
  args: { payload: TRIP, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'idle');
    await expect(canvas.getByRole('textbox', { name: 'Passenger name' })).toHaveValue('');
    await expect(canvas.getByRole('switch', { name: 'Text me gate changes' })).not.toBeChecked();
    await expect(canvas.getByRole('button', { name: 'Confirm details' })).toBeEnabled();

    // The load-bearing negative: an untouched form shows no errors at all. A widget that greets
    // the user with three red lines has told them they got something wrong before they started.
    await expect(canvas.queryByText('Passenger name is required.')).toBeNull();
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * Typing does not validate, and that is the point rather than an accident.
 *
 * Base UI's `validationMode` defaults to `'onSubmit'`, so a required email is not "invalid" while
 * the user is halfway through the local part. A form that turns red at the first character is
 * hostile, and the fix people reach for — debouncing the redness — only makes it late as well.
 */
export const Filled: Story = {
  args: { payload: TRIP, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByRole('textbox', { name: 'Passenger name' }), 'A');
    await expect(canvas.queryByText('Passenger name is required.')).toBeNull();

    await userEvent.type(canvas.getByRole('textbox', { name: 'Passenger name' }), 'da Lovelace');
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Halal' }));
    await userEvent.click(canvas.getByRole('switch', { name: 'Text me gate changes' }));

    await expect(canvas.getByRole('textbox', { name: 'Passenger name' })).toHaveValue('Ada Lovelace');
    await expect(canvas.getByRole('checkbox', { name: 'Halal' })).toBeChecked();
    await expect(canvas.getByRole('switch', { name: 'Text me gate changes' })).toBeChecked();

    // Still nothing sent: a form replies once, when it is submitted.
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * Submit with the required fields blank.
 *
 * Three things have to happen together and all three are asserted: the message under each field
 * is the one the payload's own label produced, focus moves to the first invalid control in
 * document order, and nothing reaches the agent. The last one is what a form that "shows errors"
 * but still fires its handler gets wrong.
 */
export const ValidationErrors: Story = {
  args: { payload: TRIP, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Confirm details' }));

    await expect(await canvas.findByText('Passenger name is required.')).toBeVisible();
    await expect(canvas.getByText('Departure date is required.')).toBeVisible();
    await expect(canvas.getByText('Cabin is required.')).toBeVisible();
    await expect(args.onSend).not.toHaveBeenCalled();

    // A keyboard or screen-reader user is otherwise told the form failed and left standing on the
    // button, with seven fields and no clue which one is the problem.
    await expect(canvas.getByRole('textbox', { name: 'Passenger name' })).toHaveFocus();

    // And once the first submit has been attempted, fixing a field clears its error immediately —
    // the half of `'onSubmit'` mode that stops the message from outliving the mistake.
    await userEvent.type(canvas.getByRole('textbox', { name: 'Passenger name' }), 'Ada Lovelace');
    await waitFor(async () => {
      await expect(canvas.queryByText('Passenger name is required.')).toBeNull();
    });
    await expect(canvas.getByText('Cabin is required.')).toBeVisible();
  },
};

/** A number outside `min`/`max` is kept, not silently rewritten, and the rule is explained. */
export const OutOfRangeNumber: Story = {
  args: { payload: TRIP, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByRole('textbox', { name: 'Checked bags' }), '9');
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm details' }));

    await expect(await canvas.findByText('Enter a number between 0 and 3.')).toBeVisible();
    // Clamping would have shown a 3 the user never typed and submitted it as their answer.
    await expect(canvas.getByRole('textbox', { name: 'Checked bags' })).toHaveValue('9');
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * The whole submit path: one message, one `label: value` per line, and the form closes for good.
 *
 * The text is the contract. The agent reads it as user input (ADR 0014), so it is what a person
 * would have typed — not `{"email":"ada@example.com","copy":true}`.
 */
export const SubmittedAndLocked: Story = {
  args: { payload: CONTACT, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.type(canvas.getByRole('textbox', { name: 'Email' }), 'ada@example.com');
    await userEvent.click(canvas.getByRole('switch', { name: 'Copy me on the thread' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Submit' }));

    await expect(args.onSend).toHaveBeenCalledWith('Email: ada@example.com\nCopy me on the thread: Yes', {
      values: { email: 'ada@example.com', copy: true },
    });

    await waitFor(async () => {
      await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'locked');
    });

    // Disabled, not removed (ADR 0018): the answers stay on screen and stay announced.
    await expect(canvas.getByRole('textbox', { name: 'Email' })).toHaveValue('ada@example.com');
    await expect(canvas.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await expect(canvas.getByText('Submitted')).toBeVisible();

    // A second press changes nothing and sends nothing.
    await userEvent.click(canvas.getByRole('button', { name: 'Submit' }));
    await expect(args.onSend).toHaveBeenCalledTimes(1);
  },
};

/** An all-optional form submitted untouched still has to say something a human could have typed. */
export const SubmittedWithNothingFilledIn: Story = {
  args: { payload: OPTIONAL_ONLY, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Submit' }));

    // Not an empty string, which would reach the model as a blank turn.
    await expect(args.onSend).toHaveBeenCalledWith('I submitted the form without filling anything in.', {
      values: { notes: '' },
    });
  },
};

/**
 * A reloaded tab. The answers arrive through the envelope and every control comes back holding
 * them — the reason this widget keeps its values in `useWidgetState` rather than in the DOM.
 *
 * The form is NOT locked: it was never submitted, so it is still answerable, and nothing is sent
 * on mount. Replaying a message must never re-fire the interaction that produced it.
 */
export const RestoredFromPersistedState: Story = {
  args: {
    payload: TRIP,
    state: {
      values: {
        passenger: 'Ada Lovelace',
        depart: '2026-09-14',
        bags: 2,
        cabin: 'business',
        meals: ['vegetarian'],
        alerts: true,
        notes: 'Seat us together.',
      },
    },
    onSend: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('textbox', { name: 'Passenger name' })).toHaveValue('Ada Lovelace');
    await expect(canvas.getByLabelText(/Departure date/)).toHaveValue('2026-09-14');
    await expect(canvas.getByRole('textbox', { name: 'Checked bags' })).toHaveValue('2');
    await expect(canvas.getByRole('checkbox', { name: 'Vegetarian' })).toBeChecked();
    await expect(canvas.getByRole('switch', { name: 'Text me gate changes' })).toBeChecked();
    await expect(canvas.getByRole('textbox', { name: 'Anything else' })).toHaveValue('Seat us together.');

    // The trigger shows the option's LABEL, not the stored value — the thing `items` on the Root
    // exists for, and the most common way a select ships broken.
    await expect(canvas.getByRole('combobox', { name: 'Cabin' })).toHaveTextContent('Business');

    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'idle');
    await expect(canvas.getByRole('button', { name: 'Confirm details' })).toBeEnabled();
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * `afterExpiry: 'snapshot'` on a reload after the form was sent. The terminal appearance is the
 * answers, still legible, with every control inert — which is what makes the transcript readable
 * a week later.
 */
export const SubmittedSnapshot: Story = {
  args: {
    payload: CONTACT,
    state: { values: { email: 'ada@example.com', copy: false }, submitted: true },
    onSend: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'locked');
    await expect(canvas.getByRole('textbox', { name: 'Email' })).toHaveValue('ada@example.com');
    await expect(canvas.getByRole('textbox', { name: 'Email' })).toBeDisabled();
    await expect(canvas.getByText('Submitted')).toBeVisible();
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * Read-only because the host said so, not because anything was submitted.
 *
 * The badge is absent, and that is the assertion worth having: a widget that showed "Submitted" on
 * every locked render would be putting a claim into the transcript that never happened.
 */
export const ReadOnly: Story = {
  args: {
    payload: CONTACT,
    state: { values: { email: 'ada@example.com' } },
    readonly: true,
    onSend: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-readonly', '');
    await expect(canvas.getByRole('textbox', { name: 'Email' })).toHaveValue('ada@example.com');
    await expect(canvas.getByRole('textbox', { name: 'Email' })).toBeDisabled();
    await expect(canvas.getByRole('switch', { name: 'Copy me on the thread' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(canvas.queryByText('Submitted')).toBeNull();

    await userEvent.click(canvas.getByRole('button', { name: 'Submit' }));
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * Fourteen fields, which is where a transcript-embedded form stops being a nice card and starts
 * being a page. Nothing here is virtualised or collapsed on purpose: the widget's job is to be
 * legible at this size, and the max-width on the root is what keeps the lines scannable when the
 * host's column is wider than a form should ever be.
 */
const LONG_FIELDS: readonly FormField[] = Array.from({ length: 14 }, (_unused, index) => ({
  kind: 'text' as const,
  name: `line_${String(index + 1)}`,
  label: `Line item ${String(index + 1)}`,
  placeholder: 'Description',
}));

export const LongFieldList: Story = {
  args: {
    payload: {
      title: 'Fill in the delivery note',
      fields: [...LONG_FIELDS],
      submitLabel: 'Save the note',
    },
    onSend: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getAllByRole('textbox')).toHaveLength(14);
    await expect(canvas.getByRole('textbox', { name: 'Line item 14' })).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'Save the note' })).toBeEnabled();
  },
};
