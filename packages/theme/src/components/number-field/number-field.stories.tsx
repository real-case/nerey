import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Field } from '../field/field';
import { Stack } from '../stack/stack';
import { NumberField } from './number-field';
import type { NumberFieldSize } from './number-field';

const meta = {
  title: 'Forms/NumberField',
  component: NumberField.Root,
  parameters: { layout: 'padded' },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
    readOnly: { control: 'boolean' },
  },
} satisfies Meta<typeof NumberField.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const SIZES: readonly NumberFieldSize[] = ['sm', 'md', 'lg'];

export const Default: Story = {
  args: { defaultValue: 2, min: 1, max: 9, onValueChange: fn() },
  render: (args) => (
    <Field.Root name="passengers">
      <Field.Label>Passengers</Field.Label>
      <NumberField.Root {...args}>
        <NumberField.Group>
          <NumberField.Decrement />
          <NumberField.Input />
          <NumberField.Increment />
        </NumberField.Group>
      </NumberField.Root>
    </Field.Root>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Passengers' });

    await expect(input).toHaveValue('2');

    // Base UI names the steppers itself, so an icon-only pair is still announced.
    await userEvent.click(canvas.getByRole('button', { name: 'Increase' }));
    await expect(input).toHaveValue('3');
    await expect(args.onValueChange).toHaveBeenLastCalledWith(3, expect.anything());

    await userEvent.click(canvas.getByRole('button', { name: 'Decrease' }));
    await expect(input).toHaveValue('2');
  },
};

export const Sizes: Story = {
  render: () => (
    <Stack gap={3}>
      {SIZES.map((size) => (
        <Field.Root key={size} name={`passengers-${size}`}>
          <Field.Label>{`Passengers (${size})`}</Field.Label>
          <NumberField.Root size={size} defaultValue={2}>
            <NumberField.Group>
              <NumberField.Decrement />
              <NumberField.Input />
              <NumberField.Increment />
            </NumberField.Group>
          </NumberField.Root>
        </Field.Root>
      ))}
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const small = canvas.getByRole('textbox', { name: 'Passengers (sm)' });
    const large = canvas.getByRole('textbox', { name: 'Passengers (lg)' });

    const smallGroup = small.parentElement?.getBoundingClientRect();
    const largeGroup = large.parentElement?.getBoundingClientRect();
    await expect(smallGroup?.height).toBeLessThan(largeGroup?.height ?? 0);
  },
};

/** The steppers stop at the bounds, and so does typing once the field is left. */
export const Bounded: Story = {
  render: () => (
    <Field.Root name="passengers">
      <Field.Label>Passengers</Field.Label>
      <NumberField.Root defaultValue={1} min={1} max={3}>
        <NumberField.Group>
          <NumberField.Decrement />
          <NumberField.Input />
          <NumberField.Increment />
        </NumberField.Group>
      </NumberField.Root>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Passengers' });
    const increase = canvas.getByRole('button', { name: 'Increase' });
    const decrease = canvas.getByRole('button', { name: 'Decrease' });

    await userEvent.click(decrease);
    await expect(input).toHaveValue('1');

    await userEvent.click(increase);
    await userEvent.click(increase);
    await userEvent.click(increase);
    await expect(input).toHaveValue('3');
  },
};

/** Arrow keys step, Shift steps by `largeStep`, and Home / End jump to the bounds. */
export const Keyboard: Story = {
  render: () => (
    <Field.Root name="seats">
      <Field.Label>Seats held</Field.Label>
      <NumberField.Root defaultValue={10} min={0} max={100} step={1} largeStep={10}>
        <NumberField.Group>
          <NumberField.Decrement />
          <NumberField.Input />
          <NumberField.Increment />
        </NumberField.Group>
      </NumberField.Root>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Seats held' });

    await userEvent.click(input);
    await userEvent.keyboard('{ArrowUp}');
    await expect(input).toHaveValue('11');

    await userEvent.keyboard('{Shift>}{ArrowUp}{/Shift}');
    await expect(input).toHaveValue('21');

    await userEvent.keyboard('{ArrowDown}');
    await expect(input).toHaveValue('20');
  },
};

/** `format` runs the value through `Intl.NumberFormat`; the submitted number is unchanged. */
export const Formatted: Story = {
  render: () => (
    <Field.Root name="fare">
      <Field.Label>Fare</Field.Label>
      <NumberField.Root
        defaultValue={240}
        min={0}
        step={10}
        format={{ style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }}
        locale="en-GB"
      >
        <NumberField.Group>
          <NumberField.Decrement />
          <NumberField.Input />
          <NumberField.Increment />
        </NumberField.Group>
      </NumberField.Root>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Fare' });

    await expect(input).toHaveValue('£240');
    await userEvent.click(canvas.getByRole('button', { name: 'Increase' }));
    await expect(input).toHaveValue('£250');
  },
};

/**
 * The scrub area turns any element into a drag handle for the value. Its usual occupant is the
 * field's own label, which is why the labelling still works: the label is a label first.
 */
