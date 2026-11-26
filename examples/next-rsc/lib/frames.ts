import type { WidgetStateRecord } from '@nerey/core';
import { toWidgetFrames } from '@nerey/ai-sdk';
import type { AiSdkWidgetFrame } from '@nerey/ai-sdk';

import { binding } from './contracts';
import type { ExampleMessage } from './store';

/**
 * The transcript as `WidgetRenderer` frames, in part order. Widget tool parts go through
 * `@nerey/ai-sdk`'s `toWidgetFrames` (ADR 0055): coordinates from the binding, `correlationId` from
 * the call id, ADR 0019's status table, and an expiry marker on an answered call — so a reloaded,
 * answered poll is read-only on the server's first frame. Text parts render as plain messages.
 *
 * Widget STATE lives behind the persistence port, not in the transcript. The page reads it on the
 * server and hands it over as `known`, so the snapshot shows the chosen option on the first frame
 * too, instead of after the port's read.
 */

export type WidgetFrame = AiSdkWidgetFrame;

/** Stored widget state by tool call id, as the page read it. */
export type KnownWidgetState = Record<string, WidgetStateRecord>;

export function toFrames(messages: readonly ExampleMessage[], known: KnownWidgetState): WidgetFrame[] {
  const frames: WidgetFrame[] = [];
  for (const message of messages) {
    const createdAt = message.metadata?.createdAt ?? 0;
    const widgets = new Map(
      toWidgetFrames(message, { binding, createdAt, known: { state: known } }).map((frame) => [
        frame.message.id,
        frame,
      ]),
    );
    message.parts.forEach((part, index) => {
      if (part.type === 'text') {
        frames.push({
          status: 'ready',
          message: { id: `${message.id}:${index}`, role: message.role, text: part.text, createdAt },
        });
        return;
      }
      const frame = 'toolCallId' in part ? widgets.get(part.toolCallId) : undefined;
      if (frame) frames.push(frame);
    });
  }
  return frames;
}
