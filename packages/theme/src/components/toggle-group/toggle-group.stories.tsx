import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Toggle, ToggleGroup } from './toggle-group';

/**
 * ADR 0031 / 0032 — the stories are the test suite and the axe subject.
 *
 * A toggle group is a composite widget, which means it has ONE tab stop and arrow keys move
 * between the toggles inside it. That is the behaviour worth asserting: tabbing into a group
 * of six chips and then tabbing six more times to leave it is the failure mode this component
 * exists to avoid, and it is invisible to a screenshot.
 *
 * Nothing here is portalled, so every query goes through the canvas.
 */
const meta = {
  title: 'Components/ToggleGroup',
  component: ToggleGroup,
  parameters: { layout: 'padded' },
  args: { label: 'Text alignment' },
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

const ALIGNMENTS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
] as const;

/** The default shape: a joined bar for a small, mutually exclusive set of modes. */
export const Segmented: Story = {
  args: { defaultValue: ['left'], onValueChange: fn() },
  render: (args) => (
    <ToggleGroup {...args}>
      {ALIGNMENTS.map((alignment) => (
        <Toggle key={alignment.value} value={alignment.value}>
          {alignment.label}
        </Toggle>
      ))}
    </ToggleGroup>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole('group', { name: 'Text alignment' });
    const left = within(group).getByRole('button', { name: 'Left' });
    const center = within(group).getByRole('button', { name: 'Center' });

    await expect(left).toHaveAttribute('aria-pressed', 'true');
    await expect(center).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(center);
    await expect(center).toHaveAttribute('aria-pressed', 'true');
    // Single-select: choosing one un-chooses the other, without the caller writing that rule.
    await expect(left).toHaveAttribute('aria-pressed', 'false');
    // The value is an array even in single-select mode — that is Base UI's contract, and the
    // honest one: single-select is the case where the array holds at most one entry.
    await expect(args.onValueChange).toHaveBeenLastCalledWith(['center'], expect.anything());
  },
};

/**
 * One tab stop, arrow keys inside. This is the assertion that matters most and the one a
 * hand-rolled group of `<button>`s always fails.
 */
export const KeyboardNavigation: Story = {
  args: { defaultValue: ['left'] },
  render: (args) => (
    <ToggleGroup {...args}>
      {ALIGNMENTS.map((alignment) => (
        <Toggle key={alignment.value} value={alignment.value}>
          {alignment.label}
        </Toggle>
      ))}
    </ToggleGroup>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const left = canvas.getByRole('button', { name: 'Left' });
    const center = canvas.getByRole('button', { name: 'Center' });
    const right = canvas.getByRole('button', { name: 'Right' });

    await userEvent.tab();
    await expect(left).toHaveFocus();

    await userEvent.keyboard('{ArrowRight}');
    await expect(center).toHaveFocus();
    // Moving focus does not press anything — arrowing past an option must not select it.
    await expect(center).toHaveAttribute('aria-pressed', 'false');

    await userEvent.keyboard('{ArrowRight}');
    await expect(right).toHaveFocus();

    // `loopFocus` is on by default, so the end wraps to the start.
    await userEvent.keyboard('{ArrowRight}');
    await expect(left).toHaveFocus();

    await userEvent.keyboard('{ArrowLeft}');
    await expect(right).toHaveFocus();
    await userEvent.keyboard('{ }');
    await expect(right).toHaveAttribute('aria-pressed', 'true');

    // One tab stop: the next Tab leaves the group entirely rather than walking through it.
    await userEvent.tab();
    await expect(right).not.toHaveFocus();
    await expect(left).not.toHaveFocus();
    await expect(center).not.toHaveFocus();
  },
};

const AMENITIES = [
  { value: 'wifi', label: 'Wi-Fi' },
  { value: 'lounge', label: 'Lounge access' },
  { value: 'meal', label: 'Meal included' },
  { value: 'baggage', label: 'Checked baggage' },
  { value: 'seat', label: 'Seat selection' },
  { value: 'flexible', label: 'Flexible ticket' },
] as const;

