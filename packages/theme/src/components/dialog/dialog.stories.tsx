import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';

import { Button } from '../button/button';
import { IconButton } from '../icon-button/icon-button';
import { DotsHorizontalIcon } from '../icons/icons';
import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Dialog } from './dialog';
import type { DialogSize } from './dialog';

const meta = {
  title: 'Components/Dialog',
  component: Dialog.Root,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Dialog.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Waits out the enter transition before anything measures or looks at the popup.
 *
 * Base UI mounts the popup with `data-starting-style` still on it and lets the theme's own
 * transition carry it in, so at the instant `findByRole` resolves the dialog is at `opacity: 0`
 * and `scale(0.98)`. `toBeVisible` reads computed opacity and `getBoundingClientRect` reports
 * the TRANSFORMED box, so an assertion made there is an assertion about a frame no reader ever
 * sees — and it passes or fails depending on how fast the machine painted.
 */
const settled = async (popup: HTMLElement): Promise<HTMLElement> => {
  await waitFor(() => expect(getComputedStyle(popup).opacity).toBe('1'));
  return popup;
};

/**
 * Asserts the overlay is gone, and so leaves nothing behind for the next story.
 *
 * `waitForElementToBeRemoved` is the wrong tool for a Base UI overlay: it THROWS when the
 * element is already absent, and Base UI unmounts the popup the moment the exit transition it
 * awaits reports finished — which, interleaved with `userEvent`'s own awaits, is sometimes
 * before the click that closed it has resolved and sometimes a transition later. The claim
 * worth making is "nothing is left open", and that claim is true either way.
 */
const expectClosed = async (): Promise<void> => {
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};

/**
 * Every play function reaches for `screen`, not for `within(canvasElement)`. The popup is
 * portalled to `<body>`, so the story canvas does not contain it — a query scoped to the canvas
 * would search an empty subtree and report "not found" for a dialog that is plainly on screen.
 */
const openDialog = async (name: string): Promise<HTMLElement> => {
  await userEvent.click(await screen.findByRole('button', { name }));
  return settled(await screen.findByRole('dialog'));
};

export const Default: Story = {
  render: (args) => (
    <Dialog.Root {...args}>
      <Dialog.Trigger>Change seat</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>Change your seat</Dialog.Title>
          <Dialog.Description>
            You are in 14A, a window seat over the wing. 12C is an aisle seat with extra legroom and costs
            nothing to move to.
          </Dialog.Description>
          <Dialog.Footer>
            <Dialog.Close>Keep 14A</Dialog.Close>
            <Button>Move to 12C</Button>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  ),
  play: async () => {
    const dialog = await openDialog('Change seat');

    // The accessible name comes from Dialog.Title through `aria-labelledby`, which is the
    // property worth asserting: a dialog announced as "dialog" and nothing else is the most
    // common way this component is shipped broken.
    await expect(dialog).toHaveAccessibleName('Change your seat');
    await expect(dialog).toHaveAccessibleDescription(/window seat over the wing/);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await expectClosed();
  },
};

/** Escape closes a modal dialog. It is the keyboard's only exit, so it is worth a test. */
export const DismissedByEscape: Story = {
  render: () => (
    <Dialog.Root>
      <Dialog.Trigger>Review itinerary</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>Review itinerary</Dialog.Title>
          <Dialog.Description>Two flights, one overnight stop in Reykjavík.</Dialog.Description>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  ),
  play: async () => {
    await openDialog('Review itinerary');
    await userEvent.keyboard('{Escape}');
    await expectClosed();

    // Focus returns to the control that opened the dialog. Without it a keyboard user lands
    // back at the top of the document and has to find their place again. `waitFor`, because
    // Base UI restores focus after the popup unmounts, not with it.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Review itinerary' })).toHaveFocus());
  },
};

const SIZES: readonly DialogSize[] = ['sm', 'md', 'lg', 'fullscreen'];

/**
 * The four widths, opened one at a time. A grid is impossible here — one Root shows one popup —
 * so the story measures instead of showing, which is the more useful claim anyway.
 */
export const Sizes: Story = {
  render: () => (
    <Stack direction="row" gap={2} wrap>
      {SIZES.map((size) => (
        <Dialog.Root key={size}>
          <Dialog.Trigger variant="outline" tone="neutral">{`Open ${size}`}</Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Backdrop />
            <Dialog.Popup size={size}>
              <Dialog.Title>{`A ${size} dialog`}</Dialog.Title>
              <Dialog.Description>
                Widths are fractions of the widget column, so a dialog and the widget that opened it stay the
                same family of surface.
              </Dialog.Description>
              <Dialog.Footer>
                <Dialog.Close>Done</Dialog.Close>
              </Dialog.Footer>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      ))}
    </Stack>
  ),
  play: async () => {
    const widths: number[] = [];
    let fullscreenRadius = '';

    for (const size of SIZES) {
      const dialog = await openDialog(`Open ${size}`);
      widths.push(dialog.getBoundingClientRect().width);
      if (size === 'fullscreen') fullscreenRadius = getComputedStyle(dialog).borderTopLeftRadius;

      await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
      await expectClosed();
    }

    const [sm = 0, md = 0, lg = 0, full = 0] = widths;

    // Non-strict between the three bounded sizes on purpose: on a narrow window they all cap
    // out at the window width, and a test demanding a difference there would be failing for
    // being run on a phone rather than for the component being wrong. The two STRICT claims
    // are the ones that hold at every window size, because fullscreen alone drops the inset.
    await expect(sm).toBeLessThanOrEqual(md);
    await expect(md).toBeLessThanOrEqual(lg);
    await expect(lg).toBeLessThan(full);
    await expect(sm).toBeLessThan(full);

    // A fullscreen dialog has no corners to round — the rounding would be against the window.
    await expect(fullscreenRadius).toBe('0px');
  },
};

const PASSAGES = [
  'Checked baggage is included on both legs, up to 23 kg per bag.',
  'The overnight stop is 11 hours. Airport transfers are not included in the fare.',
  'Seat selection reopens 24 hours before departure and closes 90 minutes before.',
  'Changes made more than 14 days before departure carry no fee. Inside 14 days the fare difference applies.',
  'Refunds are issued to the original payment method within 7 to 10 working days.',
  'Travel insurance purchased through us can be cancelled within 14 days for a full refund.',
  'A crew rest period is scheduled on the second leg; the cabin lights dim for six hours.',
  'Special meals must be requested at least 48 hours before departure.',
  'Lounge access is included with the fare on the outbound leg only.',
  'The aircraft on the return leg is subject to change without notice.',
];

/**
 * Long content scrolls the viewport, not the popup: the dialog keeps its shape and grows past
 * the bottom of the window. The passages are rendered once per leg rather than padded out with
 * filler, so the story is the length a real fare-rules dialog is.
 */
export const LongContent: Story = {
  render: () => (
    <Dialog.Root>
      <Dialog.Trigger>Read the fare rules</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>Fare rules</Dialog.Title>
          <Dialog.Description>Everything the fare commits you to, in full.</Dialog.Description>
          {(['Outbound leg', 'Return leg'] as const).map((leg) => (
            <Stack key={leg} gap={2}>
              <Text weight="semibold">{leg}</Text>
              {PASSAGES.map((passage) => (
                <Text key={passage} tone="secondary">
                  {passage}
                </Text>
              ))}
            </Stack>
          ))}
          <Dialog.Footer>
            <Dialog.Close>Close</Dialog.Close>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  ),
  play: async () => {
    const dialog = await openDialog('Read the fare rules');
    const viewport = dialog.parentElement;

    // The scroll container is the viewport Dialog.Popup renders around the popup, and the
    // popup is allowed to be taller than the window — that is what "outside scroll" means.
    await expect(viewport).not.toBeNull();
    await expect(viewport?.scrollHeight ?? 0).toBeGreaterThan(viewport?.clientHeight ?? 0);

    // Escape rather than a named button: the footer's Close and the corner dismiss control
    // share the accessible name "Close", so a name query would match two elements. Closing at
    // all is the point — a story that returns with a modal still mounted hands the next story
    // a focus trap and a scroll lock it never asked for.
    await userEvent.keyboard('{Escape}');
    await expectClosed();
  },
};

function ControlledDialog(): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <Stack gap={3} align="start">
      <Text tone="secondary">{open ? 'Dialog is open' : 'Dialog is closed'}</Text>
      <Button onClick={() => setOpen(true)}>Cancel booking</Button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup size="sm">
            <Dialog.Title>Cancel this booking?</Dialog.Title>
            <Dialog.Description>The fare is refundable until 14 March.</Dialog.Description>
            <Dialog.Footer>
              <Dialog.Close>Keep it</Dialog.Close>
              <Button onClick={() => setOpen(false)}>Cancel booking</Button>
            </Dialog.Footer>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </Stack>
  );
}

