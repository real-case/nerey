import { CREATED_AT, assistant } from './__fixtures__/chat';
import type { AiSdkBinding } from './binding';
import {
  createWidgetFrameMapper,
  createdAtFromMetadata,
  isAnswered,
  readToolPart,
  statusOf,
  toWidgetFrames,
} from './messages';

const RENDER: AiSdkBinding = { mode: 'render-widget' };
const TABLE: AiSdkBinding = { mode: 'tools', tools: { ask: { type: 'poll', version: '1.0.0' } } };

const pollInput = { type: 'poll', version: '1.0.0', payload: { options: [{ value: 'a', title: 'A' }] } };

function renderPart(state: string, input: unknown = pollInput, extra: Record<string, unknown> = {}) {
  return { type: 'tool-render_widget', toolCallId: 'call-1', state, input, ...extra };
}

describe('statusOf — ADR 0019 extended to AI SDK 7 approvals', () => {
  it.each([
    ['input-streaming', 'streaming'],
    ['input-available', 'ready'],
    ['approval-requested', 'ready'],
    ['approval-responded', 'ready'],
    ['output-available', 'ready'],
    ['output-denied', 'ready'],
    ['output-error', 'error'],
  ])('maps %s to %s', (state, status) => {
    expect(statusOf(state)).toBe(status);
  });
});

describe('isAnswered', () => {
  it.each([
    ['input-streaming', false],
    ['input-available', false],
    ['approval-requested', false],
    ['approval-responded', true],
    ['output-available', true],
    ['output-error', true],
    ['output-denied', true],
  ])('%s → %s', (state, answered) => {
    expect(isAnswered(state)).toBe(answered);
  });
});

describe('readToolPart', () => {
  it('reads a static tool part', () => {
    expect(readToolPart(renderPart('input-available'))).toMatchObject({
      toolName: 'render_widget',
      toolCallId: 'call-1',
    });
  });

  it('reads a dynamic tool part by its toolName', () => {
    const part = {
      type: 'dynamic-tool',
      toolName: 'ask',
      toolCallId: 'c',
      state: 'input-available',
      input: {},
    };
    expect(readToolPart(part)?.toolName).toBe('ask');
  });

  it('reads the approval id', () => {
    expect(
      readToolPart(renderPart('approval-requested', pollInput, { approval: { id: 'ap-1' } }))?.approvalId,
    ).toBe('ap-1');
  });

  it.each([
    ['a text part', { type: 'text', text: 'hi' }],
    ['a non-object', 'tool-x'],
    ['a dynamic part without a name', { type: 'dynamic-tool', toolCallId: 'c', state: 'input-available' }],
    ['a part without a call id', { type: 'tool-x', state: 'input-available' }],
  ])('ignores %s', (_label, part) => {
    expect(readToolPart(part)).toBeUndefined();
  });
});

describe('createdAtFromMetadata', () => {
  it.each<[string, unknown, number | undefined]>([
    ['epoch ms', { createdAt: CREATED_AT }, CREATED_AT],
    ['an ISO string', { createdAt: '2026-01-01T00:00:00.000Z' }, CREATED_AT],
    ['a Date', { createdAt: new Date(CREATED_AT) }, CREATED_AT],
    ['an unparseable string', { createdAt: 'yesterday' }, undefined],
    ['an invalid Date', { createdAt: new Date(Number.NaN) }, undefined],
    ['NaN', { createdAt: Number.NaN }, undefined],
    ['no metadata', undefined, undefined],
    ['metadata without the field', { model: 'x' }, undefined],
  ])('reads %s', (_label, metadata, expected) => {
    expect(createdAtFromMetadata(metadata)).toBe(expected);
  });
});