/**
 * The chips variant, and the substrate the `choice-chips` widget is built on: pills that wrap
 * into as many rows as the column allows. A segmented bar cannot do this — it breaks the moment
 * it has to wrap — which is why `variant` is a fork rather than a skin.
 */
export const Chips: Story = {
  args: {
    label: 'Amenities',
    variant: 'chips',
    multiple: true,
    defaultValue: ['wifi'],
    onValueChange: fn(),
  },
  render: (args) => (
    <ToggleGroup {...args}>
      {AMENITIES.map((amenity) => (
        <Toggle key={amenity.value} value={amenity.value}>
          {amenity.label}
        </Toggle>
      ))}
    </ToggleGroup>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole('group', { name: 'Amenities' });
    const wifi = within(group).getByRole('button', { name: 'Wi-Fi' });
    const lounge = within(group).getByRole('button', { name: 'Lounge access' });

    await expect(wifi).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(lounge);
    // `multiple` keeps both — the difference from Segmented is one prop, not one component.
    await expect(wifi).toHaveAttribute('aria-pressed', 'true');
    await expect(lounge).toHaveAttribute('aria-pressed', 'true');
    // `arrayContaining` rather than a literal: the group owns the ordering of its own value,
    // and pinning it here would turn an implementation detail into a contract.
    await expect(args.onValueChange).toHaveBeenLastCalledWith(
      expect.arrayContaining(['wifi', 'lounge']),
      expect.anything(),
    );

    await userEvent.click(wifi);
    await expect(wifi).toHaveAttribute('aria-pressed', 'false');
  },
};

