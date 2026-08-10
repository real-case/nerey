import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NereyError } from '../errors';
import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import type { MessagePersistence, NereyErrorLike, WidgetHostValue } from '../types';

import { createMemoryPersistence } from './memory-persistence';
import type { MemoryPersistence } from './memory-persistence';
import { useWidgetState } from './use-widget-state';

const CONVERSATION = 'conv-1';

type Harness = {
  store: MemoryPersistence;
  /** The port method itself, so "one write for three changes" is a call count, not an inference. */
  writes: Mock<MessagePersistence['updateWidgetState']>;
  errors: NereyErrorLike[];
  host: WidgetHostValue;
  wrapper: (props: { children: ReactNode }) => ReactElement;
};

function harness(): Harness {
  const store = createMemoryPersistence();
  const writes = vi.fn<MessagePersistence['updateWidgetState']>((conversationId, messageId, state, options) =>
    store.updateWidgetState(conversationId, messageId, state, options),
  );
  const errors: NereyErrorLike[] = [];

  const persistence: MessagePersistence = {
    getWidgetState: (conversationId, messageId) => store.getWidgetState(conversationId, messageId),
    updateWidgetState: writes,
  };
  const host: WidgetHostValue = {
    ...DEFAULT_HOST_VALUE,
    conversationId: CONVERSATION,
    persistence,
    onWidgetError: (error) => {
      errors.push(error);
    },
  };

  function wrapper({ children }: { children: ReactNode }): ReactElement {
    return <WidgetHostProvider value={host}>{children}</WidgetHostProvider>;
  }

  return { store, writes, errors, host, wrapper };
}

/**
 * Advances fake time inside `act`, so the timer callback, the promise the port returns and the
 * re-render it causes all settle before the assertion. `advanceTimersByTimeAsync` rather than the
 * synchronous form because the write is awaited: without draining microtasks between timers, a
 * store with latency never gets to resolve.
 */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('optimistic update', () => {
  it('applies the value before anything reaches the port', () => {
    const { store, writes, wrapper } = harness();
    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), { wrapper });

    act(() => {
      result.current.setState({ answer: 'yes' });
    });

    expect(result.current.state).toEqual({ answer: 'yes' });
    expect(writes).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual({});
  });

  it('reports `saving` for as long as the value is unpersisted, not only while in flight', async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), { wrapper });

    expect(result.current.status).toBe('idle');

    act(() => {
      result.current.setState({ answer: 'yes' });
    });
    // Still inside the debounce window: on screen but nowhere durable.
    expect(result.current.status).toBe('saving');

    await advance(400);
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeUndefined();
  });

  it('composes functional updates made in the same turn', async () => {
    const { store, writes, wrapper } = harness();
    const { result } = renderHook(() => useWidgetState('msg-1', { count: 0 }), { wrapper });

    // All three read `previous` before React has re-rendered once. Reading the state this render
    // closed over would make every call see `{ count: 0 }`.
    act(() => {
      result.current.setState((previous) => ({ count: previous.count + 1 }));
      result.current.setState((previous) => ({ count: previous.count + 1 }));
      result.current.setState((previous) => ({ count: previous.count + 1 }));
    });

    expect(result.current.state).toEqual({ count: 3 });

    await advance(400);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toEqual({ 'conv-1:msg-1': { count: 3 } });
  });

  it('never persists the initial value on its own', async () => {
    const { store, writes, wrapper } = harness();
    renderHook(() => useWidgetState('msg-1', { answer: 'none' }), { wrapper });

    await advance(5_000);

    expect(writes).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual({});
  });
});

