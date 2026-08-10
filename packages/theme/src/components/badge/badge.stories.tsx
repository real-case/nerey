import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { CheckIcon } from '../icons/icons';
import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Badge } from './badge';
import type { BadgeSize, BadgeTone, BadgeVariant } from './badge';

const meta = {
  title: 'Foundation/Badge',
  component: Badge,
  parameters: { layout: 'padded' },
  args: { children: 'Live' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

const TONES: readonly BadgeTone[] = ['neutral', 'accent', 'danger', 'success', 'warning'];
const VARIANTS: readonly BadgeVariant[] = ['subtle', 'solid', 'outline'];
const SIZES: readonly BadgeSize[] = ['sm', 'md'];

export const Default: Story = {};

export const Tones: Story = {
  render: () => (
    <Stack direction="row" gap={2} align="center" wrap>
      {TONES.map((tone) => (
        <Badge key={tone} tone={tone}>
          {tone}
        </Badge>
      ))}
    </Stack>
  ),
};

/**
 * The full variant × tone grid. Every pairing here was measured against the 4.5:1 the axe gate
 * enforces (ADR 0032) before it was written into the stylesheet, in both themes — flip the
 * toolbar's theme global and none of the fifteen should change verdict.
 */
export const Matrix: Story = {
  render: () => (
    <Stack gap={4}>
      {VARIANTS.map((variant) => (
        <Stack key={variant} gap={2}>
          <Text size="xs" tone="secondary" weight="semibold" mono>
            {variant}
          </Text>
          <Stack direction="row" gap={2} align="center" wrap>
            {TONES.map((tone) => (
              <Badge key={tone} variant={variant} tone={tone}>
                {tone}
              </Badge>
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Stack direction="row" gap={3} align="center">
      {SIZES.map((size) => (
        <Badge key={size} size={size} tone="accent" variant="solid">
          {size}
        </Badge>
      ))}
    </Stack>
  ),
};

/** The gap between glyph and label is a token, so an icon never needs a wrapper to sit right. */
export const WithIcon: Story = {
  render: () => (
    <Stack direction="row" gap={2} align="center" wrap>
      <Badge tone="success" variant="subtle">
        <CheckIcon size={12} />
        Confirmed
      </Badge>
      <Badge tone="success" variant="solid">
        <CheckIcon size={12} />
        Confirmed
      </Badge>
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The glyph is decorative, so the accessible name must be the label alone — an icon that
    // leaked into the name would read as "image Confirmed".
    const badges = canvas.getAllByText('Confirmed');
    await expect(badges).toHaveLength(2);
    for (const badge of badges) {
      await expect(badge.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
  },
};

/** A badge is a label, not a paragraph: it never wraps, so long content grows the pill. */
export const LongContent: Story = {
  render: () => (
    <Stack direction="row" gap={2} align="center" wrap>
      <Badge tone="warning">Awaiting counterparty confirmation</Badge>
      <Badge tone="danger" variant="outline">
        Settlement failed — retry scheduled for 09:00
      </Badge>
    </Stack>
  ),
};
