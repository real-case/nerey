import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { Checkbox, CheckboxGroup } from '../checkbox/checkbox';
import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Field } from './field';
import type { FieldControlSize } from './field';

const meta = {
  title: 'Forms/Field',
  component: Field.Root,
  parameters: { layout: 'padded' },
  args: { name: 'reference' },
} satisfies Meta<typeof Field.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const SIZES: readonly FieldControlSize[] = ['sm', 'md', 'lg'];

/**
 * The three ids a labelled control needs — the label's, the control's, the description's — are
 * generated and connected by the field. None of them appears in this story, which is the point.
 */
export const Default: Story = {
  render: (args) => (
    <Field.Root {...args}>
      <Field.Label>Booking reference</Field.Label>
      <Field.Control placeholder="e.g. NX-4821" />
      <Field.Description>Six characters, printed on your confirmation email.</Field.Description>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole('textbox', { name: 'Booking reference' });

    await expect(control).toHaveAccessibleDescription('Six characters, printed on your confirmation email.');
    // Clicking the label moves focus to the control — the association is real, not visual.
    await userEvent.click(canvas.getByText('Booking reference'));
    await expect(control).toHaveFocus();
  },
};

export const Sizes: Story = {
  render: () => (
    <Stack gap={3}>
      {SIZES.map((size) => (
        <Field.Root key={size} name={`reference-${size}`}>
          <Field.Label>{`Reference (${size})`}</Field.Label>
          <Field.Control size={size} />
        </Field.Root>
      ))}
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const small = canvas.getByRole('textbox', { name: 'Reference (sm)' });
    const large = canvas.getByRole('textbox', { name: 'Reference (lg)' });
    await expect(small.closest('div')?.getBoundingClientRect().height).toBeLessThan(
      large.closest('div')?.getBoundingClientRect().height ?? 0,
    );
  },
};

/**
 * `invalid` on the root is the seam for validity that is decided elsewhere — a server, a schema
 * run in an action, a form library. `match` on the error is `true` here for the same reason: the
 * message is shown because the caller says so, not because a native constraint fired.
 */
export const Invalid: Story = {
  render: () => (
    <Field.Root name="reference" invalid>
      <Field.Label>Booking reference</Field.Label>
      <Field.Control defaultValue="NX-48" />
      <Field.Error match>We could not find that reference.</Field.Error>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole('textbox', { name: 'Booking reference' });

    await expect(control).toHaveAttribute('data-invalid');
    await expect(control).toHaveAccessibleDescription('We could not find that reference.');
  },
};

/**
 * Two errors, one field. `match` narrows each to a single `ValidityState` reason, so the message
 * can say what is actually wrong instead of covering both cases badly.
 */
export const ValidationOnBlur: Story = {
  render: () => (
    <Field.Root name="email" validationMode="onBlur">
      <Field.Label>Email</Field.Label>
      <Field.Control type="email" required placeholder="you@example.com" />
      <Field.Error match="valueMissing">We need an email address.</Field.Error>
      <Field.Error match="typeMismatch">That does not look like an email address.</Field.Error>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole('textbox', { name: 'Email' });

    await userEvent.click(control);
    await userEvent.type(control, 'not-an-email');
    await userEvent.tab();

    await expect(canvas.getByText('That does not look like an email address.')).toBeVisible();
    await expect(canvas.queryByText('We need an email address.')).not.toBeInTheDocument();
    await expect(control).toHaveAttribute('data-invalid');
  },
};

/**
 * `Field.Validity` renders nothing itself; it hands the field's state to a function. This is the
 * escape hatch for anything the `Field.Error` vocabulary cannot say — a counter, a strength
 * meter, a progressive hint.
 */
