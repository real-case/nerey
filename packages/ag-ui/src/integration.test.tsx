import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Message } from '@ag-ui/core';
import {
  DEFAULT_HOST_VALUE,
  WidgetHostProvider,
  WidgetRenderer,
  asAnyWidget,
  builtInWidgets,
  createMemoryPersistence,
  createWidgetRegistry,
} from '@nerey/core';
import type { MessagePersistence, NereyErrorLike, WidgetHostValue } from '@nerey/core';
// A test-only import: the adapter's shipped code never reaches the theme (ADR 0051), but the
// acceptance path for this phase is the theme's `poll` widget end to end.
import { pollWidget } from '@nerey/theme';

import { T0, ev, streamedCall } from './__fixtures__/events';
import { createAgUiHost, hydrateWidgetStates } from './host';
import { createAgUiTranscript } from './transcript';
import type { AgUiTranscript } from './transcript';
import { useAgUiFrames } from './use-ag-ui-frames';

/**
 * Production-ready plan Ф4 acceptance: `poll` and `confirmation` go stream → ready → answer →
 * read-only after a reload, on a scripted AG-UI event feed, with no network and no model.
 *
 * The "agent" is a recorder: `addMessage` keeps what the host sent, which is exactly what a real
 * server would echo back as the `MESSAGES_SNAPSHOT` of the reloaded conversation.
 */

const registry = createWidgetRegistry([...builtInWidgets, asAnyWidget(pollWidget)]);

const POLL = {
  question: 'Where should we eat?',
  options: [
    { value: 'pizza', title: 'Pizza place' },
    { value: 'sushi', title: 'Sushi bar' },
  ],
};
const CONFIRM = { title: 'Book a table for four?' };

function Transcript(props: { transcript: AgUiTranscript }) {
  const frames = useAgUiFrames(props.transcript);
  return (
    <>
      {frames.map((frame) => (
        <div key={frame.message.id} data-testid={String(frame.message.id)}>
          <WidgetRenderer message={frame.message} status={frame.status} />
        </div>
      ))}
    </>
  );
}

type Session = {
  transcript: AgUiTranscript;
  added: Message[];
  runs: number;
  errors: NereyErrorLike[];
  sent: string[];
  unmount: () => void;
};

function mount(persistence: MessagePersistence, clock: { at: number }, prepared?: AgUiTranscript): Session {
  const transcript = prepared ?? createAgUiTranscript({ now: () => clock.at });
  const session: Session = { transcript, added: [], runs: 0, errors: [], sent: [], unmount: () => undefined };
  let next = 0;
  const adapterHost = createAgUiHost({
    agent: {
      addMessage: (message) => {
        session.added.push(message);
      },
      runAgent: () => {
        session.runs++;
        return Promise.resolve();
      },
    },
    transcript,
    generateId: () => `host-${++next}`,
    now: () => clock.at,
  });
  const host: WidgetHostValue = {
    ...DEFAULT_HOST_VALUE,
    registry,
    conversationId: 'thread-1',
    persistence,
    now: () => clock.at,
    onWidgetError: (error) => {
      session.errors.push(error);
    },
    ...adapterHost,
    sendUserMessage: (text, meta) => {
      session.sent.push(text);
      adapterHost.sendUserMessage(text, meta);
    },
  };
  const view = render(
    <WidgetHostProvider value={host}>
      <Transcript transcript={transcript} />
    </WidgetHostProvider>,
  );
  session.unmount = view.unmount;
  return session;
}

/** What the server holds after the first session: its own turn, plus everything the host added. */
function history(added: readonly Message[]): Message[] {
  return [
    { id: 'u-0', role: 'user', content: 'Plan dinner', metadata: { nerey: { createdAt: T0 - 1000 } } },
    {
      id: 'a-1',
      role: 'assistant',
      content: 'Two quick questions.',
      metadata: { nerey: { createdAt: T0 } },
      toolCalls: [
        {
          id: 'call-poll',
          type: 'function',
          function: {
            name: 'render_widget',
            arguments: JSON.stringify({ type: 'poll', version: '1.0.0', payload: POLL }),
          },
        },
        {
          id: 'call-confirm',
          type: 'function',
          function: {
            name: 'render_widget',
            arguments: JSON.stringify({ type: 'confirmation', version: '1.0.0', payload: CONFIRM }),
          },
        },
      ],
    },
    ...added,
  ];
}

