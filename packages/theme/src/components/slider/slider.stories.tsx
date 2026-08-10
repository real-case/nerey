import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Field } from '../field/field';
import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Slider } from './slider';

const meta = {
  title: 'Forms/Slider',
  component: Slider.Root,
  parameters: { layout: 'padded' },
  argTypes: {
    min: { control: { type: 'number' } },
    max: { control: { type: 'number' } },
    step: { control: { type: 'number' } },
    disabled: { control: 'boolean' },
  },
} satisfies Meta<typeof Slider.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { defaultValue: 40, onValueChange: fn() },
  render: (args) => (
    <Field.Root name="stops">
      <Field.Label>Maximum stops</Field.Label>
      <Slider.Root {...args}>
        <Slider.Value />
        <Slider.Control>
          <Slider.Track>
            <Slider.Indicator />
            <Slider.Thumb />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </Field.Root>
  ),
  play: async ({ args, canvasElement }) => {
    const slider = within(canvasElement).getByRole('slider', { name: 'Maximum stops' });

    // The thumb's nested range input is the real control, and the field's label names it.
    await expect(slider).toHaveValue('40');

    await userEvent.tab();
    await expect(slider).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(slider).toHaveValue('41');
    await expect(args.onValueChange).toHaveBeenLastCalledWith(41, expect.anything());
  },
};

/** `Slider.Value` renders an `<output>`, so the number is announced as the thumb moves. */
export const WithValue: Story = {
  render: () => (
    <Field.Root name="stops">
      <Field.Label>Maximum stops</Field.Label>
      <Slider.Root defaultValue={25}>
        <Slider.Value />
        <Slider.Control>
          <Slider.Track>
            <Slider.Indicator />
            <Slider.Thumb />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const slider = canvas.getByRole('slider', { name: 'Maximum stops' });
    const output = canvasElement.querySelector('output');

    await expect(output).toHaveTextContent('25');
    await userEvent.click(slider);
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    await expect(output).toHaveTextContent('27');
  },
};

/** The value can be formatted for display without changing what the control submits. */
export const FormattedValue: Story = {
  render: () => (
    <Field.Root name="budget">
      <Field.Label>Budget</Field.Label>
      <Slider.Root
        defaultValue={240}
        min={0}
        max={1000}
        step={10}
        format={{ style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }}
        locale="en-GB"
      >
        <Slider.Value />
        <Slider.Control>
          <Slider.Track>
            <Slider.Indicator />
            <Slider.Thumb />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const output = canvasElement.querySelector('output');
    const slider = within(canvasElement).getByRole('slider', { name: 'Budget' });

    await expect(output).toHaveTextContent('£240');
    // The submitted value stays a number; only the display is formatted.
    await expect(slider).toHaveValue('240');
  },
};

/**
 * A range is the same anatomy with a second thumb — no `range` prop, no second component.
 *
 * Each thumb carries its own `aria-label`, because the field's label names the whole slider and
 * "Price" read out twice tells the user nothing about which end they are on.
 */
export const Range: Story = {
  render: () => (
    <Field.Root name="price">
      <Field.Label>Price range</Field.Label>
      <Slider.Root defaultValue={[120, 480]} min={0} max={600} step={10}>
        <Slider.Value>{(formatted) => `${formatted[0] ?? ''} – ${formatted[1] ?? ''}`}</Slider.Value>
        <Slider.Control>
          <Slider.Track>
            <Slider.Indicator />
            <Slider.Thumb index={0} aria-label="Lowest price" />
            <Slider.Thumb index={1} aria-label="Highest price" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lowest = canvas.getByRole('slider', { name: 'Lowest price' });
    const highest = canvas.getByRole('slider', { name: 'Highest price' });

    await expect(lowest).toHaveValue('120');
    await expect(highest).toHaveValue('480');

    await userEvent.tab();
    await expect(lowest).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(lowest).toHaveValue('130');

    await userEvent.tab();
    await expect(highest).toHaveFocus();
  },
};