export const CustomValidityMessage: Story = {
  render: () => (
    <Field.Root name="pin" validationMode="onChange">
      <Field.Label>Booking PIN</Field.Label>
      <Field.Control minLength={4} maxLength={4} placeholder="4 digits" />
      <Field.Validity>
        {(state) => {
          const typed = typeof state.value === 'string' ? state.value.length : 0;
          return (
            <Text size="sm" tone="secondary">
              {`${String(typed)} of 4 digits`}
            </Text>
          );
        }}
      </Field.Validity>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole('textbox', { name: 'Booking PIN' });

    await expect(canvas.getByText('0 of 4 digits')).toBeVisible();
    await userEvent.type(control, '12');
    await expect(canvas.getByText('2 of 4 digits')).toBeVisible();
  },
};

/**
 * `disabled` on the root wins over the control's own. The label steps down to
 * `--nerey-text-secondary` and no further: a label is text a sighted user still has to read to
 * learn what they cannot fill in, so it stays above the contrast floor (ADR 0032).
 */
export const Disabled: Story = {
  render: () => (
    <Field.Root name="reference" disabled>
      <Field.Label>Booking reference</Field.Label>
      <Field.Control defaultValue="NX-4821" />
      <Field.Description>Sign in to change this.</Field.Description>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole('textbox', { name: 'Booking reference' });
    await expect(control).toBeDisabled();
    await expect(control).toHaveAttribute('data-disabled');
  },
};

/** `render` swaps the element. The chrome, the label wiring and the validity state all stay. */
export const CustomControlElement: Story = {
  render: () => (
    <Field.Root name="cabin">
      <Field.Label>Cabin</Field.Label>
      <Field.Control
        render={
          <select defaultValue="economy">
            <option value="economy">Economy</option>
            <option value="premium">Premium economy</option>
            <option value="business">Business</option>
          </select>
        }
      />
      <Field.Description>Upgrades are offered at check-in.</Field.Description>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = canvas.getByRole('combobox', { name: 'Cabin' });
    await expect(select.tagName).toBe('SELECT');
    await expect(select).toHaveValue('economy');
  },
};

/**
 * `Field.Item` gives each row of a group its own label. Without it every label in the group
 * associates with the group's first control — a defect that looks perfect and reads as nonsense.
 */
export const GroupedItems: Story = {
  render: () => (
    <Field.Root name="extras">
      <Field.Label>Extras</Field.Label>
      <CheckboxGroup defaultValue={['bag']}>
        <Field.Item>
          <Field.Label>
            <Checkbox.Root value="bag">
              <Checkbox.Indicator />
            </Checkbox.Root>
            Checked bag
          </Field.Label>
          <Field.Description>23 kg, one per passenger.</Field.Description>
        </Field.Item>
        <Field.Item>
          <Field.Label>
            <Checkbox.Root value="seat">
              <Checkbox.Indicator />
            </Checkbox.Root>
            Seat selection
          </Field.Label>
          <Field.Description>Choose before check-in opens.</Field.Description>
        </Field.Item>
      </CheckboxGroup>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('group', { name: 'Extras' })).toBeInTheDocument();
    const bag = canvas.getByRole('checkbox', { name: 'Checked bag' });
    await expect(bag).toBeChecked();
    await expect(bag).toHaveAccessibleDescription('23 kg, one per passenger.');
    await expect(canvas.getByRole('checkbox', { name: 'Seat selection' })).not.toBeChecked();
  },
};

/** Long text wraps rather than pushing the control sideways; nothing here is `white-space: nowrap`. */
export const LongContent: Story = {
  render: () => (
    <div style={{ maxWidth: '20rem' }}>
      <Field.Root name="reference" invalid>
        <Field.Label>
          Booking reference, exactly as it appears on the confirmation email we sent you
        </Field.Label>
        <Field.Control defaultValue="NX-48" />
        <Field.Description>
          If you booked through a travel agent the reference may be theirs rather than ours; check the top
          right of the itinerary before you try again.
        </Field.Description>
        <Field.Error match>
          We could not find that reference on any booking in the last twenty-four months.
        </Field.Error>
      </Field.Root>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole('textbox', {
      name: 'Booking reference, exactly as it appears on the confirmation email we sent you',
    });
    // The field wraps its text instead of widening: the control still fits its container.
    await expect(control.getBoundingClientRect().width).toBeLessThanOrEqual(320);
  },
};
