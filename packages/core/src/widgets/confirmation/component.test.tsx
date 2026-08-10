import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../../host/host-context';
import { createMemoryPersistence } from '../../state/memory-persistence';
import type { WidgetHostValue } from '../../types';
import { ConfirmationWidget } from './component';
import type { ConfirmationWidgetProps } from './component';

const CONVERSATION = 'conv-1';
const MESSAGE = 'msg-7';
const RECORD_KEY = `${CONVERSATION}:${MESSAGE}`;

function setup(props: Partial<ConfirmationWidgetProps> = {}, host: Partial<WidgetHostValue> = {}) {
  const persistence = createMemoryPersistence();
  const onInteraction = vi.fn();
  const onWidgetError = vi.fn();
  const user = userEvent.setup();

  const view = render(
    <WidgetHostProvider
      value={{
        ...DEFAULT_HOST_VALUE,
        conversationId: CONVERSATION,
        persistence,
        onWidgetError,
        ...host,
      }}
    >
      <ConfirmationWidget
        messageId={MESSAGE}
        payload={{ title: 'Delete the project?' }}
        state={{}}
        readonly={false}
        status="ready"
        onInteraction={onInteraction}
        {...props}
      />
    </WidgetHostProvider>,
  );

  return { ...view, user, persistence, onInteraction, onWidgetError };
}

