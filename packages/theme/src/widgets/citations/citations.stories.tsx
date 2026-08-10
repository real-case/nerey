import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';

import { WidgetRenderer, asAnyWidget, composeRegistries } from '@nerey/core';
import type { WidgetRegistry, WidgetStatus } from '@nerey/core';
import { MockWidgetHost, mockRegistry, widgetMessage } from '@nerey/core/mock';

import { citationsWidget } from './index';
import { CITATIONS_TYPE, CITATIONS_VERSION } from './schema';
import type { CitationsPayload, CitationsState } from './schema';

/**
 * ADR 0031 — the widget is rendered through `WidgetRenderer` inside `MockWidgetHost`, never by
 * calling the component directly. Calling it directly would prove only that the JSX is valid; the
 * chain is what actually ships — envelope → registry → schema → lifecycle → component — and it is
 * where a version typo, a schema that rejects `undefined` state, or a lifecycle that expires on
 * mount would show up.
 */

const registry: WidgetRegistry = composeRegistries(mockRegistry, [asAnyWidget(citationsWidget)]);

const MESSAGE_ID = 'citations-story';

/** The last line of the degradation chain (ADR 0012), and it has to read as a sentence. */
const FALLBACK_TEXT =
  'The last ten years are the ten warmest on record, and 2024 was the warmest of them. ' +
  'Sources: IPCC AR6 Synthesis Report; NOAA Global Climate Report 2024; Copernicus Global Climate Highlights.';

const SENT_PREFIX = 'Sent to the agent: ';

type HarnessProps = {
  payload: CitationsPayload;
  state?: CitationsState;
  status?: WidgetStatus;
  /** Forces read-only regardless of lifecycle — a replayed transcript, a closed conversation. */
  readonly?: boolean;
};

/**
 * A stand-in for the host, so the story's controls are the three things a host actually varies.
 *
 * The sent messages are rendered rather than only logged: a widget's outbound channel is the half
 * of the contract a screenshot cannot show, and an assertion against the actions panel is an
 * assertion against Storybook rather than against the widget.
 */
function CitationsHarness({
  payload,
  state,
  status = 'ready',
  readonly = false,
}: HarnessProps): ReactElement {
  const [sent, setSent] = useState<readonly string[]>([]);

  const message = useMemo(
    () =>
      widgetMessage({
        id: MESSAGE_ID,
        type: CITATIONS_TYPE,
        version: CITATIONS_VERSION,
        payload,
        state,
        text: FALLBACK_TEXT,
      }),
    [payload, state],
  );

  return (
    <MockWidgetHost
      registry={registry}
      onSend={(text) => {
        setSent((all) => [...all, text]);
      }}
    >
      <WidgetRenderer message={message} status={status} readonly={readonly} />
      <p>{`${SENT_PREFIX}${sent.join(' · ')}`}</p>
    </MockWidgetHost>
  );
}

