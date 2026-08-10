import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';

import { DotsHorizontalIcon } from '../icons/icons';
import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Menu } from './menu';

/**
 * ADR 0031 / 0032 — these stories are the component's test suite and its axe subject, not a
 * gallery. Base UI is a dependency for exactly one reason: the keyboard contract. So that is
 * what the `play` functions assert — arrow keys move the highlight, typeahead jumps to a
 * matching label, disabled items are skipped rather than landed on, Escape closes and returns
 * focus to the trigger. A `play` that only clicked would be testing a `<div>`.
 *
 * A menu popup is portalled to `document.body`, so it is NOT inside `canvasElement`. Queries
 * for anything inside the popup go through `screen`; queries for the trigger go through the
 * canvas.
 */
const meta = {
  title: 'Components/Menu',
  component: Menu.Root,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Menu.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const ACTIONS = ['Duplicate booking', 'Share itinerary', 'Print itinerary'] as const;

function BookingMenu({
  onSelect,
  disabledAction,
}: {
  onSelect?: (action: string) => void;
  disabledAction?: string;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger>Booking actions</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start">
          <Menu.Popup>
            {ACTIONS.map((action) => (
              <Menu.Item
                key={action}
                disabled={action === disabledAction}
                onClick={() => {
                  onSelect?.(action);
                }}
              >
                {action}
              </Menu.Item>
            ))}
            <Menu.Separator />
            <Menu.Item
              onClick={() => {
                onSelect?.('Cancel booking');
              }}
            >
              Cancel booking
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Opens from the pointer, closes from the keyboard, and hands focus back where it came from. */
export const Default: Story = {
  render: () => <BookingMenu />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Booking actions' });

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    await expect(within(menu).getAllByRole('menuitem')).toHaveLength(4);

    await userEvent.keyboard('{Escape}');
    // The exit transition keeps the popup mounted for a frame or two after the state flips.
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    // Focus lands back on the trigger rather than on `<body>`, which is the difference between
    // a menu a keyboard user can use twice and one they can use once.
    await expect(trigger).toHaveFocus();
  },
};

/**
 * The whole reason Base UI is a dependency: opening from the keyboard, moving with the arrow
 * keys, jumping with typeahead, and activating with Enter.
 */
export const KeyboardNavigation: Story = {
  render: () => <BookingMenu />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Booking actions' });

    await userEvent.tab();
    await expect(trigger).toHaveFocus();

    // ArrowDown opens AND highlights the first item — a menu that opens without a highlight
    // makes the user press the key twice for no reason.
    await userEvent.keyboard('{ArrowDown}');
    const menu = await screen.findByRole('menu');
    const first = within(menu).getByRole('menuitem', { name: 'Duplicate booking' });
    await waitFor(() => expect(first).toHaveAttribute('data-highlighted'));

    await userEvent.keyboard('{ArrowDown}');
    const second = within(menu).getByRole('menuitem', { name: 'Share itinerary' });
    await expect(second).toHaveAttribute('data-highlighted');
    await expect(first).not.toHaveAttribute('data-highlighted');

    // Typeahead matches the item's text, not its position.
    await userEvent.keyboard('c');
    await waitFor(() =>
      expect(within(menu).getByRole('menuitem', { name: 'Cancel booking' })).toHaveAttribute(
        'data-highlighted',
      ),
    );

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  },
};

/**
 * The whole chain, keyboard-only: open, move, activate.
 *
 * The result is asserted through a rendered effect rather than a spy because that is what the
 * user experiences — a spy can be called by a component that then fails to close, and the
 * story would still pass.
 */
function BookingMenuWithLog({ disabledAction }: { disabledAction?: string }) {
  const [lastAction, setLastAction] = useState('none');

  return (
    <Stack gap={3} align="start">
      <BookingMenu onSelect={setLastAction} disabledAction={disabledAction} />
      <Text tone="secondary">Last action: {lastAction}</Text>
    </Stack>
  );
}

export const ActivateWithEnter: Story = {
  render: () => <BookingMenuWithLog />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Booking actions' });

    // Opened with the keyboard rather than a click, so the starting highlight is defined:
    // ArrowDown opens the menu AND lands on the first item.
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    await screen.findByRole('menu');
    await userEvent.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    await expect(canvas.getByText('Last action: Share itinerary')).toBeInTheDocument();
    await expect(trigger).toHaveFocus();
  },
};

