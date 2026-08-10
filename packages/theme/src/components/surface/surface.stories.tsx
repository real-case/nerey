import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Surface } from './surface';
import type { SurfacePadding, SurfaceRadius, SurfaceVariant } from './surface';

/**
 * ADR 0031 — these stories are the theme's visual documentation as well as its browser tests,
 * so the axis stories show the whole axis. A single happy-path example of the most reused
 * component in the theme would document nothing and would regress silently.
 */

const meta = {
  title: 'Foundation/Surface',
  component: Surface,
  parameters: { layout: 'padded' },
  args: { children: 'Panel content' },
} satisfies Meta<typeof Surface>;

export default meta;
type Story = StoryObj<typeof meta>;

const VARIANTS: readonly SurfaceVariant[] = ['raised', 'sunken', 'outline', 'ghost'];
const PADDINGS: readonly SurfacePadding[] = ['none', 'sm', 'md', 'lg'];
const RADII: readonly SurfaceRadius[] = ['md', 'lg', 'xl'];

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <Stack gap={4}>
      {VARIANTS.map((variant) => (
        <Stack key={variant} gap={2}>
          <Text size="xs" tone="secondary" weight="semibold" mono>
            {variant}
          </Text>
          <Surface variant={variant}>
            <Text>
              The panel every widget sits in. Elevation is drawn twice — a border and a shadow — because a
              shadow alone disappears against a dark canvas.
            </Text>
          </Surface>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Padding: Story = {
  render: () => (
    <Stack gap={4}>
      {PADDINGS.map((padding) => (
        <Stack key={padding} gap={2}>
          <Text size="xs" tone="secondary" weight="semibold" mono>
            padding={padding}
          </Text>
          <Surface padding={padding}>
            <Surface variant="sunken" padding="sm" radius="md">
              <Text size="sm">Inner block, so the outer padding is visible.</Text>
            </Surface>
          </Surface>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Radius: Story = {
  render: () => (
    <Stack direction="row" gap={4} wrap>
      {RADII.map((radius) => (
        <Stack key={radius} gap={2}>
          <Text size="xs" tone="secondary" weight="semibold" mono>
            radius={radius}
          </Text>
          <Surface radius={radius}>
            <Text size="sm">{radius}</Text>
          </Surface>
        </Stack>
      ))}
    </Stack>
  ),
};

/** The full variant × padding grid — the reference every later component copies. */
export const Matrix: Story = {
  render: () => (
    <Stack gap={6}>
      {VARIANTS.map((variant) => (
        <Stack key={variant} gap={2}>
          <Text size="xs" tone="secondary" weight="semibold" mono>
            {variant}
          </Text>
          <Stack direction="row" gap={3} align="start" wrap>
            {PADDINGS.map((padding) => (
              <Surface key={padding} variant={variant} padding={padding}>
                <Text size="sm" mono>
                  {padding}
                </Text>
              </Surface>
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  ),
};

/** Nesting is the common case: a raised widget shell holding sunken rows of detail. */
export const Nested: Story = {
  render: () => (
    <Surface padding="lg" radius="xl">
      <Stack gap={3}>
        <Text as="h3" size="lg" weight="semibold">
          Flight NR-441
        </Text>
        <Surface variant="sunken" padding="sm" radius="md">
          <Text size="sm" tone="secondary">
            Departs 14:20 — Gate B7
          </Text>
        </Surface>
        <Surface variant="sunken" padding="sm" radius="md">
          <Text size="sm" tone="secondary">
            Arrives 17:05 — Terminal 3
          </Text>
        </Surface>
      </Stack>
    </Surface>
  ),
};

/**
 * `render` changes the element, never the paint (ADR 0026). A panel that delimits a region of
 * the page should say so in the markup, and that is a semantic decision the caller owns.
 */
export const AsSection: Story = {
  render: () => (
    <Surface render={<section aria-label="Order summary" />}>
      <Text>Two items, £48.00</Text>
    </Surface>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // A named <section> exposes role="region" — proof the element really was substituted and
    // that the caller's own attributes survived the merge rather than being overwritten.
    const region = canvas.getByRole('region', { name: 'Order summary' });
    await expect(region.tagName).toBe('SECTION');
    await expect(region).toHaveTextContent('Two items, £48.00');
  },
};
