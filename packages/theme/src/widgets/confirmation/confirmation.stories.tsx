import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import {
  CONFIRMATION_TYPE,
  CONFIRMATION_VERSION,
  WidgetRenderer,
  asAnyWidget,
  builtInWidgets,
  composeRegistries,
} from '@nerey/core';
import type { WidgetStatus } from '@nerey/core';
import { MockWidgetHost, widgetMessage } from '@nerey/core/mock';

import { confirmationWidget } from './index';
import type { ConfirmationPayload, ConfirmationState } from './schema';

/**
 * ADR 0035 — the composition this widget exists for. Core's `confirmation@1.0.0` is registered
 * first and the theme's is registered over it; `{ override: true }` is what makes the second one
 * win the key instead of throwing on the duplicate. Without the flag this is an error, which is
 * the right default: replacing a built-in should be a decision, not an accident of array order.
 */
const registry = composeRegistries({ override: true }, builtInWidgets, [asAnyWidget(confirmationWidget)]);

/** Stable across every story: the id keys persistence, lifecycle and React reconciliation. */
const MESSAGE_ID = 'confirmation-story';

type StoryArgs = {
  payload: ConfirmationPayload;
  /** Seeded persisted state, as a replayed transcript would arrive with (ADR 0016). */
  state?: ConfirmationState;
  status?: WidgetStatus;
  readonly?: boolean;
  onSend: (text: string, meta?: Record<string, unknown>) => void;
};

/**
 * No `component` on the meta. A widget is not rendered by calling its component — it is resolved
 * out of a registry and rendered through `WidgetRenderer` (ADR 0009 / 0012), and that whole chain
 * is what these stories have to prove: registry override, payload validation, lifecycle, the
 * persistence port and the interaction contract, all of which a direct render would skip.
 */
const meta = {
  title: 'Widgets/Confirmation',
  parameters: { layout: 'padded' },
  // A transcript column rather than a full-width page, so the wrapping story below is measured
  // against the width this widget actually gets.
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: '34rem' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onSend: fn(),
    payload: {
      title: 'Archive "Q3 incident report"?',
      description: 'It leaves the active list and stays restorable for 30 days.',
      confirmLabel: 'Archive',
      cancelLabel: 'Keep it',
    },
  },
  render: (args) => (
    <MockWidgetHost registry={registry} conversationId="story" onSend={args.onSend}>
      <WidgetRenderer
        message={widgetMessage({
          id: MESSAGE_ID,
          type: CONFIRMATION_TYPE,
          version: CONFIRMATION_VERSION,
          payload: args.payload,
          state: args.state,
          // The plain-text rendering the transcript falls back to. Written out rather than left
          // to the fixture's default, because it is the line a user would still be able to answer
          // in prose if the widget never rendered (ADR 0012).
          text: 'Archive "Q3 incident report"? Reply Archive to confirm, or Keep it to cancel.',
        })}
        status={args.status}
        readonly={args.readonly}
      />
    </MockWidgetHost>
  ),
} satisfies Meta<StoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The neutral tone. The group is named by its own title through `aria-labelledby` and described
 * by its body — nothing else could establish that relationship, since a consumer cannot reach
 * inside the widget to add it (ADR 0032).
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const group = canvas.getByRole('group', { name: 'Archive "Q3 incident report"?' });
    await expect(group).toHaveAttribute('data-state', 'idle');
    await expect(group).toHaveAccessibleDescription(
      'It leaves the active list and stays restorable for 30 days.',
    );

    await expect(canvas.getByRole('button', { name: 'Archive' })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Keep it' })).toBeEnabled();
  },
};

/**
 * `tone: 'danger'` — the one thing core validates and refuses to render, because it is a
 * presentation decision and core ships no presentation (ADR 0035).
 *
 * This is also the full interaction: press, send, lock. The message that goes out is the button's
 * own label, because the agent reads it as something the user typed — `Archive`, not
 * `{"decision":"confirmed"}`.
 */
export const Danger: Story = {
  args: {
    payload: {
      title: 'Delete 1,204 archived reports?',
      confirmLabel: 'Delete them',
      cancelLabel: 'Cancel',
      tone: 'danger',
      description: 'This cannot be undone.',
    },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const confirm = canvas.getByRole('button', { name: 'Delete them' });

    await userEvent.click(confirm);

    await expect(args.onSend).toHaveBeenCalledWith('Delete them', { decision: 'confirmed' });

    // ADR 0018 — disabled, not removed. Both actions close, the widget stays in the transcript,
    // and the root says which of the six contract states it is in.
    await expect(confirm).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await expect(canvas.getByRole('group')).toHaveAttribute('data-state', 'locked');
    await expect(confirm).toHaveAttribute('data-state', 'selected');
  },
};

