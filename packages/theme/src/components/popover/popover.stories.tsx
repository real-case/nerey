import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';

import { Button } from '../button/button';
import { IconButton } from '../icon-button/icon-button';
import { InfoIcon } from '../icons/icons';
import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Popover } from './popover';
import type { PopoverSide } from './popover';

const meta = {
  title: 'Components/Popover',
  component: Popover.Root,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Popover.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Waits out the enter transition before anything measures or looks at the popup.
 *
 * Base UI mounts the popup with `data-starting-style` still on it and the theme fades and
 * scales it in, so at the instant `findByRole` resolves the popup is at `opacity: 0` and
 * `scale(0.96)`. `toBeVisible` reads computed opacity — including the popup's, for a button
 * nested inside it — and `getBoundingClientRect` reports the TRANSFORMED box, so anything
 * asserted there is asserted about a frame no reader ever sees.
 */
const settled = async (popup: HTMLElement): Promise<HTMLElement> => {
  await waitFor(() => expect(getComputedStyle(popup).opacity).toBe('1'));
  return popup;
};

/**
 * Asserts the popover is gone, and so leaves nothing behind for the next story.
 *
 * `waitForElementToBeRemoved` is the wrong tool for a Base UI overlay: it THROWS when the
 * element is already absent, and Base UI unmounts the popup the moment the exit transition it
 * awaits reports finished — sometimes before the interaction that closed it has resolved,
 * sometimes a transition later. "Nothing is left open" is true either way.
 */
const expectClosed = async (): Promise<void> => {
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};

/**
 * The popup is portalled to `<body>`, so queries go through `screen`. Base UI gives it
 * `role="dialog"` — a popover is a dialog that happens to be anchored, not a new role.
 */
const openPopover = async (name: string): Promise<HTMLElement> => {
  await userEvent.click(await screen.findByRole('button', { name }));
  return settled(await screen.findByRole('dialog'));
};

export const Default: Story = {
  render: (args) => (
    <Popover.Root {...args}>
      <Popover.Trigger variant="outline" tone="neutral">
        Baggage allowance
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner>
          <Popover.Popup>
            <Popover.Arrow />
            <Popover.Title>Baggage allowance</Popover.Title>
            <Popover.Description>
              One cabin bag up to 7 kg and one checked bag up to 23 kg, on both legs.
            </Popover.Description>
            <Popover.Close>Got it</Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  ),
  play: async () => {
    const popup = await openPopover('Baggage allowance');
    await expect(popup).toHaveAccessibleName('Baggage allowance');
    await expect(popup).toHaveAccessibleDescription(/One cabin bag/);

    await userEvent.click(within(popup).getByRole('button', { name: 'Got it' }));
    await expectClosed();
  },
};

const SIDES: readonly PopoverSide[] = ['top', 'right', 'bottom', 'left'];

/**
 * The four preferred sides. The play function does NOT assert that a popover opened on the side
 * it asked for — Base UI flips to the opposite side when there is no room, which is the correct
 * behaviour and would make the test a function of the window size. It asserts the two things
 * that must hold whichever side wins: the arrow points the same way the popup does, and the
 * popup is inside the window.
 */
export const Sides: Story = {
  render: () => (
    <Stack direction="row" gap={2} wrap justify="center">
      {SIDES.map((side) => (
        <Popover.Root key={side}>
          <Popover.Trigger variant="outline" tone="neutral">{`Open ${side}`}</Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side={side}>
              <Popover.Popup>
                <Popover.Arrow />
                <Popover.Title>{`Anchored ${side}`}</Popover.Title>
                <Popover.Description>Short enough to fit anywhere.</Popover.Description>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ))}
    </Stack>
  ),
  play: async () => {
    for (const side of SIDES) {
      const popup = await openPopover(`Open ${side}`);

      // The arrow is `aria-hidden`, so it is queried structurally rather than by role — it is
      // a pointer at a relationship the accessibility tree already carries on the trigger.
      const arrow = popup.querySelector('[aria-hidden="true"]');
      await expect(arrow).not.toBeNull();
      await expect(arrow?.getAttribute('data-side')).toBe(popup.getAttribute('data-side'));

      const box = popup.getBoundingClientRect();
      await expect(box.left).toBeGreaterThanOrEqual(0);
      await expect(box.top).toBeGreaterThanOrEqual(0);
      await expect(box.right).toBeLessThanOrEqual(window.innerWidth);
      await expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);

      await userEvent.keyboard('{Escape}');
      await expectClosed();
    }
  },
};