describe('debounce', () => {
  it('coalesces three rapid changes into one write carrying the last value', async () => {
    const { store, writes, wrapper } = harness();
    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), { wrapper });

    act(() => {
      result.current.setState({ answer: 'a' });
    });
    await advance(100);
    act(() => {
      result.current.setState({ answer: 'b' });
    });
    await advance(100);
    act(() => {
      result.current.setState({ answer: 'c' });
    });
    await advance(400);

    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledWith(CONVERSATION, 'msg-1', { answer: 'c' }, expect.anything());
    expect(store.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'c' } });
  });

  it('waits the full default window after the last change', async () => {
    const { writes, wrapper } = harness();
    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), { wrapper });

    act(() => {
      result.current.setState({ answer: 'yes' });
    });

    await advance(399);
    expect(writes).not.toHaveBeenCalled();

    await advance(1);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('writes once per settled burst', async () => {
    const { writes, store, wrapper } = harness();
    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), { wrapper });

    act(() => {
      result.current.setState({ answer: 'a' });
    });
    await advance(400);
    act(() => {
      result.current.setState({ answer: 'b' });
    });
    await advance(400);

    expect(writes).toHaveBeenCalledTimes(2);
    expect(store.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'b' } });
  });

  it('honours a custom window', async () => {
    const { writes, wrapper } = harness();
    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }, { debounceMs: 25 }), {
      wrapper,
    });

    act(() => {
      result.current.setState({ answer: 'yes' });
    });

    await advance(24);
    expect(writes).not.toHaveBeenCalled();

    await advance(1);
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('still coalesces a burst with a zero window, writing on the next macrotask', async () => {
    const { writes, store, wrapper } = harness();
    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }, { debounceMs: 0 }), {
      wrapper,
    });

    act(() => {
      result.current.setState({ answer: 'a' });
      result.current.setState({ answer: 'b' });
    });
    expect(writes).not.toHaveBeenCalled();

    await advance(0);

    expect(writes).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'b' } });
  });
});

describe('a failed write', () => {
  it('leaves the optimistic value committed rather than rolling it back (ADR 0016)', async () => {
    const { store, wrapper } = harness();
    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), { wrapper });

    act(() => {
      result.current.setState({ answer: 'no' });
    });
    await advance(400);
    expect(store.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'no' } });

    store.failNextWrites(1);
    act(() => {
      result.current.setState({ answer: 'yes' });
    });
    await advance(400);

    // The reply for "yes" is already in the transcript. Restoring "no" here would re-render the
    // pre-interaction appearance and invite a second, duplicate reply (FR-20).
    expect(result.current.state).toEqual({ answer: 'yes' });
    expect(store.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'no' } });
  });

  it('surfaces a persistence error through status and error', async () => {
    const { store, wrapper } = harness();
    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), { wrapper });

    store.failNextWrites(1);
    act(() => {
      result.current.setState({ answer: 'yes' });
    });
    await advance(400);

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBeInstanceOf(NereyError);
    expect(result.current.error?.code).toBe('persistence');
    expect(result.current.error?.messageId).toBe('msg-1');
    expect(result.current.error?.cause).toBeInstanceOf(Error);
  });

  it('reports the same error instance to onWidgetError', async () => {
    const { store, errors, wrapper } = harness();
    const { result } = renderHook(() => useWidgetState(7, { answer: 'none' }), { wrapper });

    store.failNextWrites(1);
    act(() => {
      result.current.setState({ answer: 'yes' });
    });
    await advance(400);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('persistence');
    expect(errors[0]?.messageId).toBe(7);
    expect(errors[0]).toBe(result.current.error);
  });

  it('clears the failure when a retry starts, and settles idle when it lands', async () => {
    const { store, wrapper } = harness();
    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), { wrapper });

    store.failNextWrites(1);
    act(() => {
      result.current.setState({ answer: 'yes' });
    });
    await advance(400);
    expect(result.current.status).toBe('error');

    act(() => {
      result.current.setState({ answer: 'yes' });
    });
    // An unchanged value must still schedule a write, or a failed widget can never recover.
    expect(result.current.status).toBe('saving');
    expect(result.current.error).toBeUndefined();

    await advance(400);
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeUndefined();
    expect(store.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'yes' } });
  });

  it('keeps error and status coherent — error is set exactly when status is error', async () => {
    const { store, wrapper } = harness();
    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), { wrapper });

    store.failNextWrites(1);
    act(() => {
      result.current.setState({ answer: 'yes' });
    });

    expect(result.current.error).toBeUndefined();
    await advance(400);

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBeDefined();
  });
});

