import type { UIMessageChunk as AnyChunk } from 'ai';

import { SCRIPTED_NOW } from './clock';
import type { ExampleMessage, ExampleMetadata } from './store';

type UIMessageChunk = AnyChunk<ExampleMetadata>;

/**
 * The scripted model (production-ready plan, step 5.3). It answers the way a model with the
 * `ask_poll` tool would, as AI SDK UI message chunks, so the client runs the real `useChat` stream
 * parser — and there is no LLM, no network beyond localhost and no wall clock anywhere in it.
 *
 * Two turns: a user message gets a poll, streamed as partial JSON; a poll with a tool output gets a
 * sentence that quotes the answer back, which is how the smoke test sees the reply arrive.
 */

export const POLL_INPUT = {
  question: 'Which release channel should we ship to first?',
  options: [
    { value: 'stable', title: 'Stable' },
    { value: 'beta', title: 'Beta' },
    { value: 'nightly', title: 'Nightly' },
  ],
} as const;

const POLL_CALL_ID = 'call-poll';

/** Splits a string into `n` roughly equal pieces, so the input arrives as a real stream would. */
function pieces(text: string, n: number): string[] {
  const size = Math.ceil(text.length / n);
  return Array.from({ length: n }, (_, i) => text.slice(i * size, (i + 1) * size)).filter(Boolean);
}

function answeredPoll(messages: readonly ExampleMessage[]): unknown {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return undefined;
  // Only an answer nobody has replied to yet: once a text part follows the call, this turn is done.
  const at = last.parts.findIndex((part) => part.type === 'tool-ask_poll');
  const part = last.parts[at];
  if (!part || part.type !== 'tool-ask_poll' || part.state !== 'output-available') return undefined;
  if (last.parts.slice(at + 1).some((later) => later.type === 'text')) return undefined;
  return part.output;
}

function replyText(output: unknown): string {
  const text =
    output && typeof output === 'object' && 'text' in output && typeof output.text === 'string'
      ? output.text
      : 'your answer';
  return `Noted — shipping per your answer: ${text}`;
}

/**
 * The chunks for the next assistant turn. `createdAt` is scripted, one second per message, so the
 * same transcript always carries the same timestamps.
 */
export function nextTurn(messages: readonly ExampleMessage[]): UIMessageChunk[] {
  const createdAt = SCRIPTED_NOW + messages.length * 1_000;
  const start: UIMessageChunk = { type: 'start', messageMetadata: { createdAt } };
  const output = answeredPoll(messages);

  if (output !== undefined) {
    // Its own step. `lastAssistantMessageIsCompleteWithToolCalls` looks at the last step only, so a
    // reply in the same step as the answered call would look like an answered call again and the
    // client would send it straight back — a loop.
    return [
      start,
      { type: 'start-step' },
      { type: 'text-start', id: 'reply' },
      { type: 'text-delta', id: 'reply', delta: replyText(output) },
      { type: 'text-end', id: 'reply' },
      { type: 'finish-step' },
      { type: 'finish' },
    ];
  }

  const json = JSON.stringify(POLL_INPUT);
  return [
    start,
    { type: 'start-step' },
    { type: 'text-start', id: 'intro' },
    { type: 'text-delta', id: 'intro', delta: 'One question before I ship.' },
    { type: 'text-end', id: 'intro' },
    { type: 'tool-input-start', toolCallId: POLL_CALL_ID, toolName: 'ask_poll' },
    ...pieces(json, 4).map((inputTextDelta): UIMessageChunk => ({
      type: 'tool-input-delta',
      toolCallId: POLL_CALL_ID,
      inputTextDelta,
    })),
    { type: 'tool-input-available', toolCallId: POLL_CALL_ID, toolName: 'ask_poll', input: POLL_INPUT },
    { type: 'finish-step' },
    { type: 'finish' },
  ];
}
