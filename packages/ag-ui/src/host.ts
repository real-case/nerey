import type { BaseEvent, Message, ResumeEntry, ToolMessage, UserMessage } from '@ag-ui/core';
import type { MessagePersistence, WidgetHostValue, WidgetResponse } from '@nerey/core';

import type { AgUiTranscript } from './transcript';

/**
 * The part of an AG-UI agent the host drives. Structural on purpose: `@ag-ui/client`'s
 * `AbstractAgent` (and so `HttpAgent`) satisfies it as it is, and the adapter does not take the
 * client — with RxJS and five more packages — as a peer for two methods.
 */
export type AgUiAgent = {
  addMessage: (message: Message) => void;
  runAgent: (parameters?: { resume?: ResumeEntry[] }) => Promise<unknown>;
};

/** The part of an agent that streams events, for `subscribeTranscript`. */
export type AgUiEventSource = {
  subscribe: (subscriber: { onEvent?: (params: { event: BaseEvent }) => void }) => {
    unsubscribe: () => void;
  };
};

export type CreateAgUiHostOptions = {
  agent: AgUiAgent;
  transcript: AgUiTranscript;
  /** Ids for the messages the host adds. Defaults to `crypto.randomUUID()`. */
  generateId?: () => string;
  /** Epoch ms, written as `metadata.nerey.respondedAt` on an answer. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * A run that rejected. The answer is already in the agent's messages and the transcript, so the
   * widget stays answered (ADR 0016's no-rollback rule); retrying the run is the host's call.
   */
  onRunError?: (error: unknown) => void;
};

/** What `createAgUiHost` contributes to `WidgetHostValue`. Spread it into the provider's value. */
export type AgUiHostValue = Pick<WidgetHostValue, 'sendUserMessage'> &
  Required<Pick<WidgetHostValue, 'respond'>>;

function defaultId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Wires Nerey's outbound channel to an AG-UI agent (ADR 0048 / 0054).
 *
 * `respond` answers the tool call it is given: a `role: "tool"` message carrying the call's id, and
 * — when the run ended on an interrupt naming that call — a resolved `ResumeEntry` with the same
 * answer. The agent runs once every widget call since the last user message is answered, so three
 * questions in one turn go back as one run, as the protocol expects.
 *
 * `sendUserMessage` is the user typing. Open interrupts are cancelled on that run, because the
 * protocol requires the next run to address every one of them.
 */
export function createAgUiHost(options: CreateAgUiHostOptions): AgUiHostValue {
  const { agent, transcript } = options;
  const generateId = options.generateId ?? defaultId;
  const now = options.now ?? Date.now;
  /** Resolved interrupts waiting for the run that carries them. */
  const resolved = new Map<string, ResumeEntry>();

  function run(resume: ResumeEntry[]): void {
    resolved.clear();
    const started = resume.length > 0 ? agent.runAgent({ resume }) : agent.runAgent();
    started.catch((error: unknown) => {
      options.onRunError?.(error);
    });
  }

  function add(message: Message): void {
    agent.addMessage(message);
    transcript.addLocalMessage(message);
  }

  return {
    respond(correlationId: string, response: WidgetResponse) {
      const call = transcript.getCall(correlationId);
      // An unknown id is not a widget call this transcript rendered, and an answered call has had
      // its one answer: a second tool message for it is a protocol error the agent would reject.
      if (!call || call.answered) return;

      const answer: { action: string; text: string; result?: unknown } = {
        action: response.action,
        text: response.text,
      };
      if (response.result !== undefined) answer.result = response.result;

      const message: ToolMessage = {
        id: generateId(),
        role: 'tool',
        toolCallId: correlationId,
        content: JSON.stringify(answer),
        metadata: { nerey: { respondedAt: now() } },
      };
      if (call.interruptId !== undefined) {
        resolved.set(call.interruptId, {
          interruptId: call.interruptId,
          status: 'resolved',
          payload: answer,
        });
      }
      add(message);

      if (transcript.awaitingAnswer().length === 0) run([...resolved.values()]);
    },

    sendUserMessage(text: string, meta?: Record<string, unknown>) {
      const cancelled: ResumeEntry[] = transcript
        .openInterrupts()
        .filter(({ interruptId }) => !resolved.has(interruptId))
        .map(({ interruptId }) => ({ interruptId, status: 'cancelled' }));

      const message: UserMessage = { id: generateId(), role: 'user', content: text };
      if (meta !== undefined) message.metadata = { nerey: { meta } };
      add(message);
      run([...resolved.values(), ...cancelled]);
    },
  };
}

/**
 * Feeds every event an agent streams into the transcript. Returns the unsubscribe function.
 *
 *     useEffect(() => subscribeTranscript(agent, transcript), [agent, transcript]);
 */
export function subscribeTranscript(source: AgUiEventSource, transcript: AgUiTranscript): () => void {
  const subscription = source.subscribe({
    onEvent: ({ event }) => {
      transcript.apply(event);
    },
  });
  return () => {
    subscription.unsubscribe();
  };
}

/**
 * Reads every widget call's saved state through the persistence port and hands it to the
 * transcript (ADR 0054). Call it after a `MESSAGES_SNAPSHOT` has rebuilt the transcript and before
 * the transcript is rendered — a widget reads its state once, at mount — so a reloaded poll shows
 * the option that was chosen, not only that it was answered.
 *
 * A failed read leaves that widget seeded as though nothing was saved, and is passed to `onError`:
 * a missing selection must not make the exchange itself unreadable (ADR 0012).
 */
export async function hydrateWidgetStates(
  transcript: AgUiTranscript,
  persistence: Pick<MessagePersistence, 'getWidgetState'>,
  conversationId: string,
  onError?: (error: unknown, toolCallId: string) => void,
): Promise<void> {
  await Promise.all(
    transcript.widgetCallIds().map(async (toolCallId) => {
      try {
        const state = await persistence.getWidgetState(conversationId, toolCallId);
        if (state !== undefined) transcript.setWidgetState(toolCallId, state);
      } catch (error) {
        onError?.(error, toolCallId);
      }
    }),
  );
}