export const WithScrubArea: Story = {
  render: () => (
    <Field.Root name="nights">
      <NumberField.Root defaultValue={7} min={1} max={28}>
        <NumberField.ScrubArea>
          <Field.Label>Nights (drag to change)</Field.Label>
        </NumberField.ScrubArea>
        <NumberField.Group>
          <NumberField.Decrement />
          <NumberField.Input />
          <NumberField.Increment />
        </NumberField.Group>
      </NumberField.Root>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Nights (drag to change)' });

    // Dragging needs a pointer lock the test runner will not grant, so the assertion here is the
    // part that must hold regardless: wrapping the label in a scrub area does not unname the
    // control.
    await expect(input).toHaveValue('7');
    await expect(input).toHaveAccessibleName('Nights (drag to change)');
  },
};

/** Empty is a real state: `null`, not zero. A blank fare field does not mean a free flight. */
export const Empty: Story = {
  render: () => (
    <Field.Root name="passengers">
      <Field.Label>Passengers</Field.Label>
      <NumberField.Root>
        <NumberField.Group>
          <NumberField.Decrement />
          <NumberField.Input placeholder="Any" />
          <NumberField.Increment />
        </NumberField.Group>
      </NumberField.Root>
      <Field.Description>Leave blank to search every party size.</Field.Description>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Passengers' });

    await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('placeholder', 'Any');
  },
};

export const Disabled: Story = {
  args: { defaultValue: 2, disabled: true, onValueChange: fn() },
  render: (args) => (
    <Field.Root name="passengers">
      <Field.Label>Passengers</Field.Label>
      <NumberField.Root {...args}>
        <NumberField.Group>
          <NumberField.Decrement />
          <NumberField.Input />
          <NumberField.Increment />
        </NumberField.Group>
      </NumberField.Root>
    </Field.Root>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Passengers' });

    await expect(input).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Increase' })).toBeDisabled();
    await expect(args.onValueChange).not.toHaveBeenCalled();
  },
};

export const ReadOnly: Story = {
  args: { defaultValue: 2, readOnly: true },
  render: (args) => (
    <Field.Root name="passengers">
      <Field.Label>Passengers</Field.Label>
      <NumberField.Root {...args}>
        <NumberField.Group>
          <NumberField.Decrement />
          <NumberField.Input />
          <NumberField.Increment />
        </NumberField.Group>
      </NumberField.Root>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Passengers' });

    await expect(input).toHaveAttribute('readonly');
    await userEvent.click(canvas.getByRole('button', { name: 'Increase' }));
    await expect(input).toHaveValue('2');
  },
};

/** Invalidity is read off the group, which Base UI marks directly — no `:has()`, no class. */
export const Invalid: Story = {
  render: () => (
    <Field.Root name="passengers" invalid>
      <Field.Label>Passengers</Field.Label>
      <NumberField.Root defaultValue={12} min={1} max={9}>
        <NumberField.Group>
          <NumberField.Decrement />
          <NumberField.Input />
          <NumberField.Increment />
        </NumberField.Group>
      </NumberField.Root>
      <Field.Error match>Bookings above nine passengers go through group sales.</Field.Error>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Passengers' });

    await expect(input).toHaveAttribute('data-invalid');
    await expect(input).toHaveAccessibleDescription('Bookings above nine passengers go through group sales.');
  },
};

export const Focused: Story = {
  render: () => (
    <Field.Root name="passengers">
      <Field.Label>Passengers</Field.Label>
      <NumberField.Root defaultValue={2}>
        <NumberField.Group>
          <NumberField.Decrement />
          <NumberField.Input />
          <NumberField.Increment />
        </NumberField.Group>
      </NumberField.Root>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The whole control is ONE tab stop, and it is the input. The steppers sit either side of it
    // in the DOM and are deliberately not tabbable: a keyboard user steps with the arrow keys,
    // and three stops for one value would be two too many.
    await userEvent.tab();
    await expect(canvas.getByRole('textbox', { name: 'Passengers' })).toHaveFocus();
    await expect(canvas.getByRole('button', { name: 'Decrease' })).toHaveAttribute('tabindex', '-1');
    await expect(canvas.getByRole('button', { name: 'Increase' })).toHaveAttribute('tabindex', '-1');
  },
};

/** A long value stays inside the group rather than pushing the steppers apart. */
export const LongValue: Story = {
  render: () => (
    <div style={{ maxWidth: '12rem' }}>
      <Field.Root name="miles">
        <Field.Label>Miles</Field.Label>
        <NumberField.Root defaultValue={1234567890} format={{ useGrouping: true }} locale="en-GB">
          <NumberField.Group>
            <NumberField.Decrement />
            <NumberField.Input />
            <NumberField.Increment />
          </NumberField.Group>
        </NumberField.Root>
      </Field.Root>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Miles' });
    const group = input.parentElement;

    await expect(input).toHaveValue('1,234,567,890');
    await expect(group?.scrollWidth).toBe(group?.clientWidth);
  },
};