describe('toWidgetFrames', () => {
  it('maps a widget tool part to one message keyed on the tool call', () => {
    const [frame, ...rest] = toWidgetFrames(
      assistant('turn', [{ type: 'text', text: 'Pick one.' }, renderPart('input-available')]),
      { binding: RENDER },
    );
    expect(rest).toEqual([]);
    expect(frame).toEqual({
      status: 'ready',
      message: {
        id: 'call-1',
        role: 'assistant',
        text: 'Pick one.',
        createdAt: CREATED_AT,
        widget: { type: 'poll', version: '1.0.0', payload: pollInput.payload, correlationId: 'call-1' },
      },
    });
  });

  it('passes a near-miss version through untouched (ADR 0009)', () => {
    const [frame] = toWidgetFrames(
      assistant('turn', [renderPart('input-available', { ...pollInput, version: '1.0' })]),
      { binding: RENDER },
    );
    expect(frame?.message.widget?.version).toBe('1.0');
  });

  it('gives each widget call in a turn its own message', () => {
    const frames = toWidgetFrames(
      assistant('turn', [
        renderPart('input-available'),
        { ...renderPart('input-available'), toolCallId: 'call-2' },
      ]),
      { binding: RENDER },
    );
    expect(frames.map((frame) => frame.message.id)).toEqual(['call-1', 'call-2']);
  });

  it('ignores a tool the binding does not name', () => {
    const frames = toWidgetFrames(
      assistant('turn', [{ type: 'tool-weather', toolCallId: 'w', state: 'output-available', input: {} }]),
      { binding: RENDER },
    );
    expect(frames).toEqual([]);
  });

  it('binds through the table in tools mode, with the input as the payload', () => {
    const [frame] = toWidgetFrames(
      assistant('turn', [{ type: 'tool-ask', toolCallId: 'c', state: 'input-available', input: { q: 1 } }]),
      { binding: TABLE },
    );
    expect(frame?.message.widget).toMatchObject({ type: 'poll', version: '1.0.0', payload: { q: 1 } });
  });

  it('does not bind an inherited property name in tools mode', () => {
    const frames = toWidgetFrames(
      assistant('turn', [{ type: 'tool-toString', toolCallId: 'c', state: 'input-available', input: {} }]),
      { binding: TABLE },
    );
    expect(frames).toEqual([]);
  });

  it('holds a render-widget call back until its type and version have streamed', () => {
    const frames = toWidgetFrames(assistant('turn', [renderPart('input-streaming', { type: 'poll' })]), {
      binding: RENDER,
    });
    expect(frames).toEqual([]);
  });

  it('lets a complete call with no coordinates through, so it falls back as unknown-widget', () => {
    const [frame] = toWidgetFrames(assistant('turn', [renderPart('input-available', { payload: {} })]), {
      binding: RENDER,
    });
    expect(frame?.message.widget).toMatchObject({ type: '', version: '' });
  });

  it('stringifies a non-string version rather than dropping it', () => {
    const [frame] = toWidgetFrames(
      assistant('turn', [renderPart('input-available', { ...pollInput, version: 1 })]),
      { binding: RENDER },
    );
    expect(frame?.message.widget?.version).toBe('1');
  });

  it.each(['approval-responded', 'output-available', 'output-error', 'output-denied'])(
    'expires a part in %s, so a reload renders it read-only (ADR 0055)',
    (state) => {
      const [frame] = toWidgetFrames(assistant('turn', [renderPart(state)]), { binding: RENDER });
      expect(frame?.message.widget?.expiry).toEqual({ expiredAt: CREATED_AT, reason: { on: 'interact' } });
    },
  );

  it.each(['input-streaming', 'input-available', 'approval-requested'])(
    'leaves a part in %s live',
    (state) => {
      const [frame] = toWidgetFrames(assistant('turn', [renderPart(state)]), { binding: RENDER });
      expect(frame?.message.widget?.expiry).toBeUndefined();
    },
  );

  it('falls back to a sentence naming the widget when the turn has no text', () => {
    const [frame] = toWidgetFrames(assistant('turn', [renderPart('input-available')]), { binding: RENDER });
    expect(frame?.message.text).toBe('The assistant showed a poll widget.');
  });

  it('uses textOf when given', () => {
    const [frame] = toWidgetFrames(assistant('turn', [renderPart('input-available')]), {
      binding: RENDER,
      textOf: ({ type, version }) => `${type}@${version}`,
    });
    expect(frame?.message.text).toBe('poll@1.0.0');
  });

  it('takes createdAt from the option when metadata has none', () => {
    const [frame] = toWidgetFrames(assistant('turn', [renderPart('input-available')], null), {
      binding: RENDER,
      createdAt: 42,
    });
    expect(frame?.message.createdAt).toBe(42);
  });

  it('refuses to invent a time (ADR 0046)', () => {
    expect(() =>
      toWidgetFrames(assistant('turn', [renderPart('input-available')], {}), { binding: RENDER }),
    ).toThrow(/no metadata\.createdAt/);
  });
});

describe('createWidgetFrameMapper', () => {
  it('fixes a first-seen time for a message without metadata.createdAt', () => {
    let clock = 1000;
    const mapper = createWidgetFrameMapper({ binding: RENDER, now: () => clock });
    const first = mapper.frames([assistant('turn', [renderPart('input-streaming')], null)]);
    clock = 9000;
    const second = mapper.frames([assistant('turn', [renderPart('input-available')], null)]);
    expect(first[0]?.message.createdAt).toBe(1000);
    expect(second[0]?.message.createdAt).toBe(1000);
  });

  it('prefers metadata.createdAt over the clock', () => {
    const mapper = createWidgetFrameMapper({ binding: RENDER, now: () => 5 });
    expect(mapper.frames([assistant('turn', [renderPart('input-available')])])[0]?.message.createdAt).toBe(
      CREATED_AT,
    );
  });

  it('keeps the frame object while the part is unchanged, so the payload is not validated again', () => {
    const mapper = createWidgetFrameMapper({ binding: RENDER });
    const a = mapper.frames([assistant('turn', [renderPart('input-available')])]);
    const b = mapper.frames([assistant('turn', [renderPart('input-available')])]);
    expect(b[0]).toBe(a[0]);
  });

  it('replaces the frame when the part moves on', () => {
    const mapper = createWidgetFrameMapper({ binding: RENDER });
    const a = mapper.frames([assistant('turn', [renderPart('input-available')])]);
    const b = mapper.frames([assistant('turn', [renderPart('output-available')])]);
    expect(b[0]).not.toBe(a[0]);
    expect(b[0]?.message.widget?.expiry).toBeDefined();
  });

  it('maps a whole transcript in order', () => {
    const mapper = createWidgetFrameMapper({ binding: RENDER });
    const frames = mapper.frames([
      { id: 'u', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      assistant('t1', [renderPart('output-available')]),
      assistant('t2', [{ ...renderPart('input-available'), toolCallId: 'call-2' }]),
    ]);
    expect(frames.map((frame) => frame.message.id)).toEqual(['call-1', 'call-2']);
  });
});
