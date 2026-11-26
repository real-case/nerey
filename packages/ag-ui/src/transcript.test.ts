import { describe, expect, it } from 'vitest';

import type { Message } from '@ag-ui/core';

import { T0, ev, fragments, streamedCall } from './__fixtures__/events';
import { createAgUiTranscript, defaultFallbackText } from './transcript';
import type { AgUiTranscriptOptions } from './transcript';

const POLL = { question: 'Lunch?', options: [{ value: 'a', title: 'Pizza' }] };

function transcript(options: AgUiTranscriptOptions = {}, clock = { at: T0 }) {
  return { t: createAgUiTranscript({ now: () => clock.at, ...options }), clock };
}

describe('createAgUiTranscript — the generic render_widget tool', () => {
  it('streams a widget call: no frame until type and version are whole, then streaming, then ready', () => {
    const { t } = transcript();
    const args = JSON.stringify({ type: 'poll', version: '1.0.0', payload: POLL });
    const seen: string[] = [];

    t.apply(ev.toolStart('call-1', 'render_widget', T0));
    seen.push(
      t
        .getFrames()
        .map((f) => f.status)
        .join(','),
    );
    let sofar = '';
    for (const delta of fragments(args, 5)) {
      sofar += delta;
      t.apply(ev.toolArgs('call-1', delta));
      const frame = t.getFrames()[0];
      if (!sofar.includes('"version":"1.0.0"')) expect(frame).toBeUndefined();
      else expect(frame?.status).toBe('streaming');
    }
    t.apply(ev.toolEnd('call-1'));

    const [frame] = t.getFrames();
    expect(seen).toEqual(['']);
    expect(frame?.status).toBe('ready');
    expect(frame?.message).toEqual({
      id: 'call-1',
      role: 'assistant',
      text: 'Lunch?',
      createdAt: T0,
      widget: { type: 'poll', version: '1.0.0', payload: POLL, correlationId: 'call-1' },
    });
  });

  it('passes `type@version` through untouched — "1.0" stays "1.0"', () => {
    const { t } = transcript();
    t.applyAll(streamedCall('call-1', 'render_widget', { type: 'poll', version: '1.0', payload: POLL }));
    expect(t.getFrames()[0]?.message.widget).toMatchObject({ type: 'poll', version: '1.0' });
  });

  it('gives status `error` and no payload when the arguments are not JSON at the end', () => {
    const { t } = transcript();
    t.applyAll([
      ev.toolStart('call-1', 'render_widget'),
      ev.toolArgs('call-1', '{"type":"poll","version":"1.0.0","payload":{"question":'),
      ev.toolArgs('call-1', '}}}'),
      ev.toolEnd('call-1'),
    ]);
    const [frame] = t.getFrames();
    expect(frame?.status).toBe('error');
    expect(frame?.message.widget).toMatchObject({ type: 'poll', version: '1.0.0', payload: undefined });
    expect(frame?.message.text).toBe('poll');
  });

  it('renders nothing for a finished generic call that never named a widget', () => {
    const { t } = transcript();
    t.applyAll(streamedCall('call-1', 'render_widget', { payload: POLL }));
    expect(t.getFrames()).toEqual([]);
  });

  it('ignores tool calls that are not widget calls, and honours a renamed or disabled generic tool', () => {
    const renamed = transcript({ tools: { renderWidget: 'show_ui' } }).t;
    renamed.applyAll([
      ...streamedCall('backend', 'search_flights', { to: 'LIS' }),
      ...streamedCall('call-1', 'render_widget', { type: 'poll', version: '1.0.0', payload: POLL }),
      ...streamedCall('call-2', 'show_ui', { type: 'poll', version: '1.0.0', payload: POLL }),
    ]);
    expect(renamed.getFrames().map((f) => f.message.id)).toEqual(['call-2']);
    expect(renamed.getCall('backend')).toBeUndefined();

    const off = transcript({ tools: { renderWidget: false } }).t;
    off.applyAll(streamedCall('call-1', 'render_widget', { type: 'poll', version: '1.0.0', payload: POLL }));
    expect(off.getFrames()).toEqual([]);
  });
});

