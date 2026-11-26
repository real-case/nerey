import { describe, expect, it, vi } from 'vitest';

import type { BaseEvent, Message, ResumeEntry } from '@ag-ui/core';

import { T0, ev, streamedCall } from './__fixtures__/events';
import { createAgUiHost, hydrateWidgetStates, subscribeTranscript } from './host';
import { createAgUiTranscript } from './transcript';

const POLL = { question: 'Lunch?', options: [{ value: 'a', title: 'Pizza' }] };
const widgetCall = (id: string) =>
  streamedCall(id, 'render_widget', { type: 'poll', version: '1.0.0', payload: POLL }, T0);

function setup(run: () => Promise<unknown> = () => Promise.resolve()) {
  const transcript = createAgUiTranscript({ now: () => T0 });
  const added: Message[] = [];
  const runs: ({ resume?: ResumeEntry[] } | undefined)[] = [];
  let next = 0;
  const onRunError = vi.fn();
  const host = createAgUiHost({
    agent: {
      addMessage: (message) => {
        added.push(message);
      },
      runAgent: (parameters) => {
        runs.push(parameters);
        return run();
      },
    },
    transcript,
    generateId: () => `gen-${++next}`,
    now: () => T0 + 1000,
    onRunError,
  });
  return { transcript, host, added, runs, onRunError };
}

describe('createAgUiHost — respond', () => {
  it('answers a call with a tool message carrying its id, then runs the agent', () => {
    const { transcript, host, added, runs } = setup();
    transcript.applyAll(widgetCall('call-1'));

    host.respond('call-1', { action: 'submit', text: 'Pizza', result: { value: 'a' } });

    expect(added).toEqual([
      {
        id: 'gen-1',
        role: 'tool',
        toolCallId: 'call-1',
        content: JSON.stringify({ action: 'submit', text: 'Pizza', result: { value: 'a' } }),
        metadata: { nerey: { respondedAt: T0 + 1000 } },
      },
    ]);
    expect(runs).toEqual([undefined]);
    expect(transcript.getFrames()[0]?.message.widget?.expiry).toEqual({
      expiredAt: T0 + 1000,
      reason: { on: 'interact' },
    });
  });

  it('omits `result` from the content when the widget sent none', () => {
    const { transcript, host, added } = setup();
    transcript.applyAll(widgetCall('call-1'));
    host.respond('call-1', { action: 'confirm', text: 'Yes' });
    expect(added[0]).toMatchObject({ content: '{"action":"confirm","text":"Yes"}' });
  });

  it('waits until every widget call of the turn is answered, then runs once', () => {
    const { transcript, host, runs } = setup();
    transcript.applyAll([...widgetCall('call-1'), ...widgetCall('call-2')]);
    host.respond('call-1', { action: 'submit', text: 'A' });
    expect(runs).toEqual([]);
    host.respond('call-2', { action: 'submit', text: 'B' });
    expect(runs).toHaveLength(1);
  });

  it('ignores a second answer and an unknown id — a call has exactly one answer', () => {
    const { transcript, host, added } = setup();
    transcript.applyAll([...widgetCall('call-1'), ...streamedCall('backend', 'search', {})]);
    host.respond('call-1', { action: 'submit', text: 'A' });
    host.respond('call-1', { action: 'submit', text: 'again' });
    host.respond('backend', { action: 'submit', text: 'not a widget' });
    host.respond('nope', { action: 'submit', text: 'x' });
    expect(added).toHaveLength(1);
  });

  it('resumes an interrupt that names the call with the same answer', () => {
    const { transcript, host, runs } = setup();
    transcript.applyAll([
      ...widgetCall('call-1'),
      ev.runFinished('run-1', [{ id: 'int-1', reason: 'approval', toolCallId: 'call-1' }]),
    ]);
    host.respond('call-1', { action: 'confirm', text: 'Yes', result: true });
    expect(runs).toEqual([
      {
        resume: [
          {
            interruptId: 'int-1',
            status: 'resolved',
            payload: { action: 'confirm', text: 'Yes', result: true },
          },
        ],
      },
    ]);
  });

  it('reports a rejected run through onRunError and keeps the answer', async () => {
    const failure = new Error('network');
    const { transcript, host, onRunError } = setup(() => Promise.reject(failure));
    transcript.applyAll(widgetCall('call-1'));
    host.respond('call-1', { action: 'submit', text: 'A' });
    await Promise.resolve();
    await Promise.resolve();
    expect(onRunError).toHaveBeenCalledWith(failure);
    expect(transcript.getCall('call-1')?.answered).toBe(true);
  });
});

