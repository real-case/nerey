import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Field } from '../field/field';
import { Stack } from '../stack/stack';
import { Checkbox, CheckboxGroup } from './checkbox';
import type { CheckboxRootProps } from './checkbox';

const meta = {
  title: 'Forms/Checkbox',
  component: Checkbox.Root,
  parameters: { layout: 'padded' },
  argTypes: {
    indeterminate: { control: 'boolean' },
    disabled: { control: 'boolean' },
    readOnly: { control: 'boolean' },
  },
} satisfies Meta<typeof Checkbox.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const EXTRAS = ['bag', 'seat', 'insurance'];

/** The label wraps the box, so the words are part of the target and part of the name. */
function LabelledCheckbox({ label, ...props }: CheckboxRootProps & { label: string }): ReactElement {
  return (
    <Field.Root>
      <Field.Label>
        <Checkbox.Root {...props}>
          <Checkbox.Indicator />
        </Checkbox.Root>
        {label}
      </Field.Label>
    </Field.Root>
  );
}

export const Default: Story = {
  args: { onCheckedChange: fn() },
  render: (args) => <LabelledCheckbox label="Add a checked bag" {...args} />,
  play: async ({ args, canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: 'Add a checked bag' });

    await expect(box).not.toBeChecked();
    await userEvent.click(box);
    await expect(box).toBeChecked();
    await expect(args.onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything());
  },
};

export const Checked: Story = {
  args: { defaultChecked: true },
  render: (args) => <LabelledCheckbox label="Add a checked bag" {...args} />,
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: 'Add a checked bag' });
    await expect(box).toBeChecked();
    await expect(box).toHaveAttribute('data-checked');
  },
};

/**
 * Indeterminate is a third state, not a variation of checked, and it is drawn as one: a tinted
 * box with an accent dash rather than a filled box with a different mark. Reading it as "checked"
 * costs the user a click on a control that then does the opposite of what they expected.
 */
export const Indeterminate: Story = {
  args: { indeterminate: true },
  render: (args) => <LabelledCheckbox label="All extras" {...args} />,
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: 'All extras' });

    await expect(box).toHaveAttribute('aria-checked', 'mixed');
    await expect(box).toHaveAttribute('data-indeterminate');
    // The indicator is mounted even though the box is not ticked, and it shows the dash.
    await expect(box.querySelector('svg')).toBeInTheDocument();
  },
};

/** The three states side by side, which is the only way to check they are distinguishable. */
export const States: Story = {
  render: () => (
    <Stack gap={3}>
      <LabelledCheckbox label="Unticked" />
      <LabelledCheckbox label="Ticked" defaultChecked />
      <LabelledCheckbox label="Mixed" indeterminate />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('checkbox', { name: 'Unticked' })).toHaveAttribute('aria-checked', 'false');
    await expect(canvas.getByRole('checkbox', { name: 'Ticked' })).toHaveAttribute('aria-checked', 'true');
    await expect(canvas.getByRole('checkbox', { name: 'Mixed' })).toHaveAttribute('aria-checked', 'mixed');
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultChecked: true, onCheckedChange: fn() },
  render: (args) => <LabelledCheckbox label="Add a checked bag" {...args} />,
  play: async ({ args, canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: 'Add a checked bag' });

    await userEvent.click(box);
    await expect(box).toBeChecked();
    await expect(args.onCheckedChange).not.toHaveBeenCalled();
  },
};

/** Read-only differs from disabled in the way that matters: it is still reachable by keyboard. */
export const ReadOnly: Story = {
  args: { readOnly: true, defaultChecked: true },
  render: (args) => <LabelledCheckbox label="Add a checked bag" {...args} />,
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: 'Add a checked bag' });

    await userEvent.tab();
    await expect(box).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(box).toBeChecked();
  },
};

