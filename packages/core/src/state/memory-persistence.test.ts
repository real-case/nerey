import { describe, expect, it } from 'vitest';

import type { WidgetStateRecord } from '../types';

import { createMemoryPersistence } from './memory-persistence';

const CONVERSATION = 'conv-1';

/**
 * Returns the rejection value, or fails loudly if the promise resolved. `expect(...).rejects`
 * is avoided for the abort cases on purpose: the rejection value is a `DOMException`, whose
 * `name` lives on the prototype, so `toMatchObject` cannot see it.
 */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

describe('round trip', () => {
  it('reads back what was written', async () => {
    const persistence = createMemoryPersistence();

    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' });

    await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toEqual({
      answer: 'yes',
    });
  });

  it('resolves undefined for a message that was never written', async () => {
    const persistence = createMemoryPersistence();

    await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toBeUndefined();
  });

  it('overwrites a previous value for the same message', async () => {
    const persistence = createMemoryPersistence();

    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' });
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'no' });

    await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toEqual({
      answer: 'no',
    });
  });

  it('isolates messages within a conversation and conversations from each other', async () => {
    const persistence = createMemoryPersistence();

    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { pick: 'a' });
    await persistence.updateWidgetState(CONVERSATION, 'msg-2', { pick: 'b' });
    await persistence.updateWidgetState('conv-2', 'msg-1', { pick: 'c' });

    await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toEqual({ pick: 'a' });
    await expect(persistence.getWidgetState(CONVERSATION, 'msg-2')).resolves.toEqual({ pick: 'b' });
    await expect(persistence.getWidgetState('conv-2', 'msg-1')).resolves.toEqual({ pick: 'c' });
  });

  it('keys the snapshot as `${conversationId}:${messageId}`', async () => {
    const persistence = createMemoryPersistence();

    await persistence.updateWidgetState(CONVERSATION, 42, { pick: 'a' });

    expect(persistence.snapshot()).toEqual({ 'conv-1:42': { pick: 'a' } });
  });

  it('addresses a numeric and a string message id as the same slot', async () => {
    // A consequence of the documented key format, pinned here rather than discovered later:
    // `NereyMessage['id']` is `string | number`, and a host that mixes the two for one message
    // gets one record, not two.
    const persistence = createMemoryPersistence();

    await persistence.updateWidgetState(CONVERSATION, 7, { pick: 'a' });

    await expect(persistence.getWidgetState(CONVERSATION, '7')).resolves.toEqual({ pick: 'a' });
  });

  it('stores nested structures rather than a shallow copy', async () => {
    const persistence = createMemoryPersistence();

    await persistence.updateWidgetState(CONVERSATION, 'msg-1', {
      selection: { items: [{ id: 1 }, { id: 2 }] },
    });

    await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toEqual({
      selection: { items: [{ id: 1 }, { id: 2 }] },
    });
  });
});

describe('isolation from external mutation', () => {
  it('ignores a mutation of the object that was written', async () => {
    const persistence = createMemoryPersistence();
    const state: WidgetStateRecord = { answers: ['a'] };

    await persistence.updateWidgetState(CONVERSATION, 'msg-1', state);
    (state.answers as string[]).push('b');

    await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toEqual({
      answers: ['a'],
    });
  });

  it('ignores a mutation of the object that was read back', async () => {
    const persistence = createMemoryPersistence();
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answers: ['a'] });

    const first = await persistence.getWidgetState(CONVERSATION, 'msg-1');
    (first?.answers as string[]).push('b');

    await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toEqual({
      answers: ['a'],
    });
  });

  it('hands out a fresh object on each read', async () => {
    const persistence = createMemoryPersistence();
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answers: ['a'] });

    const first = await persistence.getWidgetState(CONVERSATION, 'msg-1');
    const second = await persistence.getWidgetState(CONVERSATION, 'msg-1');

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('ignores a mutation of a returned snapshot', async () => {
    const persistence = createMemoryPersistence();
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answers: ['a'] });

    const taken = persistence.snapshot() as Record<string, WidgetStateRecord>;
    (taken['conv-1:msg-1']?.answers as string[]).push('b');
    delete taken['conv-1:msg-1'];

    expect(persistence.snapshot()).toEqual({ 'conv-1:msg-1': { answers: ['a'] } });
  });

  it('does not retroactively change a snapshot taken before a later write', async () => {
    const persistence = createMemoryPersistence();
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answers: ['a'] });

    const before = persistence.snapshot();
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answers: ['a', 'b'] });

    expect(before).toEqual({ 'conv-1:msg-1': { answers: ['a'] } });
  });

  it('rejects a value no serialising backend could have stored', async () => {
    const persistence = createMemoryPersistence();

    await expect(
      persistence.updateWidgetState(CONVERSATION, 'msg-1', { onPick: () => {} }),
    ).rejects.toThrow();
    expect(persistence.snapshot()).toEqual({});
  });
});

