import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Stack } from '../stack/stack';
import { Surface } from '../surface/surface';
import { Text } from '../text/text';
import { Separator } from './separator';

const meta = {
  title: 'Foundation/Separator',
  component: Separator,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  args: { orientation: 'horizontal' },
  render: (args) => (
    <Surface padding="md">
      <Stack gap={3}>
        <Text>Departure — 14:20</Text>
        <Separator {...args} />
        <Text>Arrival — 17:05</Text>
      </Stack>
    </Surface>
  ),
  play: async ({ canvasElement }) => {
    const separator = within(canvasElement).getByRole('separator');
    await expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
  },
};

/**
 * A vertical rule needs a parent with a height to stretch into. `align-self: stretch` is what
 * makes it work inside a centred toolbar, where the flex default would collapse it to nothing.
 */
export const Vertical: Story = {
  args: { orientation: 'vertical' },
  render: (args) => (
    <Surface variant="outline" padding="sm">
      <Stack direction="row" gap={3} align="center">
        <Text size="sm">Draft</Text>
        <Separator {...args} />
        <Text size="sm">In review</Text>
        <Separator orientation="vertical" />
        <Text size="sm">Published</Text>
      </Stack>
    </Surface>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const separators = canvas.getAllByRole('separator');
    await expect(separators).toHaveLength(2);
    for (const separator of separators) {
      await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
      // A vertical rule that collapsed to zero height is invisible but still passes a snapshot.
      await expect(separator.getBoundingClientRect().height).toBeGreaterThan(0);
    }
  },
};

/**
 * The labelled form. `separator` is not a name-from-content role, so the visible text alone
 * would reach no screen reader — the component sets `aria-label` from the same string.
 */
export const Labelled: Story = {
  args: { label: 'or' },
  render: (args) => (
    <Surface padding="md">
      <Stack gap={4}>
        <Text>Continue with the saved card</Text>
        <Separator {...args} />
        <Text>Enter a new payment method</Text>
      </Stack>
    </Surface>
  ),
  play: async ({ canvasElement }) => {
    const separator = within(canvasElement).getByRole('separator', { name: 'or' });
    await expect(separator).toHaveAttribute('aria-orientation', 'horizontal');
    await expect(separator).toHaveTextContent('or');
  },
};

/** A long label still lands in the middle, because both rules measure from zero. */
export const LongLabel: Story = {
  render: () => (
    <Surface padding="md">
      <Stack gap={4}>
        <Separator label="Everything below this point happened yesterday" />
        <Text>08:14 — Booking created</Text>
      </Stack>
    </Surface>
  ),
};

/** Grouping rows inside one panel — the case the component was actually built for. */
export const InAList: Story = {
  render: () => (
    <Surface padding="none" radius="lg">
      <Stack>
        <Surface variant="ghost" padding="sm">
          <Text size="sm">Seat 14A — window</Text>
        </Surface>
        <Separator />
        <Surface variant="ghost" padding="sm">
          <Text size="sm">Seat 14B — middle</Text>
        </Surface>
        <Separator />
        <Surface variant="ghost" padding="sm">
          <Text size="sm">Seat 14C — aisle</Text>
        </Surface>
      </Stack>
    </Surface>
  ),
};
