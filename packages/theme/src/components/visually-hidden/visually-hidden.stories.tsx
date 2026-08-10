import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Stack } from '../stack/stack';
import { Surface } from '../surface/surface';
import { Text } from '../text/text';
import { VisuallyHidden } from './visually-hidden';

const meta = {
  title: 'Foundation/VisuallyHidden',
  component: VisuallyHidden,
  parameters: { layout: 'padded' },
  args: { children: 'Announced but not shown' },
} satisfies Meta<typeof VisuallyHidden>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The whole contract in one assertion pair: present to a query over the accessibility tree,
 * absent from the layout. `display: none` would fail the first; a `color: transparent` trick
 * would fail the second and still occupy a line.
 */
export const Default: Story = {
  render: (args) => (
    <Surface padding="md">
      <Text>
        Nothing between these words is visible —<VisuallyHidden>{args.children}</VisuallyHidden>— but the
        sentence above is longer than it looks.
      </Text>
    </Surface>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const hidden = canvas.getByText('Announced but not shown');

    await expect(hidden).toBeInTheDocument();
    // `getByText` walks the rendered DOM, so this is the assertion that matters: the element is
    // still in the tree an assistive technology reads.
    await expect(hidden).toBeVisible();

    const box = hidden.getBoundingClientRect();
    await expect(box.width).toBeLessThanOrEqual(1);
    await expect(box.height).toBeLessThanOrEqual(1);
    await expect(getComputedStyle(hidden).position).toBe('absolute');
  },
};

/** The idiomatic use: the extra words that turn a terse control into a comprehensible one. */
export const ExtendingALabel: Story = {
  render: () => (
    <Surface padding="md">
      <Stack gap={2} align="start">
        <Text as="h3" size="lg" weight="semibold">
          Seat 14A
        </Text>
        <Text as="span">
          Remove
          <VisuallyHidden> seat 14A from your booking</VisuallyHidden>
        </Text>
      </Stack>
    </Surface>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Sighted readers see "Remove"; a screen reader gets the whole sentence.
    await expect(canvas.getByText(/Remove/)).toHaveTextContent('Remove seat 14A from your booking');
  },
};

/**
 * Long strings are the case the technique usually gets wrong: without `white-space: nowrap` the
 * text wraps to hundreds of lines inside a one-pixel box, and some screen readers then read it
 * one line at a time.
 */
export const LongContent: Story = {
  render: () => (
    <Surface padding="md">
      <Text>
        Terms summary
        <VisuallyHidden>
          Cancellation is free up to twenty-four hours before departure. After that a fee of fifteen percent
          of the fare applies, and no-shows are not refundable. Changes to the date of travel are permitted
          twice.
        </VisuallyHidden>
      </Text>
    </Surface>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const hidden = canvas.getByText(/^Cancellation is free/);
    await expect(getComputedStyle(hidden).whiteSpace).toBe('nowrap');
    await expect(hidden.getBoundingClientRect().height).toBeLessThanOrEqual(1);
  },
};
