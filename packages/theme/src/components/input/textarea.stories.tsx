import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Field } from '../field/field';
import { Stack } from '../stack/stack';
import { Textarea } from './textarea';
import type { TextareaSize } from './textarea';

const meta = {
  title: 'Forms/Textarea',
  component: Textarea,
  parameters: { layout: 'padded' },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    rows: { control: { type: 'number', min: 1, max: 12 } },
    invalid: { control: 'boolean' },
  },
  args: { 'aria-label': 'Special requests', placeholder: 'Anything we should know?' },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

const SIZES: readonly TextareaSize[] = ['sm', 'md', 'lg'];

export const Default: Story = {
  args: { onValueChange: fn() },
  play: async ({ args, canvasElement }) => {
    const box = within(canvasElement).getByRole('textbox', { name: 'Special requests' });

    // The element really is a <textarea>, not an <input> wearing a taller box: newlines are the
    // whole reason this component exists.
    await expect(box.tagName).toBe('TEXTAREA');
    await userEvent.type(box, 'Aisle seat{enter}Vegetarian meal');
    await expect(box).toHaveValue('Aisle seat\nVegetarian meal');
    await expect(args.onValueChange).toHaveBeenLastCalledWith('Aisle seat\nVegetarian meal');
  },
};

/** `size` sets the type scale and the padding; `rows` sets the height. They are independent. */
export const Sizes: Story = {
  render: () => (
    <Stack gap={3}>
      {SIZES.map((size) => (
        <Textarea key={size} size={size} rows={2} aria-label={`Requests (${size})`} />
      ))}
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const small = canvas.getByRole('textbox', { name: 'Requests (sm)' });
    const large = canvas.getByRole('textbox', { name: 'Requests (lg)' });
    await expect(small.getBoundingClientRect().height).toBeLessThan(large.getBoundingClientRect().height);
  },
};

export const Rows: Story = {
  args: { rows: 8 },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('textbox', { name: 'Special requests' });
    await expect(box).toHaveAttribute('rows', '8');
  },
};

export const Invalid: Story = {
  args: { invalid: true, defaultValue: 'A' },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('textbox', { name: 'Special requests' });
    await expect(box).toHaveAttribute('aria-invalid', 'true');
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'Aisle seat please.' },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('textbox', { name: 'Special requests' });
    await expect(box).toBeDisabled();
  },
};

export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('textbox', { name: 'Special requests' });
    await userEvent.tab();
    await expect(box).toHaveFocus();
  },
};

export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('textbox', { name: 'Special requests' });
    await expect(box).toHaveValue('');
    await expect(box).toHaveAccessibleName('Special requests');
  },
};

/** Content past `rows` scrolls the control. The box does not grow and the page does not jump. */
export const LongContent: Story = {
  args: {
    rows: 3,
    defaultValue: Array.from(
      { length: 12 },
      (_unused, index) => `Line ${index + 1}: a request that runs on for a while.`,
    ).join('\n'),
  },
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('textbox', { name: 'Special requests' });
    await expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
  },
};

export const InAField: Story = {
  render: () => (
    <Field.Root name="requests">
      <Field.Label>Special requests</Field.Label>
      <Textarea rows={4} maxLength={280} />
      <Field.Description>We pass these to the airline; nothing is guaranteed.</Field.Description>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('textbox', { name: 'Special requests' });
    await expect(box).toHaveAccessibleDescription('We pass these to the airline; nothing is guaranteed.');
    await expect(box).toHaveAttribute('maxlength', '280');
  },
};
