import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Field } from '../field/field';
import { Radio, RadioGroup } from './radio-group';

const meta = {
  title: 'Forms/RadioGroup',
  component: RadioGroup,
  parameters: { layout: 'padded' },
  argTypes: {
    disabled: { control: 'boolean' },
    readOnly: { control: 'boolean' },
  },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const CABINS = [
  { value: 'economy', label: 'Economy', hint: 'One bag, standard seat.' },
  { value: 'premium', label: 'Premium economy', hint: 'Extra legroom, priority boarding.' },
  { value: 'business', label: 'Business', hint: 'Lie-flat seat, lounge access.' },
];

export const Default: Story = {
  args: { defaultValue: 'economy', onValueChange: fn() },
  render: (args) => (
    <Field.Root name="cabin">
      <Field.Label>Cabin</Field.Label>
      <RadioGroup {...args}>
        {CABINS.map((cabin) => (
          <Field.Item key={cabin.value}>
            <Field.Label>
              <Radio.Root value={cabin.value}>
                <Radio.Indicator />
              </Radio.Root>
              {cabin.label}
            </Field.Label>
          </Field.Item>
        ))}
      </RadioGroup>
    </Field.Root>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // The group is named by the field's label; each radio is named by its own item label.
    await expect(canvas.getByRole('radiogroup', { name: 'Cabin' })).toBeInTheDocument();
    await expect(canvas.getByRole('radio', { name: 'Economy' })).toBeChecked();

    await userEvent.click(canvas.getByRole('radio', { name: 'Business' }));
    await expect(canvas.getByRole('radio', { name: 'Business' })).toBeChecked();
    await expect(canvas.getByRole('radio', { name: 'Economy' })).not.toBeChecked();
    await expect(args.onValueChange).toHaveBeenLastCalledWith('business', expect.anything());
  },
};

/** Each row can carry its own footnote, which `Field.Item` attaches to that radio alone. */
export const WithDescriptions: Story = {
  render: () => (
    <Field.Root name="cabin">
      <Field.Label>Cabin</Field.Label>
      <RadioGroup defaultValue="premium">
        {CABINS.map((cabin) => (
          <Field.Item key={cabin.value}>
            <Field.Label>
              <Radio.Root value={cabin.value}>
                <Radio.Indicator />
              </Radio.Root>
              {cabin.label}
            </Field.Label>
            <Field.Description>{cabin.hint}</Field.Description>
          </Field.Item>
        ))}
      </RadioGroup>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('radio', { name: 'Business' })).toHaveAccessibleDescription(
      'Lie-flat seat, lounge access.',
    );
  },
};

/**
 * A radio group is one tab stop, and the arrow keys move within it. That is the behaviour a
 * hand-rolled group almost always loses, and losing it makes the whole group unusable by
 * keyboard — every option becomes a stop on the way to the submit button.
 */
export const KeyboardNavigation: Story = {
  render: () => (
    <Field.Root name="cabin">
      <Field.Label>Cabin</Field.Label>
      <RadioGroup defaultValue="economy">
        {CABINS.map((cabin) => (
          <Field.Item key={cabin.value}>
            <Field.Label>
              <Radio.Root value={cabin.value}>
                <Radio.Indicator />
              </Radio.Root>
              {cabin.label}
            </Field.Label>
          </Field.Item>
        ))}
      </RadioGroup>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: 'Economy' })).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('radio', { name: 'Premium economy' })).toHaveFocus();
    await expect(canvas.getByRole('radio', { name: 'Premium economy' })).toBeChecked();

    // Past the end it wraps, rather than dropping the user out of the group.
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    await expect(canvas.getByRole('radio', { name: 'Economy' })).toHaveFocus();
  },
};

/** Nothing chosen yet. The group is still one tab stop, landing on the first option. */
export const Empty: Story = {
  render: () => (
    <Field.Root name="cabin">
      <Field.Label>Cabin</Field.Label>
      <RadioGroup>
        {CABINS.map((cabin) => (
          <Field.Item key={cabin.value}>
            <Field.Label>
              <Radio.Root value={cabin.value}>
                <Radio.Indicator />
              </Radio.Root>
              {cabin.label}
            </Field.Label>
          </Field.Item>
        ))}
      </RadioGroup>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const cabin of CABINS) {
      await expect(canvas.getByRole('radio', { name: cabin.label })).not.toBeChecked();
    }
    await userEvent.tab();
    await expect(canvas.getByRole('radio', { name: 'Economy' })).toHaveFocus();
  },
};

