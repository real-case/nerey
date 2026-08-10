import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';

import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Select } from './select';

/**
 * ADR 0031 / 0032 — the stories are the test suite and the axe subject. What they assert is the
 * listbox keyboard contract, because that is the entire reason a headless dependency is here:
 * arrow keys move the highlight without committing, typeahead jumps to a matching option, Enter
 * commits, Escape abandons and returns focus to the trigger.
 *
 * The popup is portalled to `document.body`, so it is not inside `canvasElement` — anything in
 * the list is queried through `screen`, and the trigger through the canvas.
 */
const meta = {
  title: 'Components/Select',
  component: Select.Root,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Select.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Passed to `Select.Root` as `items`, which is what lets the CLOSED trigger show "Business"
 * rather than "business". The options in the popup do not exist while it is shut, so there is
 * nothing else for the trigger to read a label out of.
 */
const CABINS = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium', label: 'Premium economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
] as const;

function CabinSelect({
  defaultValue,
  disabled,
  size,
  disabledOption,
  onValueChange,
}: {
  defaultValue?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  disabledOption?: string;
  onValueChange?: (value: string | null) => void;
}) {
  return (
    <Select.Root
      items={CABINS}
      defaultValue={defaultValue}
      disabled={disabled}
      size={size}
      onValueChange={onValueChange}
    >
      <Select.Trigger label="Cabin class">
        <Select.Value placeholder="Choose a cabin" />
        <Select.Icon />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup>
            {CABINS.map((cabin) => (
              <Select.Item key={cabin.value} value={cabin.value} disabled={cabin.value === disabledOption}>
                <Select.ItemText>{cabin.label}</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

/**
 * Waits for the keyboard to actually be inside the popup, not merely for the popup to exist.
 *
 * Base UI hands DOM focus from the trigger to the list AFTER the popup has mounted and
 * measured. `findByRole('listbox')` resolving therefore says nothing about where the next key
 * press will go — for a frame or two the trigger is still `document.activeElement` and eats it.
 * Every story here that presses a key straight after opening was racing that hand-off, and the
 * ones that passed were winning the race rather than asserting anything about it.
 */
async function focusedListbox(): Promise<HTMLElement> {
  const listbox = await screen.findByRole('listbox');
  await waitFor(() => expect(listbox.contains(document.activeElement)).toBe(true));
  return listbox;
}

/**
 * Nothing chosen yet. The placeholder is the trigger's visible content, and `label` is its
 * accessible name — a `role="combobox"` does not take its name from its own text, so without
 * the required prop this control would read as an unnamed combobox.
 */
export const Placeholder: Story = {
  render: () => <CabinSelect />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Cabin class' });
    await expect(trigger).toHaveTextContent('Choose a cabin');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  },
};

export const WithSelection: Story = {
  render: () => <CabinSelect defaultValue="business" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Cabin class' });
    // The label, not the value. That only works because `items` is on the Root — see the note
    // on CABINS.
    await expect(trigger).toHaveTextContent('Business');
  },
};

/**
 * Open, move, commit — all without a pointer. `data-highlighted` tracks the arrow keys and
 * `data-selected` tracks what has actually been chosen; the two are deliberately different
 * states, so a user can look past their current choice without losing it.
 */
export const KeyboardNavigation: Story = {
  render: () => <CabinSelect defaultValue="economy" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Cabin class' });

    await userEvent.tab();
    await expect(trigger).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    const listbox = await focusedListbox();
    const economy = within(listbox).getByRole('option', { name: 'Economy' });
    await waitFor(() => expect(economy).toHaveAttribute('data-highlighted'));
    // The committed value is still Economy while the highlight moves away from it.
    await expect(economy).toHaveAttribute('data-selected');

    await userEvent.keyboard('{ArrowDown}');
    const premium = within(listbox).getByRole('option', { name: 'Premium economy' });
    await expect(premium).toHaveAttribute('data-highlighted');
    await expect(premium).not.toHaveAttribute('data-selected');
    await expect(economy).toHaveAttribute('data-selected');

    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await expect(trigger).toHaveTextContent('Premium economy');
    await expect(trigger).toHaveFocus();
  },
};

/** Typing jumps to the first option whose label matches, the way a native `<select>` does. */
export const Typeahead: Story = {
  render: () => <CabinSelect defaultValue="economy" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Cabin class' });

    await userEvent.click(trigger);
    const listbox = await focusedListbox();

    await userEvent.keyboard('b');
    await waitFor(() =>
      expect(within(listbox).getByRole('option', { name: 'Business' })).toHaveAttribute('data-highlighted'),
    );

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  },
};

/** Escape abandons the move: the highlight is discarded and the committed value is untouched. */
export const EscapeKeepsSelection: Story = {
  render: () => <CabinSelect defaultValue="economy" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Cabin class' });

    await userEvent.click(trigger);
    await focusedListbox();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Escape}');

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await expect(trigger).toHaveTextContent('Economy');
    await expect(trigger).toHaveFocus();
  },
};

