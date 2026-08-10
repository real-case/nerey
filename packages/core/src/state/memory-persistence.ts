import type { MessagePersistence, WidgetStateRecord } from '../types';

/**
 * ADR 0016 — the reference implementation of the persistence port, and what makes a widget
 * demonstrable with no backend at all (FR-37).
 *
 * It is deliberately more than a `Map`. The most consequential behaviour in the whole
 * persistence story is what happens when a write FAILS *after* the widget's reply is already
 * in the transcript — the widget must stay locked and must not offer a second send. That path
 * is unreachable against a store that always resolves, so the failure seam is part of the
 * adapter rather than something every test file re-mocks.
 */
export type MemoryPersistence = MessagePersistence & {
  /** All stored state, keyed `${conversationId}:${messageId}`. For assertions and devtools. */
  snapshot(): Readonly<Record<string, WidgetStateRecord>>;
  /**
   * Restores exactly what `createMemoryPersistence` returned: the seed contents, no armed
   * write failures, no latency.
   *
   * Clearing the seams as well as the data is the point. A `reset()` in `beforeEach` that
   * left `failNextWrites(2)` armed would fail the *next* test, at a call site that never
   * mentions the seam — the worst kind of cross-test leak to diagnose.
   */
  reset(): void;
  /** Test seam: make the next N writes reject, to exercise the failure path. */
  failNextWrites(count: number, error?: Error): void;
  /** Test seam: artificial latency in ms. */
  setLatency(ms: number): void;
};

function keyOf(conversationId: string, messageId: string | number): string {
  return `${conversationId}:${messageId}`;
}

/**
 * Every value crossing this boundary is copied, in both directions.
 *
 * A real transport serialises at call time: what the widget passed is what goes on the wire,
 * and any later mutation of that object is invisible to the server. A store holding the
 * caller's reference is strictly *more forgiving* than that. A widget that mutates its state
 * object in place — `state.answers.push(id)` — reads its own mutation straight back, so the
 * session stays perfectly self-consistent and nothing looks wrong; the bug only surfaces on
 * reload, when a real backend returns the value as it was at write time rather than as the
 * widget left it. The read direction has the same shape: hand back the stored object and a
 * widget edits the store by editing its own state, which again nothing detects until the
 * transcript is re-fetched. Sharing a reference here would therefore make the mock pass
 * exactly the bugs it exists to catch.
 *
 * `structuredClone` is allowed to throw rather than falling back to a shallow copy: a value it
 * cannot clone is a value no serialising backend could have stored either, so failing here —
 * in development, at the write — is the honest outcome.
 */
function copy<T>(value: T): T {
  return structuredClone(value);
}

/**
 * What an aborted operation rejects with.
 *
 * `abort(reason)` is how a caller says *why*, and every platform API rejects with that reason,
 * so reproducing it keeps a consumer's `catch` identical against this adapter and against
 * `fetch`. The constructed `DOMException` is only for a hand-rolled or polyfilled signal with
 * no `reason`; it is a `DOMException` and not an `Error` because callers branch on
 * `name === 'AbortError'`, and because `instanceof DOMException` is unreliable anyway — under
 * jsdom the global and the one `AbortController` uses come from different realms.
 */
function abortError(signal: AbortSignal): unknown {
  const reason: unknown = signal.reason;
  if (reason !== undefined) return reason;
  if (typeof DOMException === 'function') {
    return new DOMException('The operation was aborted.', 'AbortError');
  }
  const fallback = new Error('The operation was aborted.');
  fallback.name = 'AbortError';
  return fallback;
}