export const Disabled: Story = {
  args: { defaultValue: 'economy', disabled: true, onValueChange: fn() },
  render: (args) => (
    <Field.Root name="cabin">
      <Field.Label>Cabin</Field.Label>
      <RadioGroup {...args}>
        {CABINS.map((cabin) => (
          <Field.Item key={cabin.value}>
            <Field.Label>
              <Radio.Root value={cabin.value}>
                <Radio.Indicator />
              </Radio.Root>
              {cabin.label}
            </Field.Label>
          </Field.Item>
        ))}
      </RadioGroup>
    </Field.Root>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: 'Business' }));
    await expect(canvas.getByRole('radio', { name: 'Economy' })).toBeChecked();
    await expect(args.onValueChange).not.toHaveBeenCalled();
  },
};

/** One option can be unavailable while the rest are not; the group stays usable. */
export const OneOptionDisabled: Story = {
  render: () => (
    <Field.Root name="cabin">
      <Field.Label>Cabin</Field.Label>
      <RadioGroup defaultValue="economy">
        {CABINS.map((cabin) => (
          <Field.Item key={cabin.value}>
            <Field.Label>
              <Radio.Root value={cabin.value} disabled={cabin.value === 'business'}>
                <Radio.Indicator />
              </Radio.Root>
              {cabin.label}
            </Field.Label>
          </Field.Item>
        ))}
      </RadioGroup>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const business = canvas.getByRole('radio', { name: 'Business' });

    await expect(business).toHaveAttribute('data-disabled');
    await userEvent.click(business);
    await expect(business).not.toBeChecked();
    await expect(canvas.getByRole('radio', { name: 'Economy' })).toBeChecked();
  },
};

/** Invalidity reaches every radio in the group through Base UI's own `data-invalid`. */
export const Invalid: Story = {
  render: () => (
    <Field.Root name="cabin" invalid>
      <Field.Label>Cabin</Field.Label>
      <RadioGroup required>
        {CABINS.map((cabin) => (
          <Field.Item key={cabin.value}>
            <Field.Label>
              <Radio.Root value={cabin.value}>
                <Radio.Indicator />
              </Radio.Root>
              {cabin.label}
            </Field.Label>
          </Field.Item>
        ))}
      </RadioGroup>
      <Field.Error match>Choose a cabin to continue.</Field.Error>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('radio', { name: 'Economy' })).toHaveAttribute('data-invalid');
    await expect(canvas.getByText('Choose a cabin to continue.')).toBeVisible();
  },
};

/** Long option labels wrap beside the dot rather than under it. */
export const LongLabels: Story = {
  render: () => (
    <div style={{ maxWidth: '18rem' }}>
      <Field.Root name="refund">
        <Field.Label>Refund method</Field.Label>
        <RadioGroup defaultValue="voucher">
          <Field.Item>
            <Field.Label>
              <Radio.Root value="voucher">
                <Radio.Indicator />
              </Radio.Root>
              Travel voucher, issued immediately and valid for twenty-four months from today
            </Field.Label>
          </Field.Item>
          <Field.Item>
            <Field.Label>
              <Radio.Root value="card">
                <Radio.Indicator />
              </Radio.Root>
              Back to the original card, which normally takes seven to ten working days
            </Field.Label>
          </Field.Item>
        </RadioGroup>
      </Field.Root>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const voucher = canvas.getByRole('radio', { name: /Travel voucher/ });
    const label = voucher.closest('label');

    await expect(label?.getBoundingClientRect().height ?? 0).toBeGreaterThan(
      voucher.getBoundingClientRect().height,
    );
    await expect(Math.round(voucher.getBoundingClientRect().width)).toBe(
      Math.round(voucher.getBoundingClientRect().height),
    );
  },
};
