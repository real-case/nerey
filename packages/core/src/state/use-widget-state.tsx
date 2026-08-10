import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { persistenceError, type NereyError } from '../errors';
import { useWidgetHost } from '../host/host-context';
import type { WidgetStateRecord } from '../types';

export type WidgetStateStatus = 'idle' | 'saving' | 'error';

export type UseWidgetStateResult<S> = {
  state: S;
  /** Optimistic: applies immediately, persists debounced. */
  setState: (next: S | ((previous: S) => S)) => void;
  status: WidgetStateStatus;
  error: NereyError | undefined;
};

const DEFAULT_DEBOUNCE_MS = 400;

type SaveState = { status: WidgetStateStatus; error: NereyError | undefined };

/**
 * Module-level and frozen so re-announcing a state React is already in is an identity no-op it
 * bails out of, instead of a wasted render per write. Frozen because they are shared.
 *
 * `error` is defined exactly when `status === 'error'` — keeping the pair in one state cell is
 * what makes that an invariant rather than a convention two `useState` calls could break
 * halfway through a batch.
 */
const IDLE: SaveState = Object.freeze({ status: 'idle', error: undefined });
const SAVING: SaveState = Object.freeze({ status: 'saving', error: undefined });

/**
 * A scheduled write, with its destination captured at the moment `setState` ran rather than read
 * back when the timer fires. If the component is re-used for a different message in between —
 * a transcript list rendered without stable keys will do exactly that — the value still lands
 * under the message it came from instead of overwriting the new one.
 */
type PendingWrite<S> = {
  conversationId: string;
  messageId: string | number;
  value: S;
};