describe('seeding', () => {
  it('starts populated from the seed', async () => {
    const persistence = createMemoryPersistence({ 'conv-1:msg-1': { answer: 'yes' } });

    await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toEqual({
      answer: 'yes',
    });
    expect(persistence.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'yes' } });
  });

  it('starts empty with no seed', () => {
    expect(createMemoryPersistence().snapshot()).toEqual({});
  });

  it('copies the seed, so mutating it afterwards does not reach the store', async () => {
    const seed: Record<string, WidgetStateRecord> = { 'conv-1:msg-1': { answers: ['a'] } };
    const persistence = createMemoryPersistence(seed);

    (seed['conv-1:msg-1']?.answers as string[]).push('b');
    seed['conv-1:msg-2'] = { answers: ['z'] };

    await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toEqual({
      answers: ['a'],
    });
    await expect(persistence.getWidgetState(CONVERSATION, 'msg-2')).resolves.toBeUndefined();
  });

  it('overwrites a seeded entry like any other', async () => {
    const persistence = createMemoryPersistence({ 'conv-1:msg-1': { answer: 'yes' } });

    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'no' });

    await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toEqual({
      answer: 'no',
    });
  });
});

describe('reset', () => {
  it('empties an unseeded store', async () => {
    const persistence = createMemoryPersistence();
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' });

    persistence.reset();

    expect(persistence.snapshot()).toEqual({});
    await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toBeUndefined();
  });

  it('restores the seed rather than emptying a seeded store', async () => {
    const persistence = createMemoryPersistence({ 'conv-1:msg-1': { answer: 'yes' } });
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'no' });
    await persistence.updateWidgetState(CONVERSATION, 'msg-2', { answer: 'maybe' });

    persistence.reset();

    expect(persistence.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'yes' } });
  });

  it('restores the same seed content on every reset', async () => {
    const persistence = createMemoryPersistence({ 'conv-1:msg-1': { answers: ['a'] } });

    for (let round = 0; round < 3; round += 1) {
      const restored = await persistence.getWidgetState(CONVERSATION, 'msg-1');
      (restored?.answers as string[]).push('mutated');
      await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answers: ['overwritten'] });
      persistence.reset();
      await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toEqual({
        answers: ['a'],
      });
    }
  });

  it('disarms pending write failures', async () => {
    const persistence = createMemoryPersistence();
    persistence.failNextWrites(3);

    persistence.reset();

    await expect(
      persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' }),
    ).resolves.toBeUndefined();
  });

  it('clears latency', async () => {
    const persistence = createMemoryPersistence();
    persistence.setLatency(10_000);

    persistence.reset();

    // Would time out rather than fail if latency survived the reset.
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' });
    expect(persistence.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'yes' } });
  });
});

