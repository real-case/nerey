import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';

import { useWidgetHost } from '../host/host-context';
import { createWidgetRegistry } from '../registry';
import type { MessagePersistence, WidgetHostValue } from '../types';
import { MockWidgetHost, createSendRecorder, mockRegistry } from './mock-host';

/** Captures every host value the provider published, in render order. */
function Probe(props: { sink: WidgetHostValue[] }): null {
  props.sink.push(useWidgetHost());
  return null;
}

function latest(sink: WidgetHostValue[]): WidgetHostValue {
  const value = sink.at(-1);
  if (!value) throw new Error('the probe never rendered');
  return value;
}

function Sender(props: { text: string; meta?: Record<string, unknown> }): ReactElement {
  const { sendUserMessage } = useWidgetHost();
  return (
    <button type="button" onClick={() => sendUserMessage(props.text, props.meta)}>
      send
    </button>
  );
}

describe('createSendRecorder', () => {
  it('records text and meta in order', () => {
    const recorder = createSendRecorder();

    recorder.send('first');
    recorder.send('second', { choice: 'yes' });

    expect(recorder.sent).toEqual([{ text: 'first' }, { text: 'second', meta: { choice: 'yes' } }]);
  });

  it('omits meta entirely when the widget sent none', () => {
    const recorder = createSendRecorder();

    recorder.send('bare');

    expect(recorder.sent[0]).not.toHaveProperty('meta');
  });

  it('survives being destructured, because it is how it is always passed', () => {
    const recorder = createSendRecorder();
    const { send } = recorder;

    send('detached');

    expect(recorder.sent).toEqual([{ text: 'detached' }]);
  });

  it('empties the recorded array in place rather than replacing it', () => {
    const recorder = createSendRecorder();
    // The reference a `beforeEach` would have captured.
    const held = recorder.sent;

    recorder.send('before reset');
    recorder.reset();
    recorder.send('after reset');

    expect(held).toBe(recorder.sent);
    expect(held).toEqual([{ text: 'after reset' }]);
  });
});

