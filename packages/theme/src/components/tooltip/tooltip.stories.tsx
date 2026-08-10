import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';

import { IconButton } from '../icon-button/icon-button';
import { ChevronDownIcon, MinusIcon, PlusIcon, SearchIcon } from '../icons/icons';
import { Stack } from '../stack/stack';
import { Tooltip } from './tooltip';
import type { TooltipSide } from './tooltip';

const meta = {
  title: 'Components/Tooltip',
  component: Tooltip.Root,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Tooltip.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Waits out the enter transition before anything measures or looks at the popup.
 *
 * Base UI mounts the popup with `data-starting-style` still on it and the theme fades and
 * scales it in, so at the instant `findByText` resolves the popup is at `opacity: 0` and
 * `scale(0.94)`. `toBeVisible` reads computed opacity and `getBoundingClientRect` reports the
 * TRANSFORMED box, so an assertion made there is about a frame no reader ever sees — and it
 * passes or fails on how fast the machine painted rather than on the component.
 */
const settled = async (popup: HTMLElement): Promise<HTMLElement> => {
  await waitFor(() => expect(getComputedStyle(popup).opacity).toBe('1'));
  return popup;
};

/**
 * Asserts the tooltip's words are gone, and so leaves nothing behind for the next story.
 *
 * `waitForElementToBeRemoved` is the wrong tool: it THROWS when the element is already absent,
 * and Base UI unmounts the popup the moment the exit transition it awaits reports finished —
 * which for a tooltip, whose transition is 80ms and is suppressed outright while `data-instant`
 * is set, is regularly before the unhover has even resolved.
 */
const expectClosed = async (text: string | RegExp): Promise<void> => {
  await waitFor(() => expect(screen.queryByText(text)).toBeNull());
};

/**
 * The popup is portalled to `<body>` and has no ARIA role of its own, so it is found by its
 * text rather than by role — which is the point of the component, not a shortcoming of the
 * test: a tooltip is a visual echo, and the accessible name lives on the trigger.
 *
 * The generous timeout covers Base UI's 600ms opening delay, which the stories deliberately do
 * not shorten. A tooltip that opens instantly is a tooltip that flickers across a toolbar.
 */
const hoverForTooltip = async (trigger: HTMLElement, text: string | RegExp): Promise<HTMLElement> => {
  await userEvent.hover(trigger);
  return settled(await screen.findByText(text, {}, { timeout: 3000 }));
};

/**
 * The pattern every other story here repeats: the trigger is an IconButton, whose required
 * `label` IS the accessible name, and the tooltip shows the same words to the people who can
 * see them. Delete the tooltip and the control is still usable; delete the label and it is not.
 */
export const Default: Story = {
  render: (args) => (
    <Tooltip.Provider>
      <Tooltip.Root {...args}>
        <Tooltip.Trigger
          render={
            <IconButton label="Search flights">
              <SearchIcon />
            </IconButton>
          }
        />
        <Tooltip.Portal>
          <Tooltip.Positioner>
            <Tooltip.Popup>
              <Tooltip.Arrow />
              Search flights
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Search flights' });

    // The invariant the whole component depends on, asserted rather than described: the
    // tooltip's words are a repeat of a name the control already had. If these two ever
    // diverge, a screen reader and a sighted user are being told different things.
    const popup = await hoverForTooltip(trigger, 'Search flights');
    await expect(popup.textContent).toBe(trigger.getAttribute('aria-label'));

    await userEvent.unhover(trigger);
    await expectClosed('Search flights');
  },
};

const TOOLBAR = [
  { label: 'Add passenger', icon: <PlusIcon /> },
  { label: 'Remove passenger', icon: <MinusIcon /> },
  { label: 'Expand details', icon: <ChevronDownIcon /> },
] as const;

/**
 * What the Provider is for. Once one tooltip in the group is open, the next opens immediately,
 * so sweeping a pointer along a toolbar reads as one label following the cursor rather than as
 * three separate waits.
 */
export const Toolbar: Story = {
  render: () => (
    <Tooltip.Provider>
      <Stack direction="row" gap={1} align="center">
        {TOOLBAR.map(({ label, icon }) => (
          <Tooltip.Root key={label}>
            <Tooltip.Trigger render={<IconButton label={label}>{icon}</IconButton>} />
            <Tooltip.Portal>
              <Tooltip.Positioner>
                <Tooltip.Popup>
                  <Tooltip.Arrow />
                  {label}
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        ))}
      </Stack>
    </Tooltip.Provider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Every control is named without the tooltip's help. A toolbar of unnamed glyphs is the
    // failure a tooltip is most often used to paper over.
    const names = canvas.getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    await expect(names).toEqual(['Add passenger', 'Remove passenger', 'Expand details']);

    const first = canvas.getByRole('button', { name: 'Add passenger' });
    await hoverForTooltip(first, 'Add passenger');

    // Moving to the next trigger swaps the label and does not leave the previous one behind.
    // Polled rather than asserted outright: the outgoing popup unmounts after its exit
    // transition, so the previous label can still be in the document for a frame or two.
    const second = canvas.getByRole('button', { name: 'Remove passenger' });
    await hoverForTooltip(second, 'Remove passenger');
    await expectClosed('Add passenger');

    // Off the toolbar before the story returns, so the next story does not inherit an open
    // popup — or the Provider's "one has been open recently, skip the delay" state.
    await userEvent.unhover(second);
    await expectClosed('Remove passenger');
  },
};

const SIDES: readonly TooltipSide[] = ['top', 'right', 'bottom', 'left'];

/**
 * The four preferred sides. As with Popover, the play function does not assert that a tooltip
 * opened on the side it asked for — Base UI flips when there is no room, which is correct and
 * would make the test a function of the window size. It asserts what must hold either way: the
 * arrow points the same way the popup does, and the popup is inside the window.
 */
export const Sides: Story = {
  render: () => (
    <Tooltip.Provider>
      <Stack direction="row" gap={2} wrap justify="center">
        {SIDES.map((side) => (
          <Tooltip.Root key={side}>
            <Tooltip.Trigger variant="outline" tone="neutral">{`Hover ${side}`}</Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Positioner side={side}>
                <Tooltip.Popup>
                  <Tooltip.Arrow />
                  {`Anchored ${side}`}
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        ))}
      </Stack>
    </Tooltip.Provider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    for (const side of SIDES) {
      const trigger = canvas.getByRole('button', { name: `Hover ${side}` });
      const popup = await hoverForTooltip(trigger, `Anchored ${side}`);

      const arrow = popup.querySelector('[aria-hidden="true"]');
      await expect(arrow).not.toBeNull();
      await expect(arrow?.getAttribute('data-side')).toBe(popup.getAttribute('data-side'));

      const box = popup.getBoundingClientRect();
      await expect(box.left).toBeGreaterThanOrEqual(0);
      await expect(box.top).toBeGreaterThanOrEqual(0);
      await expect(box.right).toBeLessThanOrEqual(window.innerWidth);
      await expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);

      await userEvent.unhover(trigger);
      await expectClosed(`Anchored ${side}`);
    }
  },
};

