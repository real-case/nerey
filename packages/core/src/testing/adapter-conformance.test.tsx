import { validateOptional } from '../validate';
import type { NereyMessage, WidgetResponse } from '../types';
import { checkAdapterConformance, expectAdapterConformance } from './adapter-conformance';
import type { AdapterDelivery, AdapterFrame, AdapterScenario, AdapterUnderTest } from './adapter-conformance';

/* ────────────────────────────────────────────────────────────────────────────────────
 * A reference adapter over a toy event stream, and the switches that break it one rule at a time
 * ──────────────────────────────────────────────────────────────────────────────────── */

type ToyEvent =
  | { kind: 'delta'; id: string; type: string; version: string; partial: unknown; at: number }
  | { kind: 'available'; id: string; type: string; version: string; payload: unknown; at: number };

type Breakage = {
  validates?: boolean;
  readyWhileStreaming?: boolean;
  dropsCorrelation?: boolean;
  noText?: boolean;
  movingClock?: boolean;
  fuzzyVersion?: boolean;
  noRespond?: boolean;
  wrongCallId?: boolean;
  noFrames?: boolean;
  finalStreaming?: boolean;
  changingId?: boolean;
  dropsResult?: boolean;
};

function toyAdapter(breakage: Breakage = {}): AdapterUnderTest<ToyEvent> {
  return {
    name: 'toy',
    script: (scenario: AdapterScenario) => [
      ...scenario.partialPayloads.map((partial, index) => ({
        kind: 'delta' as const,
        id: scenario.correlationId,
        type: scenario.type,
        version: scenario.version,
        partial,
        at: scenario.createdAt + (breakage.movingClock ? index : 0),
      })),
      {
        kind: 'available' as const,
        id: scenario.correlationId,
        type: scenario.type,
        version: scenario.version,
        payload: scenario.payload,
        at: scenario.createdAt + (breakage.movingClock ? 99 : 0),
      },
    ],
    frames: (events, { registry }) => {
      if (breakage.noFrames) return [];
      return events.map((event, index): AdapterFrame => {
        const version = breakage.fuzzyVersion && event.version === '1.0' ? '1.0.0' : event.version;
        const payload = event.kind === 'delta' ? event.partial : event.payload;
        if (breakage.validates) validateOptional(registry.get(event.type, version)?.payloadSchema, payload);
        const message: NereyMessage = {
          id: breakage.changingId ? `${event.id}-${index}` : event.id,
          role: 'assistant',
          text: breakage.noText ? '' : 'A probe widget.',
          createdAt: event.at,
          widget: {
            type: event.type,
            version,
            payload,
            ...(breakage.dropsCorrelation ? {} : { correlationId: event.id }),
          },
        };
        const streamingStatus = breakage.readyWhileStreaming ? 'ready' : 'streaming';
        const readyStatus = breakage.finalStreaming ? 'streaming' : 'ready';
        return { message, status: event.kind === 'delta' ? streamingStatus : readyStatus };
      });
    },
    createHost: () => {
      const delivered: AdapterDelivery[] = [];
      const respond = (correlationId: string, response: WidgetResponse): void => {
        delivered.push({
          correlationId: breakage.wrongCallId ? 'some-other-call' : correlationId,
          text: response.text,
          ...(response.result !== undefined && !breakage.dropsResult ? { result: response.result } : {}),
        });
      };
      return {
        host: { sendUserMessage: () => undefined, ...(breakage.noRespond ? {} : { respond }) },
        delivered: () => delivered,
      };
    },
  };
}

async function rulesFired(breakage: Breakage): Promise<string[]> {
  const report = await checkAdapterConformance(toyAdapter(breakage));
  return [...new Set(report.violations.map((violation) => violation.rule))];
}

describe('checkAdapterConformance', () => {
  it('passes a conforming adapter', async () => {
    const report = await checkAdapterConformance(toyAdapter());
    expect(report.violations).toEqual([]);
    expect(report).toMatchObject({ adapter: 'toy', passed: true });
    await expect(expectAdapterConformance(toyAdapter())).resolves.toBeUndefined();
  });

  // ADR 0033 — every named rule fails on a seeded violation of it, so a kit that silently stopped
  // checking one thing cannot look complete.
  it.each<[string, Breakage]>([
    ['no-validation-while-streaming', { validates: true }],
    ['streams-partials', { readyWhileStreaming: true }],
    ['validates-once-on-ready', { readyWhileStreaming: true }],
    ['correlation-round-trip', { dropsCorrelation: true }],
    ['correlation-round-trip', { noRespond: true }],
    ['correlation-round-trip', { wrongCallId: true }],
    ['text-present', { noText: true }],
    ['created-at', { movingClock: true }],
    ['exact-type-version', { fuzzyVersion: true }],
    ['frames-produced', { noFrames: true }],
    ['ready-on-available', { finalStreaming: true }],
    ['stable-id', { changingId: true }],
    ['reply-result', { dropsResult: true }],
  ])('reports `%s` for a seeded violation', async (rule, breakage) => {
    expect(await rulesFired(breakage)).toContain(rule);
  });

  it('reports a throwing adapter instead of rejecting', async () => {
    const adapter: AdapterUnderTest<ToyEvent> = {
      ...toyAdapter(),
      frames: () => {
        throw new Error('boom');
      },
    };
    const report = await checkAdapterConformance(adapter);
    expect(report.passed).toBe(false);
    expect(report.violations[0]).toMatchObject({ rule: 'frames-produced' });
    expect(report.violations[0]?.detail).toContain('boom');
  });

  it('lists every violation in the thrown message', async () => {
    await expect(
      expectAdapterConformance(toyAdapter({ noText: true, dropsCorrelation: true })),
    ).rejects.toThrow(/\[text-present\][\s\S]*\[correlation-round-trip\]/);
  });
});
