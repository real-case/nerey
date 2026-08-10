import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Surface } from '../surface/surface';
import { Text } from '../text/text';
import { Stack } from './stack';
import type { StackAlign, StackGap, StackJustify } from './stack';

/**
 * ADR 0031 — the gap, align and justify stories show every value on the axis, because a layout
 * primitive's whole surface IS its axes and half of them would document nothing.
 */

const meta = {
  title: 'Foundation/Stack',
  component: Stack,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Stack>;

export default meta;
type Story = StoryObj<typeof meta>;

const GAPS: readonly StackGap[] = [0, 1, 2, 3, 4, 6, 8];
const ALIGNMENTS: readonly StackAlign[] = ['stretch', 'start', 'center', 'end', 'baseline'];
const JUSTIFICATIONS: readonly StackJustify[] = ['start', 'center', 'end', 'between', 'around'];

/** A filled box, so the flex behaviour under test is visible rather than inferred. */
function Box({ children }: { children: string }) {
  return (
    <Surface variant="sunken" padding="sm" radius="md">
      <Text size="sm" mono>
        {children}
      </Text>
    </Surface>
  );
}

export const Default: Story = {
  args: { gap: 3 },
  render: (args) => (
    <Stack {...args}>
      <Box>one</Box>
      <Box>two</Box>
      <Box>three</Box>
    </Stack>
  ),
};

export const Direction: Story = {
  render: () => (
    <Stack gap={6}>
      <Stack gap={2}>
        <Text size="xs" tone="secondary" weight="semibold" mono>
          direction=&quot;column&quot; (default)
        </Text>
        <Stack gap={2}>
          <Box>one</Box>
          <Box>two</Box>
        </Stack>
      </Stack>
      <Stack gap={2}>
        <Text size="xs" tone="secondary" weight="semibold" mono>
          direction=&quot;row&quot;
        </Text>
        <Stack direction="row" gap={2} align="start">
          <Box>one</Box>
          <Box>two</Box>
        </Stack>
      </Stack>
    </Stack>
  ),
};

/** The whole space scale the prop can express — there is no eighth value to reach for. */
export const Gaps: Story = {
  render: () => (
    <Stack gap={4}>
      {GAPS.map((gap) => (
        <Stack key={gap} gap={1}>
          <Text size="xs" tone="secondary" weight="semibold" mono>
            gap={gap}
          </Text>
          <Stack direction="row" gap={gap} align="start">
            <Box>a</Box>
            <Box>b</Box>
            <Box>c</Box>
          </Stack>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Align: Story = {
  render: () => (
    <Stack gap={4}>
      {ALIGNMENTS.map((align) => (
        <Stack key={align} gap={1}>
          <Text size="xs" tone="secondary" weight="semibold" mono>
            align={align}
          </Text>
          <Stack direction="row" gap={2} align={align}>
            <Box>short</Box>
            <Surface variant="sunken" padding="lg" radius="md">
              <Text size="sm" mono>
                tall
              </Text>
            </Surface>
            <Box>short</Box>
          </Stack>
        </Stack>
      ))}
    </Stack>
  ),
};

export const Justify: Story = {
  render: () => (
    <Stack gap={4}>
      {JUSTIFICATIONS.map((justify) => (
        <Stack key={justify} gap={1}>
          <Text size="xs" tone="secondary" weight="semibold" mono>
            justify={justify}
          </Text>
          <Surface variant="outline" padding="sm" radius="md">
            <Stack direction="row" gap={2} justify={justify} align="center">
              <Box>a</Box>
              <Box>b</Box>
            </Stack>
          </Surface>
        </Stack>
      ))}
    </Stack>
  ),
};

/** `gap` applies on both axes, so wrapped rows keep their rhythm without a second prop. */
export const Wrap: Story = {
  render: () => (
    <Surface variant="outline" padding="sm" radius="md">
      <Stack direction="row" gap={2} wrap>
        {['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel'].map((word) => (
          <Box key={word}>{word}</Box>
        ))}
      </Stack>
    </Surface>
  ),
};

/**
 * The reason this component exists: a Stack contributes no outer spacing of its own, so nesting
 * one inside another produces exactly the gaps that were asked for and no accumulated margin.
 */
export const OwnsNoOuterMargin: Story = {
  render: () => (
    <Surface variant="outline" padding="none" radius="md">
      <Stack role="group" aria-label="Outer stack">
        <Stack gap={2}>
          <Box>nested child</Box>
          <Box>nested child</Box>
        </Stack>
      </Stack>
    </Surface>
  ),
  play: async ({ canvasElement }) => {
    // Selected through the accessibility tree rather than a test id: ADR 0020 reserves `data-*`
    // for attributes the component emits, so there is no `data-testid` to hang a query on.
    const outer = within(canvasElement).getByRole('group', { name: 'Outer stack' });
    const computed = getComputedStyle(outer);
    // The outer Surface has `padding: none`, so any margin here would show up as a visible
    // inset — the failure this primitive exists to prevent.
    await expect(computed.marginTop).toBe('0px');
    await expect(computed.marginBottom).toBe('0px');
    await expect(computed.marginLeft).toBe('0px');
    await expect(computed.marginRight).toBe('0px');
    await expect(computed.rowGap).toBe('0px');
  },
};
