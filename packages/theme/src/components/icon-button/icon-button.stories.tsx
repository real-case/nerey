import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  DotsHorizontalIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
} from '../icons/icons';
import { Separator } from '../separator/separator';
import { Stack } from '../stack/stack';
import { Surface } from '../surface/surface';
import { Text } from '../text/text';
import { IconButton } from './icon-button';
import type { IconButtonSize, IconButtonTone, IconButtonVariant } from './icon-button';

const meta = {
  title: 'Foundation/IconButton',
  component: IconButton,
  parameters: { layout: 'padded' },
  args: { label: 'Dismiss', children: <CloseIcon />, onClick: fn() },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

const VARIANTS: readonly IconButtonVariant[] = ['solid', 'outline', 'ghost'];
const TONES: readonly IconButtonTone[] = ['neutral', 'accent', 'danger'];
const SIZES: readonly IconButtonSize[] = ['sm', 'md', 'lg'];

export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // The assertion the type signature exists to guarantee: the control has a name, and the
    // name is the one the caller passed rather than the glyph's file name or nothing at all.
    const button = canvas.getByRole('button', { name: 'Dismiss' });
    await expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

/** The full variant × tone grid, matching Button's axes so the two mix in one toolbar. */
export const Matrix: Story = {
  render: () => (
    <Stack gap={4}>
      {VARIANTS.map((variant) => (
        <Stack key={variant} gap={2}>
          <Text size="xs" tone="secondary" weight="semibold" mono>
            {variant}
          </Text>
          <Stack direction="row" gap={2} align="center">
            {TONES.map((tone) => (
              <IconButton key={tone} variant={variant} tone={tone} label={`${variant} ${tone}`}>
                <CheckIcon />
              </IconButton>
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
        <IconButton key={size} size={size} variant="outline" label={`Search (${size})`}>
          <SearchIcon size={size === 'lg' ? 20 : 16} />
        </IconButton>
      ))}
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const small = canvas.getByRole('button', { name: 'Search (sm)' });
    const large = canvas.getByRole('button', { name: 'Search (lg)' });
    const smallBox = small.getBoundingClientRect();
    const largeBox = large.getBoundingClientRect();

    // Square at every size — the property that stops an icon button drifting into a pill the
    // first time somebody adds padding.
    await expect(Math.round(smallBox.width)).toBe(Math.round(smallBox.height));
    await expect(Math.round(largeBox.width)).toBe(Math.round(largeBox.height));
    await expect(largeBox.width).toBeGreaterThan(smallBox.width);
  },
};

export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Dismiss' });
    await expect(button).toBeDisabled();
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

/** Keyboard focus has to be visible, and the ring is drawn outside the square. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Dismiss' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
  },
};

/** The realistic case: a row of secondary affordances in the corner of a panel. */
export const InAToolbar: Story = {
  render: () => (
    <Surface padding="sm" radius="lg">
      <Stack direction="row" gap={1} align="center">
        <IconButton label="Add passenger">
          <PlusIcon />
        </IconButton>
        <IconButton label="Remove passenger">
          <MinusIcon />
        </IconButton>
        <Separator orientation="vertical" />
        <IconButton label="Expand details">
          <ChevronDownIcon />
        </IconButton>
        <IconButton label="More actions">
          <DotsHorizontalIcon />
        </IconButton>
        <Separator orientation="vertical" />
        <IconButton tone="danger" label="Cancel booking">
          <CloseIcon />
        </IconButton>
      </Stack>
    </Surface>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Five glyphs, five distinct names. A toolbar of unnamed buttons is the defect this
    // component's required `label` exists to make impossible (ADR 0032).
    const names = canvas.getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    await expect(names).toEqual([
      'Add passenger',
      'Remove passenger',
      'Expand details',
      'More actions',
      'Cancel booking',
    ]);
  },
};

/** `render` changes the element, never the paint — an icon link is still a link. */
export const AsLink: Story = {
  args: {
    label: 'Open the booking in a new tab',
    render: <a href="#booking" />,
  },
  play: async ({ canvasElement }) => {
    const link = within(canvasElement).getByRole('link', {
      name: 'Open the booking in a new tab',
    });
    await expect(link.tagName).toBe('A');
  },
};
