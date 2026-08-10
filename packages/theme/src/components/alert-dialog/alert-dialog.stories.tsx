import type { Meta, StoryObj } from '@storybook/react-vite';
import { Fragment } from 'react';
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test';

import { Text } from '../text/text';
import { AlertDialog } from './alert-dialog';

const meta = {
  title: 'Components/AlertDialog',
  component: AlertDialog.Root,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof AlertDialog.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Waits out the enter transition before anything measures or looks at the popup.
 *
 * Base UI mounts the popup with `data-starting-style` still on it and lets the theme's own
 * transition carry it in, so at the instant `findByRole` resolves the confirmation is at
 * `opacity: 0` and `scale(0.98)`. `toBeVisible` reads computed opacity, so an assertion made
 * there describes a frame no reader ever sees — and passes or fails on how fast the machine
 * painted rather than on anything about the component.
 */
const settled = async (popup: HTMLElement): Promise<HTMLElement> => {
  await waitFor(() => expect(getComputedStyle(popup).opacity).toBe('1'));
  return popup;
};

/**
 * Asserts the confirmation is gone, and so leaves nothing behind for the next story.
 *
 * `waitForElementToBeRemoved` is the wrong tool here: it THROWS when the element is already
 * absent, and Base UI unmounts the popup the moment the exit transition it awaits reports
 * finished — sometimes before the click that closed it has resolved, sometimes a transition
 * later. "Nothing is left open" is the claim worth making, and it is true either way.
 */
const expectClosed = async (): Promise<void> => {
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
};

/**
 * The popup is portalled to `<body>`, so every query goes through `screen` — `canvasElement`
 * does not contain it, and a canvas-scoped query would report "not found" for a confirmation
 * that is plainly on screen.
 */
const openAlert = async (name: string): Promise<HTMLElement> => {
  await userEvent.click(await screen.findByRole('button', { name }));
  return settled(await screen.findByRole('alertdialog'));
};

export const Default: Story = {
  render: (args) => (
    <AlertDialog.Root {...args}>
      <AlertDialog.Trigger variant="outline" tone="neutral">
        Discard changes
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Popup>
          <AlertDialog.Title>Discard your changes?</AlertDialog.Title>
          <AlertDialog.Description>
            The seat map, the meal preference and the two bags you added have not been saved.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Close>Keep editing</AlertDialog.Close>
            <AlertDialog.Close variant="solid" tone="neutral">
              Discard
            </AlertDialog.Close>
          </AlertDialog.Footer>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  ),
  play: async () => {
    const alert = await openAlert('Discard changes');
    await expect(alert).toHaveAccessibleName('Discard your changes?');
    await expect(alert).toHaveAccessibleDescription(/meal preference/);

    await userEvent.click(within(alert).getByRole('button', { name: 'Keep editing' }));
    await expectClosed();
  },
};

/**
 * The two properties that make this component different from Dialog, asserted rather than
 * described: the popup is an `alertdialog` — which is what tells assistive technology the
 * content interrupts rather than informs — and the only ways out are the two labelled answers.
 * There is no corner ✕, because an unlabelled third exit is the one people take without
 * reading either of the other two.
 */
export const MustBeAnswered: Story = {
  render: () => (
    <AlertDialog.Root>
      <AlertDialog.Trigger variant="outline" tone="neutral">
        Leave the check-in
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Popup>
          <AlertDialog.Title>Leave check-in?</AlertDialog.Title>
          <AlertDialog.Description>
            Your boarding pass has not been issued yet. Leaving now returns the seat to the pool.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Close>Stay</AlertDialog.Close>
            <AlertDialog.Close variant="solid" tone="neutral">
              Leave
            </AlertDialog.Close>
          </AlertDialog.Footer>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  ),
  play: async () => {
    const alert = await openAlert('Leave the check-in');

    // `alertdialog`, not `dialog`. Base UI derives the role from the component, so this also
    // catches the wrapper being pointed at the wrong Base UI namespace.
    await expect(alert).toHaveAttribute('role', 'alertdialog');

    const names = within(alert)
      .getAllByRole('button')
      .map((button) => button.textContent);
    await expect(names).toEqual(['Stay', 'Leave']);

    // Answered before the story returns. An alert dialog left mounted hands the next story a
    // focus trap and a scroll lock, which is exactly the failure this component is supposed to
    // be able to clean up after.
    await userEvent.click(within(alert).getByRole('button', { name: 'Stay' }));
    await expectClosed();
  },
};

/**
 * Escape closes it, and that is not a contradiction of "must be answered": Escape is the
 * keyboard's only exit from a focus trap, and it means the same thing as the cancelling answer.
 * A surface that swallowed it would be a surface that traps.
 */
export const EscapeStillCloses: Story = {
  render: () => (
    <AlertDialog.Root>
      <AlertDialog.Trigger variant="outline" tone="neutral">
        Remove passenger
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Popup>
          <AlertDialog.Title>Remove Ana from this booking?</AlertDialog.Title>
          <AlertDialog.Description>Her seat and meal preference go with her.</AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Close>Keep Ana</AlertDialog.Close>
          </AlertDialog.Footer>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  ),
  play: async () => {
    await openAlert('Remove passenger');
    await userEvent.keyboard('{Escape}');
    await expectClosed();

    // Focus goes back to the trigger. Without it a keyboard user is returned to the top of the
    // document and has to find their place again. `waitFor`, because Base UI restores focus
    // after the popup unmounts rather than with it.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove passenger' })).toHaveFocus());
  },
};

/**
 * `tone="danger"` tints the frame and the heading and adds nothing else — the title still has
 * to say what is being destroyed, because colour on its own reaches nobody who cannot see it
 * (WCAG 1.4.1).
 *
 * The destructive answer is `outline` rather than `solid`. `--nerey-text-on-accent` on
 * `--nerey-surface-danger` measures 4.17:1 in the dark theme, under the 4.5:1 that 14px text
 * needs; the outline pairing measures 6.68:1 dark and 7.23:1 light. That is a token-level
 * defect, not a component one, and tokens.css is not this component's to edit.
 */
export const DangerTone: Story = {
  args: { onOpenChange: fn() },
  render: (args) => (
    <AlertDialog.Root {...args}>
      <AlertDialog.Trigger variant="outline" tone="danger">
        Delete this booking
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Popup tone="danger">
          <AlertDialog.Title>Delete booking QF-4471?</AlertDialog.Title>
          <AlertDialog.Description>
            This cannot be undone. The fare is non-refundable and the two checked bags are forfeited.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Close>Keep the booking</AlertDialog.Close>
            <AlertDialog.Close tone="danger">Delete it</AlertDialog.Close>
          </AlertDialog.Footer>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  ),
  play: async ({ args }) => {
    const alert = await openAlert('Delete this booking');

    // The title carries the consequence in words. If this assertion ever has to be relaxed to
    // something generic, the tone has started doing the work the sentence should be doing.
    await expect(alert).toHaveAccessibleName(/Delete booking/);

    await userEvent.click(within(alert).getByRole('button', { name: 'Delete it' }));
    await expectClosed();

    // One argument, not two: Root wraps Base UI's handler so the declared signature is also
    // the runtime one.
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
  },
};

const CONSEQUENCES = [
  'The outbound flight on 14 March is released and the seat returns to the pool.',
  'The return flight on 22 March is released with it; the two legs cannot be split.',
  'The two checked bags you paid for are forfeited and cannot be transferred.',
  'Lounge access purchased with the fare is cancelled with no refund.',
  'Any travel insurance bought through us is cancelled from the date of deletion.',
  'The booking reference stops working immediately, including in the mobile app.',
  'Loyalty points already credited for this itinerary are reversed within 48 hours.',
];

/** Content taller than the window scrolls the viewport; the confirmation keeps its width. */
export const LongContent: Story = {
  render: () => (
    <AlertDialog.Root>
      <AlertDialog.Trigger variant="outline" tone="danger">
        Delete everything
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Popup tone="danger">
          <AlertDialog.Title>Delete this booking and everything attached to it?</AlertDialog.Title>
          <AlertDialog.Description>Here is what goes with it.</AlertDialog.Description>
          {(['Outbound leg', 'Return leg'] as const).map((leg) => (
            <Fragment key={leg}>
              <Text weight="semibold">{leg}</Text>
              {CONSEQUENCES.map((line) => (
                <Text key={line} tone="secondary">
                  {line}
                </Text>
              ))}
            </Fragment>
          ))}
          <AlertDialog.Footer>
            <AlertDialog.Close>Keep everything</AlertDialog.Close>
            <AlertDialog.Close tone="danger">Delete it all</AlertDialog.Close>
          </AlertDialog.Footer>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  ),
  play: async () => {
    const alert = await openAlert('Delete everything');
    const viewport = alert.parentElement;

    await expect(viewport).not.toBeNull();
    await expect(viewport?.scrollHeight ?? 0).toBeGreaterThan(viewport?.clientHeight ?? 0);

    // Both answers survive the overflow — an unreachable button is the failure this story
    // exists to catch.
    await expect(within(alert).getByRole('button', { name: 'Delete it all' })).toBeVisible();

    await userEvent.click(within(alert).getByRole('button', { name: 'Keep everything' }));
    await expectClosed();
  },
};
