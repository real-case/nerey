import { describe, expect, it } from 'vitest';

import type { BaseEvent, Message } from '@ag-ui/core';
import { checkAdapterConformance } from '@nerey/core/testing';
import type { AdapterDelivery, AdapterFrame, AdapterUnderTest } from '@nerey/core/testing';

import { ev, fragments } from './__fixtures__/events';
import { createAgUiHost } from './host';
import { createAgUiTranscript } from './transcript';
import type { AgUiTranscript } from './transcript';

/**
 * The adapter conformance kit from `@nerey/core/testing`, run against both bindings (ADR 0051 /
 * 0054). The kit owns the rules; this file only says how to script a tool call in AG-UI events and
 * how to read frames and replies back out.
 */

function framesFor(transcript: AgUiTranscript, events: readonly BaseEvent[], id: string): AdapterFrame[] {
  const out: AdapterFrame[] = [];
  for (const event of events) {
    transcript.apply(event);
    const frame = transcript.getFrames().find((f) => f.message.id === id);
    if (frame && frame !== out[out.length - 1]) out.push(frame);
  }
  return out;
}

function adapterFor(binding: 'generic' | 'table'): AdapterUnderTest<BaseEvent> {
  let transcript: AgUiTranscript | undefined;
  let scriptedId = '';

  return {
    name: `@nerey/ag-ui (${binding})`,
    script: (scenario) => {
      scriptedId = scenario.correlationId;
      const name = binding === 'generic' ? 'render_widget' : `show_${scenario.type}_${scenario.version}`;
      const args =
        binding === 'generic'
          ? { type: scenario.type, version: scenario.version, payload: scenario.payload }
          : scenario.payload;
      return [
        ev.runStarted(),
        ev.toolStart(scenario.correlationId, name, scenario.createdAt),
        ...fragments(JSON.stringify(args), 6).map((delta) => ev.toolArgs(scenario.correlationId, delta)),
        ev.toolEnd(scenario.correlationId),
      ];
    },
    frames: (events, { registry }) => {
      // The table binding is built the way an application builds it: one row per registered entry.
      // The scripted version is passed through as written, so `"1.0"` gets a row of its own and the
      // registry — not the adapter — decides that it does not match.
      const table: Record<string, { type: string; version: string }> = {};
      for (const entry of registry.entries()) {
        table[`show_${entry.type}_${entry.version}`] = { type: entry.type, version: entry.version };
      }
      for (const event of events) {
        if (event.type === ev.toolStart('', '').type) {
          const [type, version] = String(event.toolCallName)
            .replace(/^show_/, '')
            .split(/_(?=[^_]*$)/);
          if (type && version) table[`show_${type}_${version}`] = { type, version };
        }
      }
      transcript = createAgUiTranscript({
        now: () => 0,
        tools: binding === 'generic' ? {} : { renderWidget: false, table },
      });
      return framesFor(transcript, events, scriptedId);
    },
    createHost: () => {
      const added: Message[] = [];
      const host = createAgUiHost({
        agent: {
          addMessage: (message) => {
            added.push(message);
          },
          runAgent: () => Promise.resolve(),
        },
        transcript: transcript ?? createAgUiTranscript(),
        generateId: () => `msg-${added.length}`,
      });
      return {
        host,
        delivered: () =>
          added.flatMap((message): AdapterDelivery[] => {
            if (message.role !== 'tool' || typeof message.content !== 'string') return [];
            const answer = JSON.parse(message.content) as { text: string; result?: unknown };
            return [{ correlationId: message.toolCallId, ...answer }];
          }),
      };
    },
  };
}

describe('@nerey/ag-ui — adapter conformance (ADR 0051)', () => {
  it.each(['generic', 'table'] as const)('passes the kit with the %s binding', async (binding) => {
    const report = await checkAdapterConformance(adapterFor(binding));
    expect(report.violations).toEqual([]);
    expect(report.passed).toBe(true);
  });
});