const meta = {
  title: 'Widgets/Citations',
  component: CitationsHarness,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CitationsHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

const CLAIM = 'The last ten years are the ten warmest on record, and 2024 was the warmest of them.';

const IPCC_TITLE = 'IPCC AR6 Synthesis Report — Summary for Policymakers';

/** The third source carries neither a snippet nor a date, so both optional branches are rendered. */
const TYPICAL: CitationsPayload = {
  claim: CLAIM,
  sources: [
    {
      id: 'ar6-spm',
      title: IPCC_TITLE,
      url: 'https://www.ipcc.ch/report/ar6/syr/summary-for-policymakers/',
      snippet: 'Global surface temperature was 1.09 °C higher in 2011–2020 than in 1850–1900.',
      publishedAt: 'March 2023',
    },
    {
      id: 'noaa-2024',
      title: 'NOAA Global Climate Report, Annual 2024',
      url: 'https://www.ncei.noaa.gov/access/monitoring/monthly-report/global/202413',
      snippet: '2024 was the warmest year in the 175-year instrumental record.',
      publishedAt: 'January 2025',
    },
    {
      id: 'copernicus-2024',
      title: 'Copernicus Climate Change Service — Global Climate Highlights',
      url: 'https://climate.copernicus.eu/global-climate-highlights-2024',
    },
  ],
};

/** Opens a marker's preview. The popup is portalled to `<body>`, so it is queried through `screen`. */
const openMarker = async (canvasElement: HTMLElement, ordinal: number): Promise<HTMLElement> => {
  const marker = within(canvasElement).getByRole('button', {
    name: new RegExp(`^Source ${ordinal}:`),
  });
  await userEvent.click(marker);
  // Base UI gives the popup `role="dialog"` — a popover is a dialog that happens to be anchored.
  return screen.findByRole('dialog');
};

/**
 * Closes the preview and waits for it to leave the DOM. Every story that opens one ends with this.
 *
 * It is not tidiness. An open Base UI popover wraps its popup in a floating focus manager, and that
 * manager renders four `aria-hidden` `<span>`s that keep `tabindex="0"` — a focusable element the
 * accessibility tree has been told is not there, which axe reports as `aria-hidden-focus` and
 * ADR 0032 fails the build over. The guards are suppressed while the popup's open reason is a
 * trigger *hover*, and these markers open on hover as well as on press (see the component), so a
 * story that leaves the popup open passes or fails depending on which of the two `userEvent.click`
 * happened to register as — intermittently, and in whichever story axe audits next, since the popup
 * is portalled to `<body>` and outlives the canvas it was opened from.
 *
 * The right answer to that is not a waiver: the guards only exist while the popover is open, and a
 * preview the reader has finished with should not still be open. A story that cannot close what it
 * opened is describing a widget that cannot either.
 */
const closePreview = async (popup: HTMLElement): Promise<void> => {
  await userEvent.keyboard('{Escape}');
  await waitFor(async () => {
    await expect(popup).not.toBeInTheDocument();
  });
};

/**
 * The whole affordance in one pass: the preview names its source, the link says which host it
 * leads to and warns that it leaves the page, and the reader can push the burden back to the agent
 * without opening anything.
 */
export const Default: Story = {
  args: { payload: TYPICAL },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const marker = canvas.getByRole('button', { name: `Source 1: ${IPCC_TITLE}` });

    const popup = await openMarker(canvasElement, 1);
    await expect(popup).toHaveAccessibleName(IPCC_TITLE);
    await expect(popup).toHaveAccessibleDescription(/1.09 °C/);

    const link = within(popup).getByRole('link');
    // The warning is part of the NAME, not a title attribute and not a sibling paragraph: a link
    // that changes context has to announce it at the moment it is reached (WCAG 3.2.5).
    await expect(link).toHaveAccessibleName(/opens in a new tab/);
    await expect(link).toHaveAccessibleName(/ipcc\.ch/);
    await expect(link).toHaveAttribute(
      'href',
      'https://www.ipcc.ch/report/ar6/syr/summary-for-policymakers/',
    );
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    const quote = within(popup).getByRole('button', { name: 'Quote this source' });
    await userEvent.click(quote);

    // The message a human would have typed, not a serialised action (ADR 0014).
    await expect(canvas.getByText(new RegExp(`Quote the passage from "${IPCC_TITLE}"`))).toBeVisible();

    // One source is now terminal and the rest are untouched — the property that makes this widget
    // usable at all, since asking about one citation must not close the other two.
    await expect(quote).toBeDisabled();
    await expect(marker.closest('[data-nerey-part="citation"]')).toHaveAttribute('data-state', 'selected');
    await expect(canvas.getByRole('button', { name: /^Source 2:/ })).toBeEnabled();

    await closePreview(popup);
  },
};

/**
 * An answer that cites nothing. The absence is stated rather than left as blank space, because it
 * is the single most useful thing this widget can tell a reader.
 */
export const NoSources: Story = {
  args: { payload: { claim: CLAIM, sources: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText('No sources were cited for this claim.')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: /^Source/ })).toBeNull();
  },
};

