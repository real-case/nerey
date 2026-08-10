import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { Badge } from '../badge/badge';
import { Stack } from '../stack/stack';
import { Surface } from '../surface/surface';
import { Text } from '../text/text';
import { Tabs } from './tabs';

const meta = {
  title: 'Disclosure/Tabs',
  component: Tabs.Root,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Tabs.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { defaultValue: 'itinerary', onValueChange: fn() },
  render: (args) => (
    <Tabs.Root {...args}>
      <Tabs.List label="Booking sections">
        <Tabs.Tab value="itinerary">Itinerary</Tabs.Tab>
        <Tabs.Tab value="passengers">Passengers</Tabs.Tab>
        <Tabs.Tab value="payment">Payment</Tabs.Tab>
        <Tabs.Indicator />
      </Tabs.List>
      <Tabs.Panel value="itinerary">
        <Text size="sm">LHR → FCO, 09:15, Terminal 5.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="passengers">
        <Text size="sm">A. Marchetti, R. Okonjo.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="payment">
        <Text size="sm">Visa ending 4417 — £412.80.</Text>
      </Tabs.Panel>
    </Tabs.Root>
  ),
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const list = canvas.getByRole('tablist', { name: 'Booking sections' });
    const itinerary = canvas.getByRole('tab', { name: 'Itinerary' });
    const passengers = canvas.getByRole('tab', { name: 'Passengers' });

    await expect(list).toBeVisible();
    await expect(itinerary).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('LHR → FCO');

    await userEvent.click(passengers);
    await expect(passengers).toHaveAttribute('aria-selected', 'true');
    await expect(itinerary).toHaveAttribute('aria-selected', 'false');

    // Polled, because a tab swap is not atomic: Base UI's `TabsPanel` hands `setMounted(false)`
    // to `useOpenChangeComplete`, which waits a full animation frame and then on the element's
    // `getAnimations()` before unmounting — so that a theme CAN animate a panel out. This theme
    // declares no exit transition on `.panel`, so the outgoing panel is on screen for exactly one
    // frame; within that frame it is still `role="tabpanel"` (only `inert`, not `hidden`), and a
    // bare `getByRole('tabpanel')` throws "Found multiple elements". The unpolled assertion was
    // therefore passing on a race, and lost it roughly one run in three.
    //
    // Waiting is the stronger claim, not the weaker one: it says that once the swap settles there
    // is exactly ONE panel and it is the new one — which also pins that the old panel goes away.
    await waitFor(async () => {
      await expect(canvas.getByRole('tabpanel')).toHaveTextContent('A. Marchetti');
    });
    await expect(args.onValueChange).toHaveBeenLastCalledWith('passengers');
  },
};

/**
 * The indicator's position comes entirely from the `--active-tab-*` custom properties Base UI
 * writes onto it. This story asserts that they actually arrive and actually move — the failure
 * mode otherwise is an underline that sits at the origin forever and looks like a styling bug.
 */
export const IndicatorTracksTheActiveTab: Story = {
  args: { defaultValue: 'one' },
  render: (args) => (
    <Tabs.Root {...args}>
      <Tabs.List label="Sections">
        <Tabs.Tab value="one">First</Tabs.Tab>
        <Tabs.Tab value="two">Second section</Tabs.Tab>
        <Tabs.Indicator />
      </Tabs.List>
      <Tabs.Panel value="one">
        <Text size="sm">First panel.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="two">
        <Text size="sm">Second panel.</Text>
      </Tabs.Panel>
    </Tabs.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = canvas.getByRole('tablist', { name: 'Sections' });

    const indicator = list.querySelector('[role="presentation"][data-orientation]');
    if (!(indicator instanceof HTMLElement)) {
      throw new Error('Tabs.Indicator did not render inside the tab list.');
    }

    const left = () => getComputedStyle(indicator).getPropertyValue('--active-tab-left').trim();

    await waitFor(async () => {
      await expect(left()).not.toBe('');
    });
    const initial = left();

    await userEvent.click(canvas.getByRole('tab', { name: 'Second section' }));
    await waitFor(async () => {
      await expect(left()).not.toBe(initial);
    });
  },
};

/** Vertical: the same parts, the same indicator, a different axis. */
export const Vertical: Story = {
  args: { orientation: 'vertical', defaultValue: 'summary' },
  render: (args) => (
    <Tabs.Root {...args}>
      <Stack direction="row" gap={4}>
        <Tabs.List label="Report sections">
          <Tabs.Tab value="summary">Summary</Tabs.Tab>
          <Tabs.Tab value="detail">Detail</Tabs.Tab>
          <Tabs.Tab value="audit">Audit trail</Tabs.Tab>
          <Tabs.Indicator />
        </Tabs.List>
        <div>
          <Tabs.Panel value="summary">
            <Text size="sm">Three findings, one blocking.</Text>
          </Tabs.Panel>
          <Tabs.Panel value="detail">
            <Text size="sm">Every finding with its evidence.</Text>
          </Tabs.Panel>
          <Tabs.Panel value="audit">
            <Text size="sm">Who changed what, and when.</Text>
          </Tabs.Panel>
        </div>
      </Stack>
    </Tabs.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = canvas.getByRole('tablist', { name: 'Report sections' });
    await expect(list).toHaveAttribute('data-orientation', 'vertical');

    // The orientation is what tells the arrow keys which axis they are on, so it is worth
    // exercising rather than reading: Down moves in a vertical list, Right does not.
    await userEvent.click(canvas.getByRole('tab', { name: 'Summary' }));
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('tab', { name: 'Detail' })).toHaveFocus();
  },
};