describe('failNextWrites', () => {
  it('rejects the next write and leaves the store untouched', async () => {
    const persistence = createMemoryPersistence();
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' });

    persistence.failNextWrites(1);
    const error = await rejection(persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'no' }));

    expect(error).toBeInstanceOf(Error);
    // The previously persisted value survives — which is what `useWidgetState` rolls back to.
    expect(persistence.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'yes' } });
  });

  it('rejects with a plain Error, not a NereyError, because the port models a transport', async () => {
    const persistence = createMemoryPersistence();
    persistence.failNextWrites(1);

    const error = await rejection(persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'no' }));

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('Error');
    expect(error).not.toHaveProperty('code');
  });

  it('recovers on the write after the armed count is exhausted', async () => {
    const persistence = createMemoryPersistence();
    persistence.failNextWrites(2);

    await rejection(persistence.updateWidgetState(CONVERSATION, 'msg-1', { attempt: 1 }));
    await rejection(persistence.updateWidgetState(CONVERSATION, 'msg-1', { attempt: 2 }));
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { attempt: 3 });

    expect(persistence.snapshot()).toEqual({ 'conv-1:msg-1': { attempt: 3 } });
  });

  it('rejects with the supplied error instance', async () => {
    const persistence = createMemoryPersistence();
    const supplied = new TypeError('backend exploded');
    persistence.failNextWrites(1, supplied);

    const error = await rejection(persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'no' }));

    expect(error).toBe(supplied);
  });

  it('re-arms with a fresh error, replacing a previously supplied one', async () => {
    const persistence = createMemoryPersistence();
    persistence.failNextWrites(1, new TypeError('first'));
    await rejection(persistence.updateWidgetState(CONVERSATION, 'msg-1', { attempt: 1 }));

    persistence.failNextWrites(1);
    const error = await rejection(persistence.updateWidgetState(CONVERSATION, 'msg-1', { attempt: 2 }));

    expect(error).not.toBeInstanceOf(TypeError);
  });

  it('disarms on a count of zero, replacing an earlier arming', async () => {
    const persistence = createMemoryPersistence();
    persistence.failNextWrites(5);

    persistence.failNextWrites(0);

    await expect(
      persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' }),
    ).resolves.toBeUndefined();
  });

  it('treats a negative count as disarmed', async () => {
    const persistence = createMemoryPersistence();
    persistence.failNextWrites(-3);

    await expect(
      persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' }),
    ).resolves.toBeUndefined();
  });

  it('treats NaN as disarmed rather than as a comparison that never fires', async () => {
    const persistence = createMemoryPersistence();
    persistence.failNextWrites(Number.NaN);

    await expect(
      persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' }),
    ).resolves.toBeUndefined();
  });

  it('fails every write until reset when armed with Infinity', async () => {
    const persistence = createMemoryPersistence();
    persistence.failNextWrites(Number.POSITIVE_INFINITY);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await rejection(persistence.updateWidgetState(CONVERSATION, 'msg-1', { attempt }));
    }
    expect(persistence.snapshot()).toEqual({});

    persistence.reset();
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { attempt: 'last' });
    expect(persistence.snapshot()).toEqual({ 'conv-1:msg-1': { attempt: 'last' } });
  });

  it('does not affect reads', async () => {
    const persistence = createMemoryPersistence({ 'conv-1:msg-1': { answer: 'yes' } });
    persistence.failNextWrites(1);

    await expect(persistence.getWidgetState(CONVERSATION, 'msg-1')).resolves.toEqual({
      answer: 'yes',
    });
  });
});

describe('abort', () => {
  it('rejects a write whose signal is already aborted, without touching the store', async () => {
    const persistence = createMemoryPersistence();
    const controller = new AbortController();
    controller.abort();

    const error = await rejection(
      persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' }, { signal: controller.signal }),
    );

    expect((error as Error).name).toBe('AbortError');
    expect(persistence.snapshot()).toEqual({});
  });

  it('rejects with the reason the caller aborted with', async () => {
    const persistence = createMemoryPersistence();
    const controller = new AbortController();
    const reason = new Error('superseded by a newer write');
    controller.abort(reason);

    const error = await rejection(
      persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' }, { signal: controller.signal }),
    );

    expect(error).toBe(reason);
  });

  it('does not consume an armed write failure when it aborts up front', async () => {
    const persistence = createMemoryPersistence();
    persistence.failNextWrites(1);
    const controller = new AbortController();
    controller.abort();

    await rejection(
      persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' }, { signal: controller.signal }),
    );

    // The aborted attempt never reached the "server", so the seam is still armed for the retry.
    const error = await rejection(persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' }));
    expect(error).toBeInstanceOf(Error);
  });

  it('rejects a write aborted during the latency window', async () => {
    const persistence = createMemoryPersistence();
    persistence.setLatency(50);
    const controller = new AbortController();

    // The entry check has already passed by the time this aborts, so it is the in-flight
    // listener that rejects — a different code path from the already-aborted case above.
    const inFlight = persistence.updateWidgetState(
      CONVERSATION,
      'msg-1',
      { answer: 'yes' },
      { signal: controller.signal },
    );
    const settled = rejection(inFlight);
    controller.abort();

    expect(((await settled) as Error).name).toBe('AbortError');
    expect(persistence.snapshot()).toEqual({});
  });

  it('does not write after the latency window when it was aborted mid-flight', async () => {
    const persistence = createMemoryPersistence();
    persistence.setLatency(10);
    const controller = new AbortController();

    const settled = rejection(
      persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' }, { signal: controller.signal }),
    );
    controller.abort();
    await settled;

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(persistence.snapshot()).toEqual({});
  });

  it('resolves normally when the signal never aborts', async () => {
    const persistence = createMemoryPersistence();
    persistence.setLatency(5);
    const controller = new AbortController();

    await persistence.updateWidgetState(
      CONVERSATION,
      'msg-1',
      { answer: 'yes' },
      { signal: controller.signal },
    );

    expect(persistence.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'yes' } });

    // Aborting after the write settled must not retroactively reject or unwrite anything.
    controller.abort();
    expect(persistence.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'yes' } });
  });
});