/**
 * A disabled option stays announced, stays reachable and cannot be chosen.
 *
 * Reachable is the deliberate part. Base UI builds the item with `focusableWhenDisabled`, so
 * arrow keys land on it and it reports `aria-disabled="true"` rather than vanishing from the
 * keyboard. That is the behaviour APG asks for: an option a user can never arrive at is an
 * option they can never be told exists, and "Premium economy, dimmed" is the announcement that
 * explains why the row is there. What must not happen is a commit, which is what the Enter
 * press below asserts.
 */
export const DisabledOption: Story = {
  render: () => <CabinSelect defaultValue="economy" disabledOption="premium" />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Cabin class' });

    await userEvent.click(trigger);
    const listbox = await focusedListbox();
    const premium = within(listbox).getByRole('option', { name: 'Premium economy' });
    await expect(premium).toHaveAttribute('data-disabled');
    await expect(premium).toHaveAttribute('aria-disabled', 'true');

    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(premium).toHaveAttribute('data-highlighted'));

    // Reachable but inert: Enter neither commits it nor closes the popup.
    await userEvent.keyboard('{Enter}');
    await expect(screen.getByRole('listbox')).toBeInTheDocument();
    await expect(premium).not.toHaveAttribute('data-selected');
    await expect(within(listbox).getByRole('option', { name: 'Economy' })).toHaveAttribute('data-selected');

    // And stepping past it reaches the next selectable row, so it is a stop on the way and
    // nothing more.
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() =>
      expect(within(listbox).getByRole('option', { name: 'Business' })).toHaveAttribute('data-highlighted'),
    );

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await expect(trigger).toHaveTextContent('Economy');
  },
};

export const Disabled: Story = {
  render: () => <CabinSelect defaultValue="economy" disabled />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Cabin class' });
    await expect(trigger).toHaveAttribute('data-disabled');

    await userEvent.click(trigger);
    // A disabled field must not open. Asserting the absence needs the queryBy form — findBy
    // would wait for something that is never going to arrive and then fail on a timeout.
    await expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  },
};

/**
 * `size` is set once on the Root and reaches both halves of the control. It cannot be set on
 * the trigger alone: the popup is portalled to `<body>`, so nothing about the trigger's box is
 * visible to it through the cascade.
 */
export const Sizes: Story = {
  render: () => (
    <Stack gap={4}>
      {(['sm', 'md'] as const).map((size) => (
        <Stack key={size} gap={2}>
          <Text size="xs" tone="secondary" weight="semibold" mono>
            {size}
          </Text>
          <CabinSelect size={size} defaultValue="economy" />
        </Stack>
      ))}
    </Stack>
  ),
  play: async ({ canvasElement }) => {
    const triggers = within(canvasElement).getAllByRole('combobox', { name: 'Cabin class' });
    await expect(triggers).toHaveLength(2);
    const [small, medium] = triggers.map((trigger) => trigger.getBoundingClientRect().height);
    await expect(small).toBeLessThan(medium ?? 0);
  },
};

const AIRPORTS = {
  lhr: 'London Heathrow',
  edi: 'Edinburgh',
  cph: 'Copenhagen Kastrup',
  arn: 'Stockholm Arlanda',
};

