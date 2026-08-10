import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { Button } from '../button/button';
import { Stack } from '../stack/stack';
import { Text } from '../text/text';
import { Toast, createToastManager, useToastManager } from './toast';
import type { ToastOptions, ToastTone } from './toast';

/**
 * Every story pins `timeout={0}`. A five-second auto-dismiss turns a story into a race against its
 * own `play` function — exactly the non-deterministic test ADR 0031 rules out — and it hides the
 * component from anyone reading the workbench who happened to look away.
 */
const meta = {
  title: 'Feedback/Toast',
  component: Toast.Provider,
  parameters: { layout: 'padded' },
  args: { timeout: 0 },
} satisfies Meta<typeof Toast.Provider>;

export default meta;
type Story = StoryObj<typeof meta>;

const TONES: readonly ToastTone[] = ['neutral', 'accent', 'success', 'warning', 'danger'];

/** A manager created outside React, shared by the story below that demonstrates one. */
const standaloneManager = createToastManager();

const GATE_CHANGE: ToastOptions = {
  tone: 'warning',
  id: 'gate-change',
  title: 'Gate changed',
  description: 'BA 583 now departs from gate B41.',
};

/** The trigger most stories use. It is a component because `useToastManager` needs a tree. */
function PushButton({ label, options }: { label: string; options: ToastOptions }) {
  const toasts = useToastManager();
  return (
    <Button size="sm" onClick={() => toasts.add(options)}>
      {label}
    </Button>
  );
}

export const Default: Story = {
  render: (args) => (
    <Toast.Provider {...args}>
      <PushButton
        label="Save the booking"
        options={{
          tone: 'success',
          title: 'Booking saved',
          description: 'Reference NX-4417. A confirmation is on its way.',
        }}
      />
      <Toast.Portal>
        <Toast.Viewport>
          <Toast.List />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Save the booking' }));

    // The viewport is portalled to `<body>`, so it is outside `canvasElement` by construction —
    // querying the document is not sloppiness here, it is where the element actually is.
    const body = within(document.body);
    const region = await waitFor(() => body.getByRole('region', { name: 'Notifications' }));
    const toast = within(region);

    // `waitFor`, not a bare assertion: a toast enters at `opacity: 0` under
    // `[data-starting-style]` and fades in, and jest-dom counts a zero-opacity element as not
    // visible. Asserting on the frame the card mounts is asserting on the enter transition.
    await waitFor(async () => {
      await expect(toast.getByText('Booking saved')).toBeVisible();
    });
    await expect(toast.getByText(/NX-4417/)).toBeVisible();

    // The dismiss button is in the accessibility tree from the first frame, not only once the
    // viewport is hovered. Base UI hides it until then; Nerey does not, because it stays
    // `tabindex="0"` the whole time and a control keyboard focus can reach must be a control
    // assistive technology can see (ADR 0032 — axe reports the other arrangement as
    // `aria-hidden-focus`).
    const dismiss = toast.getByRole('button', { name: 'Dismiss notification' });
    await expect(dismiss).toBeVisible();

    await userEvent.click(dismiss);
    await waitFor(async () => {
      await expect(body.queryByText('Booking saved')).toBeNull();
    });
  },
};

/**
 * The tone is carried as Base UI's toast `type`, which lands on the DOM as `data-type` — so the
 * stripe and the glyph are chosen by the stylesheet from the vendor's own state attribute rather
 * than from a parallel class this component would have to keep in step.
 */
export const Tones: Story = {
  args: { limit: 5 },
  render: (args) => (
    <Toast.Provider {...args}>
      <Stack direction="row" gap={2} wrap>
        {TONES.map((tone) => (
          <PushButton
            key={tone}
            label={tone}
            options={{
              tone,
              id: tone,
              title: `${tone} notification`,
              description: 'One line of supporting detail.',
            }}
          />
        ))}
      </Stack>
      <Toast.Portal>
        <Toast.Viewport>
          <Toast.List />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const tone of TONES) {
      await userEvent.click(canvas.getByRole('button', { name: tone }));
    }

    const region = await waitFor(() => within(document.body).getByRole('region', { name: 'Notifications' }));
    for (const tone of TONES) {
      await waitFor(async () => {
        await expect(region.querySelector(`[data-type="${tone}"]`)).not.toBeNull();
      });
    }
  },
};

function UndoTrigger() {
  const toasts = useToastManager();
  const [passengers, setPassengers] = useState(2);

  function remove() {
    setPassengers((current) => current - 1);
    const id = toasts.add({
      title: 'Passenger removed',
      description: 'R. Okonjo is no longer on this booking.',
      action: {
        label: 'Undo',
        onClick: () => {
          setPassengers((current) => current + 1);
          toasts.close(id);
        },
      },
    });
  }

  return (
    <Stack gap={2} align="start">
      <Text size="sm">Passengers: {passengers}</Text>
      <Button size="sm" variant="outline" tone="danger" onClick={remove}>
        Remove passenger
      </Button>
    </Stack>
  );
}

