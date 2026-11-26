import { EventType } from '@ag-ui/core';
import type { BaseEvent, Interrupt, Message } from '@ag-ui/core';

/**
 * Scripted AG-UI events for tests (ADR 0054). Built from the protocol's own enum so a renamed
 * event type breaks the fixtures at compile time rather than silently matching nothing.
 */

export const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z

export const ev = {
  runStarted: (runId = 'run-1'): BaseEvent => ({ type: EventType.RUN_STARTED, threadId: 'thread-1', runId }),
  runFinished: (runId = 'run-1', interrupts?: Interrupt[]): BaseEvent => ({
    type: EventType.RUN_FINISHED,
    threadId: 'thread-1',
    runId,
    ...(interrupts ? { outcome: { type: 'interrupt', interrupts } } : {}),
  }),
  textStart: (messageId: string, timestamp?: number): BaseEvent => ({
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: 'assistant',
    ...(timestamp !== undefined ? { timestamp } : {}),
  }),
  textContent: (messageId: string, delta: string): BaseEvent => ({
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta,
  }),
  textEnd: (messageId: string): BaseEvent => ({ type: EventType.TEXT_MESSAGE_END, messageId }),
  textChunk: (delta: string, messageId?: string): BaseEvent => ({
    type: EventType.TEXT_MESSAGE_CHUNK,
    delta,
    ...(messageId !== undefined ? { messageId } : {}),
  }),
  toolStart: (toolCallId: string, toolCallName: string, timestamp?: number): BaseEvent => ({
    type: EventType.TOOL_CALL_START,
    toolCallId,
    toolCallName,
    ...(timestamp !== undefined ? { timestamp } : {}),
  }),
  toolArgs: (toolCallId: string, delta: string): BaseEvent => ({
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta,
  }),
  toolEnd: (toolCallId: string): BaseEvent => ({ type: EventType.TOOL_CALL_END, toolCallId }),
  toolChunk: (fields: { toolCallId?: string; toolCallName?: string; delta?: string }): BaseEvent => ({
    type: EventType.TOOL_CALL_CHUNK,
    ...fields,
  }),
  toolResult: (toolCallId: string, content: string, timestamp?: number): BaseEvent => ({
    type: EventType.TOOL_CALL_RESULT,
    messageId: `result-${toolCallId}`,
    toolCallId,
    content,
    ...(timestamp !== undefined ? { timestamp } : {}),
  }),
  snapshot: (messages: Message[], timestamp?: number): BaseEvent => ({
    type: EventType.MESSAGES_SNAPSHOT,
    messages,
    ...(timestamp !== undefined ? { timestamp } : {}),
  }),
};

/** Splits a document into fragments of `size` characters, the way a model streams arguments. */
export function fragments(text: string, size = 7): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size));
  return out;
}

/** A whole streamed tool call: start, one ARGS per fragment, end. */
export function streamedCall(
  toolCallId: string,
  name: string,
  args: unknown,
  timestamp?: number,
): BaseEvent[] {
  return [
    ev.toolStart(toolCallId, name, timestamp),
    ...fragments(JSON.stringify(args)).map((delta) => ev.toolArgs(toolCallId, delta)),
    ev.toolEnd(toolCallId),
  ];
}