describe('createAgUiTranscript — the tool table', () => {
  const tools = { renderWidget: false as const, table: { ask_poll: { type: 'poll', version: '1.0.0' } } };

  it('fixes type@version from the row and streams the arguments as the payload', () => {
    const { t } = transcript({ tools });
    t.apply(ev.toolStart('call-1', 'ask_poll'));
    t.apply(ev.toolArgs('call-1', '{"question":"Lun'));
    expect(t.getFrames()[0]).toMatchObject({
      status: 'streaming',
      message: { widget: { type: 'poll', version: '1.0.0', payload: { question: 'Lun' } } },
    });
    t.apply(ev.toolArgs('call-1', 'ch?"}'));
    t.apply(ev.toolEnd('call-1'));
    expect(t.getFrames()[0]).toMatchObject({
      status: 'ready',
      message: { widget: { payload: { question: 'Lunch?' } } },
    });
  });

  it('reads a call with no arguments as an empty payload, and broken ones as `error`', () => {
    const { t } = transcript({ tools });
    t.applyAll([
      ev.toolStart('a', 'ask_poll'),
      ev.toolEnd('a'),
      ev.toolStart('b', 'ask_poll'),
      ev.toolArgs('b', '{'),
      ev.toolEnd('b'),
    ]);
    expect(t.getFrames().map((f) => [f.status, f.message.widget?.payload])).toEqual([
      ['ready', {}],
      ['error', undefined],
    ]);
  });

  it('does not match an inherited property name as a tool', () => {
    const { t } = transcript({ tools });
    t.applyAll(streamedCall('a', 'constructor', {}));
    expect(t.getFrames()).toEqual([]);
  });
});

describe('createAgUiTranscript — chunks and text', () => {
  it('folds TOOL_CALL_CHUNK sequences and closes one when another event arrives', () => {
    const { t } = transcript();
    const args = JSON.stringify({ type: 'poll', version: '1.0.0', payload: POLL });
    const [head = '', ...rest] = fragments(args, 9);
    t.apply(ev.toolChunk({ toolCallId: 'call-1', toolCallName: 'render_widget', delta: head }));
    for (const delta of rest) t.apply(ev.toolChunk({ delta }));
    expect(t.getFrames()[0]?.status).toBe('streaming');
    t.apply(ev.runFinished());
    expect(t.getFrames()[0]?.status).toBe('ready');
    expect(t.getFrames()[0]?.message.widget?.payload).toEqual(POLL);
  });

  it('renders assistant text as its own frame and skips empty text', () => {
    const { t } = transcript();
    t.applyAll([
      ev.textStart('m-1', T0 - 5),
      ev.textContent('m-1', 'Here is '),
      ev.textContent('m-1', 'a poll.'),
      ev.textEnd('m-1'),
      ev.textStart('m-2'),
      ev.textChunk('chunked ', 'm-3'),
      ev.textChunk('text'),
      ...streamedCall('call-1', 'render_widget', { type: 'poll', version: '1.0.0', payload: POLL }),
    ]);
    expect(t.getFrames().map((f) => [f.message.id, f.message.text, f.message.createdAt])).toEqual([
      ['m-1', 'Here is a poll.', T0 - 5],
      ['m-3', 'chunked text', T0],
      ['call-1', 'Lunch?', T0],
    ]);
  });

  it('keeps a frame referentially stable while unrelated events arrive, so validation does not re-run', () => {
    const { t } = transcript();
    t.applyAll(streamedCall('call-1', 'render_widget', { type: 'poll', version: '1.0.0', payload: POLL }));
    const before = t.getFrames()[0];
    t.applyAll([ev.textStart('m-9'), ev.textContent('m-9', 'and more')]);
    expect(t.getFrames()[0]).toBe(before);
    expect(t.getFrames()).toBe(t.getFrames());
  });
});

