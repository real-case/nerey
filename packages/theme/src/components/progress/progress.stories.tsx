import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Stack } from '../stack/stack';
import { Surface } from '../surface/surface';
import { Text } from '../text/text';
import { Progress } from './progress';
import type { ProgressTone } from './progress';

const meta = {
  title: 'Feedback/Progress',
  component: Progress.Root,
  parameters: { layout: 'padded' },
  args: { value: 65, label: 'Uploading' },
} satisfies Meta<typeof Progress.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const TONES: readonly ProgressTone[] = ['accent', 'success', 'warning', 'danger'];

export const Default: Story = {
  render: (args) => (
    <Progress.Root {...args}>
      <Progress.Label>Uploading</Progress.Label>
      <Progress.Track>
        <Progress.Indicator />
      </Progress.Track>
      <Progress.Value />
    </Progress.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The three things Base UI is here to supply, asserted rather than assumed: the role, the
    // value triple, and the name — which is the one axe fails the build over
    // (`aria-progressbar-name`, WCAG 1.1.1, ADR 0032).
    const bar = canvas.getByRole('progressbar', { name: 'Uploading' });
    await expect(bar).toHaveAttribute('aria-valuenow', '65');
    await expect(bar).toHaveAttribute('aria-valuemin', '0');
    await expect(bar).toHaveAttribute('aria-valuemax', '100');
  },
};

/** A bar with no visible label is still named, because `label` is not optional. */
export const TrackOnly: Story = {
  args: { label: 'Rendering the itinerary' },
  render: (args) => (
    <Progress.Root {...args}>
      <Progress.Track>
        <Progress.Indicator />
      </Progress.Track>
    </Progress.Root>
  ),
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('progressbar', {
      name: 'Rendering the itinerary',
    });
    await expect(bar).toBeInTheDocument();
  },
};

export const Tones: Story = {
  render: () => (
    <Stack gap={6}>
      {TONES.map((tone, index) => (
        <Progress.Root key={tone} tone={tone} value={(index + 1) * 22} label={`${tone} progress`}>
          <Progress.Label>{tone}</Progress.Label>
          <Progress.Track>
            <Progress.Indicator />
          </Progress.Track>
          <Progress.Value />
        </Progress.Root>
      ))}
    </Stack>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Stack gap={6}>
      <Progress.Root size="sm" value={40} label="Small">
        <Progress.Label>sm</Progress.Label>
        <Progress.Track>
          <Progress.Indicator />
        </Progress.Track>
        <Progress.Value />
      </Progress.Root>
      <Progress.Root size="md" value={40} label="Medium">
        <Progress.Label>md</Progress.Label>
        <Progress.Track>
          <Progress.Indicator />
        </Progress.Track>
        <Progress.Value />
      </Progress.Root>
    </Stack>
  ),
};

/**
 * `value={null}`. The bar travels because the total is unknown; under a reduced-motion preference
 * it stops travelling and pulses in place instead, since the movement was the message.
 */
export const Indeterminate: Story = {
  args: { value: null, label: 'Waiting for the provider' },
  render: (args) => (
    <Progress.Root {...args}>
      <Progress.Label>Waiting for the provider</Progress.Label>
      <Progress.Track>
        <Progress.Indicator />
      </Progress.Track>
      <Progress.Value />
    </Progress.Root>
  ),
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('progressbar', {
      name: 'Waiting for the provider',
    });
    // An indeterminate progressbar must NOT carry a value, and Base UI's own state attribute is
    // what the stylesheet keys off — both are worth pinning, because either one changing silently
    // is a bar that lies about what it knows.
    await expect(bar).not.toHaveAttribute('aria-valuenow');
    await expect(bar).toHaveAttribute('data-indeterminate');
  },
};

export const Complete: Story = {
  args: { value: 100, tone: 'success', label: 'Booking confirmed' },
  render: (args) => (
    <Progress.Root {...args}>
      <Progress.Label>Booking confirmed</Progress.Label>
      <Progress.Track>
        <Progress.Indicator />
      </Progress.Track>
      <Progress.Value />
    </Progress.Root>
  ),
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('progressbar', { name: 'Booking confirmed' });
    await expect(bar).toHaveAttribute('data-complete');
  },
};

/**
 * `min` / `max` describe the real quantity and the formatted value follows, so the reader sees
 * megabytes rather than a percentage of something they were never told the size of.
 */
export const CustomRange: Story = {
  args: { value: 184, min: 0, max: 512, label: 'Downloading the archive' },
  render: (args) => (
    <Progress.Root {...args}>
      <Progress.Label>Downloading the archive</Progress.Label>
      <Progress.Track>
        <Progress.Indicator />
      </Progress.Track>
      <Progress.Value>{(_formatted, value) => `${value ?? 0} / 512 MB`}</Progress.Value>
    </Progress.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = canvas.getByRole('progressbar', { name: 'Downloading the archive' });
    await expect(bar).toHaveAttribute('aria-valuemax', '512');
    await expect(canvas.getByText('184 / 512 MB')).toBeInTheDocument();
  },
};

/** The label wraps and the value stays pinned to the end of its row rather than being pushed off. */
export const LongLabel: Story = {
  render: () => (
    <Surface padding="md" radius="lg">
      <Stack gap={3}>
        <Progress.Root value={31} label="Reconciling ledger entries">
          <Progress.Label>
            Reconciling ledger entries against the counterparty statement for July
          </Progress.Label>
          <Progress.Track>
            <Progress.Indicator />
          </Progress.Track>
          <Progress.Value />
        </Progress.Root>
        <Text size="xs" tone="secondary">
          The value column never wraps; the label column gives way first.
        </Text>
      </Stack>
    </Surface>
  ),
};