describe('aborting', () => {
  it('aborts the in-flight write on unmount and reports nothing', async () => {
    const { store, writes, errors, wrapper } = harness();
    store.setLatency(50);
    const { result, unmount } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), {
      wrapper,
    });

    act(() => {
      result.current.setState({ answer: 'yes' });
    });
    await advance(400);

    // In flight: the debounce elapsed, the port was called, the latency window has not closed.
    expect(writes).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toEqual({});

    unmount();
    await advance(200);

    expect(store.snapshot()).toEqual({});
    // An abort is a cancellation, not a persistence failure; reporting it would light up an
    // error for every widget the user scrolled past mid-save.
    expect(errors).toEqual([]);
  });

  it('drops a write still inside its debounce window on unmount', async () => {
    const { store, writes, errors, wrapper } = harness();
    const { result, unmount } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), {
      wrapper,
    });

    act(() => {
      result.current.setState({ answer: 'yes' });
    });
    unmount();
    await advance(2_000);

    expect(writes).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual({});
    expect(errors).toEqual([]);
  });

  it('aborts a superseded write and lets the newer value win', async () => {
    const { store, writes, errors, wrapper } = harness();
    store.setLatency(500);
    const { result } = renderHook(() => useWidgetState('msg-1', { n: 0 }, { debounceMs: 10 }), {
      wrapper,
    });

    act(() => {
      result.current.setState({ n: 1 });
    });
    await advance(10);
    expect(writes).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.setState({ n: 2 });
    });
    await advance(10);
    expect(writes).toHaveBeenCalledTimes(2);

    await advance(600);

    expect(store.snapshot()).toEqual({ 'conv-1:msg-1': { n: 2 } });
    expect(errors).toEqual([]);
    expect(result.current.status).toBe('idle');
  });

  it('stays `saving` when an earlier write lands while a newer one is queued', async () => {
    const { store, wrapper } = harness();
    store.setLatency(20);
    const { result } = renderHook(() => useWidgetState('msg-1', { n: 0 }, { debounceMs: 200 }), {
      wrapper,
    });

    act(() => {
      result.current.setState({ n: 1 });
    });
    await advance(200);

    // Queued while the first write is still crossing the port, and settling after it.
    act(() => {
      result.current.setState({ n: 2 });
    });
    await advance(100);

    expect(store.snapshot()).toEqual({ 'conv-1:msg-1': { n: 1 } });
    // The queued write owns the outcome; announcing `idle` on the older one would claim the
    // value on screen is stored when it is not.
    expect(result.current.status).toBe('saving');

    await advance(200);
    expect(result.current.status).toBe('idle');
    expect(store.snapshot()).toEqual({ 'conv-1:msg-1': { n: 2 } });
  });
});

