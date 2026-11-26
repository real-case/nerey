import type { LifecycleRecord, NereyMessage, WidgetStateRecord, WidgetStatus } from '@nerey/core';
import { getToolName, isToolUIPart } from 'ai';

import { TOOL_WIDGETS } from './contracts';
import type { ToolName } from './contracts';
import type { ExampleMessage } from './store';

/**
 * UI messages → the frames `WidgetRenderer` renders. A placeholder for `@nerey/ai-sdk`'s
 * `toWidgetFrames`, which does this mapping for real (ADR 0051); the example switches to it once
 * the adapter lands, and this file goes away.
 *
 * The status table is ADR 0019's: a tool call whose input is still streaming renders `streaming`
 * and is never validated; once the input is complete it is `ready`, whether or not it has been
 * answered; a failed call is `error`.
 */

export type WidgetFrame = { message: NereyMessage; status: WidgetStatus };

/** What the server already knows about each widget, keyed by tool call id. */
export type KnownWidgetState = {
  state: Record<string, WidgetStateRecord>;
  expiry: Record<string, LifecycleRecord>;
};

function statusOf(state: string): WidgetStatus {
  if (state === 'input-streaming') return 'streaming';
  if (state === 'output-error') return 'error';
  return 'ready';
}

function isToolName(name: string): name is ToolName {
  return Object.hasOwn(TOOL_WIDGETS, name);
}

export function toFrames(messages: readonly ExampleMessage[], known: KnownWidgetState): WidgetFrame[] {
  const frames: WidgetFrame[] = [];
  for (const message of messages) {
    const createdAt = message.metadata?.createdAt ?? 0;
    message.parts.forEach((part, index) => {
      if (part.type === 'text') {
        frames.push({
          status: 'ready',
          message: { id: `${message.id}:${index}`, role: message.role, text: part.text, createdAt },
        });
        return;
      }
      if (!isToolUIPart(part)) return;
      const toolName = getToolName(part);
      if (!isToolName(toolName)) return;
      const coordinates = TOOL_WIDGETS[toolName];
      const id = part.toolCallId;
      const state = known.state[id];
      const expiry = known.expiry[id];
      frames.push({
        status: statusOf(part.state),
        message: {
          id,
          role: 'assistant',
          // The last line of the degradation chain (ADR 0012): readable even if nothing renders.
          text: `[${coordinates.type}] ${JSON.stringify(part.input ?? {})}`,
          createdAt,
          widget: {
            ...coordinates,
            payload: part.input ?? {},
            correlationId: id,
            ...(state ? { state } : {}),
            ...(expiry ? { expiry } : {}),
          },
        },
      });
    });
  }
  return frames;
}