/**
 * A disabled item is announced and reachable, not hidden and not skipped.
 *
 * This story used to assert that arrow keys stepped OVER the disabled row. That is the wrong
 * contract for a menu, and Base UI declines to implement it on purpose — `MenuRoot` passes
 * `disabledIndices: []` to its list navigation, so every row is reachable regardless of state.
 * The APG's menu pattern prefers exactly this: a disabled item that focus cannot land on is an
 * item a screen-reader user never learns exists, and "Share itinerary, dimmed" is more useful
 * than a menu that silently has three rows for some users and four for others. What the item
 * must not do is ACT — and that is what the assertions below check.
 */
export const DisabledItem: Story = {
  render: () => <BookingMenuWithLog disabledAction="Share itinerary" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole('button', { name: 'Booking actions' });

    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    const menu = await screen.findByRole('menu');
    const disabled = within(menu).getByRole('menuitem', { name: 'Share itinerary' });
    // `data-disabled` is the styling hook; `aria-disabled` is the part a screen reader reads.
    // Both, because a row that only looks dimmed is dimmed for sighted users only.
    await expect(disabled).toHaveAttribute('data-disabled');
    await expect(disabled).toHaveAttribute('aria-disabled', 'true');
    await waitFor(() =>
      expect(within(menu).getByRole('menuitem', { name: 'Duplicate booking' })).toHaveAttribute(
        'data-highlighted',
      ),
    );

    // One press from the first item lands ON the disabled row — it is discoverable.
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(disabled).toHaveAttribute('data-highlighted'));

    // And Enter there does nothing: no action fires, and the menu does not close out from
    // under the user as though something had happened.
    await userEvent.keyboard('{Enter}');
    await expect(screen.getByRole('menu')).toBeInTheDocument();
    await expect(canvas.getByText('Last action: none')).toBeInTheDocument();

    // The next press carries on past it, so the disabled row costs one keypress, not the menu.
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(within(menu).getByRole('menuitem', { name: 'Print itinerary' })).toHaveAttribute(
        'data-highlighted',
      ),
    );
    await expect(disabled).not.toHaveAttribute('data-highlighted');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  },
};