/** Invalidity comes from the field, and the box picks it up from `data-invalid` (ADR 0022). */
export const Invalid: Story = {
  render: () => (
    <Field.Root name="terms" invalid>
      <Field.Label>
        <Checkbox.Root required>
          <Checkbox.Indicator />
        </Checkbox.Root>
        I accept the fare conditions
      </Field.Label>
      <Field.Error match>You have to accept the fare conditions to continue.</Field.Error>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole('checkbox', { name: 'I accept the fare conditions' });

    await expect(box).toHaveAttribute('data-invalid');
    await expect(box).toHaveAccessibleDescription('You have to accept the fare conditions to continue.');
  },
};

export const Focused: Story = {
  render: () => <LabelledCheckbox label="Add a checked bag" />,
  play: async ({ canvasElement }) => {
    const box = within(canvasElement).getByRole('checkbox', { name: 'Add a checked bag' });
    await userEvent.tab();
    await expect(box).toHaveFocus();
  },
};

/** A group shares state and takes its name from the field around it. */
export const Group: Story = {
  render: () => (
    <Field.Root name="extras">
      <Field.Label>Extras</Field.Label>
      <CheckboxGroup defaultValue={['bag']}>
        {EXTRAS.map((value) => (
          <Field.Item key={value}>
            <Field.Label>
              <Checkbox.Root value={value}>
                <Checkbox.Indicator />
              </Checkbox.Root>
              {value}
            </Field.Label>
          </Field.Item>
        ))}
      </CheckboxGroup>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('group', { name: 'Extras' })).toBeInTheDocument();
    await expect(canvas.getByRole('checkbox', { name: 'bag' })).toBeChecked();

    await userEvent.click(canvas.getByRole('checkbox', { name: 'seat' }));
    await expect(canvas.getByRole('checkbox', { name: 'seat' })).toBeChecked();
    await expect(canvas.getByRole('checkbox', { name: 'insurance' })).not.toBeChecked();
  },
};

/**
 * A parent box, which is where the third state earns its keep: it is the only honest answer when
 * some children are ticked. `allValues` is what tells the group what "all" means.
 */
export const ParentCheckbox: Story = {
  render: () => (
    <Field.Root name="extras">
      <Field.Label>Extras</Field.Label>
      <CheckboxGroup allValues={EXTRAS} defaultValue={['bag']}>
        <Field.Item>
          <Field.Label>
            <Checkbox.Root parent>
              <Checkbox.Indicator />
            </Checkbox.Root>
            All extras
          </Field.Label>
        </Field.Item>
        {EXTRAS.map((value) => (
          <Field.Item key={value}>
            <Field.Label>
              <Checkbox.Root value={value}>
                <Checkbox.Indicator />
              </Checkbox.Root>
              {value}
            </Field.Label>
          </Field.Item>
        ))}
      </CheckboxGroup>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const parent = canvas.getByRole('checkbox', { name: 'All extras' });

    // One of three ticked, so the parent is mixed rather than lying in either direction.
    await expect(parent).toHaveAttribute('aria-checked', 'mixed');

    await userEvent.click(parent);
    for (const value of EXTRAS) {
      await expect(canvas.getByRole('checkbox', { name: value })).toBeChecked();
    }
    await expect(parent).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(parent);
    for (const value of EXTRAS) {
      await expect(canvas.getByRole('checkbox', { name: value })).not.toBeChecked();
    }
  },
};

/** A long label wraps beside the box rather than under it: the box never leaves the first line. */
export const LongLabel: Story = {
  render: () => (
    <div style={{ maxWidth: '18rem' }}>
      <Field.Root name="marketing">
        <Field.Label>
          <Checkbox.Root>
            <Checkbox.Indicator />
          </Checkbox.Root>
          Email me about fare drops, seat sales and schedule changes on routes I have flown before
        </Field.Label>
      </Field.Root>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = canvas.getByRole('checkbox', {
      name: /Email me about fare drops/,
    });
    const label = box.closest('label');

    // The label is taller than one line and the box has kept its square shape inside it.
    await expect(label?.getBoundingClientRect().height ?? 0).toBeGreaterThan(
      box.getBoundingClientRect().height,
    );
    await expect(Math.round(box.getBoundingClientRect().width)).toBe(
      Math.round(box.getBoundingClientRect().height),
    );
  },
};