/** A wrapping set is the case the chips variant exists for, so it is a story rather than a note. */
export const ChipsWrap: Story = {
  args: { label: 'Amenities', variant: 'chips', multiple: true, defaultValue: ['wifi', 'meal'] },
  render: (args) => (
    <div style={{ inlineSize: '18rem' }}>
      <ToggleGroup {...args}>
        {AMENITIES.map((amenity) => (
          <Toggle key={amenity.value} value={amenity.value}>
            {amenity.label}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole('group', { name: 'Amenities' });
    const chips = within(group).getAllByRole('button');
    const tops = new Set(chips.map((chip) => Math.round(chip.getBoundingClientRect().top)));
    // More than one row, and no chip wider than the column it was given.
    await expect(tops.size).toBeGreaterThan(1);
    const groupWidth = group.getBoundingClientRect().width;
    for (const chip of chips) {
      await expect(chip.getBoundingClientRect().width).toBeLessThanOrEqual(groupWidth + 1);
    }
  },
};

/** Both variants at both sizes, so a change to one geometry cannot silently break the other. */
export const Matrix: Story = {
  render: () => (
    <Stack gap={6}>
      {(['segmented', 'chips'] as const).map((variant) => (
        <Stack key={variant} gap={3}>
          <Text size="xs" tone="secondary" weight="semibold" mono>
            {variant}
          </Text>
          {(['sm', 'md'] as const).map((size) => (
            <ToggleGroup
              key={size}
              label={`Text alignment (${variant}, ${size})`}
              variant={variant}
              size={size}
              defaultValue={['center']}
            >
              {ALIGNMENTS.map((alignment) => (
                <Toggle key={alignment.value} value={alignment.value}>
                  {alignment.label}
                </Toggle>
              ))}
            </ToggleGroup>
          ))}
        </Stack>
      ))}
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Four groups, four distinct names. An unnamed `role="group"` is announced as nothing, which
    // is why `label` is required rather than optional (ADR 0032).
    const groups = canvas.getAllByRole('group');
    await expect(groups).toHaveLength(4);

    const small = canvas
      .getByRole('group', { name: 'Text alignment (segmented, sm)' })
      .getBoundingClientRect().height;
    const medium = canvas
      .getByRole('group', { name: 'Text alignment (segmented, md)' })
      .getBoundingClientRect().height;
    await expect(small).toBeLessThan(medium);
  },
};

/** Vertical is a real orientation, not a rotation: the dividers move to the block axis too. */
export const Vertical: Story = {
  args: { label: 'View density', orientation: 'vertical', defaultValue: ['comfortable'] },
  render: (args) => (
    <ToggleGroup {...args}>
      <Toggle value="compact">Compact</Toggle>
      <Toggle value="comfortable">Comfortable</Toggle>
      <Toggle value="spacious">Spacious</Toggle>
    </ToggleGroup>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole('group', { name: 'View density' });
    await expect(group).toHaveAttribute('data-orientation', 'vertical');

    await userEvent.tab();
    const entryPoint = document.activeElement;
    // Where the single tab stop lands is Base UI's business; that it lands INSIDE the group is
    // the contract, and pinning the former would make this story a change-detector.
    await expect(group.contains(entryPoint)).toBe(true);

    // A vertical group answers to the vertical arrows, which is the whole point of the prop.
    await userEvent.keyboard('{ArrowDown}');
    await expect(document.activeElement).not.toBe(entryPoint);
    await expect(group.contains(document.activeElement)).toBe(true);
  },
};

/** A disabled group refuses the whole set, including from the keyboard. */
export const DisabledGroup: Story = {
  args: { label: 'Text alignment', disabled: true, defaultValue: ['left'], onValueChange: fn() },
  render: (args) => (
    <ToggleGroup {...args}>
      {ALIGNMENTS.map((alignment) => (
        <Toggle key={alignment.value} value={alignment.value}>
          {alignment.label}
        </Toggle>
      ))}
    </ToggleGroup>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole('group', { name: 'Text alignment' });
    await expect(group).toHaveAttribute('data-disabled');

    const center = within(group).getByRole('button', { name: 'Center' });
    await userEvent.click(center);
    await expect(center).toHaveAttribute('aria-pressed', 'false');
    await expect(args.onValueChange).not.toHaveBeenCalled();
  },
};

/** One toggle disabled inside an otherwise live group. */
export const DisabledToggle: Story = {
  args: { label: 'Amenities', variant: 'chips', multiple: true, defaultValue: ['wifi'] },
  render: (args) => (
    <ToggleGroup {...args}>
      <Toggle value="wifi">Wi-Fi</Toggle>
      <Toggle value="lounge" disabled>
        Lounge access
      </Toggle>
      <Toggle value="meal">Meal included</Toggle>
    </ToggleGroup>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lounge = canvas.getByRole('button', { name: 'Lounge access' });
    await expect(lounge).toBeDisabled();

    await userEvent.click(lounge);
    await expect(lounge).toHaveAttribute('aria-pressed', 'false');

    // The live toggles either side of it still work.
    const meal = canvas.getByRole('button', { name: 'Meal included' });
    await userEvent.click(meal);
    await expect(meal).toHaveAttribute('aria-pressed', 'true');
  },
};

/** Nothing chosen yet — a legitimate state for a filter, and one that must not look broken. */
export const NoneSelected: Story = {
  args: { label: 'Amenities', variant: 'chips', multiple: true, defaultValue: [] },
  render: (args) => (
    <ToggleGroup {...args}>
      {AMENITIES.map((amenity) => (
        <Toggle key={amenity.value} value={amenity.value}>
          {amenity.label}
        </Toggle>
      ))}
    </ToggleGroup>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chips = within(canvas.getByRole('group', { name: 'Amenities' })).getAllByRole('button');
    for (const chip of chips) {
      await expect(chip).toHaveAttribute('aria-pressed', 'false');
    }

    await userEvent.tab();
    // With nothing pressed the composite still has a tab stop — it lands on the first toggle.
    await expect(chips[0]).toHaveFocus();
  },
};

/**
 * A standalone toggle, outside any group. `value` is only needed inside one, and the accessible
 * name contains the visible text rather than replacing it (WCAG 2.5.3).
 */
export const StandaloneToggle: Story = {
  render: () => (
    <Toggle defaultPressed aria-label="Show seat map" onPressedChange={fn()}>
      Seat map
    </Toggle>
  ),
  play: async ({ canvasElement }) => {
    const toggle = within(canvasElement).getByRole('button', { name: 'Show seat map' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  },
};