function normaliseDebounce(ms: number | undefined): number {
  if (ms === undefined) return DEFAULT_DEBOUNCE_MS;
  // Negative and non-finite collapse to zero, which means "the next macrotask", not
  // "synchronously": coalescing still holds, because everything set in one event handler
  // re-arms the same timer before the turn ends.
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/**
 * ADR 0016 — widget state applied optimistically and written through the injected
 * `MessagePersistence` port. Core performs no I/O of its own: everything here is local state,
 * one timer and one `AbortController`.
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
 * It never reads. Hydration happens at the boundary that already owns migration and schema
 * validation (ADR 0030 / 0011) and arrives here as `initial`; a read inside the hook would race
 * the optimistic value it exists to protect, and would do it asynchronously, so the widget would
 * flicker back to the stored value some time after the user acted.
 */
export function useWidgetState<S extends WidgetStateRecord>(
  messageId: string | number,
  initial: S,
  options?: { debounceMs?: number },
): UseWidgetStateResult<S> {
  const host = useWidgetHost();
  const { conversationId } = host;
  const debounceMs = normaliseDebounce(options?.debounceMs);

  const [state, setLocalState] = useState<S>(initial);
  const [save, setSave] = useState<SaveState>(IDLE);

  /**
   * The committed value, mirrored. A functional update must see what the *previous* call in the
   * same event handler produced, and the `state` this render closed over is stale for the second
   * of two batched calls. React's updater queue resolves that inside `setLocalState` — but the
   * resolved value is also what gets scheduled for the write, and the queue cannot be read from
   * outside a reducer, so the hook has to resolve it itself.
   */
  const stateRef = useRef<S>(initial);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlightRef = useRef<AbortController | undefined>(undefined);
  const mountedRef = useRef(true);

  /**
   * Latest host and message id, for the write that runs later. Read from a ref rather than
   * closed over so `setState` keeps one identity for the lifetime of the widget: a consumer will
   * put it in a dependency array, and a host that rebuilds its value object each render would
   * otherwise re-fire their effects on every keystroke elsewhere in the app.
   */
  const latestRef = useRef({ host, messageId });
  useEffect(() => {
    latestRef.current = { host, messageId };
    // Re-synced from committed state rather than assigned wherever state changes, because the
    // reset below runs during render and a ref must not be written there. `setState` still
    // assigns it eagerly — it has to, for two updates in one turn to compose — and this only
    // ever confirms that value or picks up a reset.
    stateRef.current = state;
  });

  const [renderedMessageId, setRenderedMessageId] = useState(messageId);
  if (renderedMessageId !== messageId) {
    // This instance is now showing a different message, so the previous message's answers must
    // not carry over. Adjusting state during render is React's documented way to do this — the
    // alternative, an effect, paints one frame of message A's state under message B's identity.
    //
    // The pending write is deliberately left armed: it carries its own destination, so it still
    // lands under message A. Cancelling it here would discard work the user actually did.
    setRenderedMessageId(messageId);
    setLocalState(initial);
    setSave(IDLE);
  }

  const persistNow = useCallback(async (target: PendingWrite<S>): Promise<void> => {
    // A write that outlives the message it belongs to reports through `onWidgetError` and
    // nothing else: this hook now represents a different message, and rendering that message's
    // controls as saving or failed would attribute one message's outcome to another.
    const ownsStatus = () => latestRef.current.messageId === target.messageId;

    // Supersede rather than queue. The newer value already contains everything the older one
    // carried, so letting both run would only race them into the store in whatever order the
    // transport happened to settle — and the loser of that race is the value on screen.
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;

    // Clears a previous failure at the moment a new attempt starts, which is what makes a retry
    // legible: `saving` after `error` is the widget trying again, not a stale banner.
    if (ownsStatus()) setSave(SAVING);

    let failed = false;
    let failure: unknown;
    try {
      await latestRef.current.host.persistence.updateWidgetState(
        target.conversationId,
        target.messageId,
        target.value,
        { signal: controller.signal },
      );
    } catch (cause) {
      failed = true;
      failure = cause;
    }

    if (inFlightRef.current === controller) inFlightRef.current = undefined;

    // An aborted write owns no outcome. It was either superseded — in which case the write that
    // replaced it will report — or the component is gone. Reporting an abort as a persistence
    // failure would light up an error for every widget the user scrolled past mid-save.
    if (controller.signal.aborted || !mountedRef.current) return;

    if (failed) {
      // Reported even when a newer write is already queued: a write that reached the transport
      // and was refused is a fact about the user's data, and swallowing it because a retry
      // happens to be pending is how a silently unsaved widget ships.
      //
      // The error carries `messageId` but no widget type or version — this layer legitimately
      // does not know them, and inventing coordinates would be worse than omitting them.
      const error = persistenceError({ messageId: target.messageId }, failure);
      if (ownsStatus()) setSave({ status: 'error', error });
      latestRef.current.host.onWidgetError?.(error);
      return;
    }

    // A queued write means there is still unpersisted work, so the widget is not idle; the
    // scheduled write owns the outcome and will announce it when it settles.
    if (timerRef.current !== undefined) return;
    if (ownsStatus()) setSave(IDLE);
  }, []);

  const setState = useCallback(
    (next: S | ((previous: S) => S)) => {
      // `S extends WidgetStateRecord` has no function in it — a function is not assignable to a
      // string index signature — so `typeof` is an unambiguous discriminator here rather than the
      // ambiguity React's own `SetStateAction` has to live with.
      const value = typeof next === 'function' ? next(stateRef.current) : next;

      stateRef.current = value;
      setLocalState(value);
      // `saving` from the moment the value changes rather than from the moment the write leaves:
      // during the debounce window the value is on screen and absent from the store, and a
      // consumer rendering "saved" for those 400ms would be showing something that is not true
      // yet. An unchanged value still schedules a write — that is how a retry after a failure is
      // expressed, and skipping it would strand the widget in `error` forever.
      setSave(SAVING);

      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
      const target: PendingWrite<S> = { conversationId, messageId, value };
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        void persistNow(target);
      }, debounceMs);
    },
    [conversationId, messageId, debounceMs, persistNow],
  );

  useEffect(() => {
    // Set here, not only at `useRef(true)`: React 19's StrictMode mounts, unmounts and remounts
    // in development, and a flag only ever cleared by the cleanup would leave the remounted hook
    // permanently convinced it was unmounted, silently dropping every write.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // A write still inside its debounce window is dropped rather than flushed. Flushing would
      // fire an unowned request from a component that no longer exists: nothing could surface its
      // failure (`onWidgetError` is reachable, but `status` and `error` are not), and a widget
      // remounted immediately afterwards — a virtualised transcript does this while scrolling —
      // would race its own hydrated value against the write it left behind. Losing at most one
      // debounce window of a value the user can see is the cheaper failure (ADR 0016).
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      // `abort()` with no reason on purpose: the platform then rejects with a genuine
      // `AbortError` DOMException, which is what a consumer's transport-level `catch` already
      // classifies. A bespoke reason would rename an error every fetch-based adapter can
      // already recognise.
      inFlightRef.current?.abort();
      inFlightRef.current = undefined;
    };
  }, []);

  return useMemo(
    () => ({ state, setState, status: save.status, error: save.error }),
    [state, setState, save],
  );
}