describe('per-message isolation', () => {
  it('keeps two widget instances in one conversation independent', async () => {
    const { store, wrapper } = harness();
    const { result } = renderHook(
      () => ({
        a: useWidgetState('msg-a', { picked: 'none' }),
        b: useWidgetState('msg-b', { picked: 'none' }),
      }),
      { wrapper },
    );

    act(() => {
      result.current.a.setState({ picked: 'x' });
    });

    expect(result.current.b.state).toEqual({ picked: 'none' });
    expect(result.current.b.status).toBe('idle');
    expect(result.current.a.status).toBe('saving');

    await advance(400);
    expect(store.snapshot()).toEqual({ 'conv-1:msg-a': { picked: 'x' } });

    act(() => {
      result.current.b.setState({ picked: 'y' });
    });
    await advance(400);

    expect(result.current.a.state).toEqual({ picked: 'x' });
    expect(store.snapshot()).toEqual({
      'conv-1:msg-a': { picked: 'x' },
      'conv-1:msg-b': { picked: 'y' },
    });
  });

  it("does not attribute one message's failure to the other", async () => {
    const { store, wrapper } = harness();
    const { result } = renderHook(
      () => ({
        a: useWidgetState('msg-a', { picked: 'none' }),
        b: useWidgetState('msg-b', { picked: 'none' }),
      }),
      { wrapper },
    );

    store.failNextWrites(1);
    act(() => {
      result.current.a.setState({ picked: 'x' });
    });
    await advance(400);

    expect(result.current.a.status).toBe('error');
    expect(result.current.b.status).toBe('idle');
    expect(result.current.b.error).toBeUndefined();
  });

  it('resets to the new initial when the instance is re-used for another message', async () => {
    // A transcript rendered without stable keys hands the same hook instance a different
    // messageId. Carrying the previous message's answers over would be a data leak between
    // messages; the write already scheduled must still land under the message it came from.
    const { store, wrapper } = harness();
    const { result, rerender } = renderHook(
      ({ id, initial }: { id: string; initial: { picked: string } }) => useWidgetState(id, initial),
      { wrapper, initialProps: { id: 'msg-a', initial: { picked: 'none' } } },
    );

    act(() => {
      result.current.setState({ picked: 'x' });
    });
    rerender({ id: 'msg-b', initial: { picked: 'fresh' } });

    expect(result.current.state).toEqual({ picked: 'fresh' });
    expect(result.current.status).toBe('idle');

    await advance(400);

    expect(store.snapshot()).toEqual({ 'conv-1:msg-a': { picked: 'x' } });
    expect(result.current.state).toEqual({ picked: 'fresh' });
    expect(result.current.status).toBe('idle');
  });

  it('ignores a changed `initial` while the messageId is unchanged', () => {
    // `initial` is a literal in practice, so re-syncing on it would discard the user's input on
    // every unrelated parent render.
    const { wrapper } = harness();
    const { result, rerender } = renderHook(
      ({ initial }: { initial: { picked: string } }) => useWidgetState('msg-1', initial),
      { wrapper, initialProps: { initial: { picked: 'none' } } },
    );

    act(() => {
      result.current.setState({ picked: 'x' });
    });
    rerender({ initial: { picked: 'other' } });

    expect(result.current.state).toEqual({ picked: 'x' });
  });
});

describe('identity', () => {
  it('keeps setState stable across re-renders', () => {
    const { wrapper } = harness();
    const { result, rerender } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), {
      wrapper,
    });
    const first = result.current.setState;

    rerender();
    rerender();

    // Consumers put this in dependency arrays; churn here re-fires their effects.
    expect(result.current.setState).toBe(first);
  });

  it('keeps the returned object stable when nothing changed', () => {
    const { wrapper } = harness();
    const { result, rerender } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), {
      wrapper,
    });
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });
});

describe('under StrictMode', () => {
  it('still persists after the development mount-unmount-remount', async () => {
    // React 19 mounts, tears down and remounts every component in development. A hook that
    // latched "unmounted" on the first teardown would look fine on screen and quietly write
    // nothing for the rest of the session.
    const { store, host } = harness();
    function wrapper({ children }: { children: ReactNode }): ReactElement {
      return (
        <StrictMode>
          <WidgetHostProvider value={host}>{children}</WidgetHostProvider>
        </StrictMode>
      );
    }

    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }), { wrapper });

    act(() => {
      result.current.setState({ answer: 'yes' });
    });
    await advance(400);

    expect(store.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'yes' } });
    expect(result.current.status).toBe('idle');
  });
});

describe('with no host provider mounted', () => {
  it('renders and applies state against the null port without throwing', async () => {
    const { result } = renderHook(() => useWidgetState('msg-1', { answer: 'none' }));

    act(() => {
      result.current.setState({ answer: 'yes' });
    });
    await advance(400);

    // The default port resolves without storing anything (ADR 0016), so the write "succeeds".
    expect(result.current.state).toEqual({ answer: 'yes' });
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeUndefined();
  });
});