/** Keyboard focus opens it too, which is the only reason a tooltip reaches anyone without a mouse. */
export const OpensOnKeyboardFocus: Story = {
  render: () => (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger variant="outline" tone="neutral">
          Fare rules
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner>
            <Tooltip.Popup>
              <Tooltip.Arrow />
              Changes are free up to 14 days out
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Fare rules' });

    await userEvent.tab();
    await expect(trigger).toHaveFocus();
    await expect(
      await settled(await screen.findByText('Changes are free up to 14 days out', {}, { timeout: 3000 })),
    ).toBeVisible();

    // Escape dismisses a focus-opened tooltip without moving focus, which is WCAG 1.4.13's
    // "dismissable" requirement and also what keeps this story from handing the next one an
    // open popup.
    await userEvent.keyboard('{Escape}');
    await expectClosed('Changes are free up to 14 days out');
    await expect(trigger).toHaveFocus();
  },
};

/**
 * A long label wraps at a readable measure instead of stretching to the window. If a tooltip
 * needs more room than this, the content belongs in a Popover, where it is reachable by touch
 * and by a screen reader.
 */
export const LongLabel: Story = {
  render: () => (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger variant="outline" tone="neutral">
          Baggage
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner>
            <Tooltip.Popup>
              <Tooltip.Arrow />
              One cabin bag up to 7 kg and one checked bag up to 23 kg on both legs, measured at the gate
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Baggage' });
    const popup = await hoverForTooltip(trigger, /One cabin bag up to 7 kg/);
    const box = popup.getBoundingClientRect();

    await expect(box.width).toBeLessThanOrEqual(window.innerWidth);
    await expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    // Wrapped rather than run on: nothing spills sideways out of the popup's own box.
    await expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth + 1);

    await userEvent.unhover(trigger);
    await expectClosed(/One cabin bag up to 7 kg/);
  },
};

/**
 * `disabled` on the Root suppresses the tooltip and leaves the control alone — which is the
 * distinction Base UI's own `disabled` on the trigger blurs, and the reason Nerey's trigger
 * does not have one.
 */
export const Disabled: Story = {
  args: { disabled: true },
  render: (args) => (
    <Tooltip.Provider>
      <Tooltip.Root {...args}>
        <Tooltip.Trigger
          render={
            <IconButton label="Search flights">
              <SearchIcon />
            </IconButton>
          }
        />
        <Tooltip.Portal>
          <Tooltip.Positioner>
            <Tooltip.Popup>
              <Tooltip.Arrow />
              Search flights
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Search flights' });

    await userEvent.hover(trigger);
    await userEvent.click(trigger);

    // The control still works and still has its name; only the echo is gone.
    await expect(trigger).toBeEnabled();
    await expect(trigger).toHaveAccessibleName('Search flights');
    await expect(screen.queryByText('Search flights')).toBeNull();
  },
};
