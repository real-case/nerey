'use client';

import { useChat } from '@ai-sdk/react';
import { DEFAULT_HOST_VALUE, WidgetHostProvider, WidgetRenderer } from '@nerey/core';
import type { WidgetHostValue } from '@nerey/core';
import { Button } from '@nerey/theme';
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import { useMemo, useState } from 'react';
import type { FormEvent, ReactElement } from 'react';

import { now, SCRIPTED_NOW } from '../lib/clock';
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

/** The tool a call id belongs to, which `addToolOutput` needs alongside the id. */
function toolNameOf(messages: readonly ExampleMessage[], toolCallId: string): string | undefined {
  for (const message of messages) {
    for (const part of message.parts) {
      if (isToolUIPart(part) && part.toolCallId === toolCallId) return getToolName(part);
    }
  }
  return undefined;
}

/**
 * The client half. `useChat` owns the transcript and the stream; Nerey owns what a tool call looks
 * like and how it answers. A widget's reply goes back through `respond` → `addToolOutput` (ADR
 * 0048), and `sendAutomaticallyWhen` sends the answered call to the scripted model.
 */
export function Chat({ conversationId, initialMessages, known }: ChatProps): ReactElement {
  const [transport] = useState(() => new DefaultChatTransport<ExampleMessage>({ api: '/api/chat' }));
  const chat = useChat<ExampleMessage>({
    id: conversationId,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });
  const { messages, sendMessage, addToolOutput, status } = chat;
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
      sendUserMessage: (text) => {
        void sendMessage({ text, metadata: { createdAt: SCRIPTED_NOW + messages.length * 1_000 } });
      },
      respond: (toolCallId, response) => {
        const tool = toolNameOf(messages, toolCallId);
        if (!tool) return;
        void addToolOutput({ tool, toolCallId, output: response });
      },
    }),
    [conversationId, messages, sendMessage, addToolOutput],
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
