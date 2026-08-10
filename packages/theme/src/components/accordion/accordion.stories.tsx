import { useState } from 'react';
import type { ReactElement } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { Badge } from '../badge/badge';
import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Accordion } from './accordion';

const meta = {
  title: 'Disclosure/Accordion',
  component: Accordion.Root,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Accordion.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const SECTIONS = [
  {
    value: 'baggage',
    title: 'Baggage',
    body: 'One checked piece up to 23 kg, one cabin bag up to 10 kg, and one personal item.',
  },
  {
    value: 'changes',
    title: 'Changes and cancellation',
    body: 'Changes are permitted up to two hours before departure, and attract a fare difference.',
  },
  {
    value: 'seats',
    title: 'Seat selection',
    body: 'Standard seats are free from 24 hours before departure. Extra-legroom rows are chargeable.',
  },
] as const;

/** The same three sections in every story, so a diff between two of them is only the prop. */
function Sections(): ReactElement[] {
  return SECTIONS.map((section) => (
    <Accordion.Item key={section.value} value={section.value}>
      <Accordion.Header>
        <Accordion.Trigger>{section.title}</Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Panel>
        <Text size="sm">{section.body}</Text>
      </Accordion.Panel>
    </Accordion.Item>
  ));
}

/** Single-open: opening one section closes the one that was open. */
export const Default: Story = {
  args: { onValueChange: fn() },
  render: (args) => <Accordion.Root {...args}>{Sections()}</Accordion.Root>,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const baggage = canvas.getByRole('button', { name: 'Baggage' });
    const changes = canvas.getByRole('button', { name: 'Changes and cancellation' });

    await expect(baggage).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(baggage);
    await expect(baggage).toHaveAttribute('aria-expanded', 'true');
    // Base UI's value is an array even in single-open mode, and Nerey keeps it that way rather
    // than collapsing to `string | null` — one prop, one callback signature.
    await expect(args.onValueChange).toHaveBeenLastCalledWith(['baggage']);

    await userEvent.click(changes);
    await expect(changes).toHaveAttribute('aria-expanded', 'true');
    await expect(baggage).toHaveAttribute('aria-expanded', 'false');
    await expect(args.onValueChange).toHaveBeenLastCalledWith(['changes']);
  },
};

/** `multiple` lets any number of sections stay open at once. */
export const Multiple: Story = {
  args: { multiple: true, defaultValue: ['baggage'] },
  render: (args) => <Accordion.Root {...args}>{Sections()}</Accordion.Root>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const baggage = canvas.getByRole('button', { name: 'Baggage' });
    const seats = canvas.getByRole('button', { name: 'Seat selection' });

    await expect(baggage).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(seats);
    await expect(seats).toHaveAttribute('aria-expanded', 'true');
    await expect(baggage).toHaveAttribute('aria-expanded', 'true');
  },
};

/**
 * The panels are reachable from the keyboard alone: Tab moves between triggers and Enter opens
 * the focused one. There is no roving tabindex here by design — Base UI dropped it in 1.7.0
 * following the APG's own revision.
 */
export const KeyboardOperation: Story = {
  render: () => <Accordion.Root>{Sections()}</Accordion.Root>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const baggage = canvas.getByRole('button', { name: 'Baggage' });
    const changes = canvas.getByRole('button', { name: 'Changes and cancellation' });

    await userEvent.tab();
    await expect(baggage).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await expect(baggage).toHaveAttribute('aria-expanded', 'true');

    await userEvent.tab();
    await expect(changes).toHaveFocus();
  },
};

/** A disabled item keeps its place in the list and refuses to open. */
export const DisabledItem: Story = {
  render: () => (
    <Accordion.Root>
      <Accordion.Item value="included">
        <Accordion.Header>
          <Accordion.Trigger>What is included</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          <Text size="sm">Cabin bag, seat selection at check-in, and a 24-hour hold.</Text>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="lounge" disabled>
        <Accordion.Header>
          <Accordion.Trigger>Lounge access</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          <Text size="sm">Not available on this fare.</Text>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lounge = canvas.getByRole('button', { name: 'Lounge access' });
    await userEvent.click(lounge);
    await expect(lounge).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.queryByText('Not available on this fare.')).toBeNull();
  },
};

/**
 * The heading level is a document-outline decision, not a size. An accordion nested under a
 * widget's own `<h2>` needs `<h3>`; one that is the top-level structure of a page section needs
 * `<h2>`. Both look identical, which is the point.
 */
export const HeadingLevels: Story = {
  render: () => (
    <Stack gap={6}>
      <Accordion.Root>
        <Accordion.Item value="h2">
          <Accordion.Header level={2}>
            <Accordion.Trigger>Rendered as h2</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>
            <Text size="sm">Top-level structure.</Text>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion.Root>
      <Accordion.Root>
        <Accordion.Item value="h4">
          <Accordion.Header level={4}>
            <Accordion.Trigger>Rendered as h4</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel>
            <Text size="sm">Nested three levels down.</Text>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion.Root>
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'Rendered as h2', level: 2 })).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'Rendered as h4', level: 4 })).toBeVisible();
  },
};

/** Controlled, with the open set held outside the component. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const [value, setValue] = useState<string[]>([]);

    return (
      <Stack gap={3}>
        <Text size="xs" tone="secondary" mono>
          open: [{value.join(', ')}]
        </Text>
        <Accordion.Root multiple value={value} onValueChange={setValue}>
          {Sections()}
        </Accordion.Root>
      </Stack>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Baggage' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Seat selection' }));
    await waitFor(async () => {
      await expect(canvas.getByText('open: [baggage, seats]')).toBeInTheDocument();
    });
  },
};

/** Long titles wrap and long bodies grow the panel; nothing is truncated. */
export const LongContent: Story = {
  args: { defaultValue: ['terms'] },
  render: (args) => (
    <Accordion.Root {...args}>
      <Accordion.Item value="terms">
        <Accordion.Header>
          <Accordion.Trigger>
            Conditions of carriage, fare rules and the contract of transport in full
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          <Stack gap={2}>
            <Text size="sm">
              Tickets are valid for one year from the date of the first flight coupon. Changes are permitted
              up to two hours before departure and attract a fare difference plus the change fee shown at the
              time of booking.
            </Text>
            <Text size="sm">
              Refunds on non-flexible fares are limited to unused taxes and government charges, and are paid
              to the original form of payment.
            </Text>
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
      <Accordion.Item value="status">
        <Accordion.Header>
          <Accordion.Trigger>
            Loyalty status{' '}
            <Badge size="sm" tone="accent">
              Gold
            </Badge>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          <Text size="sm">Priority boarding and a second checked piece.</Text>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  ),
};