function AirportSelect() {
  return (
    <Select.Root items={AIRPORTS} defaultValue="lhr">
      <Select.Trigger label="Departure airport">
        <Select.Value placeholder="Choose an airport" />
        <Select.Icon />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup>
            <Select.Group>
              <Select.GroupLabel>United Kingdom</Select.GroupLabel>
              <Select.Item value="lhr">
                <Select.ItemText>London Heathrow</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
              <Select.Item value="edi">
                <Select.ItemText>Edinburgh</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
            </Select.Group>
            <Select.Group>
              <Select.GroupLabel>Nordics</Select.GroupLabel>
              <Select.Item value="cph">
                <Select.ItemText>Copenhagen Kastrup</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
              <Select.Item value="arn">
                <Select.ItemText>Stockholm Arlanda</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
            </Select.Group>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

/** Groups are named, which is what tells a screen-reader user which country an airport is in. */
export const Groups: Story = {
  render: () => <AirportSelect />,
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Departure airport' });

    await userEvent.click(trigger);
    const listbox = await screen.findByRole('listbox');
    await expect(within(listbox).getByRole('group', { name: 'United Kingdom' })).toBeInTheDocument();
    await expect(within(listbox).getByRole('group', { name: 'Nordics' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  },
};

/**
 * A whole route network rather than a sample of one, and the length is load-bearing.
 *
 * The story below asserts that the popup scrolls, which is only true when the options are
 * taller than the space Base UI measured for them. That space is a fraction of the viewport,
 * and the browser this suite runs in is 900px tall — twenty rows fit in it comfortably, so a
 * twenty-row list asserted nothing about scrolling and quietly depended on the window size.
 * Sixty-eight rows are taller than any viewport a test or a laptop is going to have.
 */
const DESTINATIONS = [
  'Amsterdam Schiphol',
  'Athens Eleftherios Venizelos',
  'Barcelona El Prat',
  'Basel Mulhouse',
  'Belfast International',
  'Bergen Flesland',
  'Berlin Brandenburg',
  'Bilbao',
  'Billund',
  'Birmingham',
  'Bologna Guglielmo Marconi',
  'Bordeaux Merignac',
  'Bratislava',
  'Bremen',
  'Brussels Zaventem',
  'Bucharest Otopeni',
  'Budapest Ferenc Liszt',
  'Copenhagen Kastrup',
  'Cork',
  'Dublin',
  'Dubrovnik',
  'Dusseldorf',
  'Edinburgh',
  'Faro',
  'Florence Peretola',
  'Frankfurt am Main',
  'Geneva Cointrin',
  'Gothenburg Landvetter',
  'Hamburg',
  'Helsinki Vantaa',
  'Istanbul',
  'Krakow John Paul II',
  'Lisbon Humberto Delgado',
  'Ljubljana Joze Pucnik',
  'London Heathrow',
  'Luxembourg Findel',
  'Lyon Saint Exupery',
  'Madrid Barajas',
  'Malaga Costa del Sol',
  'Malta Luqa',
  'Manchester',
  'Marseille Provence',
  'Milan Malpensa',
  'Munich Franz Josef Strauss',
  'Naples Capodichino',
  'Nice Cote d Azur',
  'Oslo Gardermoen',
  'Palma de Mallorca',
  'Paris Charles de Gaulle',
  'Porto Francisco Sa Carneiro',
  'Prague Vaclav Havel',
  'Reykjavik Keflavik',
  'Riga',
  'Rome Fiumicino',
  'Seville',
  'Sofia',
  'Stockholm Arlanda',
  'Stuttgart',
  'Tallinn Lennart Meri',
  'Thessaloniki Makedonia',
  'Toulouse Blagnac',
  'Valencia',
  'Venice Marco Polo',
  'Vienna Schwechat',
  'Vilnius',
  'Warsaw Chopin',
  'Zagreb Franjo Tudman',
  'Zurich Kloten',
] as const;

/**
 * More options than fit. The list scrolls inside `--available-height` and the two scroll
 * affordances appear — both `aria-hidden` inside Base UI, which is what keeps the popup a
 * conforming listbox rather than one owning two decorative `<div>`s.
 */
export const LongList: Story = {
  render: () => (
    <Select.Root items={DESTINATIONS.map((value) => ({ value, label: value }))} defaultValue="Dublin">
      <Select.Trigger label="Destination">
        <Select.Value placeholder="Choose a destination" />
        <Select.Icon />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup>
            <Select.ScrollUpArrow />
            {DESTINATIONS.map((destination) => (
              <Select.Item key={destination} value={destination}>
                <Select.ItemText>{destination}</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
            ))}
            <Select.ScrollDownArrow />
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Destination' });

    await userEvent.click(trigger);
    const listbox = await focusedListbox();
    // Every option is an option, and the two scroll arrows are not — they are `aria-hidden`
    // inside Base UI, so they never join the listbox's owned children.
    await expect(within(listbox).getAllByRole('option')).toHaveLength(DESTINATIONS.length);
    await expect(listbox.scrollHeight).toBeGreaterThan(listbox.clientHeight);
    // And the popup stayed inside the height Base UI measured for it rather than running off
    // the bottom of the window.
    await expect(listbox.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      document.documentElement.clientHeight,
    );

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    // Base UI keeps a closed select mounted and marks it `hidden`, so "gone from the role
    // query" is not "gone from the layout" unless the stylesheet honours the attribute. It
    // does — see `.positioner[hidden]` in select.module.css — and this is the assertion that
    // says so, because a scrollable stranded listbox is exactly what axe caught when it did
    // not.
    await expect(listbox.checkVisibility()).toBe(false);
  },
};

const LONG_LABELS = {
  mad: 'Madrid Adolfo Suarez Barajas Terminal 4 Satellite',
  dub: 'Dublin',
};

/**
 * A long option label in a narrow field. The trigger truncates rather than stretching its
 * container, because a select that widens to fit its content relays out the form around it every
 * time the user picks something.
 */
export const LongLabelTruncates: Story = {
  render: () => (
    <div style={{ inlineSize: '12rem' }}>
      <Select.Root items={LONG_LABELS} defaultValue="mad">
        <Select.Trigger label="Destination">
          <Select.Value placeholder="Choose a destination" />
          <Select.Icon />
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner>
            <Select.Popup>
              <Select.Item value="mad">
                <Select.ItemText>Madrid Adolfo Suarez Barajas Terminal 4 Satellite</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
              <Select.Item value="dub">
                <Select.ItemText>Dublin</Select.ItemText>
                <Select.ItemIndicator />
              </Select.Item>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('combobox', { name: 'Destination' });
    // The field stays inside the 12rem column its parent gave it.
    await expect(trigger.getBoundingClientRect().width).toBeLessThanOrEqual(
      (trigger.parentElement?.getBoundingClientRect().width ?? 0) + 1,
    );
  },
};

/**
 * Rendered open and non-modal so the listbox's own markup is what axe reads — every other story
 * closes before it finishes, which leaves axe looking at a trigger and nothing else.
 */
export const OpenPopup: Story = {
  parameters: {
    /**
     * ADR 0032 — a reviewed, per-story opt-out, and the narrowest one the addon can express.
     *
     * Base UI wraps `Select.Popup` in floating-ui's `FloatingFocusManager`, which renders four
     * `<span aria-hidden="true" tabindex="0" data-base-ui-focus-guard>` sentinels around the
     * portal so it can tell when focus leaves. axe flags each of them under `aria-hidden-focus`
     * (WCAG 4.1.2), and it is right that the pattern is questionable — but it is not markup
     * this wrapper emits or can suppress: Base UI hard-codes that focus manager's props and
     * exposes no `guards` escape hatch, so there is nothing to fix at this layer.
     *
     * Note what is NOT done here. The rule stays enabled, so `aria-hidden-focus` still audits
     * the trigger, the listbox and every option — an `aria-hidden` wrapper around a real
     * control would still fail. Only the guard elements themselves leave the axe context.
     * Revisit when Base UI exposes the focus-manager guards or floating-ui stops needing them.
     */
    a11y: { context: { exclude: ['[data-base-ui-focus-guard]'] } },
    nereyA11yWaivers: [
      {
        rule: 'aria-hidden-focus',
        reason:
          "Base UI's own FloatingFocusManager sentinels (`[data-base-ui-focus-guard]`), which the wrapper cannot configure away. Scoped to those elements only; the rule remains enabled for the select's own markup.",
        expires: '2027-08-01',
      },
    ],
  },
  render: () => (
    <Select.Root items={CABINS} defaultValue="business" defaultOpen modal={false}>
      <Select.Trigger label="Cabin class">
        <Select.Value placeholder="Choose a cabin" />
        <Select.Icon />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup>
            <Select.Group>
              <Select.GroupLabel>Cabins</Select.GroupLabel>
              {CABINS.map((cabin) => (
                <Select.Item key={cabin.value} value={cabin.value}>
                  <Select.ItemText>{cabin.label}</Select.ItemText>
                  <Select.ItemIndicator />
                </Select.Item>
              ))}
            </Select.Group>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  ),
  play: async () => {
    const listbox = await screen.findByRole('listbox');
    // The listbox carries the trigger's name. Base UI supplies none, and the only reason an
    // unnamed one is not an immediate axe failure is that axe exempts a listbox some combobox
    // is pointing `aria-controls` at — a relationship the trigger drops on close. See
    // `SelectLabelContext` in select.tsx.
    await expect(listbox).toHaveAccessibleName('Cabin class');
    await expect(within(listbox).getByRole('option', { selected: true })).toHaveAccessibleName('Business');
  },
};
