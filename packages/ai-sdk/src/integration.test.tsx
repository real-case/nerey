import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';

import {
  DEFAULT_HOST_VALUE,
  WidgetHostProvider,
  WidgetRenderer,
  confirmationWidget,
  createMemoryPersistence,
  createWidgetRegistry,
} from '@nerey/core';
import type { MessagePersistence, NereyErrorLike, WidgetHostValue } from '@nerey/core';
import { pollWidget } from '@nerey/theme';

import { CREATED_AT, assistant, createRecordingChat } from './__fixtures__/chat';
import type { RecordingChat } from './__fixtures__/chat';
import type { AiSdkBinding } from './binding';
import { useAiSdkHost, useAiSdkWidgetFrames } from './hooks';
import type { AiSdkMessageLike } from './messages';

/**
 * Production-ready plan Ф4, acceptance — `poll` and `confirmation` go stream → ready → answer →
 * read-only after reload on a scripted stream: no network, no model. The chat is a recording stand-in
 * that applies an answer to the transcript the way the AI SDK does, and "reload" is a fresh mount on
 * the stored transcript with an empty in-memory port, so nothing but the transcript carries over.
 */

const registry = createWidgetRegistry([pollWidget, confirmationWidget]);
const BINDING: AiSdkBinding = { mode: 'render-widget' };

function Chat(props: {
  chat: RecordingChat;
  messages: readonly AiSdkMessageLike[];
  persistence: MessagePersistence;
  errors: NereyErrorLike[];
  session: string;
}): ReactElement {
  const frames = useAiSdkWidgetFrames(props.messages, { binding: BINDING, now: () => CREATED_AT });
  const host = useAiSdkHost(props.chat);
  const value: WidgetHostValue = {
    ...DEFAULT_HOST_VALUE,
    registry,
    // A fresh id per mount stands in for a page reload: core's session-scoped marker store does not
    // survive one, so nothing but the transcript may carry the answered state across.
    conversationId: props.session,
    persistence: props.persistence,
    now: () => CREATED_AT + 1_000,
    onWidgetError: (error) => {
      props.errors.push(error);
    },
    ...host,
  };
  return (
    <WidgetHostProvider value={value}>
      {frames.map((frame) => (
        <WidgetRenderer key={frame.message.id} message={frame.message} status={frame.status} />
      ))}
    </WidgetHostProvider>
  );
}

let mounts = 0;

function mount(chat: RecordingChat) {
  mounts += 1;
  const session = `conversation-${mounts}`;
  const errors: NereyErrorLike[] = [];
  const persistence = createMemoryPersistence();
  const view = render(
    <Chat chat={chat} messages={chat.messages} persistence={persistence} errors={errors} session={session} />,
  );
  const show = (messages: AiSdkMessageLike[]): void => {
    chat.messages = messages;
    view.rerender(
      <Chat chat={chat} messages={messages} persistence={persistence} errors={errors} session={session} />,
    );
  };
  return { ...view, errors, show, sync: () => show(chat.messages) };
}

/**
 * A durable, action-bearing widget stays read-only while its marker is being read through the port
 * (ADR 0047), so asserting on the first frame would pass whatever the transcript said. Reload waits
 * for that read to settle; only then is a read-only widget read-only because of the transcript.
 */
async function reload(stored: AiSdkMessageLike[]) {
  const view = mount(createRecordingChat(stored));
  await act(() => Promise.resolve());
  return view;
}

const POLL = {
  question: 'Which city?',
  options: [
    { value: 'lisbon', title: 'Lisbon' },
    { value: 'porto', title: 'Porto' },
  ],
};

function pollTurn(state: string, payload: unknown, extra: Record<string, unknown> = {}): AiSdkMessageLike {
  return assistant('turn-poll', [
    { type: 'text', text: 'Which city should the trip start in?' },
    {
      type: 'tool-render_widget',
      toolCallId: 'call-poll',
      state,
      input: { type: 'poll', version: '1.0.0', payload },
      ...extra,
    },
  ]);
}