describe('createAgUiTranscript — answers, interrupts and expiry', () => {
  const call = () =>
    streamedCall('call-1', 'render_widget', { type: 'poll', version: '1.0.0', payload: POLL }, T0);

  it('marks a call answered by TOOL_CALL_RESULT expired, with the answer time', () => {
    const { t } = transcript();
    t.applyAll([...call(), ev.toolResult('call-1', 'ok', T0 + 500)]);
    expect(t.getFrames()[0]?.message.widget?.expiry).toEqual({
      expiredAt: T0 + 500,
      reason: { on: 'interact' },
    });
    expect(t.getCall('call-1')).toMatchObject({ answered: true, expired: true });
  });

  it('expires an unanswered call when its interrupt expiresAt passes, and reports the wait', () => {
    const { t, clock } = transcript();
    const expiresAt = new Date(T0 + 60_000).toISOString();
    t.applyAll([
      ...call(),
      ev.runFinished('run-1', [{ id: 'int-1', reason: 'tool_approval', toolCallId: 'call-1', expiresAt }]),
    ]);

    expect(t.getFrames()[0]?.message.widget?.expiry).toBeUndefined();
    expect(t.msUntilNextDeadline()).toBe(60_000);
    expect(t.openInterrupts()).toEqual([{ interruptId: 'int-1', toolCallId: 'call-1' }]);
    expect(t.getCall('call-1')?.interruptId).toBe('int-1');

    clock.at = T0 + 60_000;
    t.refresh();
    expect(t.getFrames()[0]?.message.widget?.expiry).toEqual({
      expiredAt: T0 + 60_000,
      reason: { on: 'timeout', ms: 60_000 },
    });
    expect(t.msUntilNextDeadline()).toBeUndefined();
    expect(t.awaitingAnswer()).toEqual([]);
  });

  it('ignores an unparseable expiresAt and an interrupt that names no widget call', () => {
    const { t } = transcript();
    t.applyAll([
      ...call(),
      ev.runFinished('run-1', [
        { id: 'int-1', reason: 'x', toolCallId: 'call-1', expiresAt: 'soon' },
        { id: 'int-2', reason: 'x', toolCallId: 'elsewhere' },
        { id: 'int-3', reason: 'x' },
      ]),
    ]);
    expect(t.msUntilNextDeadline()).toBeUndefined();
    expect(t.openInterrupts()).toEqual([{ interruptId: 'int-1', toolCallId: 'call-1' }]);
  });

  it('lists the calls awaiting an answer since the last user message only', () => {
    const { t } = transcript();
    t.applyAll(call());
    expect(t.awaitingAnswer().map((c) => c.toolCallId)).toEqual(['call-1']);
    t.addLocalMessage({ id: 'u-1', role: 'user', content: 'never mind' });
    expect(t.awaitingAnswer()).toEqual([]);
  });
});

