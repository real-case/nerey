'use client';

import { useChat } from '@ai-sdk/react';
import { DEFAULT_HOST_VALUE, WidgetHostProvider, WidgetRenderer } from '@nerey/core';
import type { WidgetHostValue } from '@nerey/core';
import { Button } from '@nerey/theme';
import { useAiSdkHost } from '@nerey/ai-sdk';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useMemo, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import { now } from '../lib/clock';
import { toFrames } from '../lib/frames';
import type { KnownWidgetState } from '../lib/frames';
import { fetchPersistence } from '../lib/persistence';
import { registry } from '../lib/registry';
import type { ExampleMessage } from '../lib/store';

export type ChatProps = {
  conversationId: string;
  initialMessages: ExampleMessage[];
  known: KnownWidgetState;
};

/**
 * The client half. `useChat` owns the transcript and the stream; Nerey owns what a tool call looks
 * like and how it answers. `useAiSdkHost` turns a widget's reply into `addToolOutput` on its call
 * (ADR 0048, 0055), and `sendAutomaticallyWhen` sends the answered call to the scripted model.
 */
export function Chat({ conversationId, initialMessages, known }: ChatProps): ReactElement {
  const [transport] = useState(() => new DefaultChatTransport<ExampleMessage>({ api: '/api/chat' }));
  const chat = useChat<ExampleMessage>({
    id: conversationId,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });
  const { messages, status } = chat;
  const aiSdkHost = useAiSdkHost(chat);
  const [draft, setDraft] = useState('Ship the release.');

  const frames = useMemo(() => toFrames(messages, known), [messages, known]);

  const host = useMemo<WidgetHostValue>(
    () => ({
      ...DEFAULT_HOST_VALUE,
      registry,
      conversationId,
      persistence: fetchPersistence,
      now,
      messageCount: messages.length,
      ...aiSdkHost,
    }),
    [conversationId, messages.length, aiSdkHost],
  );

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!draft.trim()) return;
    host.sendUserMessage(draft.trim());
    setDraft('');
  }

  return (
    <WidgetHostProvider value={host}>
      <ol className="transcript" aria-label="Conversation" data-chat-status={status}>
        {frames.map(({ message, status: frameStatus }) => (
          <li key={message.id} className={`turn turn-${message.role}`}>
            <WidgetRenderer message={message} status={frameStatus} />
          </li>
        ))}
      </ol>
      <form className="composer" onSubmit={submit}>
        <label htmlFor="composer-input">Message</label>
        <input id="composer-input" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <Button type="submit" disabled={status !== 'ready'}>
          Send
        </Button>
      </form>
    </WidgetHostProvider>
  );
}
