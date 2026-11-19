import { persistenceError, type NereyError } from '../errors';
import type { MessagePersistence, WidgetHostValue, WidgetStateRecord } from '../types';

/**
 * ADR 0047 — the queue that owns a widget's pending state write.
 *
 * ADR 0016 kept the debounce timer inside `useWidgetState` and dropped a pending write on unmount,
 * because a write fired from a dead component had no owner to report its failure and would race the
 * value a quick remount hydrated. Both reasons were about ownership, not about the write. This queue
 * lives as long as the host provider, so it owns the timer, the request and the outcome, and the
 * component only enqueues and listens.
 *
 * Plain TypeScript, no React: the provider creates one, `useWidgetState` subscribes to one key of
 * it through `useSyncExternalStore`, and the rules below are testable without rendering anything.
 */

export type WidgetStateStatus = 'idle' | 'saving' | 'error';

/** `error` is defined exactly when `status === 'error'`. Frozen and shared where it can be. */
export type SaveState = { readonly status: WidgetStateStatus; readonly error: NereyError | undefined };

export const IDLE: SaveState = Object.freeze({ status: 'idle', error: undefined });
export const SAVING: SaveState = Object.freeze({ status: 'saving', error: undefined });

/** Where a write goes and who hears about its failure, captured when it was enqueued. */
export type WriteTarget = {
  conversationId: string;
  messageId: string | number;
  persistence: MessagePersistence;
  onWidgetError: WidgetHostValue['onWidgetError'];
};

type Entry = {
  target: WriteTarget;
  /** The value still on its way to the port: queued or in flight. `undefined` once settled. */
  unsettled: WidgetStateRecord | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  inFlight: AbortController | undefined;
  save: SaveState;
  listeners: Set<() => void>;
};

export type WriteQueue = {
  /** Schedules `value` for `target` after `debounceMs`. A later write for the same key replaces it. */
  enqueue(target: WriteTarget, value: WidgetStateRecord, debounceMs: number): void;
  /** Fires the key's queued write now, if there is one. What unmount calls. */
  flush(conversationId: string, messageId: string | number): void;
  /** Fires every queued write now. What the provider calls when it unmounts. */
  flushAll(): void;
  /** The value a remount of this key should start from, when the port does not have it yet. */
  unsettled(conversationId: string, messageId: string | number): WidgetStateRecord | undefined;
  /** The key's save status. Identity-stable between changes, as `useSyncExternalStore` needs. */
  status(conversationId: string, messageId: string | number): SaveState;
  subscribe(conversationId: string, messageId: string | number, listener: () => void): () => void;
};

function keyOf(conversationId: string, messageId: string | number): string {
  // `String()` so the number 7 and the string "7" — which a JSON round-trip turns into each other —
  // are one key, matching how every port keys its store.
  return `${conversationId}\u0000${String(messageId)}`;
}

export function createWriteQueue(): WriteQueue {
  const entries = new Map<string, Entry>();

  function entryFor(conversationId: string, messageId: string | number): Entry | undefined {
    return entries.get(keyOf(conversationId, messageId));
  }

  function ensure(target: WriteTarget): Entry {
    const key = keyOf(target.conversationId, target.messageId);
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        target,
        unsettled: undefined,
        timer: undefined,
        inFlight: undefined,
        save: IDLE,
        listeners: new Set(),
      };
      entries.set(key, entry);
    }
    return entry;
  }

  /**
   * Drops an entry nothing needs any more, so a long session does not hold one per message it ever
   * showed. An entry with an unsettled value is kept even with no listener: it is what a remount
   * hydrates from, and what `flushAll` still has to send.
   */
  function prune(entry: Entry): void {
    if (entry.listeners.size > 0 || entry.timer !== undefined || entry.inFlight !== undefined) return;
    if (entry.unsettled !== undefined) return;
    const key = keyOf(entry.target.conversationId, entry.target.messageId);
    if (entries.get(key) === entry) entries.delete(key);
  }

  function announce(entry: Entry, save: SaveState): void {
    if (entry.save === save) return;
    entry.save = save;
    for (const listener of entry.listeners) listener();
  }

  async function send(entry: Entry, value: WidgetStateRecord): Promise<void> {
    // Supersede rather than queue. The newer value already contains everything the older one
    // carried, so letting both run would only race them into the store in whatever order the
    // transport happened to settle — and the loser of that race is the value on screen.
    entry.inFlight?.abort();
    const controller = new AbortController();
    entry.inFlight = controller;
    const { target } = entry;

    let failure: unknown;
    let failed = false;
    try {
      await target.persistence.updateWidgetState(target.conversationId, target.messageId, value, {
        signal: controller.signal,
      });
    } catch (cause) {
      failed = true;
      failure = cause;
    }

    if (entry.inFlight === controller) entry.inFlight = undefined;
    // An aborted write owns no outcome: the write that replaced it will report.
    if (controller.signal.aborted) return;

    if (failed) {
      // Reported even when a newer write is already queued: a write that reached the transport and
      // was refused is a fact about the user's data. The value stays unsettled, so a remount still
      // shows what the user did rather than the older value the port holds.
      //
      // ADR 0016's lock rule is untouched: nothing here rolls the value back or unlocks a widget.
      const error = persistenceError({ messageId: target.messageId }, failure);
      announce(entry, Object.freeze({ status: 'error', error }));
      target.onWidgetError?.(error);
      prune(entry);
      return;
    }

    // A queued successor means there is still unpersisted work; it owns the outcome.
    if (entry.timer !== undefined) return;
    if (entry.unsettled === value) entry.unsettled = undefined;
    announce(entry, IDLE);
    prune(entry);
  }

  function fire(entry: Entry): void {
    if (entry.timer === undefined) return;
    clearTimeout(entry.timer);
    entry.timer = undefined;
    const value = entry.unsettled;
    if (value !== undefined) void send(entry, value);
  }

  return {
    enqueue(target, value, debounceMs) {
      const entry = ensure(target);
      // The latest host's port and error sink: a host that swapped its port mid-session wants the
      // write to land in the new one.
      entry.target = target;
      entry.unsettled = value;
      // `saving` from the moment the value changes rather than from the moment the write leaves:
      // during the debounce window the value is on screen and absent from the store.
      announce(entry, SAVING);
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.timer = setTimeout(() => {
        fire(entry);
      }, debounceMs);
    },
    flush(conversationId, messageId) {
      const entry = entryFor(conversationId, messageId);
      if (entry) fire(entry);
    },
    flushAll() {
      for (const entry of entries.values()) fire(entry);
    },
    unsettled(conversationId, messageId) {
      return entryFor(conversationId, messageId)?.unsettled;
    },
    status(conversationId, messageId) {
      return entryFor(conversationId, messageId)?.save ?? IDLE;
    },
    subscribe(conversationId, messageId, listener) {
      // A listener may arrive before the first write, and needs an entry to hang on. The target is
      // a placeholder until `enqueue` supplies the real one; nothing is sent before that.
      const entry = ensure({
        conversationId,
        messageId,
        persistence: PLACEHOLDER_PORT,
        onWidgetError: undefined,
      });
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
        prune(entry);
      };
    },
  };
}

/** Never called: an entry only sends after `enqueue`, which replaces the target. */
const PLACEHOLDER_PORT: MessagePersistence = Object.freeze({
  getWidgetState: () => Promise.resolve(undefined),
  updateWidgetState: () => Promise.resolve(),
});
