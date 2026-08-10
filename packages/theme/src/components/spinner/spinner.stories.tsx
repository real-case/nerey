import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Button } from '../button/button';
import { Stack } from '../stack/stack';
import { Surface } from '../surface/surface';
import { Text } from '../text/text';
import { Spinner } from './spinner';
import type { SpinnerSize } from './spinner';

const meta = {
  title: 'Foundation/Spinner',
  component: Spinner,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

const SIZES: readonly SpinnerSize[] = ['sm', 'md', 'lg'];

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The two halves of the accessibility design, asserted separately: the graphic must be
    // hidden, and the status region must have real text in it rather than only a name.
    const status = canvas.getByRole('status');
    await expect(status).toHaveTextContent('Loading');
    await expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(status.querySelector('svg')).toHaveAttribute('focusable', 'false');
  },
};

export const Sizes: Story = {
  render: () => (
    <Stack direction="row" gap={6} align="center">
      {SIZES.map((size) => (
        <Stack key={size} gap={2} align="center">
          <Spinner size={size} />
          <Text size="xs" tone="secondary" mono>
            {size}
          </Text>
        </Stack>
      ))}
    </Stack>
  ),
};

/**
 * The label is what a screen reader announces, so it is the string a host translates. It is
 * never rendered visually — see the clipped box in VisuallyHidden.
 */
export const CustomLabel: Story = {
  args: { label: 'Checking seat availability' },
  play: async ({ canvasElement }) => {
    const status = within(canvasElement).getByRole('status');
    // Text CONTENT, not accessible name. `status` is a live region, and a live region announces
    // what is inside it when it changes — it is not a name-from-content role, so it has no
    // accessible name unless one is set explicitly. Asserting a name here passes only if the
    // component adds a redundant `aria-label`, which would then be announced alongside the
    // content rather than instead of it.
    await expect(status).toHaveTextContent('Checking seat availability');
    await expect(status.getBoundingClientRect().width).toBeLessThan(64);
  },
};

/** The arc paints in `currentColor`, so it inherits whatever it is dropped into. */
export const InheritsColour: Story = {
  render: () => (
    <Stack gap={3}>
      <Stack direction="row" gap={2} align="center">
        <Spinner size="sm" />
        <Text size="sm">Default body colour</Text>
      </Stack>
      <Stack direction="row" gap={2} align="center">
        <Text tone="accent" as="span" size="sm">
          <Spinner size="sm" /> Accent
        </Text>
      </Stack>
      <Stack direction="row" gap={2} align="center">
        <Text tone="danger" as="span" size="sm">
          <Spinner size="sm" /> Danger
        </Text>
      </Stack>
    </Stack>
  ),
};

/**
 * The busy-button case. The button carries no visible label of its own on purpose: the
 * spinner's clipped text is inside it, so the button's accessible name is computed from content
 * and comes out as "Submitting". Adding a visible "Submitting" next to the spinner would name
 * the button "Submitting Submitting", which is the usual way this pattern goes wrong.
 */
export const InsideAButton: Story = {
  render: () => (
    <Stack direction="row" gap={3} align="center" wrap>
      <Button disabled aria-busy>
        <Spinner size="sm" label="Submitting" />
      </Button>
      <Button variant="outline" disabled aria-busy>
        <Spinner size="sm" label="Refreshing" />
      </Button>
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Submitting' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Refreshing' })).toBeDisabled();
  },
};

/** Loading state for a whole panel. */
export const InAPanel: Story = {
  render: () => (
    <Surface padding="lg">
      <Stack gap={3} align="center">
        <Spinner size="lg" label="Loading itinerary" />
        <Text size="sm" tone="secondary">
          Fetching your itinerary…
        </Text>
      </Stack>
    </Surface>
  ),
};
