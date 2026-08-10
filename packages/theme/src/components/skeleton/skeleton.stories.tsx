import type { CSSProperties } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Stack } from '../stack/stack';
import { Surface } from '../surface/surface';
import { Text } from '../text/text';
import { Skeleton } from './skeleton';

const meta = {
  title: 'Foundation/Skeleton',
  component: Skeleton,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Surface padding="md">
      <Skeleton />
    </Surface>
  ),
};

export const Variants: Story = {
  render: () => (
    <Stack gap={4}>
      <Stack gap={1}>
        <Text size="xs" tone="secondary" weight="semibold" mono>
          text
        </Text>
        <Skeleton variant="text" />
      </Stack>
      <Stack gap={1}>
        <Text size="xs" tone="secondary" weight="semibold" mono>
          block
        </Text>
        <Skeleton variant="block" />
      </Stack>
      <Stack gap={1} align="start">
        <Text size="xs" tone="secondary" weight="semibold" mono>
          circle
        </Text>
        <Skeleton variant="circle" />
      </Stack>
    </Stack>
  ),
};

/** The last bar is short because real paragraphs end mid-line. */
export const Lines: Story = {
  args: { variant: 'text', lines: 4 },
  render: (args) => (
    <Surface padding="md">
      <Skeleton {...args} />
    </Surface>
  ),
};

/**
 * ADR 0026 — there is no `width` or `height` prop. Size is per-instance deviation, so it is a
 * custom property set on a container the caller owns and inherited into the subtree. The
 * `<div>` here is the caller's own element, which is the whole point of the mechanism.
 */
export const SizedByCustomProperties: Story = {
  render: () => (
    <Surface padding="md">
      <Stack direction="row" gap={3} align="center">
        <div style={{ '--_width': '3rem', '--_height': '3rem' } as CSSProperties}>
          <Skeleton variant="circle" />
        </div>
        <div style={{ '--_width': '12rem' } as CSSProperties}>
          <Stack gap={2}>
            <Skeleton variant="text" />
            <Skeleton variant="text" />
          </Stack>
        </div>
      </Stack>
    </Surface>
  ),
};

/** What a widget actually looks like while it waits. */
export const CardPlaceholder: Story = {
  render: () => (
    <Surface padding="lg" radius="xl">
      <Stack gap={4}>
        <Stack direction="row" gap={3} align="center">
          <Skeleton variant="circle" />
          <div style={{ flex: 1 }}>
            <Skeleton variant="text" lines={2} />
          </div>
        </Stack>
        <Skeleton variant="block" />
      </Stack>
    </Surface>
  ),
};

/**
 * The accessibility contract, asserted rather than described: the whole graphic is hidden, so a
 * screen reader is never read a paragraph that does not exist yet. The announcement belongs to
 * the region that is waiting — `aria-busy` here — which says it once, about something real.
 */
export const HiddenFromAssistiveTech: Story = {
  render: () => (
    <Surface padding="md" render={<section aria-label="Itinerary" aria-busy />}>
      <Skeleton variant="text" lines={3} />
    </Surface>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const region = canvas.getByRole('region', { name: 'Itinerary' });
    await expect(region).toHaveAttribute('aria-busy', 'true');
    // Nothing inside the region reaches the accessibility tree, and nothing inside it has any
    // text for a screen reader to reach in the first place.
    await expect(region.textContent).toBe('');
    for (const node of Array.from(region.children)) {
      await expect(node).toHaveAttribute('aria-hidden', 'true');
    }
  },
};
