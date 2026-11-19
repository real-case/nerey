import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessagePersistence, NereyErrorLike } from '../types';
import { IDLE, SAVING, createWriteQueue } from './write-queue';
import type { WriteTarget } from './write-queue';

function port(options: { fail?: boolean; latency?: number } = {}) {
  const writes: { messageId: string | number; value: unknown; signal: AbortSignal | undefined }[] = [];
  const persistence: MessagePersistence = {
    getWidgetState: () => Promise.resolve(undefined),
    updateWidgetState: (_c, messageId, value, init) => {
      writes.push({ messageId, value, signal: init?.signal });
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (options.fail) reject(new Error('offline'));
          else resolve();
        }, options.latency ?? 0);
      });
    },
  };
  return { persistence, writes };
}

function target(
  persistence: MessagePersistence,
  errors: NereyErrorLike[] = [],
  messageId: string | number = 'm1',
): WriteTarget {
  return {
    conversationId: 'c1',
    messageId,
    persistence,
    onWidgetError: (error) => {
      errors.push(error);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createWriteQueue', () => {
  it('debounces, then settles to idle and forgets the value', async () => {
    const queue = createWriteQueue();
    const { persistence, writes } = port();

    queue.enqueue(target(persistence), { a: 1 }, 100);
    expect(queue.status('c1', 'm1')).toBe(SAVING);
    expect(queue.unsettled('c1', 'm1')).toEqual({ a: 1 });

    await vi.advanceTimersByTimeAsync(101);
    expect(writes).toHaveLength(1);
    expect(queue.status('c1', 'm1')).toBe(IDLE);
    expect(queue.unsettled('c1', 'm1')).toBeUndefined();
  });

  it('treats the number 7 and the string "7" as one key', () => {
    const queue = createWriteQueue();
    const { persistence } = port();

    queue.enqueue(target(persistence, [], 7), { a: 1 }, 100);
    expect(queue.unsettled('c1', '7')).toEqual({ a: 1 });
  });

  it('notifies a subscriber on each status change, and keeps the snapshot identity between them', async () => {
    const queue = createWriteQueue();
    const { persistence } = port();
    const listener = vi.fn();
    queue.subscribe('c1', 'm1', listener);

    queue.enqueue(target(persistence), { a: 1 }, 100);
    const first = queue.status('c1', 'm1');
    queue.enqueue(target(persistence), { a: 2 }, 100);
    expect(queue.status('c1', 'm1')).toBe(first);
    expect(listener).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(101);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('aborts an in-flight write when a newer one leaves, and reports only the newer outcome', async () => {
    const queue = createWriteQueue();
    const { persistence, writes } = port({ latency: 50 });
    const errors: NereyErrorLike[] = [];

    queue.enqueue(target(persistence, errors), { a: 1 }, 0);
    await vi.advanceTimersByTimeAsync(0);
    queue.enqueue(target(persistence, errors), { a: 2 }, 0);
    await vi.advanceTimersByTimeAsync(0);

    expect(writes[0]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(101);
    expect(errors).toEqual([]);
    expect(queue.status('c1', 'm1')).toBe(IDLE);
  });

  it('reports a failure, keeps the value unsettled, and holds the error status', async () => {
    const queue = createWriteQueue();
    const { persistence } = port({ fail: true });
    const errors: NereyErrorLike[] = [];

    queue.enqueue(target(persistence, errors), { a: 1 }, 0);
    await vi.advanceTimersByTimeAsync(10);

    expect(errors).toHaveLength(1);
    expect(queue.status('c1', 'm1').status).toBe('error');
    expect(queue.unsettled('c1', 'm1')).toEqual({ a: 1 });
  });

  it('flushAll sends every queued write now', async () => {
    const queue = createWriteQueue();
    const { persistence, writes } = port();

    queue.enqueue(target(persistence, [], 'm1'), { a: 1 }, 10_000);
    queue.enqueue(target(persistence, [], 'm2'), { b: 1 }, 10_000);
    queue.flushAll();
    await vi.advanceTimersByTimeAsync(0);

    expect(writes.map((w) => w.messageId).sort()).toEqual(['m1', 'm2']);
  });

  it('flush on a key with nothing queued does nothing', () => {
    const queue = createWriteQueue();
    expect(() => {
      queue.flush('c1', 'nothing');
    }).not.toThrow();
    expect(queue.status('c1', 'nothing')).toBe(IDLE);
  });
});