function GroupedMenu() {
  return (
    <Menu.Root>
      <Menu.Trigger>Trip options</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start">
          <Menu.Popup>
            <Menu.Group>
              <Menu.GroupLabel>Itinerary</Menu.GroupLabel>
              <Menu.Item>Share itinerary</Menu.Item>
              <Menu.Item>Download PDF</Menu.Item>
            </Menu.Group>
            <Menu.Separator />
            <Menu.Group>
              <Menu.GroupLabel>Booking</Menu.GroupLabel>
              <Menu.Item>Change dates</Menu.Item>
              <Menu.Item>Cancel booking</Menu.Item>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Group labels are not decoration — Base UI points each group's `aria-labelledby` at them. */
export const GroupsAndSeparators: Story = {
  render: () => <GroupedMenu />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Trip options' });

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    // The groups are reachable BY NAME, which is the only thing that tells a screen-reader user
    // that "Cancel booking" belongs to Booking rather than to Itinerary.
    await expect(within(menu).getByRole('group', { name: 'Itinerary' })).toBeInTheDocument();
    await expect(within(menu).getByRole('group', { name: 'Booking' })).toBeInTheDocument();
    await expect(within(menu).getByRole('separator')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  },
};

function PreferencesMenu() {
  return (
    <Menu.Root>
      <Menu.Trigger>Preferences</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start">
          <Menu.Popup>
            <Menu.Group>
              <Menu.GroupLabel>Notify me about</Menu.GroupLabel>
              <Menu.CheckboxItem defaultChecked closeOnClick={false}>
                Gate changes
              </Menu.CheckboxItem>
              <Menu.CheckboxItem closeOnClick={false}>Price drops</Menu.CheckboxItem>
              <Menu.CheckboxItem closeOnClick={false}>Seat upgrades</Menu.CheckboxItem>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * Checkbox items report `data-checked`, unlike `Select.Item`, which reports `data-selected` —
 * the attribute follows the semantics, and these hold an independent boolean each.
 */
export const CheckboxItems: Story = {
  render: () => <PreferencesMenu />,
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('button', { name: 'Preferences' });

    // Keyboard open, so the starting highlight is the first item rather than whatever a click
    // happens to leave behind.
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    const menu = await screen.findByRole('menu');
    const gate = within(menu).getByRole('menuitemcheckbox', { name: 'Gate changes' });
    const price = within(menu).getByRole('menuitemcheckbox', { name: 'Price drops' });

    await expect(gate).toBeChecked();
    await expect(price).not.toBeChecked();

    // Space toggles without closing, so a user can set three preferences in one visit.
    await userEvent.keyboard('{ArrowDown}{ }');
    await waitFor(() => expect(price).toBeChecked());
    await expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  },
};

/**
 * The radio group is CONTROLLED, and that is the point of the story rather than an accident of
 * how it was written.
 *
 * A closed menu is an unmounted menu — `Menu.Portal` tears the popup down unless it is given
 * `keepMounted` — so a `Menu.RadioGroup` holding its own `defaultValue` starts over every time
 * the menu is reopened, and the user watches their cabin class revert to Economy. State that
 * has to outlive the popup has to live outside the popup. `keepMounted` is the other answer,
 * and it is the wrong one here: it keeps a menu's worth of DOM alive for the life of the page
 * to store one string.
 */
function CabinMenu() {
  const [cabin, setCabin] = useState('economy');

  return (
    <Stack gap={3} align="start">
      <Menu.Root>
        <Menu.Trigger>Cabin</Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="start">
            <Menu.Popup>
              <Menu.RadioGroup
                value={cabin}
                onValueChange={(next) => {
                  setCabin(next);
                }}
              >
                <Menu.GroupLabel>Cabin class</Menu.GroupLabel>
                <Menu.RadioItem value="economy">Economy</Menu.RadioItem>
                <Menu.RadioItem value="premium">Premium economy</Menu.RadioItem>
                <Menu.RadioItem value="business">Business</Menu.RadioItem>
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Text tone="secondary">Cabin: {cabin}</Text>
    </Stack>
  );
}

/**
 * One choice among a set — exactly one item carries `aria-checked` at any moment, and the
 * choice survives a close-and-reopen.
 *
 * Selecting a radio item does NOT close the menu. `Menu.Item` defaults to `closeOnClick: true`
 * and `Menu.RadioItem` defaults to `closeOnClick: false`, because the two are different acts:
 * an item does something and the menu is finished, a radio item sets a value the user may want
 * to correct without hunting for the trigger again. Both defaults are Base UI's, and the
 * `closeOnClick` prop on `Menu.RadioItem` is there for the caller who wants the other one.
 */
export const RadioItems: Story = {
  render: () => <CabinMenu />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'Cabin' });

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    const economy = within(menu).getByRole('menuitemradio', { name: 'Economy' });
    const business = within(menu).getByRole('menuitemradio', { name: 'Business' });

    await expect(economy).toBeChecked();

    await userEvent.click(business);
    await waitFor(() => expect(business).toBeChecked());
    // Exactly one at a time: the previous choice clears itself.
    await expect(economy).not.toBeChecked();
    // `onValueChange` reported the new value to the caller. Asserted through what it rendered
    // rather than through a spy, because a group that fires the callback and then fails to move
    // the mark is a bug a spy assertion would call a pass.
    await expect(canvas.getByText('Cabin: business')).toBeInTheDocument();
    await expect(screen.getByRole('menu')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());

    await userEvent.click(trigger);
    const reopened = await screen.findByRole('menu');
    await expect(within(reopened).getByRole('menuitemradio', { name: 'Business' })).toBeChecked();
    await expect(within(reopened).getByRole('menuitemradio', { name: 'Economy' })).not.toBeChecked();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  },
};