describe('@nerey/ai-sdk end to end — poll', () => {
  it('streams, becomes ready, answers through addToolOutput and is read-only after reload', async () => {
    const user = userEvent.setup();
    const chat = createRecordingChat();
    const view = mount(chat);

    // Streaming: the partial payload fails the schema and must not fall back.
    view.show([pollTurn('input-streaming', { question: 'Which city?' })]);
    view.show([pollTurn('input-streaming', { question: 'Which city?', options: [{ value: 'lisbon' }] })]);
    expect(view.container.querySelector('[data-nerey-fallback]')).toBeNull();
    expect(view.errors).toEqual([]);

    // Ready.
    view.show([pollTurn('input-available', POLL)]);
    await user.click(screen.getByRole('radio', { name: 'Porto' }));
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(chat.outputs).toEqual([
      {
        tool: 'render_widget',
        toolCallId: 'call-poll',
        output: { action: 'submit', text: 'porto — Porto' },
      },
    ]);
    expect(chat.sent).toEqual([]);
    expect(view.errors).toEqual([]);

    // Reload: a new mount on the stored transcript, with an empty port.
    const stored = chat.messages;
    view.unmount();
    const reloaded = await reload(stored);
    const root = reloaded.container.querySelector('[data-nerey-widget="poll"]');
    expect(root).toHaveAttribute('data-readonly');
    expect(screen.getByRole('button', { name: /Answer sent|Submit/ })).toBeDisabled();
    const lisbon = screen.getByRole('radio', { name: 'Lisbon' });
    await user.click(lisbon);
    expect(lisbon).not.toBeChecked();
    expect(reloaded.errors).toEqual([]);
  });

  it('falls back for a near-miss version instead of rendering poll@1.0.0', () => {
    const chat = createRecordingChat();
    const view = mount(chat);
    view.show([
      assistant('turn', [
        { type: 'text', text: 'Which city?' },
        {
          type: 'tool-render_widget',
          toolCallId: 'call-near',
          state: 'input-available',
          input: { type: 'poll', version: '1.0', payload: POLL },
        },
      ]),
    ]);
    expect(view.container.querySelector('[data-nerey-fallback="unknown-widget"]')).not.toBeNull();
    expect(view.container.textContent).toContain('Which city?');
    expect(view.errors.map((error) => error.code)).toEqual(['unknown-widget']);
  });
});

function confirmationTurn(state: string, extra: Record<string, unknown> = {}): AiSdkMessageLike {
  return assistant('turn-confirm', [
    {
      type: 'tool-render_widget',
      toolCallId: 'call-confirm',
      state,
      input: { type: 'confirmation', version: '1.0.0', payload: { title: 'Delete the draft?' } },
      ...extra,
    },
  ]);
}

describe('@nerey/ai-sdk end to end — confirmation', () => {
  it('answers a plain tool call through addToolOutput and is read-only after reload', async () => {
    const user = userEvent.setup();
    const chat = createRecordingChat();
    const view = mount(chat);

    view.show([confirmationTurn('input-streaming')]);
    view.show([confirmationTurn('input-available')]);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(chat.outputs).toHaveLength(1);
    expect(chat.outputs[0]).toMatchObject({ tool: 'render_widget', toolCallId: 'call-confirm' });
    expect(chat.outputs[0]?.output).toMatchObject({ action: 'confirm' });

    const stored = chat.messages;
    view.unmount();
    await reload(stored);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('answers an AI SDK approval request through addToolApprovalResponse', async () => {
    const user = userEvent.setup();
    const chat = createRecordingChat();
    const view = mount(chat);

    view.show([confirmationTurn('approval-requested', { approval: { id: 'approval-1' } })]);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(chat.approvals).toEqual([{ id: 'approval-1', approved: false }]);
    expect(chat.outputs).toEqual([]);

    const stored = chat.messages;
    view.unmount();
    await reload(stored);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });
});

describe('@nerey/ai-sdk end to end — known state on the first frame', () => {
  it('renders an answered poll read-only, with its answer, before any port read settles', () => {
    const errors: NereyErrorLike[] = [];
    function Known(): ReactElement {
      const messages = [pollTurn('output-available', POLL)];
      const frames = useAiSdkWidgetFrames(messages, {
        binding: BINDING,
        known: { state: { 'call-poll': { selected: 'porto' } } },
      });
      const host = useAiSdkHost(createRecordingChat(messages));
      return (
        <WidgetHostProvider
          value={{
            ...DEFAULT_HOST_VALUE,
            registry,
            conversationId: 'conversation-known',
            persistence: createMemoryPersistence(),
            onWidgetError: (error) => {
              errors.push(error);
            },
            ...host,
          }}
        >
          {frames.map((frame) => (
            <WidgetRenderer key={frame.message.id} message={frame.message} status={frame.status} />
          ))}
        </WidgetHostProvider>
      );
    }
    const view = render(<Known />);
    expect(view.container.querySelector('[data-nerey-widget="poll"]')).toHaveAttribute('data-readonly');
    expect(screen.getByRole('radio', { name: 'Porto' })).toBeChecked();
    expect(errors).toEqual([]);
  });
});
