import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { Badge } from '../badge/badge';
import { Button } from '../button/button';
import { Stack } from '../stack/stack';
import { Surface } from '../surface/surface';
import { Text } from '../text/text';
import { Collapsible } from './collapsible';

const meta = {
  title: 'Disclosure/Collapsible',
  component: Collapsible.Root,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Collapsible.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { onOpenChange: fn() },
  render: (args) => (
    <Collapsible.Root {...args}>
      <Collapsible.Trigger>Fare breakdown</Collapsible.Trigger>
      <Collapsible.Panel>
        <Stack gap={1}>
          <Text size="sm">Base fare — £148.00</Text>
          <Text size="sm">Taxes and carrier charges — £62.40</Text>
          <Text size="sm">Seat selection — £14.00</Text>
        </Stack>
      </Collapsible.Panel>
    </Collapsible.Root>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Fare breakdown' });

    // `aria-expanded` and `aria-controls` are Base UI's, and they are the entire reason this is a
    // disclosure rather than a div that hides things. Asserting them is asserting the contract.
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.queryByText(/Base fare/)).toBeNull();

    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByText(/Base fare/)).toBeVisible();
    await expect(args.onOpenChange).toHaveBeenCalledWith(true);

    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await waitFor(async () => {
      await expect(canvas.queryByText(/Base fare/)).toBeNull();
    });
  },
};

export const DefaultOpen: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <Collapsible.Root {...args}>
      <Collapsible.Trigger>What is included</Collapsible.Trigger>
      <Collapsible.Panel>
        <Text size="sm">One cabin bag, seat selection at check-in, and a 24-hour hold.</Text>
      </Collapsible.Panel>
    </Collapsible.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'What is included' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(canvas.getByText(/One cabin bag/)).toBeVisible();
  },
};

export const Disabled: Story = {
  args: { disabled: true, onOpenChange: fn() },
  render: (args) => (
    <Collapsible.Root {...args}>
      <Collapsible.Trigger>Unavailable on this fare</Collapsible.Trigger>
      <Collapsible.Panel>
        <Text size="sm">Never reachable while the root is disabled.</Text>
      </Collapsible.Panel>
    </Collapsible.Root>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Unavailable on this fare' });
    await userEvent.click(trigger);
    // The click has to be inert, not merely styled as inert — an opacity change that still opens
    // the panel is the version of "disabled" that reaches production.
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(args.onOpenChange).not.toHaveBeenCalled();
  },
};

/** Controlled: the open state lives outside the component and something else can move it. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const [open, setOpen] = useState(false);

    return (
      <Stack gap={3} align="start">
        <Button size="sm" variant="outline" onClick={() => setOpen((previous) => !previous)}>
          Toggle from outside
        </Button>
        <Collapsible.Root open={open} onOpenChange={setOpen}>
          <Collapsible.Trigger>Passenger details</Collapsible.Trigger>
          <Collapsible.Panel>
            <Text size="sm">A. Marchetti — window, 14A</Text>
          </Collapsible.Panel>
        </Collapsible.Root>
      </Stack>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const external = canvas.getByRole('button', { name: 'Toggle from outside' });
    const trigger = canvas.getByRole('button', { name: 'Passenger details' });

    await userEvent.click(external);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // And back the other way: the trigger has to drive the same state, or "controlled" means the
    // component has quietly kept a second copy of it.
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  },
};

/** The panel animates to whatever height the content needs, however tall that turns out to be. */
export const LongContent: Story = {
  args: { defaultOpen: true },
  render: (args) => (
    <Surface padding="md" radius="lg">
      <Collapsible.Root {...args}>
        <Collapsible.Trigger>Conditions of carriage</Collapsible.Trigger>
        <Collapsible.Panel>
          <Stack gap={2}>
            <Text size="sm">
              Tickets are valid for one year from the date of the first flight coupon. Changes are permitted
              up to two hours before departure and attract a fare difference plus the change fee shown at the
              time of booking.
            </Text>
            <Text size="sm">
              Checked baggage is limited to 23 kg per piece. Items exceeding this are carried subject to space
              and attract an excess charge assessed at the airport.
            </Text>
            <Text size="sm">
              Refunds on non-flexible fares are limited to unused taxes and government charges, and are paid
              to the original form of payment.
            </Text>
          </Stack>
        </Collapsible.Panel>
      </Collapsible.Root>
    </Surface>
  ),
};

/**
 * `hiddenUntilFound` keeps the panel in the accessibility tree as hidden-but-findable, so the
 * browser's own find-in-page can open it. Worth it for reference copy nobody will think to expand.
 */
export const FindableWhenClosed: Story = {
  render: () => (
    <Collapsible.Root>
      <Collapsible.Trigger>
        Baggage allowance <Badge size="sm">23 kg</Badge>
      </Collapsible.Trigger>
      <Collapsible.Panel hiddenUntilFound>
        <Text size="sm">
          One checked piece up to 23 kg, plus one cabin bag up to 10 kg and one personal item.
        </Text>
      </Collapsible.Panel>
    </Collapsible.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: /Baggage allowance/ });
    // `hidden="until-found"` keeps the element in the DOM, unlike the default unmount — that is
    // the whole difference, and it is what find-in-page needs to have something to find.
    const panel = canvasElement.querySelector('[hidden="until-found"]');
    await expect(panel).not.toBeNull();

    await userEvent.click(trigger);
    await expect(canvas.getByText(/One checked piece/)).toBeVisible();
  },
};