const LONG_CLAIM =
  'Between 2011 and 2020 the global surface temperature ran about 1.09 °C above the 1850–1900 ' +
  'baseline, the increase was larger over land than over the ocean, and every one of the ten ' +
  'warmest years in the 175-year instrumental record has now occurred since 2014 — a run long ' +
  'enough that it is no longer plausibly explained by the variability of the observing system.';

/**
 * Eleven markers on a claim that wraps over several lines. Two things have to survive it: the
 * paragraph must not push the transcript sideways, and a preview opened from the last marker must
 * still land inside the window rather than off the bottom of it.
 */
export const ManySources: Story = {
  args: {
    payload: {
      claim: LONG_CLAIM,
      sources: Array.from({ length: 11 }, (_unused, index) => ({
        id: `source-${index + 1}`,
        title: `Working Group I contribution, chapter ${index + 1}: attribution of the observed warming`,
        url: `https://www.ipcc.ch/report/ar6/wg1/chapter/chapter-${index + 1}/`,
        snippet:
          'Human influence has warmed the climate system, and the scale of recent changes across ' +
          'the system as a whole is unprecedented over many centuries.',
        publishedAt: 'August 2021',
      })),
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole('button', { name: /^Source \d+:/ })).toHaveLength(11);

    const popup = await openMarker(canvasElement, 11);
    const box = popup.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.top).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(window.innerWidth);
    await expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);

    // The page itself never scrolls sideways, whatever the popup did.
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);

    await closePreview(popup);
  },
};

/**
 * `status: 'error'` — the terminal input state of a tool call that failed (ADR 0019). The sources
 * that did arrive stay readable and stay linked, because a half-answered question is still worth
 * checking; what goes away is the ability to ask the agent for more, since the turn it would
 * belong to is the one that just failed.
 *
 * The other failure — a payload the schema rejects — never reaches this component at all: the
 * degradation chain replaces it with the message's plain text (ADR 0012).
 */
export const Errored: Story = {
  args: { payload: TYPICAL, status: 'error' },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector('[data-nerey-widget="citations"]');

    await expect(root).toHaveAttribute('data-nerey-status', 'error');
    await expect(root).toHaveAttribute('data-state', 'error');

    const popup = await openMarker(canvasElement, 1);
    // `findByRole('dialog')` resolves the moment the popup is in the DOM, which is the frame
    // `popover.module.css` renders at `opacity: 0` under Base UI's `data-starting-style`. Since
    // `toBeVisible()` reads computed opacity, the entrance has to be waited out — the claim is that
    // the link is on screen, not that it was on screen in the first frame of a fade.
    await waitFor(async () => {
      await expect(within(popup).getByRole('link')).toBeVisible();
    });
    await expect(within(popup).getByRole('button', { name: 'Quote this source' })).toBeDisabled();

    await closePreview(popup);
  },
};

/**
 * A replayed transcript. Read-only removes the outbound action and nothing else: going back to
 * check what an answer rested on is the commonest reason to reread a conversation, so the previews
 * and the links still work.
 */
export const Readonly: Story = {
  args: { payload: TYPICAL, state: { asked: ['noaa-2024'] }, readonly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const root = canvasElement.querySelector('[data-nerey-widget="citations"]');

    await expect(root).toHaveAttribute('data-readonly', '');
    await expect(root).toHaveAttribute('data-state', 'locked');

    // The persisted answer is replayed on the marker it belongs to, not on the widget as a whole.
    const asked = canvas.getByRole('button', { name: /^Source 2:/ });
    await expect(asked.closest('[data-nerey-part="citation"]')).toHaveAttribute('data-state', 'selected');

    const popup = await openMarker(canvasElement, 1);
    await expect(within(popup).getByRole('link')).toHaveAccessibleName(/opens in a new tab/);
    await expect(within(popup).getByRole('button', { name: 'Quote this source' })).toBeDisabled();
    await expect(canvas.getByText(SENT_PREFIX.trim())).toBeVisible();

    await closePreview(popup);
  },
};