/**
 * `open` + `onOpenChange` with no Trigger inside the Root at all: the dialog is opened from a
 * button that has nothing to do with the anatomy, which is what controlled state is for.
 */
export const Controlled: Story = {
  render: () => <ControlledDialog />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Dialog is closed')).toBeVisible();

    await userEvent.click(canvas.getByRole('button', { name: 'Cancel booking' }));
    const dialog = await settled(await screen.findByRole('dialog'));
    await expect(canvas.getByText('Dialog is open')).toBeVisible();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    await expectClosed();
    await expect(canvas.getByText('Dialog is closed')).toBeVisible();
  },
};

/** A disabled trigger opens nothing, and says so to assistive technology rather than by colour. */
export const DisabledTrigger: Story = {
  render: () => (
    <Dialog.Root>
      <Dialog.Trigger disabled>Change seat</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <Dialog.Title>Change your seat</Dialog.Title>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Change seat' });
    await expect(trigger).toBeDisabled();
    await expect(screen.queryByRole('dialog')).toBeNull();
  },
};

/**
 * `render` substitutes the whole control, which is why it cannot be combined with `variant`:
 * an IconButton has already decided how it is painted, and it brings the required `label` that
 * a glyph-only trigger needs.
 */
export const CustomTrigger: Story = {
  render: () => (
    <Dialog.Root>
      <Dialog.Trigger
        render={
          <IconButton label="Booking actions">
            <DotsHorizontalIcon />
          </IconButton>
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup size="sm">
          <Dialog.Title>Booking actions</Dialog.Title>
          <Dialog.Description>Everything you can still do to this reservation.</Dialog.Description>
          <Dialog.Footer>
            <Dialog.Close>Close</Dialog.Close>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Booking actions' });
    // The glyph is decorative; the name comes from IconButton's required label, and Base UI's
    // open-state wiring rides along on the same element.
    await expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    await userEvent.click(trigger);
    await expect(await screen.findByRole('dialog')).toHaveAccessibleName('Booking actions');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Escape rather than a named button — the footer's Close and the corner dismiss control
    // share the name "Close". The story has to hand the suite back a page with no modal on it.
    await userEvent.keyboard('{Escape}');
    await expectClosed();
  },
};