const group = () => screen.getByRole('group');
const confirmButton = () => screen.getByRole('button', { name: 'Confirm' });
const cancelButton = () => screen.getByRole('button', { name: 'Cancel' });
const part = (name: string) => {
  const node = document.querySelector(`[data-nerey-part="${name}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`no part named ${name}`);
  return node;
};

describe('confirmation rendering', () => {
  it('carries its registry identity and the message slot on the root', () => {
    setup();

    expect(group()).toHaveAttribute('data-nerey-widget', 'confirmation');
    expect(group()).toHaveAttribute('data-nerey-version', '1.0.0');
    expect(group()).toHaveAttribute('data-nerey-slot', 'message');
    expect(group()).toHaveAttribute('data-nerey-status', 'ready');
    expect(group()).toHaveAttribute('data-state', 'idle');
    expect(group()).not.toHaveAttribute('data-readonly');
  });

  it('renders the title and the default labels as real buttons', () => {
    setup();

    expect(part('title')).toHaveTextContent('Delete the project?');
    expect(confirmButton()).toHaveAttribute('type', 'button');
    expect(cancelButton()).toHaveAttribute('type', 'button');
    expect(confirmButton()).toBeEnabled();
    expect(cancelButton()).toBeEnabled();
  });

  it('uses the authored labels when the payload supplies them', () => {
    setup({ payload: { title: 'Send it?', confirmLabel: 'Send now', cancelLabel: 'Later' } });

    expect(screen.getByRole('button', { name: 'Send now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument();
  });

  it('omits the description part and its ARIA relationship when there is no description', () => {
    setup();

    expect(document.querySelector('[data-nerey-part="description"]')).toBeNull();
    expect(group()).not.toHaveAttribute('aria-describedby');
  });

  it('renders no tone attribute — presentation is the theme’s decision, not core’s', () => {
    setup({ payload: { title: 'Delete the project?', tone: 'danger' } });

    expect(
      group()
        .getAttributeNames()
        .filter((name) => name.includes('tone')),
    ).toEqual([]);
  });
});

describe('confirmation accessibility wiring', () => {
  it('names the group from its title', () => {
    setup();

    expect(screen.getByRole('group', { name: 'Delete the project?' })).toBe(group());
  });

  it('describes the group from its description', () => {
    setup({ payload: { title: 'Delete the project?', description: 'This cannot be undone.' } });

    const node = screen.getByRole('group', { name: 'Delete the project?' });

    expect(node).toHaveAccessibleDescription('This cannot be undone.');
    expect(part('description')).toHaveTextContent('This cannot be undone.');
  });

  it('points the relationships at ids that actually resolve', () => {
    setup({ payload: { title: 'Delete the project?', description: 'This cannot be undone.' } });

    const labelledBy = group().getAttribute('aria-labelledby') ?? '';
    const describedBy = group().getAttribute('aria-describedby') ?? '';

    expect(document.getElementById(labelledBy)).toBe(part('title'));
    expect(document.getElementById(describedBy)).toBe(part('description'));
  });

  it('keeps ids unique across two confirmations on the same page', () => {
    setup();
    setup({ messageId: 'msg-8' });

    const [first, second] = screen.getAllByRole('group');

    expect(first?.getAttribute('aria-labelledby')).not.toBe(second?.getAttribute('aria-labelledby'));
  });
});

describe('confirming', () => {
  it('sends the confirm action with the label as its text and the decision as meta', async () => {
    const { user, onInteraction } = setup();

    await user.click(confirmButton());

    expect(onInteraction).toHaveBeenCalledTimes(1);
    expect(onInteraction).toHaveBeenCalledWith('confirm', {
      text: 'Confirm',
      meta: { decision: 'confirmed' },
    });
  });

  it('sends the authored label rather than the action name', async () => {
    const { user, onInteraction } = setup({
      payload: { title: 'Send it?', confirmLabel: 'Send now' },
    });

    await user.click(screen.getByRole('button', { name: 'Send now' }));

    expect(onInteraction).toHaveBeenCalledWith('confirm', {
      text: 'Send now',
      meta: { decision: 'confirmed' },
    });
  });

  it('locks the widget and marks the chosen part as selected', async () => {
    const { user } = setup();

    await user.click(confirmButton());

    expect(group()).toHaveAttribute('data-state', 'locked');
    expect(part('confirm')).toHaveAttribute('data-state', 'selected');
    expect(part('cancel')).not.toHaveAttribute('data-state');
    expect(confirmButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();
  });

  it('persists the decision through the injected port', async () => {
    const { user, persistence } = setup();

    await user.click(confirmButton());

    await waitFor(() => {
      expect(persistence.snapshot()).toEqual({ [RECORD_KEY]: { decision: 'confirmed' } });
    });
  });

  it('cannot be answered twice', async () => {
    const { user, onInteraction } = setup();

    await user.click(confirmButton());
    await user.click(cancelButton());
    await user.click(confirmButton());

    expect(onInteraction).toHaveBeenCalledTimes(1);
  });
});

describe('cancelling', () => {
  it('sends the cancel action and locks with the cancel part selected', async () => {
    const { user, onInteraction, persistence } = setup();

    await user.click(cancelButton());

    expect(onInteraction).toHaveBeenCalledWith('cancel', {
      text: 'Cancel',
      meta: { decision: 'cancelled' },
    });
    expect(group()).toHaveAttribute('data-state', 'locked');
    expect(part('cancel')).toHaveAttribute('data-state', 'selected');
    expect(part('confirm')).not.toHaveAttribute('data-state');
    await waitFor(() => {
      expect(persistence.snapshot()).toEqual({ [RECORD_KEY]: { decision: 'cancelled' } });
    });
  });
});

describe('replaying a persisted decision', () => {
  it.each(['confirmed', 'cancelled'] as const)('mounts locked for a %s decision', (decision) => {
    setup({ state: { decision } });

    expect(group()).toHaveAttribute('data-state', 'locked');
    expect(confirmButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();
    expect(part(decision === 'confirmed' ? 'confirm' : 'cancel')).toHaveAttribute('data-state', 'selected');
  });

  it('sends nothing and writes nothing on mount', async () => {
    const { onInteraction, persistence } = setup({ state: { decision: 'confirmed' } });

    // A replayed widget that re-announced itself would add a duplicate turn to the transcript
    // every time the conversation was reopened (ADR 0014).
    await waitFor(() => {
      expect(persistence.snapshot()).toEqual({});
    });
    expect(onInteraction).not.toHaveBeenCalled();
  });

  it('renders idle when the host mounts it with no state at all', () => {
    setup({ state: undefined as unknown as ConfirmationWidgetProps['state'] });

    expect(group()).toHaveAttribute('data-state', 'idle');
    expect(confirmButton()).toBeEnabled();
  });
});

describe('read-only replay', () => {
  it('renders the locked appearance with the read-only marker', () => {
    setup({ readonly: true });

    expect(group()).toHaveAttribute('data-readonly', '');
    expect(group()).toHaveAttribute('data-state', 'locked');
    expect(confirmButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();
  });

  it('fires nothing when a read-only widget is clicked', async () => {
    const { user, onInteraction, persistence } = setup({ readonly: true });

    await user.click(confirmButton());
    await user.click(cancelButton());

    expect(onInteraction).not.toHaveBeenCalled();
    expect(persistence.snapshot()).toEqual({});
  });

  it('still shows which button was pressed before it expired', () => {
    setup({ readonly: true, state: { decision: 'cancelled' } });

    expect(part('cancel')).toHaveAttribute('data-state', 'selected');
    expect(part('cancel')).toHaveTextContent('Cancel');
  });
});

describe('streaming and error status', () => {
  it('is not answerable while the payload is still arriving', async () => {
    const { user, onInteraction } = setup({ status: 'streaming' });

    expect(group()).toHaveAttribute('data-nerey-status', 'streaming');
    expect(group()).toHaveAttribute('data-state', 'idle');
    expect(confirmButton()).toBeDisabled();

    await user.click(confirmButton());

    expect(onInteraction).not.toHaveBeenCalled();
  });

  it('reports an errored generation on the root and stays unanswerable', async () => {
    const { user, onInteraction } = setup({ status: 'error' });

    expect(group()).toHaveAttribute('data-state', 'error');
    expect(cancelButton()).toBeDisabled();

    await user.click(cancelButton());

    expect(onInteraction).not.toHaveBeenCalled();
  });
});

describe('persistence failure', () => {
  it('stays locked and reports the failure instead of re-enabling', async () => {
    const { user, persistence, onInteraction, onWidgetError } = setup();
    persistence.failNextWrites(1);

    await user.click(confirmButton());

    await waitFor(() => {
      expect(onWidgetError).toHaveBeenCalledTimes(1);
    });
    expect(onWidgetError.mock.calls[0]?.[0]).toMatchObject({ code: 'persistence', messageId: MESSAGE });

    // FR-20 / AC-10 — the reply is already in the transcript, so re-enabling the buttons would
    // invite the press that sends the same answer a second time.
    expect(group()).toHaveAttribute('data-state', 'locked');
    expect(confirmButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();

    await user.click(confirmButton());

    expect(onInteraction).toHaveBeenCalledTimes(1);
  });
});
