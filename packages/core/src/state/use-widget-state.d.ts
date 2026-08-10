import { type NereyError } from '../errors';
import type { WidgetStateRecord } from '../types';
export type WidgetStateStatus = 'idle' | 'saving' | 'error';
export type UseWidgetStateResult<S> = {
  state: S;
  /** Optimistic: applies immediately, persists debounced. */
  setState: (next: S | ((previous: S) => S)) => void;
  status: WidgetStateStatus;
  error: NereyError | undefined;
};
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
export declare function useWidgetState<S extends WidgetStateRecord>(
  messageId: string | number,
  initial: S,
  options?: {
    debounceMs?: number;
  },
): UseWidgetStateResult<S>;
//# sourceMappingURL=use-widget-state.d.ts.map
