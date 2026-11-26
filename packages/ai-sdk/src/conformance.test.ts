import { checkAdapterConformance, expectAdapterConformance } from '@nerey/core/testing';
import type { AdapterFrame, AdapterScenario, AdapterUnderTest } from '@nerey/core/testing';

import { assistant, createRecordingChat } from './__fixtures__/chat';
import type { AiSdkBinding } from './binding';
import { createAiSdkHost } from './host';
import { createWidgetFrameMapper } from './messages';
import type { AiSdkMessageLike } from './messages';

/**
 * ADR 0051 / 0055 — the adapter runs the shared adapter conformance kit in both binding modes. Each
 * event is the whole `UIMessage` as `useChat` would hold it after one stream chunk, because that is
 * what the adapter actually receives: the SDK has already folded the chunks into parts.
 */

const TABLE: AiSdkBinding = {
  mode: 'tools',
  tools: {
    // The kit scripts the registered version and a near miss; both rows are declared verbatim,
    // which is the point: the table names a version, and the adapter never second-guesses it.
    show_probe: { type: 'nerey-adapter-probe', version: '1.0.0' },
    show_probe_near_miss: { type: 'nerey-adapter-probe', version: '1.0' },
  },
};

function inputFor(binding: AiSdkBinding, scenario: AdapterScenario, payload: unknown): unknown {
  if (binding.mode === 'tools') return payload;
  return { type: scenario.type, version: scenario.version, payload };
}

function toolNameFor(binding: AiSdkBinding, scenario: AdapterScenario): string {
  if (binding.mode === 'render-widget') return binding.toolName ?? 'render_widget';
  const row = Object.entries(binding.tools).find(
    ([, ref]) => ref.type === scenario.type && ref.version === scenario.version,
  );
  if (!row) throw new Error(`no table row for ${scenario.type}@${scenario.version}`);
  return row[0];
}

function aiSdkAdapter(binding: AiSdkBinding): AdapterUnderTest<AiSdkMessageLike> {
  // The host reads the chat's messages when a widget answers, so the projection leaves the latest
  // snapshot where the host's chat can see it.
  const chat = createRecordingChat();

  return {
    name: `@nerey/ai-sdk (${binding.mode})`,
    script: (scenario) => {
      const tool = toolNameFor(binding, scenario);
      const snapshot = (state: string, input: unknown): AiSdkMessageLike =>
        assistant(
          'turn-1',
          [
            { type: 'text', text: 'Here is a probe.' },
            { type: `tool-${tool}`, toolCallId: scenario.correlationId, state, input },
          ],
          { createdAt: scenario.createdAt },
        );
      return [
        ...scenario.partialPayloads.map((partial) =>
          snapshot('input-streaming', inputFor(binding, scenario, partial)),
        ),
        snapshot('input-available', inputFor(binding, scenario, scenario.payload)),
      ];
    },
    frames: (events) => {
      const mapper = createWidgetFrameMapper({ binding });
      const frames: AdapterFrame[] = [];
      for (const event of events) {
        chat.messages = [event];
        frames.push(...mapper.frames([event]));
      }
      return frames;
    },
    createHost: () => ({
      host: createAiSdkHost({ chat }),
      delivered: () =>
        chat.outputs.map((entry) => {
          const output = entry.output as { text: string; result?: unknown };
          return {
            correlationId: entry.toolCallId,
            text: output.text,
            ...(output.result !== undefined ? { result: output.result } : {}),
          };
        }),
    }),
  };
}

describe('@nerey/ai-sdk adapter conformance', () => {
  it('passes the kit in render-widget mode', async () => {
    await expectAdapterConformance(aiSdkAdapter({ mode: 'render-widget' }));
  });

  it('passes the kit in render-widget mode under a custom tool name', async () => {
    await expectAdapterConformance(aiSdkAdapter({ mode: 'render-widget', toolName: 'show_widget' }));
  });

  it('passes the kit in tools mode', async () => {
    await expectAdapterConformance(aiSdkAdapter(TABLE));
  });

  it('is caught by the kit when a binding "fixes" a near-miss version', async () => {
    // The tempting bug, planted: a table that resolves the `1.0` tool to the registered `1.0.0`.
    const fuzzy: AiSdkBinding = {
      mode: 'tools',
      tools: {
        show_probe: { type: 'nerey-adapter-probe', version: '1.0.0' },
        show_probe_near_miss: { type: 'nerey-adapter-probe', version: '1.0.0' },
      },
    };
    const adapter = aiSdkAdapter(fuzzy);
    const scripted = adapter.script;
    // The script still names the near-miss tool for a `1.0` scenario.
    adapter.script = (scenario) =>
      scripted({ ...scenario, version: scenario.version === '1.0' ? '1.0.0' : scenario.version }).map(
        (event) =>
          scenario.version === '1.0'
            ? {
                ...event,
                parts: event.parts.map((part) =>
                  typeof part === 'object' && part !== null && 'toolCallId' in part
                    ? { ...part, type: 'tool-show_probe_near_miss' }
                    : part,
                ),
              }
            : event,
      );
    const report = await checkAdapterConformance(adapter);
    expect(report.violations.map((violation) => violation.rule)).toContain('exact-type-version');
  });
});
