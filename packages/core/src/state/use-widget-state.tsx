import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import type { NereyError } from '../errors';
import { useWidgetHost, useWriteQueue } from '../host/host-context';
import type { WidgetStateRecord } from '../types';
import type { WidgetStateStatus } from './write-queue';

export type { WidgetStateStatus } from './write-queue';

export type UseWidgetStateResult<S> = {
  state: S;
  /** Optimistic: applies immediately, persists debounced. */
  setState: (next: S | ((previous: S) => S)) => void;
  status: WidgetStateStatus;
  error: NereyError | undefined;
};

const DEFAULT_DEBOUNCE_MS = 400;

function normaliseDebounce(ms: number | undefined): number {
  if (ms === undefined) return DEFAULT_DEBOUNCE_MS;
  // Negative and non-finite collapse to zero, which means "the next macrotask", not
  // "synchronously": coalescing still holds, because everything set in one event handler
  // re-arms the same timer before the turn ends.
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/**
 * ADR 0016 / 0047 — widget state applied optimistically and written through the injected
 * `MessagePersistence` port. Core performs no I/O of its own. The debounce, the request and its
 * outcome belong to the host provider's write queue (`./write-queue`), which outlives this hook:
 * the hook holds the value on screen, enqueues it, and listens to the queue for `status`.
 *
 * ## A failed write does NOT roll the value back
 *
 * This is the opposite of the usual optimistic pattern, it is deliberate, and it is the thing a
 * future maintainer will "fix". Read this before changing it.
 *
 * The usual pattern — apply, write, restore the previous value on rejection — assumes the
 * optimistic value is a *proposal* the server may refuse. A widget's state is not a proposal. By
 * the time a widget persists anything it has almost always already sent a reply into the
 * transcript through `sendUserMessage` (ADR 0014): the user pressed Confirm, the text went to
 * the agent, the model is answering it. The write that just failed is a record of something that
 * has already happened everywhere else.
 *
 * Rolling the value back would restore the pre-interaction appearance — the unselected option,
 * the unpressed button — and in any widget that derives `disabled` from its own state it would
 * re-enable the control. The user reads that as "it did not go through" and presses again. The
 * second press sends the same reply a second time, and the transcript now carries a duplicate
 * answer and a second model turn. Losing a state write is recoverable and visible on reload; a
 * duplicated reply is neither. This is FR-20, and it is the resolution of a real incident in the
 * extraction source: a rolled-back optimistic state re-enabled a poll's options after the vote
 * had already been sent.
 *
 * So the failure is surfaced, never undone. `status` becomes `'error'`, `error` carries the
 * `persistence` member of the taxonomy (ADR 0013), and the same error reaches the host's
 * `onWidgetError`, which may render a retry affordance, log it, or ignore it — that judgement
 * belongs to the application, not to a library that cannot see the surrounding UI.
 *
 * Note what this hook deliberately does not own: the widget's *lock*. Read-only-ness comes from
 * the lifecycle runtime (ADR 0018), never from whether a write succeeded, so an expired widget
 * stays expired whether the write landed, failed, or is still in flight. Value and lock are
 * separate questions; conflating them is precisely what produces the duplicate reply.
 *
 * ## What it does not do
 *
 * It never reads the port. Hydration happens at the boundary that already owns migration and schema
 * validation (ADR 0030 / 0011) and arrives here as `initial`; a read inside the hook would race
 * the optimistic value it exists to protect, and would do it asynchronously, so the widget would
 * flicker back to the stored value some time after the user acted. The one thing it does read is
 * the queue: a value this message wrote and the port has not confirmed yet wins over `initial`,
 * because `initial` was taken before the write and a remount must see what it left (ADR 0047).
 */
export function useWidgetState<S extends WidgetStateRecord>(
  messageId: string | number,
  initial: S,
  options?: { debounceMs?: number },
): UseWidgetStateResult<S> {
  const host = useWidgetHost();
  const queue = useWriteQueue();
  const { conversationId } = host;
  const debounceMs = normaliseDebounce(options?.debounceMs);

  // Only this message's own unsettled write can be read back here, and only a value this hook
  // wrote as `S` is ever in the queue under this key, so the cast restores a type it was erased from.
  const hydrate = (): S => (queue.unsettled(conversationId, messageId) as S | undefined) ?? initial;

  const [state, setLocalState] = useState<S>(hydrate);

  /**
   * The committed value, mirrored. A functional update must see what the *previous* call in the
   * same event handler produced, and the `state` this render closed over is stale for the second
   * of two batched calls. React's updater queue resolves that inside `setLocalState` — but the
   * resolved value is also what gets enqueued, and the updater queue cannot be read from outside
   * a reducer, so the hook has to resolve it itself.
   */
  const stateRef = useRef<S>(state);

  /**
   * Latest host, for the write that is enqueued later. Read from a ref rather than closed over so
   * `setState` keeps one identity for the lifetime of the widget: a consumer will put it in a
   * dependency array, and a host that rebuilds its value object each render would otherwise
   * re-fire their effects on every keystroke elsewhere in the app.
   */
  const hostRef = useRef(host);
  useEffect(() => {
    hostRef.current = host;
    // Re-synced from committed state rather than assigned wherever state changes, because the
    // reset below runs during render and a ref must not be written there.
    stateRef.current = state;
  });

  const [renderedMessageId, setRenderedMessageId] = useState(messageId);
  if (renderedMessageId !== messageId) {
    // This instance is now showing a different message, so the previous message's answers must
    // not carry over. Adjusting state during render is React's documented way to do this — the
    // alternative, an effect, paints one frame of message A's state under message B's identity.
    //
    // Message A's queued write is left alone: it carries its own destination in the queue and
    // still lands under message A.
    setRenderedMessageId(messageId);
    setLocalState(hydrate());
  }

  // `status` and `error` come from the queue, per key, so they always describe the message this
  // hook is showing — a write that outlives its message can no longer light up another one.
  const subscribe = useCallback(
    (listener: () => void) => queue.subscribe(conversationId, messageId, listener),
    [queue, conversationId, messageId],
  );
  const read = useCallback(() => queue.status(conversationId, messageId), [queue, conversationId, messageId]);
  const save = useSyncExternalStore(subscribe, read, read);

  const setState = useCallback(
    (next: S | ((previous: S) => S)) => {
      // `S extends WidgetStateRecord` has no function in it — a function is not assignable to a
      // string index signature — so `typeof` is an unambiguous discriminator here rather than the
      // ambiguity React's own `SetStateAction` has to live with.
      const value = typeof next === 'function' ? next(stateRef.current) : next;

      stateRef.current = value;
      setLocalState(value);
      // An unchanged value still enqueues a write — that is how a retry after a failure is
      // expressed, and skipping it would strand the widget in `error` forever.
      const { persistence, onWidgetError } = hostRef.current;
      queue.enqueue({ conversationId, messageId, persistence, onWidgetError }, value, debounceMs);
    },
    [queue, conversationId, messageId, debounceMs],
  );

  useEffect(
    () => () => {
      // ADR 0047 — a write still inside its debounce window is flushed, not dropped. The queue owns
      // the request from here, reports its failure through `onWidgetError`, and hands its value
      // to a remount of the same message until the port confirms it.
      queue.flush(conversationId, messageId);
    },
    [queue, conversationId, messageId],
  );

  return useMemo(
    () => ({ state, setState, status: save.status, error: save.error }),
    [state, setState, save],
  );
}