describe('createAgUiHost — sendUserMessage', () => {
  it('adds the user message, with meta under metadata.nerey, and runs', () => {
    const { transcript, host, added, runs } = setup();
    host.sendUserMessage('hello', { source: 'poll' });
    expect(added).toEqual([
      { id: 'gen-1', role: 'user', content: 'hello', metadata: { nerey: { meta: { source: 'poll' } } } },
    ]);
    expect(runs).toEqual([undefined]);
    expect(transcript.getFrames()[0]?.message).toMatchObject({ role: 'user', text: 'hello' });
  });

  it('cancels open interrupts, because the next run must address every one', () => {
    const { transcript, host, runs } = setup();
    transcript.applyAll([
      ...widgetCall('call-1'),
      ev.runFinished('run-1', [{ id: 'int-1', reason: 'approval', toolCallId: 'call-1' }]),
    ]);
    host.sendUserMessage('actually, no');
    expect(runs).toEqual([{ resume: [{ interruptId: 'int-1', status: 'cancelled' }] }]);
  });

  it('carries answers already given alongside the cancellations', () => {
    const { transcript, host, runs } = setup();
    transcript.applyAll([
      ...widgetCall('call-1'),
      ...widgetCall('call-2'),
      ev.runFinished('run-1', [
        { id: 'int-1', reason: 'approval', toolCallId: 'call-1' },
        { id: 'int-2', reason: 'approval', toolCallId: 'call-2' },
      ]),
    ]);
    host.respond('call-1', { action: 'confirm', text: 'Yes' });
    expect(runs).toEqual([]);
    host.sendUserMessage('skip the other one');
    expect(runs).toEqual([
      {
        resume: [
          { interruptId: 'int-1', status: 'resolved', payload: { action: 'confirm', text: 'Yes' } },
          { interruptId: 'int-2', status: 'cancelled' },
        ],
      },
    ]);
  });
});

describe('subscribeTranscript', () => {
  it('feeds every streamed event into the transcript until unsubscribed', () => {
    const transcript = createAgUiTranscript({ now: () => T0 });
    let push: ((event: BaseEvent) => void) | undefined;
    const unsubscribe = vi.fn();
    const stop = subscribeTranscript(
      {
        subscribe: (subscriber) => {
          push = (event) => subscriber.onEvent?.({ event });
          return { unsubscribe };
        },
      },
      transcript,
    );
    for (const event of widgetCall('call-1')) push?.(event);
    expect(transcript.getFrames()).toHaveLength(1);
    stop();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('the default id generator', () => {
  it('uses crypto.randomUUID', () => {
    const transcript = createAgUiTranscript();
    const added: Message[] = [];
    const host = createAgUiHost({
      agent: { addMessage: (m) => added.push(m), runAgent: () => Promise.resolve() },
      transcript,
    });
    host.sendUserMessage('hi');
    expect(added[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('hydrateWidgetStates', () => {
  it('hands each widget call its saved state, skips calls with none, and reports failed reads', async () => {
    const transcript = createAgUiTranscript({ now: () => T0 });
    transcript.applyAll([...widgetCall('call-1'), ...widgetCall('call-2'), ...widgetCall('call-3')]);
    const failure = new Error('offline');
    const onError = vi.fn();

    await hydrateWidgetStates(
      transcript,
      {
        getWidgetState: (_conversation, id) =>
          id === 'call-1'
            ? Promise.resolve({ selected: 'a' })
            : id === 'call-2'
              ? Promise.resolve(undefined)
              : Promise.reject(failure),
      },
      'thread-1',
      onError,
    );

    expect(transcript.getFrames().map((f) => f.message.widget?.state)).toEqual([
      { selected: 'a' },
      undefined,
      undefined,
    ]);
    expect(onError).toHaveBeenCalledWith(failure, 'call-3');
  });
});