/** One action, and only one: two buttons in a notification is a dialog wearing a disguise. */
export const WithAction: Story = {
  render: (args) => (
    <Toast.Provider {...args}>
      <UndoTrigger />
      <Toast.Portal>
        <Toast.Viewport>
          <Toast.List />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);

    await userEvent.click(canvas.getByRole('button', { name: 'Remove passenger' }));
    await expect(canvas.getByText('Passengers: 1')).toBeVisible();

    const undo = await waitFor(() => body.getByRole('button', { name: 'Undo' }));
    await userEvent.click(undo);

    // The handler runs AND the toast goes away. Either one alone is not what a button labelled
    // Undo promises, and the two are wired up in different places.
    await expect(canvas.getByText('Passengers: 2')).toBeVisible();
    await waitFor(async () => {
      await expect(body.queryByText('Passenger removed')).toBeNull();
    });
  },
};

/** `priority: 'high'` is announced assertively. Reserve it for things that already went wrong. */
export const HighPriority: Story = {
  render: (args) => (
    <Toast.Provider {...args}>
      <PushButton
        label="Report the failure"
        options={{
          tone: 'danger',
          priority: 'high',
          title: 'Payment declined',
          description:
            'The issuing bank refused the transaction. No charge was made, and the seats are held for another twelve minutes.',
        }}
      />
      <Toast.Portal>
        <Toast.Viewport>
          <Toast.List />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Report the failure' }));
    const body = within(document.body);

    // Base UI mirrors a high-priority toast into an assertive live region and hides the visible
    // card from the accessibility tree, so the message is announced once rather than twice.
    const alert = await waitFor(() => body.getByRole('alert'));
    await expect(alert).toHaveTextContent('Payment declined');

    const region = body.getByRole('region', { name: 'Notifications' });
    const card = region.querySelector('[role="alertdialog"]');
    await expect(card).toHaveAttribute('aria-hidden', 'true');

    // Engaging with the viewport hands the card back to the accessibility tree. Doing it here is
    // not decoration: the card is focusable, and `aria-hidden` on a focusable element is a WCAG
    // 4.1.2 failure the axe gate would report as `aria-hidden-focus` (ADR 0032).
    await userEvent.click(region);
    await waitFor(async () => {
      await expect(region.querySelector('[role="alertdialog"]')).not.toHaveAttribute('aria-hidden');
    });
  },
};

/**
 * The case the overlay slot of ADR 0017 actually needs: a manager created OUTSIDE React, so the
 * runtime can push a notification without holding a reference to a component.
 */
export const PushedFromOutsideReact: Story = {
  render: (args) => (
    <Toast.Provider {...args} manager={standaloneManager}>
      <Button size="sm" onClick={() => standaloneManager.add(GATE_CHANGE)}>
        Simulate a background event
      </Button>
      <Toast.Portal>
        <Toast.Viewport>
          <Toast.List />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(document.body);

    await userEvent.click(canvas.getByRole('button', { name: 'Simulate a background event' }));
    await waitFor(async () => {
      await expect(body.getByText('Gate changed')).toBeVisible();
    });

    // `close()` with no id closes everything — what a runtime tearing a session down needs, and
    // what no per-component handle can offer.
    standaloneManager.close();
    await waitFor(async () => {
      await expect(body.queryByText('Gate changed')).toBeNull();
    });
  },
};

/**
 * A custom card. `Toast.List` takes a render function, so the parts stay composable: a caller who
 * wants the description above the title, or no dismiss button at all, moves a JSX line.
 */
export const CustomCard: Story = {
  render: (args) => (
    <Toast.Provider {...args}>
      <PushButton
        label="Show the custom card"
        options={{ tone: 'accent', title: 'Seat held', description: '14A, for twelve minutes.' }}
      />
      <Toast.Portal>
        <Toast.Viewport>
          <Toast.List>
            {(toast) => (
              <Toast.Root toast={toast}>
                <Toast.Description />
                <Toast.Title />
              </Toast.Root>
            )}
          </Toast.List>
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Show the custom card' }));
    const body = within(document.body);
    const description = await waitFor(() => body.getByText('14A, for twelve minutes.'));
    const title = body.getByText('Seat held');

    // The description precedes the title in the DOM, which is the whole claim this story makes:
    // the order comes from the JSX, not from anything the component decided.
    await expect(description.compareDocumentPosition(title)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // No Close part was rendered, so nothing can dismiss it but the timeout.
    await expect(body.queryByRole('button', { name: 'Dismiss notification' })).toBeNull();
  },
};

/** Long copy wraps and the card grows; a notification never truncates the half that says why. */
export const LongContent: Story = {
  render: (args) => (
    <Toast.Provider {...args}>
      <PushButton
        label="Push a long one"
        options={{
          tone: 'warning',
          title: 'Itinerary changed by the operating carrier',
          description:
            'The 09:15 departure has been retimed to 11:40, and the connection in Rome now has a layover of fifty minutes. Seat assignments were carried over and the checked baggage allowance is unchanged.',
          action: { label: 'Review the new itinerary', onClick: () => undefined },
        }}
      />
      <Toast.Portal>
        <Toast.Viewport>
          <Toast.List />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  ),
};
