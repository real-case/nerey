import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';

import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Combobox } from './combobox';

/**
 * ADR 0031 / 0032 — the stories are the test suite and the axe subject.
 *
 * What they assert is the part a hand-rolled combobox always gets wrong: that typing narrows
 * the list, that the arrow keys move a highlight while DOM focus stays in the input (so the
 * user can keep typing), that Enter commits the highlighted row, that Escape closes without
 * committing — and that a filter matching nothing says so instead of opening an empty box.
 *
 * The popup is portalled to `document.body`; the field is not. Queries are split accordingly.
 */
const meta = {
  title: 'Components/Combobox',
  component: Combobox.Root,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Combobox.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const DESTINATIONS = [
  'Amsterdam Schiphol',
  'Barcelona El Prat',
  'Copenhagen Kastrup',
  'Dublin',
  'Edinburgh',
  'Frankfurt am Main',
  'Helsinki Vantaa',
  'Lisbon Humberto Delgado',
  'Madrid Barajas',
  'Oslo Gardermoen',
  'Stockholm Arlanda',
  'Vienna Schwechat',
  'Zurich Kloten',
] as const;

const EMPTY_MESSAGE = 'No destinations match that search.';

function DestinationCombobox({ defaultValue, disabled }: { defaultValue?: string; disabled?: boolean }) {
  return (
    <Combobox.Root items={DESTINATIONS} defaultValue={defaultValue} disabled={disabled}>
      <Combobox.InputGroup>
        <Combobox.Input label="Destination" placeholder="Search destinations" />
        <Combobox.Clear />
        <Combobox.Trigger />
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner>
          <Combobox.Popup>
            <Combobox.Empty>{EMPTY_MESSAGE}</Combobox.Empty>
            <Combobox.List>
              {(destination: string) => (
                <Combobox.Item key={destination} value={destination}>
                  <span>{destination}</span>
                  <Combobox.ItemIndicator />
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

/** Typing narrows the list; Enter commits the highlighted row into the field. */
export const Default: Story = {
  render: () => <DestinationCombobox />,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('combobox', { name: 'Destination' });
    await expect(input).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(input);
    await userEvent.type(input, 'Cope');

    const listbox = await screen.findByRole('listbox');
    await waitFor(() => expect(within(listbox).getAllByRole('option')).toHaveLength(1));

    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(input).toHaveValue('Copenhagen Kastrup'));
    // The commit and the unmount are not the same moment: the popup stays in the DOM through
    // its exit transition, so its absence is a state to wait for rather than one to read on
    // the next line.
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await expect(input).toHaveAttribute('aria-expanded', 'false');
  },
};

/**
 * The state a combobox is judged on. A filter that matches nothing must SAY nothing matched;
 * an empty popup is indistinguishable from a component that has stopped working.
 *
 * Base UI's `Empty` is a permanently mounted polite live region — that is why the message is
 * announced rather than silently appearing, and why the padding lives on the inner element
 * instead of on the region itself.
 *
 * This one ends with the popup open on purpose: the empty state IS the subject, and axe reads
 * the post-`play` DOM (ADR 0032). Closing it here would audit a text field and nothing else.
 */
export const NoResults: Story = {
  render: () => <DestinationCombobox />,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('combobox', { name: 'Destination' });

    await userEvent.click(input);
    await userEvent.type(input, 'qqqq');

    await waitFor(() => expect(screen.getByText(EMPTY_MESSAGE)).toBeVisible());
    await expect(screen.queryAllByRole('option')).toHaveLength(0);
  },
};

/**
 * Arrow keys move the highlight while DOM focus stays in the input — that is what lets a user
 * keep typing mid-navigation, and it is also why `data-highlighted` is the only focus indicator
 * this component has. No `:focus-visible` will ever land on a row.
 */
export const KeyboardNavigation: Story = {
  render: () => <DestinationCombobox />,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('combobox', { name: 'Destination' });

    await userEvent.tab();
    await expect(input).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    const listbox = await screen.findByRole('listbox');
    const first = within(listbox).getByRole('option', { name: 'Amsterdam Schiphol' });
    await waitFor(() => expect(first).toHaveAttribute('data-highlighted'));
    await expect(input).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    await expect(within(listbox).getByRole('option', { name: 'Barcelona El Prat' })).toHaveAttribute(
      'data-highlighted',
    );
    await expect(first).not.toHaveAttribute('data-highlighted');
    await expect(input).toHaveFocus();

    // Escape closes without committing — the field is still empty.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await expect(input).toHaveValue('');
  },
};

/**
 * The clear button exists only while there is something to clear — Base UI mounts and unmounts
 * it rather than hiding it, so an empty field genuinely has no clear control in its DOM. The
 * stylesheet's only job there is the fade, so it does not appear beside the caret with a jump
 * while the user is mid-word.
 */
export const ClearSelection: Story = {
  render: () => <DestinationCombobox />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('combobox', { name: 'Destination' });
    await expect(canvas.queryByLabelText('Clear selection')).not.toBeInTheDocument();

    await userEvent.click(input);
    await userEvent.type(input, 'Dubl');
    await screen.findByRole('listbox');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(input).toHaveValue('Dublin'));

    const clear = await canvas.findByRole('button', { name: 'Clear selection' });
    await userEvent.click(clear);
    await waitFor(() => expect(input).toHaveValue(''));
    // Clearing puts the field back to "nothing chosen", and the suggestion list that was open
    // behind it goes with it — the story does not hand the next one a popup to inherit.
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await expect(input).toHaveAttribute('aria-expanded', 'false');
  },
};