describe('MockWidgetHost', () => {
  it('supplies the built-in widgets so a story that registers nothing still renders', () => {
    const sink: WidgetHostValue[] = [];
    render(
      <MockWidgetHost>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );

    const host = latest(sink);
    expect(host.registry).toBe(mockRegistry);
    expect(host.registry.has('text', '1.0.0')).toBe(true);
    expect(host.registry.has('confirmation', '1.0.0')).toBe(true);
  });

  it('defaults the conversation id and honours an override', () => {
    const sink: WidgetHostValue[] = [];
    const { rerender } = render(
      <MockWidgetHost>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );
    expect(latest(sink).conversationId).toBe('mock-conversation');

    rerender(
      <MockWidgetHost conversationId="thread-42">
        <Probe sink={sink} />
      </MockWidgetHost>,
    );
    expect(latest(sink).conversationId).toBe('thread-42');
  });

  it('routes sends to onSend with their meta', async () => {
    const user = userEvent.setup();
    const recorder = createSendRecorder();

    render(
      <MockWidgetHost onSend={recorder.send}>
        <Sender text="Archive" meta={{ decision: 'confirmed' }} />
      </MockWidgetHost>,
    );
    await user.click(screen.getByRole('button'));

    expect(recorder.sent).toEqual([{ text: 'Archive', meta: { decision: 'confirmed' } }]);
  });

  it('does nothing, rather than throwing, when no onSend was supplied', async () => {
    const user = userEvent.setup();
    render(
      <MockWidgetHost>
        <Sender text="into the void" />
      </MockWidgetHost>,
    );

    await expect(user.click(screen.getByRole('button'))).resolves.toBeUndefined();
  });

  it('keeps sendUserMessage identity stable while still calling the latest onSend', async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    const sink: WidgetHostValue[] = [];

    const { rerender } = render(
      <MockWidgetHost onSend={first}>
        <Probe sink={sink} />
        <Sender text="hello" />
      </MockWidgetHost>,
    );
    const before = latest(sink).sendUserMessage;

    rerender(
      <MockWidgetHost onSend={second}>
        <Probe sink={sink} />
        <Sender text="hello" />
      </MockWidgetHost>,
    );
    await user.click(screen.getByRole('button'));

    // A new handler each render must not churn the host value — that is what re-renders every
    // widget in the transcript — but it must still be the one that receives the message.
    expect(latest(sink).sendUserMessage).toBe(before);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('hello', undefined);
  });

  it('persists to a real in-memory store by default, unlike the null default host', async () => {
    const sink: WidgetHostValue[] = [];
    render(
      <MockWidgetHost>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );

    const { persistence } = latest(sink);
    await persistence.updateWidgetState('mock-conversation', 'm1', { decision: 'confirmed' });

    await expect(persistence.getWidgetState('mock-conversation', 'm1')).resolves.toEqual({
      decision: 'confirmed',
    });
  });

  it('keeps the same persistence instance across re-renders', () => {
    const sink: WidgetHostValue[] = [];
    const { rerender } = render(
      <MockWidgetHost conversationId="a">
        <Probe sink={sink} />
      </MockWidgetHost>,
    );
    const first = latest(sink).persistence;

    rerender(
      <MockWidgetHost conversationId="b">
        <Probe sink={sink} />
      </MockWidgetHost>,
    );

    // A fresh store per render would re-run every widget's load effect against an empty one.
    expect(latest(sink).persistence).toBe(first);
  });

  it('uses an injected persistence port instead of its own', () => {
    const injected: MessagePersistence = {
      getWidgetState: () => Promise.resolve(undefined),
      updateWidgetState: () => Promise.resolve(),
    };
    const sink: WidgetHostValue[] = [];

    render(
      <MockWidgetHost persistence={injected}>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );

    expect(latest(sink).persistence).toBe(injected);
  });

  it('falls back to plain text and accepts a renderFallback override', () => {
    const sink: WidgetHostValue[] = [];
    const { rerender } = render(
      <MockWidgetHost>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );
    expect(latest(sink).renderFallback('plain', { messageId: 1 })).toBe('plain');

    rerender(
      <MockWidgetHost renderFallback={(text) => `md:${text}`}>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );
    expect(latest(sink).renderFallback('plain', { messageId: 1 })).toBe('md:plain');
  });

  it('leaves messageCount and firedEvents absent when not supplied', () => {
    const sink: WidgetHostValue[] = [];
    render(
      <MockWidgetHost>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );

    const host = latest(sink);
    expect(host.messageCount).toBeUndefined();
    expect(host.firedEvents).toBeUndefined();
  });

  it('passes messageCount through, including zero', () => {
    const sink: WidgetHostValue[] = [];
    render(
      <MockWidgetHost messageCount={0}>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );

    expect(latest(sink).messageCount).toBe(0);
  });

  it('accepts any iterable of fired events, including a one-shot generator', () => {
    function* dispatched(): Generator<string> {
      yield 'checkout-complete';
      yield 'nerey:navigate';
    }
    const sink: WidgetHostValue[] = [];

    render(
      <MockWidgetHost firedEvents={dispatched()}>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );

    const fired = latest(sink).firedEvents;
    expect(fired?.has('checkout-complete')).toBe(true);
    expect(fired?.has('nerey:navigate')).toBe(true);
  });

  it('treats an empty fired-event list as an empty set, not as absent', () => {
    const sink: WidgetHostValue[] = [];
    render(
      <MockWidgetHost firedEvents={[]}>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );

    const fired = latest(sink).firedEvents;
    expect(fired).toBeDefined();
    expect(fired?.size).toBe(0);
  });

  it('does not rebuild the host value for an inline fired-event array of the same contents', () => {
    const sink: WidgetHostValue[] = [];
    const { rerender } = render(
      <MockWidgetHost firedEvents={['checkout-complete']}>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );
    const before = latest(sink);

    rerender(
      <MockWidgetHost firedEvents={['checkout-complete']}>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );

    expect(latest(sink)).toBe(before);
  });

  it('rebuilds the host value when a fired event is actually added', () => {
    const sink: WidgetHostValue[] = [];
    const { rerender } = render(
      <MockWidgetHost firedEvents={['a']}>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );
    const before = latest(sink);

    rerender(
      <MockWidgetHost firedEvents={['a', 'b']}>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );

    expect(latest(sink)).not.toBe(before);
    expect(latest(sink).firedEvents?.has('b')).toBe(true);
  });

  it('uses an injected registry verbatim rather than wrapping it', () => {
    const empty = createWidgetRegistry([]);
    const sink: WidgetHostValue[] = [];

    render(
      <MockWidgetHost registry={empty}>
        <Probe sink={sink} />
      </MockWidgetHost>,
    );

    // The mock host is a stand-in for the consumer's host; changing resolution behaviour here is
    // what produces "it worked in Storybook". Diagnostics are `createDevRegistry`'s explicit job.
    expect(latest(sink).registry).toBe(empty);
    expect(latest(sink).registry.get('confirmation', '1.0.0')).toBeUndefined();
  });
});
