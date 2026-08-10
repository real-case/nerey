import type { ComponentType, ReactElement } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';

import { Stack } from '../stack/stack';
import { Surface } from '../surface/surface';
import { Text } from '../text/text';
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  DotsHorizontalIcon,
  ExternalLinkIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  SpinnerArcIcon,
} from './icons';
import type { IconProps } from './icons';

/**
 * The set is small on purpose (see the note in icons.tsx). Listing it in one story is what makes
 * "is there already a glyph for this?" a five-second question instead of a grep.
 */

const ICONS: readonly (readonly [string, ComponentType<IconProps>])[] = [
  ['check', CheckIcon],
  ['close', CloseIcon],
  ['chevron-down', ChevronDownIcon],
  ['chevron-up', ChevronUpIcon],
  ['chevron-right', ChevronRightIcon],
  ['info', InfoIcon],
  ['alert-circle', AlertCircleIcon],
  ['alert-triangle', AlertTriangleIcon],
  ['external-link', ExternalLinkIcon],
  ['search', SearchIcon],
  ['dots-horizontal', DotsHorizontalIcon],
  ['plus', PlusIcon],
  ['minus', MinusIcon],
  ['spinner-arc', SpinnerArcIcon],
];

const meta = {
  title: 'Foundation/Icons',
  component: CheckIcon,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CheckIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

function Cell({ name, children }: { name: string; children: ReactElement }) {
  return (
    <Surface variant="outline" padding="sm" radius="md">
      <Stack gap={2} align="center">
        {children}
        <Text size="xs" tone="secondary" mono>
          {name}
        </Text>
      </Stack>
    </Surface>
  );
}

export const Gallery: Story = {
  render: () => (
    <Stack direction="row" gap={3} wrap>
      {ICONS.map(([name, Icon]) => (
        <Cell key={name} name={name}>
          <Icon size={24} />
        </Cell>
      ))}
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const glyphs = canvasElement.querySelectorAll('svg');
    await expect(glyphs).toHaveLength(ICONS.length);
    // Decorative by construction. An icon that reached the accessibility tree would be read out
    // as "graphic" beside the label that already says what it is.
    for (const glyph of Array.from(glyphs)) {
      await expect(glyph).toHaveAttribute('aria-hidden', 'true');
      await expect(glyph).toHaveAttribute('focusable', 'false');
    }
  },
};

/**
 * `size` is a plain pixel number because it lands on the `width`/`height` attributes. Everything
 * else about a glyph — colour, alignment, whether it shrinks — is CSS, and CSS wins over a
 * presentation attribute, which is why a caller can still size these from a token if they need to.
 */
export const Sizes: Story = {
  render: () => (
    <Stack direction="row" gap={4} align="center">
      {[12, 16, 20, 24, 32].map((size) => (
        <Stack key={size} gap={2} align="center">
          <AlertTriangleIcon size={size} />
          <Text size="xs" tone="secondary" mono>
            {size}
          </Text>
        </Stack>
      ))}
    </Stack>
  ),
};

/** Every glyph strokes in `currentColor`, so tone comes from the text around it. */
export const InheritsColour: Story = {
  render: () => (
    <Stack gap={3}>
      <Text as="span" tone="primary">
        <InfoIcon /> Primary
      </Text>
      <Text as="span" tone="accent">
        <CheckIcon /> Accent
      </Text>
      <Text as="span" tone="danger">
        <AlertCircleIcon /> Danger
      </Text>
      <Text as="span" tone="success">
        <CheckIcon /> Success
      </Text>
    </Stack>
  ),
};