/** `minStepsBetweenValues` stops the two ends crossing into a range that means nothing. */
export const RangeWithMinimumGap: Story = {
  render: () => (
    <Field.Root name="price">
      <Field.Label>Price range</Field.Label>
      <Slider.Root defaultValue={[40, 60]} min={0} max={100} step={1} minStepsBetweenValues={10}>
        <Slider.Control>
          <Slider.Track>
            <Slider.Indicator />
            <Slider.Thumb index={0} aria-label="Lowest price" />
            <Slider.Thumb index={1} aria-label="Highest price" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lowest = canvas.getByRole('slider', { name: 'Lowest price' });

    await userEvent.click(lowest);
    // Ten presses would land on 50, which is where the other thumb's exclusion zone starts.
    await userEvent.keyboard('{ArrowRight>10/}');
    await expect(Number(lowest.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(50);
  },
};

/** Large steps: Page Up and Page Down move by `largeStep` rather than by `step`. */
export const Steps: Story = {
  render: () => (
    <Field.Root name="stops">
      <Field.Label>Maximum stops</Field.Label>
      <Slider.Root defaultValue={50} min={0} max={100} step={5} largeStep={25}>
        <Slider.Value />
        <Slider.Control>
          <Slider.Track>
            <Slider.Indicator />
            <Slider.Thumb />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole('slider', { name: 'Maximum stops' });

    await userEvent.click(slider);
    await userEvent.keyboard('{ArrowRight}');
    await expect(slider).toHaveValue('55');
    await userEvent.keyboard('{PageUp}');
    await expect(slider).toHaveValue('80');
  },
};

/** At the extremes the thumb stays inside the track rather than half-off the end of it. */
export const AtTheEnds: Story = {
  render: () => (
    <Stack gap={6}>
      <Field.Root name="min">
        <Field.Label>At the minimum</Field.Label>
        <Slider.Root defaultValue={0}>
          <Slider.Control>
            <Slider.Track>
              <Slider.Indicator />
              <Slider.Thumb />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
      </Field.Root>
      <Field.Root name="max">
        <Field.Label>At the maximum</Field.Label>
        <Slider.Root defaultValue={100}>
          <Slider.Control>
            <Slider.Track>
              <Slider.Indicator />
              <Slider.Thumb />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
      </Field.Root>
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('slider', { name: 'At the minimum' })).toHaveValue('0');
    await expect(canvas.getByRole('slider', { name: 'At the maximum' })).toHaveValue('100');
  },
};

export const Disabled: Story = {
  args: { defaultValue: 40, disabled: true, onValueChange: fn() },
  render: (args) => (
    <Field.Root name="stops">
      <Field.Label>Maximum stops</Field.Label>
      <Slider.Root {...args}>
        <Slider.Value />
        <Slider.Control>
          <Slider.Track>
            <Slider.Indicator />
            <Slider.Thumb />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </Field.Root>
  ),
  play: async ({ args, canvasElement }) => {
    const slider = within(canvasElement).getByRole('slider', { name: 'Maximum stops' });

    await expect(slider).toBeDisabled();
    await userEvent.keyboard('{ArrowRight}');
    await expect(slider).toHaveValue('40');
    await expect(args.onValueChange).not.toHaveBeenCalled();
  },
};

/** Invalidity reaches the track and the indicator through Base UI's own `data-invalid`. */
export const Invalid: Story = {
  render: () => (
    <Field.Root name="stops" invalid>
      <Field.Label>Maximum stops</Field.Label>
      <Slider.Root defaultValue={90}>
        <Slider.Value />
        <Slider.Control>
          <Slider.Track>
            <Slider.Indicator />
            <Slider.Thumb />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
      <Field.Error match>No fares match a limit that high.</Field.Error>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const slider = canvas.getByRole('slider', { name: 'Maximum stops' });

    await expect(slider).toHaveAccessibleDescription('No fares match a limit that high.');
    await expect(canvasElement.querySelector('[data-invalid]')).toBeInTheDocument();
  },
};

export const Focused: Story = {
  render: () => (
    <Field.Root name="stops">
      <Field.Label>Maximum stops</Field.Label>
      <Slider.Root defaultValue={40}>
        <Slider.Control>
          <Slider.Track>
            <Slider.Indicator />
            <Slider.Thumb />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </Field.Root>
  ),
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole('slider', { name: 'Maximum stops' });
    await userEvent.tab();
    await expect(slider).toHaveFocus();
  },
};

/** A slider outside a field has to be named by hand; nothing else will do it. */
export const StandaloneWithAriaLabel: Story = {
  render: () => (
    <Stack gap={2}>
      <Text size="sm" tone="secondary">
        No field here — the thumb carries its own name.
      </Text>
      <Slider.Root defaultValue={60}>
        <Slider.Control>
          <Slider.Track>
            <Slider.Indicator />
            <Slider.Thumb aria-label="Cabin temperature" />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const slider = within(canvasElement).getByRole('slider', { name: 'Cabin temperature' });
    await expect(slider).toHaveValue('60');
  },
};