describe('@nerey/ag-ui — poll and confirmation, end to end', () => {
  it('streams, becomes ready, answers through the protocol, and replays read-only after a reload', async () => {
    const user = userEvent.setup();
    const persistence = createMemoryPersistence();
    const clock = { at: T0 };

    /* ── Session 1: the live stream ── */
    const live = mount(persistence, clock);
    const pollEvents = streamedCall(
      'call-poll',
      'render_widget',
      { type: 'poll', version: '1.0.0', payload: POLL },
      T0,
    );
    const confirmEvents = streamedCall(
      'call-confirm',
      'render_widget',
      { type: 'confirmation', version: '1.0.0', payload: CONFIRM },
      T0,
    );

    act(() => {
      live.transcript.applyAll([
        ev.runStarted(),
        ev.textStart('a-1', T0),
        ev.textContent('a-1', 'Two quick questions.'),
      ]);
    });
    // Stream the poll up to its last fragment: it renders while still streaming, never as a fallback.
    act(() => {
      live.transcript.applyAll(pollEvents.slice(0, -2));
    });
    expect(screen.getByTestId('call-poll').querySelector('[data-nerey-fallback]')).toBeNull();
    expect(live.errors).toEqual([]);

    act(() => {
      live.transcript.applyAll([...pollEvents.slice(-2), ...confirmEvents, ev.runFinished()]);
    });
    const poll = within(screen.getByTestId('call-poll'));
    const confirm = within(screen.getByTestId('call-confirm'));
    expect(poll.getByText('Where should we eat?')).toBeTruthy();
    expect(confirm.getByText('Book a table for four?')).toBeTruthy();

    await user.click(poll.getByRole('radio', { name: 'Sushi bar' }));
    await user.click(poll.getByRole('button', { name: 'Submit' }));
    // One answer of two: the agent waits for the turn to be complete.
    expect(live.runs).toBe(0);

    clock.at = T0 + 5_000;
    await user.click(confirm.getByRole('button', { name: 'Confirm' }));
    expect(live.runs).toBe(1);

    // Both answers went back as tool messages on their own call ids — never as user text.
    expect(live.sent).toEqual([]);
    expect(live.added.map((m) => (m.role === 'tool' ? m.toolCallId : m.role))).toEqual([
      'call-poll',
      'call-confirm',
    ]);
    const answers = live.added.map(
      (m) =>
        JSON.parse(m.role === 'tool' && typeof m.content === 'string' ? m.content : 'null') as {
          action: string;
          text: string;
        },
    );
    expect(answers[0]?.text).toContain('Sushi bar');
    expect(answers[1]).toMatchObject({ action: 'confirm' });

    // The poll's selection is persisted debounced (ADR 0047); let the write land before leaving.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(await persistence.getWidgetState('thread-1', 'call-poll')).toEqual({ selected: 'sushi' });
    expect(live.errors).toEqual([]);
    live.unmount();

    /* ── Session 2: a reload, rebuilt from the server's snapshot ── */
    clock.at = T0 + 3_600_000;
    // What a reloading application does: rebuild from the snapshot, read the saved widget state
    // through the port, then render. Read-only comes from the envelope's marker; the selection
    // comes from the state, which a widget reads once, at mount.
    const restored = createAgUiTranscript({ now: () => clock.at });
    restored.apply(ev.snapshot(history(live.added), T0 + 3_600_000));
    await hydrateWidgetStates(restored, persistence, 'thread-1');
    const reloaded = mount(persistence, clock, restored);

    const roots = [screen.getByTestId('call-poll'), screen.getByTestId('call-confirm')].map((cell) =>
      cell.querySelector('[data-nerey-widget]'),
    );
    for (const root of roots) {
      expect(root).not.toBeNull();
      expect(root?.hasAttribute('data-readonly')).toBe(true);
    }
    // Disabled, not removed: the chosen option is still on screen and still checked.
    expect(within(screen.getByTestId('call-poll')).getByRole('radio', { name: 'Sushi bar' })).toBeChecked();
    for (const button of within(screen.getByTestId('call-confirm')).queryAllByRole('button')) {
      expect(button).toHaveProperty('disabled', true);
    }

    // Created times came from the server's metadata, not from the reload.
    expect(reloaded.transcript.getFrames().find((f) => f.message.id === 'call-poll')?.message.createdAt).toBe(
      T0,
    );
    expect(reloaded.added).toEqual([]);
    expect(reloaded.runs).toBe(0);
    expect(reloaded.errors).toEqual([]);
  });

  it('renders "1.0" against a registered 1.0.0 as a fallback with a typed error, never a near match', () => {
    const live = mount(createMemoryPersistence(), { at: T0 });
    act(() => {
      live.transcript.applyAll(
        streamedCall('call-x', 'render_widget', { type: 'poll', version: '1.0', payload: POLL }, T0),
      );
    });
    expect(
      screen.getByTestId('call-x').querySelector('[data-nerey-fallback="unknown-widget"]'),
    ).not.toBeNull();
    expect(screen.getByTestId('call-x').textContent).toContain('Where should we eat?');
    expect(live.errors.map((e) => e.code)).toEqual(['unknown-widget']);
  });

  it('expires an unanswered widget when its interrupt deadline passes, while mounted', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const clock = { at: T0 };
    const live = mount(createMemoryPersistence(), clock);
    act(() => {
      live.transcript.applyAll([
        ...streamedCall(
          'call-c',
          'render_widget',
          { type: 'confirmation', version: '1.0.0', payload: CONFIRM },
          T0,
        ),
        ev.runFinished('run-1', [
          {
            id: 'int-1',
            reason: 'approval',
            toolCallId: 'call-c',
            expiresAt: new Date(T0 + 30_000).toISOString(),
          },
        ]),
      ]);
    });
    // The lifecycle runtime reads the marker through the port before it lets the widget be pressed.
    await act(async () => {
      await Promise.resolve();
    });
    const root = () => screen.getByTestId('call-c').querySelector('[data-nerey-widget]');
    expect(root()?.hasAttribute('data-readonly')).toBe(false);

    try {
      clock.at = T0 + 30_000;
      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      expect(root()?.hasAttribute('data-readonly')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