/** The other terminal state. Cancelling is an answer, and it locks the widget exactly as hard. */
export const Cancelled: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const cancel = canvas.getByRole('button', { name: 'Keep it' });

    await userEvent.click(cancel);

    await expect(args.onSend).toHaveBeenCalledWith('Keep it', { decision: 'cancelled' });
    await expect(cancel).toHaveAttribute('data-state', 'selected');
    await expect(canvas.getByRole('button', { name: 'Archive' })).toBeDisabled();
  },
};

/**
 * A payload with no description. `aria-describedby` is omitted rather than pointed at an empty
 * element — a dangling reference is a worse outcome for a screen reader than no reference.
 */
export const WithoutDescription: Story = {
  args: { payload: { title: 'Send the draft to the reviewers?' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole('group', { name: 'Send the draft to the reviewers?' });

    await expect(group).not.toHaveAttribute('aria-describedby');
    // Core's defaults, imported rather than restated, so both entries answer identically.
    await expect(canvas.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    await expect(canvas.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  },
};

/**
 * Model-authored labels are not designer-authored labels. The action row wraps rather than
 * pushing the panel wider than the transcript that contains it.
 */
export const LongContent: Story = {
  args: {
    payload: {
      title:
        'Replace the existing quarterly incident review with the reconstructed timeline from the on-call logs?',
      description:
        'The current document was assembled by hand in October and has been edited eleven times since. Replacing it keeps a copy in version history, but every inline comment on the old revision is dropped and cannot be recovered.',
      confirmLabel: 'Replace it and drop the comments',
      cancelLabel: 'Keep the hand-written version',
      tone: 'danger',
    },
  },
  play: async ({ canvasElement }) => {
    const group = canvasElement.querySelector<HTMLElement>('[data-nerey-widget="confirmation"]');
    await expect(group).not.toBeNull();
    if (!group) return;
    // Nothing may spill out of the panel: a widget that overflows breaks the conversation layout
    // around it, which is a worse failure than a button on two lines.
    await expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth);
  },
};

/**
 * A transcript replayed from storage. The decision arrives on the envelope, so the widget is
 * locked before the user ever sees it and still shows which button was pressed (FR-24).
 */
export const LockedFromPersistedState: Story = {
  args: { state: { decision: 'confirmed' } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const confirm = canvas.getByRole('button', { name: 'Archive' });

    await expect(confirm).toBeDisabled();
    await expect(confirm).toHaveAttribute('data-state', 'selected');
    await expect(canvas.getByRole('group')).toHaveAttribute('data-state', 'locked');

    // Rendering a persisted decision is not taking one.
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * `readonly` from the host — a disabled conversation, an archived thread — with no decision on
 * record. The widget renders its terminal appearance and fires nothing (ADR 0018).
 */
export const ReadOnlyReplay: Story = {
  args: { readonly: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const confirm = canvas.getByRole('button', { name: 'Archive' });

    await expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    await expect(args.onSend).not.toHaveBeenCalled();
  },
};

/**
 * ADR 0019 — mid-stream the payload is partial and deliberately unvalidated, so the question may
 * not be a question yet. It renders, and it is not answerable until the stream lands.
 */
export const Streaming: Story = {
  args: {
    status: 'streaming',
    // Half a title and nothing else — the state a payload is genuinely in mid-stream. It happens
    // to satisfy the type here; a real delta would not, and the chain skips validation for
    // exactly that reason.
    payload: { title: 'Archive "Q3 incident' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('group')).toHaveAttribute('data-nerey-status', 'streaming');
    await expect(canvas.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  },
};

/**
 * A tool call that failed on the way to the widget. The exchange stays readable and stays
 * unanswerable — an error is not a question either.
 */
export const ErrorStatus: Story = {
  args: { status: 'error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const group = canvas.getByRole('group');

    await expect(group).toHaveAttribute('data-state', 'error');
    await expect(canvas.getByRole('button', { name: 'Archive' })).toBeDisabled();
  },
};
