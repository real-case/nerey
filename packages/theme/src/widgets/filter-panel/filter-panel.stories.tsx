import { useMemo } from 'react';
import type { ReactElement } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

import { InputSlotHost, WidgetRenderer, asAnyWidget, createWidgetRegistry } from '@nerey/core';
import type { WidgetRegistry } from '@nerey/core';
import { MockWidgetHost, widgetMessage } from '@nerey/core/mock';

import { Textarea } from '../../components/input/textarea';
import { filterPanelWidget } from './index';
import { FILTER_PANEL_TYPE, FILTER_PANEL_VERSION } from './schema';
import type { FilterPanelPayload, FilterPanelState } from './schema';

/**
 * ADR 0031 / 0032 — the stories render through `WidgetRenderer` inside `MockWidgetHost`, and the
 * last one goes one step further and mounts `InputSlotHost` with a composer beside it. That story
 * is the one this widget exists for: everything else about a filter panel could be built as an
 * ordinary component, and only the slot host shows that a widget can be resolved out of a registry
 * by `type@version` and land somewhere other than the transcript (ADR 0017).
 */

const registry: WidgetRegistry = createWidgetRegistry([asAnyWidget(filterPanelWidget)]);

type FilterPanelStoryProps = {
  payload: FilterPanelPayload;
  state?: FilterPanelState;
  /** Forces the read-only path, as a replayed or disabled transcript would. */
  readonly?: boolean;
  onSend?: (text: string, meta?: Record<string, unknown>) => void;
};

function useStoryMessage(payload: FilterPanelPayload, state: FilterPanelState | undefined) {
  // Memoised on the inputs it is built from: `WidgetRenderer` keys its validation memo on the
  // message identity, so a fresh object per render would re-run the chain on every chip press.
  return useMemo(
    () =>
      widgetMessage({
        id: 'filter-panel-story',
        type: FILTER_PANEL_TYPE,
        version: FILTER_PANEL_VERSION,
        payload,
        state,
      }),
    [payload, state],
  );
}

function FilterPanelStory({ payload, state, readonly, onSend }: FilterPanelStoryProps): ReactElement {
  const message = useStoryMessage(payload, state);

  return (
    <MockWidgetHost registry={registry} onSend={onSend}>
      <WidgetRenderer message={message} readonly={readonly} />
    </MockWidgetHost>
  );
}

const meta = {
  title: 'Widgets/FilterPanel',
  component: FilterPanelStory,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof FilterPanelStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three short facets: at or under `CHIP_LIMIT`, so each renders as a wrapping row of chips. */
const ISSUES: FilterPanelPayload = {
  facets: [
    {
      name: 'status',
      label: 'Status',
      options: [
        { value: 'open', label: 'Open', count: 42 },
        { value: 'review', label: 'In review', count: 8 },
        { value: 'closed', label: 'Closed', count: 311 },
      ],
    },
    {
      name: 'priority',
      label: 'Priority',
      options: [
        { value: 'p0', label: 'P0' },
        { value: 'p1', label: 'P1' },
        { value: 'p2', label: 'P2' },
      ],
    },
  ],
};

/** Nine airlines — past `CHIP_LIMIT`, so this facet becomes a filtered Combobox instead. */
const AIRLINES: FilterPanelPayload = {
  facets: [
    {
      name: 'airline',
      label: 'Airline',
      options: [
        { value: 'ba', label: 'British Airways', count: 24 },
        { value: 'af', label: 'Air France', count: 18 },
        { value: 'lh', label: 'Lufthansa', count: 31 },
        { value: 'kl', label: 'KLM', count: 12 },
        { value: 'ib', label: 'Iberia', count: 9 },
        { value: 'az', label: 'ITA Airways', count: 4 },
        { value: 'sk', label: 'SAS', count: 6 },
        { value: 'os', label: 'Austrian', count: 3 },
        { value: 'lx', label: 'Swiss', count: 7 },
      ],
    },
    {
      name: 'stops',
      label: 'Stops',
      options: [
        { value: 'direct', label: 'Direct' },
        { value: 'one', label: 'One stop' },
      ],
    },
  ],
};

function widgetRoot(canvasElement: HTMLElement): Element | null {
  return canvasElement.querySelector(`[data-nerey-widget='${FILTER_PANEL_TYPE}']`);
}

/** Nothing picked: a hint instead of a sentence, and neither button does anything yet. */
export const Empty: Story = {
  args: { payload: ISSUES, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('group', { name: 'Filters' })).toBeInTheDocument();
    await expect(canvas.getByText('Pick a filter to build a search.')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Search' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Clear filters' })).toBeDisabled();
    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'idle');
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * Picking chips composes the sentence, and picking them sends NOTHING.
 *
 * That gap is the whole design: the panel lives in the composer, so its output is a draft the user
 * reads and then chooses to send, not a message that escapes on every click.
 */