/**
 * The accessible information affordance, and the reason it is a popover rather than a tooltip:
 * it opens on hover for a mouse, on press for touch, and on Enter from the keyboard, and its
 * content is real content that a screen reader can reach. A tooltip does none of those three.
 */
export const InfoOnHover: Story = {
  render: () => (
    <Stack direction="row" gap={2} align="center">
      <Text>Fare: refundable</Text>
      <Popover.Root>
        <Popover.Trigger
          openOnHover
          render={
            <IconButton label="What refundable means">
              <InfoIcon />
            </IconButton>
          }
        />
        <Popover.Portal>
          <Popover.Positioner side="top">
            <Popover.Popup>
              <Popover.Arrow />
              <Popover.Title>Refundable fares</Popover.Title>
              <Popover.Description>
                Cancel up to 24 hours before departure and the fare returns to the original payment method
                within 10 working days.
              </Popover.Description>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'What refundable means' });

    // The trigger carries its own name. The popover's content is extra, never the only place
    // the affordance is described.
    await expect(trigger).toHaveAccessibleName('What refundable means');

    await userEvent.hover(trigger);
    const popup = await settled(await screen.findByRole('dialog'));
    await expect(popup).toHaveAccessibleName('Refundable fares');

    // Closed before the story returns. A hover-opened popover left mounted is still a dialog
    // in the next story's document, and axe would go on to audit it there.
    await userEvent.keyboard('{Escape}');
    await expectClosed();
  },
};

/**
 * A single long paragraph. The popup hugs its content up to a readable measure and then wraps —
 * without the cap, `width: max-content` would produce one 900-pixel line on a desktop, which is
 * unreadable for reasons that have nothing to do with collision detection.
 */
export const LongContent: Story = {
  render: () => (
    <Popover.Root>
      <Popover.Trigger variant="outline" tone="neutral">
        Why was this delayed?
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner>
          <Popover.Popup>
            <Popover.Arrow />
            <Popover.Title>Delay reason</Popover.Title>
            <Popover.Description>
              The inbound aircraft was held at its origin by an air traffic flow restriction, which pushed the
              turnaround past the crew duty limit and required a replacement first officer to be called in
              from standby. The replacement arrived at 14:05 and the aircraft pushed back at 14:40, which is
              the delay you are seeing on this booking.
            </Popover.Description>
            <Popover.Close>Close</Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  ),
  play: async () => {
    const popup = await openPopover('Why was this delayed?');
    const box = popup.getBoundingClientRect();

    // Capped, and still inside the window: the two constraints that make an anchored surface
    // usable at any window size.
    await expect(box.width).toBeLessThanOrEqual(window.innerWidth);
    await expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    await expect(within(popup).getByRole('button', { name: 'Close' })).toBeVisible();

    await userEvent.click(within(popup).getByRole('button', { name: 'Close' }));
    await expectClosed();
  },
};

function ControlledPopover(): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <Stack gap={3} align="start">
      <Text tone="secondary">{open ? 'Popover is open' : 'Popover is closed'}</Text>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger variant="outline" tone="neutral">
          Seat 14A
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start">
            <Popover.Popup>
              <Popover.Arrow />
              <Popover.Title>Seat 14A</Popover.Title>
              <Popover.Description>Window, over the wing, does not recline.</Popover.Description>
              <Button size="sm" onClick={() => setOpen(false)}>
                Choose this seat
              </Button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </Stack>
  );
}

/** `open` + `onOpenChange`, with an action inside the popup that closes it from the outside. */
export const Controlled: Story = {
  render: () => <ControlledPopover />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Popover is closed')).toBeVisible();

    const popup = await openPopover('Seat 14A');
    await expect(canvas.getByText('Popover is open')).toBeVisible();

    await userEvent.click(within(popup).getByRole('button', { name: 'Choose this seat' }));
    await expectClosed();
    await expect(canvas.getByText('Popover is closed')).toBeVisible();
  },
};

/** A disabled trigger opens nothing, and says so through the DOM rather than through colour. */
export const DisabledTrigger: Story = {
  render: () => (
    <Popover.Root>
      <Popover.Trigger variant="outline" tone="neutral" disabled>
        Baggage allowance
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner>
          <Popover.Popup>
            <Popover.Arrow />
            <Popover.Title>Baggage allowance</Popover.Title>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Baggage allowance' });
    await expect(trigger).toBeDisabled();
    await expect(screen.queryByRole('dialog')).toBeNull();
  },
};
