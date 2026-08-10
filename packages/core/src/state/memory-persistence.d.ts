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
export declare function createMemoryPersistence(
  seed?: Readonly<Record<string, WidgetStateRecord>>,
): MemoryPersistence;
//# sourceMappingURL=memory-persistence.d.ts.map