function ExportMenu() {
  return (
    <Menu.Root>
      <Menu.Trigger>Booking actions</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start">
          <Menu.Popup>
            <Menu.Item>Duplicate booking</Menu.Item>
            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger>Export as</Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner side="inline-end" align="start" sideOffset={2}>
                  <Menu.Popup>
                    <Menu.Item>PDF</Menu.Item>
                    <Menu.Item>Calendar invite</Menu.Item>
                    <Menu.Item>Spreadsheet</Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>
            <Menu.Separator />
            <Menu.Item>Cancel booking</Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/**
 * ArrowRight opens a submenu and ArrowLeft closes it — the two keys that make a nested menu
 * usable without a pointer, and the reason `SubmenuTrigger` is a distinct part rather than an
 * item with a chevron in it.
 */
export const Submenu: Story = {
  render: () => <ExportMenu />,
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('button', { name: 'Booking actions' });

    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    await screen.findByRole('menu');

    await userEvent.keyboard('{ArrowDown}');
    const submenuTrigger = screen.getByRole('menuitem', { name: 'Export as' });
    await waitFor(() => expect(submenuTrigger).toHaveAttribute('data-highlighted'));
    // The submenu is announced before it is opened, which is what lets a screen-reader user
    // know ArrowRight will do something here and nowhere else.
    await expect(submenuTrigger).toHaveAttribute('aria-haspopup', 'menu');

    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Calendar invite' })).toBeInTheDocument(),
    );

    // ArrowLeft returns to the parent without closing the whole menu.
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() =>
      expect(screen.queryByRole('menuitem', { name: 'Calendar invite' })).not.toBeInTheDocument(),
    );
    await expect(screen.getByRole('menuitem', { name: 'Export as' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  },
};

/**
 * Rendered open and non-modal so the popup's own markup is what axe reads. The rest of the
 * stories close before they finish, which leaves axe looking at a trigger and nothing else.
 */
export const OpenPopup: Story = {
  parameters: {
    /*
     * ADR 0032 allows an axe opt-out only as an explicit, reviewed parameter — this is one.
     *
     * While the popup is open, Base UI renders its own focus guards: `<span>` sentinels around
     * the trigger and around the popup that catch a Tab leaving the surface and hand focus on.
     * `utils/FocusGuard` hard-codes `tabIndex: 0` together with `aria-hidden: true` (it drops the
     * `aria-hidden` only for VoiceOver on WebKit, where the virtual cursor has to be able to see
     * them), which axe correctly reports as `aria-hidden-focus`. Nothing in Nerey's wrapper
     * reaches those elements: they are not children of `Menu.Popup` or `Menu.Trigger` in the
     * React sense, they are emitted by Base UI's floating-focus machinery, and the alternative to
     * the exclusion is either deleting the story that renders the popup open — the only one that
     * shows axe the popup at all — or turning the rule off for the whole theme.
     *
     * The selector is the guard itself and nothing else, so every real element inside the popup
     * is still evaluated. Revisit if Base UI adopts `inert` for these sentinels; the upstream
     * issue is that a focus trap needs a tabbable sentinel and ARIA has no way to say so.
     */
    a11y: { context: { exclude: ['[data-base-ui-focus-guard]'] } },
    /*
     * The waiver register of ADR 0032. It is recorded even though the opt-out is expressed as a
     * context exclusion rather than as `a11y.config.rules`: a disabled rule id would switch
     * `aria-hidden-focus` off for the whole story and hide a real defect inside the popup, while
     * excluding the two sentinel spans leaves the rule running over every element Nerey renders.
     * The register is what makes "which rules are we not honouring, where, why, until when"
     * answerable by grepping one parameter name, and an exclusion that skipped it would be
     * exactly the kind of quiet opt-out the ADR exists to prevent.
     */
    nereyA11yWaivers: [
      {
        rule: 'aria-hidden-focus',
        scope: '[data-base-ui-focus-guard]',
        reason:
          "Base UI's focus-trap sentinels are aria-hidden and tabindex=0 by construction; they are " +
          "emitted by the vendor's floating-focus machinery, no prop reaches them, and making them " +
          'untabbable would break the trap they exist to implement.',
        expires: '2027-02-10',
      },
    ],
  },
  render: () => (
    <Menu.Root defaultOpen modal={false}>
      <Menu.Trigger>Booking actions</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start">
          <Menu.Popup>
            <Menu.Group>
              <Menu.GroupLabel>Itinerary</Menu.GroupLabel>
              <Menu.Item>Share itinerary</Menu.Item>
              <Menu.Item disabled>Print itinerary</Menu.Item>
            </Menu.Group>
            <Menu.Separator />
            <Menu.CheckboxItem defaultChecked closeOnClick={false}>
              Notify me about gate changes
            </Menu.CheckboxItem>
            <Menu.RadioGroup defaultValue="economy">
              <Menu.GroupLabel>Cabin class</Menu.GroupLabel>
              <Menu.RadioItem value="economy">Economy</Menu.RadioItem>
              <Menu.RadioItem value="business">Business</Menu.RadioItem>
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  ),
  play: async () => {
    const menu = await screen.findByRole('menu');
    await expect(within(menu).getByRole('menuitemcheckbox')).toBeChecked();
    await expect(within(menu).getByRole('menuitemradio', { name: 'Economy' })).toBeChecked();
  },
};

/** Both trigger shapes and both sizes. The popup is unaffected by either. */
export const TriggerVariants: Story = {
  render: () => (
    <Stack gap={4}>
      <Stack gap={2}>
        <Text size="xs" tone="secondary" weight="semibold" mono>
          outline
        </Text>
        <Stack direction="row" gap={3} align="center">
          <Menu.Root>
            <Menu.Trigger size="sm">Small</Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner align="start">
                <Menu.Popup>
                  <Menu.Item>Share itinerary</Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <Menu.Root>
            <Menu.Trigger>Medium</Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner align="start">
                <Menu.Popup>
                  <Menu.Item>Share itinerary</Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </Stack>
      </Stack>
      <Stack gap={2}>
        <Text size="xs" tone="secondary" weight="semibold" mono>
          ghost
        </Text>
        <Stack direction="row" gap={3} align="center">
          <Menu.Root>
            {/* Icon-only: the glyph is `aria-hidden`, so the name has to come from `aria-label`. */}
            <Menu.Trigger variant="ghost" aria-label="More actions">
              <DotsHorizontalIcon />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner align="start">
                <Menu.Popup>
                  <Menu.Item>Share itinerary</Menu.Item>
                  <Menu.Item>Cancel booking</Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
          <Menu.Root>
            <Menu.Trigger variant="ghost">Sort by</Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner align="start">
                <Menu.Popup>
                  <Menu.Item>Departure time</Menu.Item>
                  <Menu.Item>Price</Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </Stack>
      </Stack>
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Four triggers, four distinct accessible names — including the icon-only one, which is the
    // one that silently loses its name if `aria-label` is dropped.
    await expect(canvas.getByRole('button', { name: 'More actions' })).toBeInTheDocument();
    await expect(canvas.getAllByRole('button')).toHaveLength(4);
  },
};

const DESTINATIONS = [
  'Amsterdam Schiphol',
  'Barcelona El Prat',
  'Copenhagen Kastrup',
  'Dublin',
  'Edinburgh',
  'Frankfurt am Main',
  'Geneva Cointrin',
  'Helsinki Vantaa',
  'Istanbul',
  'Lisbon Humberto Delgado',
  'Madrid Barajas',
  'Munich Franz Josef Strauss',
  'Oslo Gardermoen',
  'Prague Vaclav Havel',
  'Reykjavik Keflavik',
  'Stockholm Arlanda',
  'Vienna Schwechat',
  'Warsaw Chopin',
  'Zagreb Franjo Tudman',
  'Zurich Kloten',
] as const;

/**
 * More items than fit on screen. The popup takes its ceiling from `--available-height` on the
 * Positioner and scrolls inside it, rather than growing past the viewport edge where the last
 * item is unreachable.
 */
export const LongList: Story = {
  render: () => (
    <Menu.Root>
      <Menu.Trigger>Add destination</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="start">
          <Menu.Popup>
            {DESTINATIONS.map((destination) => (
              <Menu.Item key={destination}>{destination}</Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Add destination' });

    await userEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    await expect(within(menu).getAllByRole('menuitem')).toHaveLength(DESTINATIONS.length);

    // The constraint is the point: a popup that grows past the viewport edge has items nobody
    // can reach. This is asserted as the mechanism rather than as `scrollHeight > clientHeight`,
    // which is what it said before — twenty rows happen to fit in the 900px browser the test
    // runs in, so that assertion was really a claim about the runner's window size and it failed
    // on a tall one while a popup with no cap at all would have passed on a short one.
    const positioner = menu.parentElement as HTMLElement;
    const cap = getComputedStyle(positioner).maxBlockSize;
    // Base UI measures the gap to the viewport edge and publishes it as `--available-height` on
    // the Positioner. A resolved pixel length is the proof it arrived; `none` would mean the
    // custom property never landed and the popup is free to grow.
    await expect(cap).toMatch(/^\d+(\.\d+)?px$/);
    await expect(parseFloat(cap)).toBeLessThanOrEqual(window.innerHeight);
    await expect(menu.clientHeight).toBeLessThanOrEqual(parseFloat(cap));
    // Overflow scrolls inside the popup instead of spilling out of it — `min-block-size: 0` on
    // the Popup is what lets a flex child shrink below its content, and without it the box would
    // ignore the cap it was just given.
    await expect(getComputedStyle(menu).overflowY).toBe('auto');

    // Whatever the window height, the last destination is reachable: it sits inside the popup's
    // own box once the popup is scrolled to the end.
    menu.scrollTop = menu.scrollHeight;
    const last = within(menu).getByRole('menuitem', { name: DESTINATIONS[DESTINATIONS.length - 1] });
    await waitFor(() =>
      expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        Math.ceil(menu.getBoundingClientRect().bottom),
      ),
    );

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  },
};