/** The trigger opens the whole list without typing, for a user who wants to browse. */
export const OpenWithTrigger: Story = {
  render: () => <DestinationCombobox />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Queried by label rather than by role, and that is a fact about the component rather than
    // a convenience: Base UI marks the trigger `aria-hidden` whenever an input is present,
    // because the input already carries `role="combobox"` and `aria-expanded`. An aria-hidden
    // element has no accessible name by definition, so no `getByRole` call can ever match it.
    const trigger = canvas.getByLabelText('Show suggestions');

    await userEvent.click(trigger);
    const listbox = await screen.findByRole('listbox');
    await expect(within(listbox).getAllByRole('option')).toHaveLength(DESTINATIONS.length);

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  },
};

export const WithSelection: Story = {
  render: () => <DestinationCombobox defaultValue="Madrid Barajas" />,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('combobox', { name: 'Destination' });
    await expect(input).toHaveValue('Madrid Barajas');
  },
};

export const Disabled: Story = {
  render: () => <DestinationCombobox defaultValue="Dublin" disabled />,
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('combobox', { name: 'Destination' });
    await expect(input).toBeDisabled();

    await userEvent.click(input);
    await expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  },
};

const AIRPORTS_BY_REGION = [
  { region: 'United Kingdom', airports: ['London Heathrow', 'Edinburgh', 'Manchester'] },
  { region: 'Nordics', airports: ['Copenhagen Kastrup', 'Oslo Gardermoen', 'Stockholm Arlanda'] },
] as const;

const ALL_AIRPORTS = AIRPORTS_BY_REGION.flatMap((group) => group.airports);

/**
 * Groups are rendered by the caller rather than filtered by Base UI, so the labels stay put
 * while the rows inside them come and go. Each label names its group through `aria-labelledby`.
 */
export const Groups: Story = {
  render: () => (
    <Combobox.Root items={ALL_AIRPORTS}>
      <Combobox.InputGroup>
        <Combobox.Input label="Departure airport" placeholder="Search airports" />
        <Combobox.Clear />
        <Combobox.Trigger />
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner>
          <Combobox.Popup>
            <Combobox.Empty>No airports match that search.</Combobox.Empty>
            <Combobox.List>
              {AIRPORTS_BY_REGION.map((group) => (
                <Combobox.Group key={group.region}>
                  <Combobox.GroupLabel>{group.region}</Combobox.GroupLabel>
                  {group.airports.map((airport) => (
                    <Combobox.Item key={airport} value={airport}>
                      <span>{airport}</span>
                      <Combobox.ItemIndicator />
                    </Combobox.Item>
                  ))}
                </Combobox.Group>
              ))}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByLabelText('Show suggestions');

    await userEvent.click(trigger);
    const listbox = await screen.findByRole('listbox');
    await expect(within(listbox).getByRole('group', { name: 'United Kingdom' })).toBeInTheDocument();
    await expect(within(listbox).getByRole('group', { name: 'Nordics' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  },
};

/** A field narrower than its longest option. The input truncates; the popup does not stretch it. */
export const NarrowField: Story = {
  render: () => (
    <div style={{ inlineSize: '11rem' }}>
      <DestinationCombobox defaultValue="Lisbon Humberto Delgado" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('combobox', { name: 'Destination' });
    const field = input.closest('div');
    await expect(input.getBoundingClientRect().width).toBeLessThanOrEqual(
      (field?.getBoundingClientRect().width ?? 0) + 1,
    );
  },
};

/**
 * Rendered open and non-modal so the listbox's markup is what axe reads — every other story
 * closes before it finishes, which would leave axe looking at a text field and nothing else.
 */
export const OpenPopup: Story = {
  render: () => (
    <Stack gap={2}>
      <Text size="xs" tone="secondary" weight="semibold" mono>
        open, unfiltered
      </Text>
      <Combobox.Root items={DESTINATIONS} defaultOpen modal={false}>
        <Combobox.InputGroup>
          <Combobox.Input label="Destination" placeholder="Search destinations" />
          <Combobox.Clear />
          <Combobox.Trigger />
        </Combobox.InputGroup>
        <Combobox.Portal>
          <Combobox.Positioner>
            <Combobox.Popup>
              <Combobox.Empty>{EMPTY_MESSAGE}</Combobox.Empty>
              <Combobox.List>
                {(destination: string) => (
                  <Combobox.Item key={destination} value={destination}>
                    <span>{destination}</span>
                    <Combobox.ItemIndicator />
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </Stack>
  ),
  play: async () => {
    const listbox = await screen.findByRole('listbox');
    await expect(within(listbox).getAllByRole('option')).toHaveLength(DESTINATIONS.length);
  },
};
