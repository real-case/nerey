import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Stack } from '../stack/stack';
import { Surface } from '../surface/surface';
import { Text } from './text';
import type { TextElement, TextSize, TextTone, TextWeight } from './text';

/**
 * ADR 0031 — the type scale, the tone set and the weight set are shown in full, because these
 * three axes ARE the theme's typographic vocabulary and a sample of them documents nothing.
 */

const meta = {
  title: 'Foundation/Text',
  component: Text,
  parameters: { layout: 'padded' },
  args: { children: 'The quick brown fox jumps over the lazy dog.' },
} satisfies Meta<typeof Text>;

export default meta;
type Story = StoryObj<typeof meta>;

const SIZES: readonly TextSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];
const TONES: readonly TextTone[] = ['primary', 'secondary', 'muted', 'accent', 'danger', 'success'];
const WEIGHTS: readonly TextWeight[] = ['normal', 'medium', 'semibold'];
const ELEMENTS: readonly TextElement[] = ['p', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'strong', 'em'];

function Label({ children }: { children: string }) {
  return (
    <Text size="xs" tone="secondary" weight="semibold" mono>
      {children}
    </Text>
  );
}

export const Default: Story = {};

export const Sizes: Story = {
  render: () => (
    <Stack gap={3}>
      {SIZES.map((size) => (
        <Stack key={size} gap={1}>
          <Label>{`size="${size}"`}</Label>
          <Text size={size}>The quick brown fox jumps over the lazy dog.</Text>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Tones: Story = {
  render: () => (
    <Stack gap={3}>
      {TONES.map((tone) => (
        <Stack key={tone} gap={1}>
          <Label>{`tone="${tone}"`}</Label>
          <Text tone={tone}>The quick brown fox jumps over the lazy dog.</Text>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Weights: Story = {
  render: () => (
    <Stack gap={3}>
      {WEIGHTS.map((weight) => (
        <Stack key={weight} gap={1}>
          <Label>{`weight="${weight}"`}</Label>
          <Text weight={weight} size="lg">
            The quick brown fox jumps over the lazy dog.
          </Text>
        </Stack>
      ))}
    </Stack>
  ),
};

/**
 * The point of separating `as` from `size`: every row below renders the same 0.875rem body type
 * out of a different element, so the document outline is a decision the caller makes on purpose
 * rather than a side effect of wanting bigger text.
 */
export const Elements: Story = {
  render: () => (
    <Stack gap={3}>
      {ELEMENTS.map((as) => (
        <Stack key={as} gap={1}>
          <Label>{`as="${as}"`}</Label>
          <Text as={as}>Rendered as &lt;{as}&gt;, styled by size and weight.</Text>
        </Stack>
      ))}
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Four heading levels went in; four headings must come out, or `as` is decorative and the
    // document outline a widget contributes to the page is a lie.
    await expect(canvas.getAllByRole('heading')).toHaveLength(4);
    await expect(canvas.getByRole('heading', { level: 3 })).toBeInTheDocument();
  },
};

/** The size × tone grid — the pairing every later component is checked against. */
export const Matrix: Story = {
  render: () => (
    <Stack gap={6}>
      {TONES.map((tone) => (
        <Stack key={tone} gap={2}>
          <Label>{tone}</Label>
          <Stack direction="row" gap={4} align="baseline" wrap>
            {SIZES.map((size) => (
              <Text key={size} tone={tone} size={size}>
                {size}
              </Text>
            ))}
          </Stack>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Mono: Story = {
  render: () => (
    <Stack gap={2}>
      <Label>tabular figures line up in a column</Label>
      <Stack gap={1}>
        <Text mono>1,204.50</Text>
        <Text mono>88.00</Text>
        <Text mono>17,911.25</Text>
      </Stack>
    </Stack>
  ),
};

/**
 * Truncation is the long-content case every widget eventually hits. The Surface is narrow on
 * purpose: `min-inline-size: 0` on both the Stack and the Text is what stops the string from
 * widening its container until there is nothing left to ellipsise.
 */
export const Truncated: Story = {
  // The plain `<div>` is scaffolding, not a theme component: the panel has to be narrower than
  // the string for there to be anything to clip, and pinning the width here is what makes the
  // assertion below deterministic on any viewport (ADR 0031).
  render: () => (
    <div style={{ maxWidth: '18rem' }}>
      <Stack gap={4}>
        <Stack gap={1} role="group" aria-label="Truncated sample">
          <Label>truncate</Label>
          <Surface variant="outline" padding="sm" radius="md">
            <Stack>
              <Text truncate>
                Antidisestablishmentarianism, floccinaucinihilipilification and several other words that will
                not fit on one line in this panel.
              </Text>
            </Stack>
          </Surface>
        </Stack>
        <Stack gap={1} role="group" aria-label="Wrapping sample">
          <Label>the same string, wrapping</Label>
          <Surface variant="outline" padding="sm" radius="md">
            <Text>
              Antidisestablishmentarianism, floccinaucinihilipilification and several other words that will
              not fit on one line in this panel.
            </Text>
          </Surface>
        </Stack>
      </Stack>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const sample = within(canvas.getByRole('group', { name: 'Truncated sample' }));
    const truncated = sample.getByText(/^Antidisestablishmentarianism/);

    await expect(getComputedStyle(truncated).textOverflow).toBe('ellipsis');
    // The clipped node keeps its full text — truncation is presentation, so a screen reader and
    // a copy-paste both still get the whole string.
    await expect(truncated.scrollWidth).toBeGreaterThan(truncated.clientWidth);
    await expect(truncated).toHaveTextContent(/floccinaucinihilipilification/);
  },
};