/**
 * Resolves after `ms`, or as soon as `signal` aborts — whichever comes first.
 *
 * It *resolves* on abort rather than rejecting, and the caller re-checks `signal.aborted` on
 * the far side of the await. That keeps the rejection value — which by the platform's contract
 * is `signal.reason`, and is deliberately not required to be an `Error` — under the control of
 * the function that owns the port's contract, instead of buried in a timer helper.
 *
 * Zero latency skips the timer entirely, so the common case costs a microtask rather than a
 * macrotask: a `setTimeout(0)` per write is enough to make `await` ordering in a test differ
 * from production for no reason.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();

  return new Promise<void>((resolve) => {
    if (!signal) {
      setTimeout(resolve, ms);
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    // Listener removed on the happy path above, not only on abort: this adapter outlives
    // thousands of writes in a long-running dev session, and a signal reused across them would
    // otherwise accumulate one listener per completed write.
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function newSimulatedWriteFailure(): Error {
  // A plain `Error`, never a `NereyError`. The port models the *consumer's* transport, and a
  // consumer's transport rejects with its own error type; wrapping it into the typed taxonomy
  // is core's job (`persistenceError(coords, cause)`, ADR 0013). Rejecting with a NereyError
  // here would let a missing wrap look correct in every test that uses this adapter.
  return new Error(
    'Simulated persistence write failure (failNextWrites). The widget must stay locked: the ' +
      'reply it produced is already in the transcript (ADR 0016).',
  );
}

export function createMemoryPersistence(
  seed?: Readonly<Record<string, WidgetStateRecord>>,
): MemoryPersistence {
  // Cloned once, at construction. Reading the caller's `seed` object lazily inside `reset()`
  // would mean a caller who kept and mutated it silently changes what a `reset()` three tests
  // later restores.
  const seeded = new Map<string, WidgetStateRecord>(
    Object.entries(seed ?? {}).map(([key, record]) => [key, copy(record)]),
  );

  const store = new Map<string, WidgetStateRecord>();

  let latencyMs = 0;
  let pendingWriteFailures = 0;
  let writeFailure: Error | undefined;

  function restoreSeed(): void {
    store.clear();
    for (const [key, record] of seeded) store.set(key, copy(record));
  }

  restoreSeed();

  async function getWidgetState(
    conversationId: string,
    messageId: string | number,
  ): Promise<WidgetStateRecord | undefined> {
    await delay(latencyMs);
    const record = store.get(keyOf(conversationId, messageId));
    return record === undefined ? undefined : copy(record);
  }

  async function updateWidgetState(
    conversationId: string,
    messageId: string | number,
    state: WidgetStateRecord,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    const signal = options?.signal;

    // Checked before anything else. An already-aborted write must reject rather than resolve:
    // a caller whose cleanup path swallows a resolved promise would otherwise record the write
    // as successful and skip the retry it was cancelling *for*.
    if (signal?.aborted) throw abortError(signal);

    // Captured now, before the latency window, because that is when a real transport
    // serialises. Cloning after the await would let a mutation made while the write was
    // in flight land in the store, which no wire protocol permits.
    const record = copy(state);

    await delay(latencyMs, signal);

    // Re-checked on the far side of the latency window — `delay` resolves early when the signal
    // fires, so this is the mid-flight abort. It reads `aborted` rather than a flag set by the
    // listener on purpose: a cancellation that lands in the same tick the timer fired must
    // still cancel, because the caller has already decided it does not want this write.
    if (signal?.aborted) throw abortError(signal);

    // Consumed after the latency window, not before: a write that never reached the "server"
    // did not use up an armed failure, so an aborted attempt leaves the seam intact for the
    // retry the test is actually interested in.
    if (pendingWriteFailures > 0) {
      pendingWriteFailures -= 1;
      throw writeFailure ?? newSimulatedWriteFailure();
    }

    store.set(keyOf(conversationId, messageId), record);
  }

  function snapshot(): Readonly<Record<string, WidgetStateRecord>> {
    // A fresh deep copy per call. `Readonly` is a compile-time claim only; copying makes it
    // true at runtime, so an assertion that mutates the snapshot — or holds one across a write
    // to compare before and after — can neither corrupt nor observe the live store.
    const out: Record<string, WidgetStateRecord> = {};
    for (const [key, record] of store) out[key] = copy(record);
    return out;
  }

  function reset(): void {
    restoreSeed();
    pendingWriteFailures = 0;
    writeFailure = undefined;
    latencyMs = 0;
  }

  function failNextWrites(count: number, error?: Error): void {
    // Assignment, not accumulation: `failNextWrites(0)` is how a test disarms the seam, and
    // `+=` would make two arming calls in one test depend on their order.
    //
    // `Infinity` deliberately survives `Math.trunc` and never decrements below itself, so
    // "fail every write until reset" is expressible; `NaN` is a caller mistake and disarms
    // rather than comparing false forever at the call site that armed it.
    pendingWriteFailures = Number.isNaN(count) ? 0 : Math.max(0, Math.trunc(count));
    writeFailure = error;
  }

  function setLatency(ms: number): void {
    // Negative and NaN normalise to zero. Both would reach `setTimeout` as "fire immediately"
    // anyway; collapsing them here means the timer is skipped as well, so the behaviour a
    // caller gets matches the one they can reason about.
    latencyMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  return { getWidgetState, updateWidgetState, snapshot, reset, failNextWrites, setLatency };
}