describe('latency', () => {
  it('defers the write past the microtask queue', async () => {
    const persistence = createMemoryPersistence();
    persistence.setLatency(15);

    const inFlight = persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' });
    expect(persistence.snapshot()).toEqual({});

    // Draining microtasks is not enough: a real transport makes the caller wait across a task
    // boundary, which is what exposes a component that renders before its state has landed.
    await Promise.resolve();
    await Promise.resolve();
    expect(persistence.snapshot()).toEqual({});

    await inFlight;
    expect(persistence.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'yes' } });
  });

  it('defers reads as well as writes', async () => {
    const persistence = createMemoryPersistence({ 'conv-1:msg-1': { answer: 'yes' } });
    persistence.setLatency(15);

    let settled = false;
    const read = persistence.getWidgetState(CONVERSATION, 'msg-1').then((value) => {
      settled = true;
      return value;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    await expect(read).resolves.toEqual({ answer: 'yes' });
  });

  it('waits at least the configured latency', async () => {
    const persistence = createMemoryPersistence();
    persistence.setLatency(30);

    const started = Date.now();
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' });

    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
  });

  it('resolves without a timer once latency is set back to zero', async () => {
    const persistence = createMemoryPersistence();
    persistence.setLatency(10_000);
    persistence.setLatency(0);

    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' });

    expect(persistence.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'yes' } });
  });

  it('treats a negative or non-finite latency as none', async () => {
    const persistence = createMemoryPersistence();

    persistence.setLatency(-100);
    await persistence.updateWidgetState(CONVERSATION, 'msg-1', { attempt: 1 });

    persistence.setLatency(Number.NaN);
    await persistence.updateWidgetState(CONVERSATION, 'msg-2', { attempt: 2 });

    persistence.setLatency(Number.POSITIVE_INFINITY);
    await persistence.updateWidgetState(CONVERSATION, 'msg-3', { attempt: 3 });

    expect(persistence.snapshot()).toEqual({
      'conv-1:msg-1': { attempt: 1 },
      'conv-1:msg-2': { attempt: 2 },
      'conv-1:msg-3': { attempt: 3 },
    });
  });

  it('applies the latency in force when the call was made', async () => {
    const persistence = createMemoryPersistence();
    persistence.setLatency(20);

    const inFlight = persistence.updateWidgetState(CONVERSATION, 'msg-1', { answer: 'yes' });
    // Changing latency mid-flight must not shorten a write already waiting.
    persistence.setLatency(0);
    expect(persistence.snapshot()).toEqual({});

    await inFlight;
    expect(persistence.snapshot()).toEqual({ 'conv-1:msg-1': { answer: 'yes' } });
  });

  it('settles concurrent writes to different messages independently', async () => {
    const persistence = createMemoryPersistence();
    persistence.setLatency(10);

    await Promise.all([
      persistence.updateWidgetState(CONVERSATION, 'msg-1', { pick: 'a' }),
      persistence.updateWidgetState(CONVERSATION, 'msg-2', { pick: 'b' }),
    ]);

    expect(persistence.snapshot()).toEqual({
      'conv-1:msg-1': { pick: 'a' },
      'conv-1:msg-2': { pick: 'b' },
    });
  });
});
