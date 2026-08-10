import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Field } from '../field/field';
import { SearchIcon } from '../icons/icons';
import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Input } from './input';
import type { InputSize } from './input';

const meta = {
  title: 'Forms/Input',
  component: Input,
  parameters: { layout: 'padded' },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
    invalid: { control: 'boolean' },
  },
  args: { 'aria-label': 'Booking reference', placeholder: 'e.g. NX-4821' },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

const SIZES: readonly InputSize[] = ['sm', 'md', 'lg'];

export const Default: Story = {
  args: { onValueChange: fn() },
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Booking reference' });

    await userEvent.type(input, 'NX-4821');
    await expect(input).toHaveValue('NX-4821');
    // The value is reported once per keystroke, so the last call carries the whole string.
    await expect(args.onValueChange).toHaveBeenLastCalledWith('NX-4821');
  },
};

export const Sizes: Story = {
  render: () => (
    <Stack gap={3}>
      {SIZES.map((size) => (
        <Input key={size} size={size} aria-label={`Reference (${size})`} placeholder={size} />
      ))}
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const small = canvas.getByRole('textbox', { name: 'Reference (sm)' });
    const large = canvas.getByRole('textbox', { name: 'Reference (lg)' });

    // The box grows, not just the text: the shell owns the height, so a size change has to
    // reach the element the user actually clicks.
    const smallBox = small.closest('div')?.getBoundingClientRect();
    const largeBox = large.closest('div')?.getBoundingClientRect();
    await expect(smallBox?.height).toBeLessThan(largeBox?.height ?? 0);
  },
};

/** Slots sit inside the box, so the border and the focus ring enclose them with the value. */
export const WithSlots: Story = {
  render: () => (
    <Stack gap={3}>
      <Input aria-label="Search bookings" placeholder="Search" prefix={<SearchIcon />} />
      <Input aria-label="Baggage allowance" defaultValue="23" suffix={<span>kg</span>} />
      <Input aria-label="Fare" defaultValue="240.00" prefix={<span>£</span>} suffix={<span>GBP</span>} />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const fare = canvas.getByRole('textbox', { name: 'Fare' });
    const shell = fare.closest('div');

    // Clicking the input still focuses it with the slots present, and the ring is on the shell.
    await userEvent.click(fare);
    await expect(fare).toHaveFocus();
    await expect(shell).toHaveTextContent('£');
    await expect(shell).toHaveTextContent('GBP');
  },
};

/**
 * `invalid` is for a control outside a `Field`. It sets `aria-invalid`, which is both what a
 * screen reader announces and what the stylesheet keys off — there is no second, private class
 * that could disagree with the announcement.
 */
export const Invalid: Story = {
  args: { invalid: true, defaultValue: 'NX-48' },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Booking reference' });
    await expect(input).toHaveAttribute('aria-invalid', 'true');
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: 'NX-4821' },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Booking reference' });
    await expect(input).toBeDisabled();

    await userEvent.type(input, 'nope');
    await expect(input).toHaveValue('NX-4821');
  },
};

export const ReadOnly: Story = {
  args: { readOnly: true, defaultValue: 'NX-4821' },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Booking reference' });

    // Read-only differs from disabled in the one way that matters: it is still reachable, so the
    // value can be selected and copied.
    await userEvent.tab();
    await expect(input).toHaveFocus();
    await userEvent.type(input, 'nope');
    await expect(input).toHaveValue('NX-4821');
  },
};

/** The ring is drawn on the shell, which is why it survives a pointer click on a slot. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Booking reference' });
    await userEvent.tab();
    await expect(input).toHaveFocus();
  },
};

/** An empty control shows its placeholder, which is a hint and never a label. */
export const Empty: Story = {
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Booking reference' });
    await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('placeholder', 'e.g. NX-4821');
    // The placeholder is not the name. If it were, the field would be nameless the moment
    // somebody typed into it.
    await expect(input).toHaveAccessibleName('Booking reference');
  },
};

/**
 * A value longer than the box scrolls inside it; the field never grows sideways.
 *
 * The width is pinned by the wrapper rather than left to the viewport. Overflow is a relationship
 * between the value and the box, so a story that asserts overflow while letting the layout pick
 * the box is really asserting the size of the window it runs in — at the padded default the
 * control is over a thousand pixels wide and this value fits inside it, which is a passing test
 * that proves nothing and a failing one that means nothing.
 */
export const LongValue: Story = {
  args: {
    defaultValue: 'NX-4821-CONNECTING-VIA-AMSTERDAM-SCHIPHOL-RETURNING-TUESDAY-EVENING-SEAT-14A',
  },
  render: (args) => (
    <div style={{ inlineSize: '14rem' }}>
      <Input {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Booking reference' });
    const shell = input.closest('div');
    await expect(input.scrollWidth).toBeGreaterThan(input.clientWidth);
    await expect(shell?.scrollWidth).toBe(shell?.clientWidth);
  },
};

/** The composition this component exists for: named, described and validated by its field. */
export const InAField: Story = {
  render: () => (
    <Field.Root name="reference">
      <Field.Label>Booking reference</Field.Label>
      <Input placeholder="e.g. NX-4821" required />
      <Field.Description>Six characters, printed on your confirmation email.</Field.Description>
      <Field.Error match="valueMissing">Please enter your booking reference.</Field.Error>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // No `id`, no `htmlFor`, no `aria-describedby` written by hand: the field wires all three.
    const input = canvas.getByRole('textbox', { name: 'Booking reference' });
    await expect(input).toHaveAccessibleDescription('Six characters, printed on your confirmation email.');
  },
};

/** Several fields in a column, which is the only place the default full width makes sense. */
export const InAStack: Story = {
  render: () => (
    <Stack gap={4}>
      <Text as="h3" size="lg" weight="semibold">
        Passenger
      </Text>
      <Field.Root name="given">
        <Field.Label>Given name</Field.Label>
        <Input />
      </Field.Root>
      <Field.Root name="family">
        <Field.Label>Family name</Field.Label>
        <Input />
      </Field.Root>
      <Field.Root name="email">
        <Field.Label>Email</Field.Label>
        <Input type="email" placeholder="you@example.com" />
      </Field.Root>
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole('textbox', { name: 'Given name' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('textbox', { name: 'Family name' })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('textbox', { name: 'Email' })).toHaveFocus();
  },
};
