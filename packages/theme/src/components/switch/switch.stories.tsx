import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactElement } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Field } from '../field/field';
import { Stack } from '../stack/stack';
import { Switch } from './switch';
import type { SwitchRootProps } from './switch';

const meta = {
  title: 'Forms/Switch',
  component: Switch.Root,
  parameters: { layout: 'padded' },
  argTypes: {
    disabled: { control: 'boolean' },
    readOnly: { control: 'boolean' },
  },
} satisfies Meta<typeof Switch.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The label wraps the track, so the words are part of the target and part of the name. */
function LabelledSwitch({
  label,
  description,
  ...props
}: SwitchRootProps & { label: string; description?: string }): ReactElement {
  return (
    <Field.Root>
      <Field.Label>
        <Switch.Root {...props}>
          <Switch.Thumb />
        </Switch.Root>
        {label}
      </Field.Label>
      {description ? <Field.Description>{description}</Field.Description> : null}
    </Field.Root>
  );
}

export const Default: Story = {
  args: { onCheckedChange: fn() },
  render: (args) => <LabelledSwitch label="Fare alerts" {...args} />,
  play: async ({ args, canvasElement }) => {
    const control = within(canvasElement).getByRole('switch', { name: 'Fare alerts' });

    // `role="switch"`, not `checkbox`. The difference is the promise: a switch takes effect now,
    // a checkbox takes effect on submit.
    await expect(control).not.toBeChecked();
    await userEvent.click(control);
    await expect(control).toBeChecked();
    await expect(args.onCheckedChange).toHaveBeenLastCalledWith(true, expect.anything());
  },
};

export const On: Story = {
  args: { defaultChecked: true },
  render: (args) => <LabelledSwitch label="Fare alerts" {...args} />,
  play: async ({ canvasElement }) => {
    const control = within(canvasElement).getByRole('switch', { name: 'Fare alerts' });
    await expect(control).toBeChecked();
    await expect(control).toHaveAttribute('data-checked');
  },
};

/** Both positions together, because a switch is only legible against its other state. */
export const States: Story = {
  render: () => (
    <Stack gap={3}>
      <LabelledSwitch label="Off" />
      <LabelledSwitch label="On" defaultChecked />
      <LabelledSwitch label="Off and disabled" disabled />
      <LabelledSwitch label="On and disabled" defaultChecked disabled />
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('switch', { name: 'Off' })).not.toBeChecked();
    await expect(canvas.getByRole('switch', { name: 'On' })).toBeChecked();
    await expect(canvas.getByRole('switch', { name: 'On and disabled' })).toBeChecked();
    await expect(canvas.getByRole('switch', { name: 'Off and disabled' })).toHaveAttribute('data-disabled');
  },
};

export const WithDescription: Story = {
  render: () => (
    <LabelledSwitch
      label="Fare alerts"
      description="We email you when the price on a saved route drops."
      defaultChecked
    />
  ),
  play: async ({ canvasElement }) => {
    const control = within(canvasElement).getByRole('switch', { name: 'Fare alerts' });
    await expect(control).toHaveAccessibleDescription('We email you when the price on a saved route drops.');
  },
};

export const Disabled: Story = {
  args: { disabled: true, onCheckedChange: fn() },
  render: (args) => <LabelledSwitch label="Fare alerts" {...args} />,
  play: async ({ args, canvasElement }) => {
    const control = within(canvasElement).getByRole('switch', { name: 'Fare alerts' });

    await userEvent.click(control);
    await expect(control).not.toBeChecked();
    await expect(args.onCheckedChange).not.toHaveBeenCalled();
  },
};

/** Read-only keeps the switch reachable and announced, and refuses the change. */
export const ReadOnly: Story = {
  args: { readOnly: true, defaultChecked: true },
  render: (args) => <LabelledSwitch label="Fare alerts" {...args} />,
  play: async ({ canvasElement }) => {
    const control = within(canvasElement).getByRole('switch', { name: 'Fare alerts' });

    await userEvent.tab();
    await expect(control).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(control).toBeChecked();
  },
};

/** Space toggles it, which is the keyboard contract for a switch. */
export const Keyboard: Story = {
  render: () => <LabelledSwitch label="Fare alerts" />,
  play: async ({ canvasElement }) => {
    const control = within(canvasElement).getByRole('switch', { name: 'Fare alerts' });

    await userEvent.tab();
    await expect(control).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(control).toBeChecked();
    await userEvent.keyboard(' ');
    await expect(control).not.toBeChecked();
  },
};

export const Invalid: Story = {
  render: () => (
    <Field.Root name="consent" invalid>
      <Field.Label>
        <Switch.Root required>
          <Switch.Thumb />
        </Switch.Root>
        Share my itinerary with the group organiser
      </Field.Label>
      <Field.Error match>The organiser needs this to hold the group booking.</Field.Error>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole('switch', {
      name: 'Share my itinerary with the group organiser',
    });

    await expect(control).toHaveAttribute('data-invalid');
    await expect(control).toHaveAccessibleDescription('The organiser needs this to hold the group booking.');
  },
};

/** A long label wraps beside the track, and the track keeps its width. */
export const LongLabel: Story = {
  render: () => (
    <div style={{ maxWidth: '18rem' }}>
      <LabelledSwitch label="Let the airline text me about gate changes, delays and cancellations for this trip" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const control = canvas.getByRole('switch', { name: /Let the airline text me/ });
    const box = control.getBoundingClientRect();

    // 2.5rem × 1.5rem, whatever the label does around it.
    await expect(Math.round(box.width)).toBe(40);
    await expect(Math.round(box.height)).toBe(24);
  },
};
