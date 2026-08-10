import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Stack } from '../stack/stack';
import { Surface } from '../surface/surface';
import { Text } from '../text/text';
import { Meter } from './meter';
import type { MeterTone } from './meter';

const meta = {
  title: 'Feedback/Meter',
  component: Meter.Root,
  parameters: { layout: 'padded' },
  args: { value: 72, label: 'Storage used' },
} satisfies Meta<typeof Meter.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const TONES: readonly MeterTone[] = ['accent', 'success', 'warning', 'danger'];

export const Default: Story = {
  render: (args) => (
    <Meter.Root {...args}>
      <Meter.Label>Storage used</Meter.Label>
      <Meter.Track>
        <Meter.Indicator />
      </Meter.Track>
      <Meter.Value />
    </Meter.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // `meter`, not `progressbar`. The distinction is the whole reason this component exists
    // alongside Progress, and it is the one thing a refactor could silently undo.
    const meter = canvas.getByRole('meter', { name: 'Storage used' });
    await expect(meter).toHaveAttribute('aria-valuenow', '72');
    await expect(canvas.queryByRole('progressbar')).toBeNull();
  },
};

export const Tones: Story = {
  render: () => (
    <Stack gap={6}>
      {TONES.map((tone, index) => (
        <Meter.Root key={tone} tone={tone} value={(index + 1) * 22} label={`${tone} meter`}>
          <Meter.Label>{tone}</Meter.Label>
          <Meter.Track>
            <Meter.Indicator />
          </Meter.Track>
          <Meter.Value />
        </Meter.Root>
      ))}
    </Stack>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Stack gap={6}>
      <Meter.Root size="sm" value={45} label="Small">
        <Meter.Label>sm</Meter.Label>
        <Meter.Track>
          <Meter.Indicator />
        </Meter.Track>
        <Meter.Value />
      </Meter.Root>
      <Meter.Root size="md" value={45} label="Medium">
        <Meter.Label>md</Meter.Label>
        <Meter.Track>
          <Meter.Indicator />
        </Meter.Track>
        <Meter.Value />
      </Meter.Root>
    </Stack>
  ),
};

/** The two ends of the range. Neither is a special case in the markup — only in what it says. */
export const Extremes: Story = {
  render: () => (
    <Stack gap={6}>
      <Meter.Root value={0} label="Seats taken">
        <Meter.Label>Empty</Meter.Label>
        <Meter.Track>
          <Meter.Indicator />
        </Meter.Track>
        <Meter.Value />
      </Meter.Root>
      <Meter.Root value={100} tone="danger" label="Seats taken, sold out">
        <Meter.Label>Sold out</Meter.Label>
        <Meter.Track>
          <Meter.Indicator />
        </Meter.Track>
        <Meter.Value />
      </Meter.Root>
    </Stack>
  ),
};

/**
 * A value outside `[min, max]` is clamped for the announcement, the formatted text and the fill
 * together, so the three can never disagree — a bad reading from upstream produces a full bar,
 * not a bar that says 122% while it draws 100%.
 */
export const Clamped: Story = {
  args: { value: 9800, min: 0, max: 8000, label: 'Steps today' },
  render: (args) => (
    <Meter.Root {...args}>
      <Meter.Label>Steps today</Meter.Label>
      <Meter.Track>
        <Meter.Indicator />
      </Meter.Track>
      <Meter.Value />
    </Meter.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const meter = canvas.getByRole('meter', { name: 'Steps today' });
    await expect(meter).toHaveAttribute('aria-valuenow', '8000');
    await expect(canvas.getByText('100%')).toBeInTheDocument();
  },
};

/**
 * `format` and `locale` go straight to `Intl.NumberFormat`, so the visible text is a real quantity
 * rather than a percentage of a total the reader was never shown. The locale is pinned here
 * because a story that formats against the runner's locale is a story that fails in another
 * timezone (ADR 0031).
 */
export const Formatted: Story = {
  args: {
    value: 1240,
    max: 2000,
    label: 'Spend against budget',
    locale: 'en-GB',
    format: { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 },
  },
  render: (args) => (
    <Meter.Root {...args}>
      <Meter.Label>Spend against budget</Meter.Label>
      <Meter.Track>
        <Meter.Indicator />
      </Meter.Track>
      <Meter.Value />
    </Meter.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('meter', { name: 'Spend against budget' })).toBeInTheDocument();
    await expect(canvas.getByText(/1,240/)).toBeInTheDocument();
  },
};

/** The label wraps; the value column does not. */
export const LongLabel: Story = {
  render: () => (
    <Surface padding="md" radius="lg">
      <Stack gap={3}>
        <Meter.Root value={88} tone="warning" label="Monthly API quota">
          <Meter.Label>Monthly API quota consumed across every environment in this organisation</Meter.Label>
          <Meter.Track>
            <Meter.Indicator />
          </Meter.Track>
          <Meter.Value />
        </Meter.Root>
        <Text size="xs" tone="secondary">
          Tone is a prop, not a threshold this component guesses at.
        </Text>
      </Stack>
    </Surface>
  ),
};
