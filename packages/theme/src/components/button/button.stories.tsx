import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from './button';

const meta = {
  title: 'Components/Button',
  component: Button,
  argTypes: {
    variant: { control: 'inline-radio', options: ['solid', 'outline', 'ghost'] },
    tone: { control: 'inline-radio', options: ['accent', 'neutral', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
  args: { children: 'Continue' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * The full axis matrix. `variant` sets visual weight and `tone` sets which semantic colour
 * family that weight is drawn from — the two are orthogonal, which is why nine combinations
 * come out of six rule blocks rather than nine hand-written pairs.
 */
export const Matrix: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, max-content)', gap: '0.75rem' }}>
      {(['solid', 'outline', 'ghost'] as const).flatMap((variant) =>
        (['accent', 'neutral', 'danger'] as const).map((tone) => (
          <Button key={`${variant}-${tone}`} variant={variant} tone={tone}>
            {variant} · {tone}
          </Button>
        )),
      )}
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};

export const Disabled: Story = { args: { disabled: true } };

export const FullWidth: Story = {
  args: { fullWidth: true },
  parameters: { layout: 'padded' },
};

/**
 * Long labels do not wrap — a button that reflows to three lines destroys a toolbar's rhythm.
 * The label is expected to be truncated by its container instead.
 */
export const LongLabel: Story = {
  args: { children: 'Send this rather long confirmation message to the assistant' },
  parameters: { layout: 'padded' },
};

/**
 * `render` swaps the element without changing the paint (ADR 0021 / 0026). This is the escape
 * hatch that exists precisely so `className` does not have to.
 */
export const AsLink: Story = {
  args: { render: <a href="https://example.com">Open the docs</a> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole('link', { name: 'Open the docs' });
    await expect(link).toHaveAttribute('href', 'https://example.com');
  },
};

export const Clickable: Story = {
  args: { children: 'Confirm' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Confirm' });

    // `type` defaults to 'button', not the HTML default of 'submit'. A widget button inside a
    // consumer's form would otherwise submit it — a bug that only ever appears in their app.
    await expect(button).toHaveAttribute('type', 'button');

    await userEvent.tab();
    await expect(button).toHaveFocus();
  },
};