describe('createAgUiTranscript — rehydration from MESSAGES_SNAPSHOT', () => {
  const args = JSON.stringify({ type: 'poll', version: '1.0.0', payload: POLL });
  const history: Message[] = [
    {
      id: 'u-1',
      role: 'user',
      content: [{ type: 'text', text: 'Ask me' }],
      metadata: { nerey: { createdAt: T0 - 10 } },
    },
    {
      id: 'a-1',
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call-1', type: 'function', function: { name: 'render_widget', arguments: args } }],
      metadata: { nerey: { createdAt: T0 } },
    },
    {
      id: 't-1',
      role: 'tool',
      toolCallId: 'call-1',
      content: '{}',
      metadata: { nerey: { respondedAt: T0 + 900 } },
    },
    { id: 'd-1', role: 'developer', content: 'be brief' },
    { id: 'r-1', role: 'reasoning', content: 'thinking' },
  ];

  it('restores widgets ready, answered ones expired at their answer time, with createdAt from metadata', () => {
    const { t } = transcript({}, { at: T0 + 99_999 });
    t.apply(ev.snapshot(history, T0 + 50_000));
    expect(t.getFrames().map((f) => f.message)).toEqual([
      { id: 'u-1', role: 'user', text: 'Ask me', createdAt: T0 - 10 },
      {
        id: 'call-1',
        role: 'assistant',
        text: 'Lunch?',
        createdAt: T0,
        widget: {
          type: 'poll',
          version: '1.0.0',
          payload: POLL,
          correlationId: 'call-1',
          expiry: { expiredAt: T0 + 900, reason: { on: 'interact' } },
        },
      },
      { id: 'd-1', role: 'system', text: 'be brief', createdAt: T0 + 50_000 },
    ]);
  });

  it('keeps createdAt an earlier event already gave the same id, so a deadline does not restart', () => {
    const { t, clock } = transcript();
    t.applyAll(streamedCall('call-1', 'render_widget', JSON.parse(args), T0));
    clock.at = T0 + 30_000;
    t.apply(ev.snapshot([{ ...history[1], metadata: {} } as Message], T0 + 30_000));
    expect(t.getFrames()[0]?.message.createdAt).toBe(T0);
  });

  it('keeps local messages the snapshot has not echoed yet, and drops them once it has', () => {
    const { t } = transcript();
    t.addLocalMessage({ id: 'u-9', role: 'user', content: 'typed locally' });
    t.apply(ev.snapshot(history.slice(0, 2)));
    expect(t.getFrames().map((f) => f.message.id)).toEqual(['u-1', 'call-1', 'u-9']);
    t.apply(ev.snapshot([...history.slice(0, 2), { id: 'u-9', role: 'user', content: 'typed locally' }]));
    t.apply(ev.snapshot(history.slice(0, 2)));
    expect(t.getFrames().map((f) => f.message.id)).toEqual(['u-1', 'call-1']);
  });

  it('marks a call answered by a local tool message at once', () => {
    const { t } = transcript();
    t.apply(ev.snapshot(history.slice(0, 2)));
    t.addLocalMessage({
      id: 't-9',
      role: 'tool',
      toolCallId: 'call-1',
      content: '{}',
      metadata: { nerey: { respondedAt: T0 + 7 } },
    });
    expect(t.getFrames()[1]?.message.widget?.expiry).toEqual({
      expiredAt: T0 + 7,
      reason: { on: 'interact' },
    });
  });
});

describe('createAgUiTranscript — plumbing', () => {
  it('notifies subscribers on every change and stops after unsubscribe', () => {
    const { t } = transcript();
    let calls = 0;
    const stop = t.subscribe(() => {
      calls++;
    });
    t.apply(ev.runStarted());
    t.applyAll([ev.runStarted(), ev.runFinished()]);
    stop();
    t.apply(ev.runStarted());
    expect(calls).toBe(2);
  });

  it('ignores events with missing fields rather than throwing', () => {
    const { t } = transcript();
    t.applyAll([
      { type: ev.toolStart('x', 'y').type },
      { type: ev.toolArgs('x', '').type, toolCallId: 'nope', delta: '{' },
      { type: ev.textContent('m', '').type },
      { type: ev.snapshot([]).type, messages: 'not an array' },
      { type: ev.runFinished().type, outcome: { type: 'interrupt', interrupts: [null] } },
    ]);
    expect(t.getFrames()).toEqual([]);
  });

  it('falls back to the type when the payload has no readable field', () => {
    expect(defaultFallbackText({ type: 'chart', version: '1', payload: { title: '  ' } })).toBe('chart');
    expect(defaultFallbackText({ type: 'chart', version: '1', payload: 'x' })).toBe('chart');
    expect(defaultFallbackText({ type: 'confirmation', version: '1', payload: { title: 'Delete?' } })).toBe(
      'Delete?',
    );
  });
});