/**
 * `activateOnFocus` selects a tab as soon as arrow keys reach it. It suits panels that are cheap
 * to render, and it is off by default because a panel that fetches would fire a request per
 * keypress on the way past.
 */
export const ActivateOnFocus: Story = {
  args: { defaultValue: 'a' },
  render: (args) => (
    <Tabs.Root {...args}>
      <Tabs.List label="Cheap panels" activateOnFocus>
        <Tabs.Tab value="a">Alpha</Tabs.Tab>
        <Tabs.Tab value="b">Bravo</Tabs.Tab>
        <Tabs.Tab value="c">Charlie</Tabs.Tab>
        <Tabs.Indicator />
      </Tabs.List>
      <Tabs.Panel value="a">
        <Text size="sm">Alpha panel.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="b">
        <Text size="sm">Bravo panel.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="c">
        <Text size="sm">Charlie panel.</Text>
      </Tabs.Panel>
    </Tabs.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Alpha' }));
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('tab', { name: 'Bravo' })).toHaveAttribute('aria-selected', 'true');
    // Polled for the reason given in Default: the outgoing panel outlives the swap by a frame,
    // and `getByRole('tabpanel')` matches both while it does.
    await waitFor(async () => {
      await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Bravo panel.');
    });
  },
};

/**
 * A disabled tab still takes arrow-key focus; it simply refuses to activate. `defaultValue` points
 * at an enabled tab on purpose — which tabs are disabled is not knowable during pre-render, so a
 * `defaultValue` aimed at a disabled one produces a different first paint on the server.
 */
export const DisabledTab: Story = {
  args: { defaultValue: 'overview' },
  render: (args) => (
    <Tabs.Root {...args}>
      <Tabs.List label="Account sections">
        <Tabs.Tab value="overview">Overview</Tabs.Tab>
        <Tabs.Tab value="billing" disabled>
          Billing
        </Tabs.Tab>
        <Tabs.Tab value="team">Team</Tabs.Tab>
        <Tabs.Indicator />
      </Tabs.List>
      <Tabs.Panel value="overview">
        <Text size="sm">Overview panel.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="billing">
        <Text size="sm">Billing panel.</Text>
      </Tabs.Panel>
      <Tabs.Panel value="team">
        <Text size="sm">Team panel.</Text>
      </Tabs.Panel>
    </Tabs.Root>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Overview' }));

    // A disabled tab is FOCUSABLE but not activatable — the APG's own guidance, and the opposite
    // of removing it from the sequence. Skipping it would hide from a keyboard user that the
    // section exists at all, which is information they are entitled to.
    await userEvent.keyboard('{ArrowRight}');
    const billing = canvas.getByRole('tab', { name: 'Billing' });
    await expect(billing).toHaveFocus();
    await expect(billing).toHaveAttribute('aria-disabled', 'true');

    await userEvent.keyboard('{Enter}');
    await expect(billing).toHaveAttribute('aria-selected', 'false');
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Overview panel.');

    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('tab', { name: 'Team' })).toHaveFocus();
  },
};

/** Controlled, with the active tab held outside the component. */
export const Controlled: Story = {
  render: function ControlledStory() {
    const [value, setValue] = useState<string | null>('now');

    return (
      <Stack gap={3}>
        <Text size="xs" tone="secondary" mono>
          active: {value ?? 'none'}
        </Text>
        <Tabs.Root value={value} onValueChange={setValue}>
          <Tabs.List label="Departures">
            <Tabs.Tab value="now">Now</Tabs.Tab>
            <Tabs.Tab value="later">Later today</Tabs.Tab>
            <Tabs.Indicator />
          </Tabs.List>
          <Tabs.Panel value="now">
            <Text size="sm">Four departures in the next hour.</Text>
          </Tabs.Panel>
          <Tabs.Panel value="later">
            <Text size="sm">Nineteen departures before midnight.</Text>
          </Tabs.Panel>
        </Tabs.Root>
      </Stack>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Later today' }));
    await waitFor(async () => {
      await expect(canvas.getByText('active: later')).toBeInTheDocument();
    });
  },
};

/** Long labels and a list wider than its container: the row scrolls, the labels do not truncate. */
export const ManyTabs: Story = {
  args: { defaultValue: 'jan' },
  render: (args) => (
    <Surface padding="md" radius="lg">
      <Tabs.Root {...args}>
        <Tabs.List label="Reporting periods">
          <Tabs.Tab value="jan">January reconciliation</Tabs.Tab>
          <Tabs.Tab value="feb">February reconciliation</Tabs.Tab>
          <Tabs.Tab value="mar">March reconciliation</Tabs.Tab>
          <Tabs.Tab value="apr">
            April{' '}
            <Badge size="sm" tone="warning">
              Open
            </Badge>
          </Tabs.Tab>
          <Tabs.Indicator />
        </Tabs.List>
        <Tabs.Panel value="jan">
          <Text size="sm">Closed on 4 February.</Text>
        </Tabs.Panel>
        <Tabs.Panel value="feb">
          <Text size="sm">Closed on 6 March.</Text>
        </Tabs.Panel>
        <Tabs.Panel value="mar">
          <Text size="sm">Closed on 3 April.</Text>
        </Tabs.Panel>
        <Tabs.Panel value="apr">
          <Text size="sm">Two entries still unmatched.</Text>
        </Tabs.Panel>
      </Tabs.Root>
    </Surface>
  ),
};