export const ComposingAQuery: Story = {
  args: { payload: ISSUES, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // The count is hidden from the accessible name and restated as a phrase, so the visible words
    // stay a clean prefix of the name (WCAG 2.5.3).
    await userEvent.click(canvas.getByRole('button', { name: 'Open, 42 results' }));
    await expect(canvas.getByText('Show me the results where Status is Open.')).toBeVisible();

    await userEvent.click(canvas.getByRole('button', { name: 'In review, 8 results' }));
    await userEvent.click(canvas.getByRole('button', { name: 'P0' }));

    await expect(
      canvas.getByText('Show me the results where Status is Open or In review, and Priority is P0.'),
    ).toBeVisible();
    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'selected');
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/** The sentence on screen and the message sent are the same string, by construction. */
export const SearchSendsTheComposedSentence: Story = {
  args: { payload: ISSUES, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('button', { name: 'Closed, 311 results' }));
    await userEvent.click(canvas.getByRole('button', { name: 'P2' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Search' }));

    await expect(args.onSend).toHaveBeenCalledWith(
      'Show me the results where Status is Closed, and Priority is P2.',
      { filters: { status: ['closed'], priority: ['p2'] } },
    );
    await expect(args.onSend).toHaveBeenCalledTimes(1);
  },
};

/**
 * Clearing is local and sends nothing.
 *
 * `onInteraction` is the outbound channel and every call posts a message (ADR 0014), so a "Clear
 * filters" wired through it would put "Clear filters" into the conversation — a widget telling the
 * agent about its own UI state.
 */
export const ClearingIsNotAMessage: Story = {
  args: { payload: ISSUES, state: { selected: { status: ['open'], priority: ['p1'] } }, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole('button', { name: 'Open, 42 results' })).toHaveAttribute('data-pressed');

    await userEvent.click(canvas.getByRole('button', { name: 'Clear filters' }));

    await waitFor(async () => {
      await expect(canvas.getByText('Pick a filter to build a search.')).toBeVisible();
    });
    await expect(canvas.getByRole('button', { name: 'Open, 42 results' })).not.toHaveAttribute(
      'data-pressed',
    );
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * A facet past `CHIP_LIMIT` becomes a filtered Combobox, because thirty chips above a text box
 * push the message the user is reading off screen. Typing narrows the list; choosing commits one
 * value into the same query the chips feed.
 */
export const LongFacetUsesCombobox: Story = {
  args: { payload: AIRLINES, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('combobox', { name: 'Airline' });

    // The short facet beside it is still chips: the fork is per facet, not per panel.
    await expect(canvas.getByRole('button', { name: 'Direct' })).toBeInTheDocument();

    await userEvent.click(input);
    await userEvent.type(input, 'luft');

    // The popup is portalled, so it is found on the document rather than inside the canvas.
    const option = await within(document.body).findByRole('option', { name: 'Lufthansa, 31 results' });
    await userEvent.click(option);

    await waitFor(async () => {
      await expect(canvas.getByText('Show me the results where Airline is Lufthansa.')).toBeVisible();
    });
    await expect(args.onSend).not.toHaveBeenCalled();

    // Committing a choice closes the popup, and that is asserted rather than assumed. It is
    // portalled to `document.body`, which is outside every story's canvas and is NOT torn down
    // between stories the way the canvas is — a play that walked away from an open listbox would
    // leave it floating over whatever renders next, and the story that then fails is not this one.
    await waitFor(async () => {
      await expect(within(document.body).queryByRole('listbox')).toBeNull();
    });
  },
};

/**
 * A restored selection, filtered against the payload that is actually on screen.
 *
 * `nope` is a value no facet offers any more — a stale record from an earlier payload. It is
 * dropped rather than carried into the sentence, because a filter the user can read but cannot
 * see a control for is one they have no way to remove.
 */
export const RestoredAndFilteredAgainstThePayload: Story = {
  args: {
    payload: ISSUES,
    state: { selected: { status: ['review', 'nope'], priority: [] } },
    onSend: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText('Show me the results where Status is In review.')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'In review, 8 results' })).toHaveAttribute(
      'data-pressed',
    );
    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'selected');
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/** Read-only: the selection is still legible, every control is inert, and nothing can be sent. */
export const ReadOnly: Story = {
  args: { payload: ISSUES, state: { selected: { status: ['open'] } }, readonly: true, onSend: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-readonly', '');
    await expect(widgetRoot(canvasElement)).toHaveAttribute('data-state', 'locked');
    await expect(canvas.getByText('Show me the results where Status is Open.')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Search' })).toBeDisabled();

    await userEvent.click(canvas.getByRole('button', { name: 'Open, 42 results' }));
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * The story this widget exists for.
 *
 * `InputSlotHost` resolves the message's placement out of the registry, sees `{ slot: 'input',
 * position: 'above' }`, and renders the widget above the composer the host passed as children —
 * which stays exactly where it was. Nothing about the payload says "composer": the placement lives
 * on the registry entry, so the same envelope in a host that registered a different entry would
 * land somewhere else entirely (ADR 0017).
 */
function InComposerStory({ payload, state, onSend }: FilterPanelStoryProps): ReactElement {
  const message = useStoryMessage(payload, state);

  return (
    <MockWidgetHost registry={registry} onSend={onSend}>
      <InputSlotHost messages={[message]} position="above">
        <Textarea aria-label="Message" rows={2} placeholder="Ask me anything…" />
      </InputSlotHost>
    </MockWidgetHost>
  );
}

export const InTheComposer: StoryObj<typeof InComposerStory> = {
  args: { payload: ISSUES, onSend: fn() },
  render: (args) => <InComposerStory {...args} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // The composer is untouched and still the host's own element — `position: 'above'` adds a box
    // beside it rather than wrapping it.
    const composer = canvas.getByRole('textbox', { name: 'Message' });
    await expect(composer).toBeInTheDocument();

    // The slot host's positioning box, which is what a consumer's stylesheet selects on.
    const slot = canvasElement.querySelector("[data-nerey-slot='input'][data-nerey-position='above']");
    await expect(slot).not.toBeNull();
    await expect(slot).toContainElement(canvas.getByRole('group', { name: 'Filters' }));

    await userEvent.click(canvas.getByRole('button', { name: 'P1' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Search' }));

    await expect(args.onSend).toHaveBeenCalledWith('Show me the results where Priority is P1.', {
      filters: { status: [], priority: ['p1'] },
    });

    // The composer survived the interaction. `position: 'replace'` is the placement that takes it
    // away; `'above'` never does, and a widget that quietly removed the text box would be the
    // failure nobody notices until a user cannot type.
    await expect(canvas.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
  },
};
