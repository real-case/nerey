import { useCallback, useEffect, useMemo, useState } from 'react';

import { useWidgetHost } from '../host/host-context';
import type { AfterExpiry, ExpiryRule, Lifecycle } from '../types';
import { firstFiredRule, msUntilNextTimeout } from './expiry';
import type { LifecycleSignals } from './expiry';

/**
 * ADR 0018 — the React layer over the pure evaluator in `./expiry`. It owns the three things the
 * evaluator deliberately does not: where the signals come from, when the widget re-renders
 * because time passed, and the guarantee that a widget's baseline is fixed before its first paint
 * rather than after it.
 */

/** Shared identity, so an untouched widget never hands the evaluator a fresh array per render. */
const NO_INTERACTIONS: readonly string[] = Object.freeze([]);

/** Likewise for a host that dispatches no lifecycle events. */
const NO_EVENTS: ReadonlySet<string> = new Set<string>();

/**
 * `setTimeout` truncates its delay to a signed 32-bit integer and a larger value wraps round to
 * something tiny — a 30-day deadline would fire within milliseconds. Clamping turns that into an
 * early wake-up that re-arms (see `timerTick` below) instead of an expiry at the wrong moment.
 */
const MAX_TIMEOUT_DELAY = 2_147_483_647;

/**
 * `WidgetHostValue` carries no navigation flag, and core knows nothing about routers (ADR 0037),
 * so `{ on: 'navigate' }` arrives through the same `firedEvents` set as every other
 * host-dispatched signal — the extension seam ADR 0018 nominates for exactly this case. The
 * alternative, hard-coding `navigated: false`, would leave a rule that is part of the published
 * vocabulary and dead in the runtime: the silent never-expires failure the ADR exists to prevent.
 */
export const NAVIGATE_EVENT = 'nerey:navigate';

export type WidgetLifecycleState = {
  expired: boolean;
  readonly: boolean;
  afterExpiry: AfterExpiry;
  recordInteraction: (action: string) => void;
  firedRule: ExpiryRule | undefined;
};

export type UseWidgetLifecycleArgs = {
  lifecycle: Lifecycle;
  messageId: string | number;
  /** The host mounted this widget read-only regardless of lifecycle. */
  forcedReadonly?: boolean;
};

/** What expiry is measured against. Fixed at mount; re-taken only when the widget is re-keyed. */
type Baseline = { mountedAt: number; messageCountAtMount: number };

export function useWidgetLifecycle(args: UseWidgetLifecycleArgs): WidgetLifecycleState {
  const { lifecycle, messageId, forcedReadonly = false } = args;

  const host = useWidgetHost();
  const messageCount = host.messageCount ?? 0;
  const firedEvents = host.firedEvents ?? NO_EVENTS;

  const [interactions, setInteractions] = useState<readonly string[]>(NO_INTERACTIONS);

  // ADR 0018 — the baseline is captured on the FIRST RENDER, never from an effect. An effect runs
  // after the first paint; by then the host may already have appended the message that should have
  // expired this widget, `messageCountAtMount` would be recorded as the post-arrival count, and an
  // `{ on: 'message' }` rule would compare a number against itself forever.
  //
  // It lives in a lazy state initialiser rather than in a ref because render reads it: a ref
  // written during render survives a render React discards and retries — StrictMode's double
  // invocation, or any concurrent restart — so the committed tree would carry a `mountedAt` from a
  // render that never happened. State initialisers are re-run for the retry, which is the point.
  const [baseline, setBaseline] = useState<Baseline>(() => ({
    mountedAt: Date.now(),
    messageCountAtMount: messageCount,
  }));

  useResetLifecycleOnChange(messageId, () => {
    setBaseline({ mountedAt: Date.now(), messageCountAtMount: messageCount });
    setInteractions(NO_INTERACTIONS);
  });

  // Bumped by the timer below purely to re-run this hook against a later clock. The number itself
  // means nothing; it is read only as an effect dependency, so a clamped deadline can re-arm.
  const [timerTick, setTimerTick] = useState(0);

  const signals: LifecycleSignals = {
    interactions,
    mountedAt: baseline.mountedAt,
    // Read during render, deliberately, and the one place this hook is impure. Expiry is a
    // question about the wall clock: answering it from an effect would paint an already-dead
    // widget as live once, which is exactly the reload case ADR 0018 calls out — the deadline
    // passed while the tab was closed. Seeding `now` once and advancing it only from the timer
    // below was the lint-clean alternative and is wrong for a backgrounded tab, where the timer is
    // throttled and every re-render until it fires would report a widget that is not live as live.
    // The rule's objection — a value that changes when the component happens to re-render — is the
    // intended semantics of a deadline.
    // eslint-disable-next-line react-hooks/purity -- ADR 0018: the clock is the authority here.
    now: Date.now(),
    messageCountAtMount: baseline.messageCountAtMount,
    messageCount,
    navigated: firedEvents.has(NAVIGATE_EVENT),
    firedEvents,
  };

  const firedRule = firstFiredRule(lifecycle, signals);
  const remaining = msUntilNextTimeout(lifecycle, signals);
  // An absolute deadline, not the remaining interval, because it is what the timer effect keys on.
  // `remaining` shrinks on every render, so keying on it would re-arm the timer whenever anything
  // else re-rendered the widget — and each re-arm restarts the countdown from a later instant,
  // which for a widget in an active conversation means a deadline that never arrives.
  const deadlineAt = remaining === undefined ? undefined : signals.now + remaining;

  useEffect(() => {
    if (deadlineAt === undefined) return;

    // Measured against the clock rather than reusing `remaining`: this runs after commit, and the
    // render-to-commit gap is real time the widget has already spent.
    const delay = Math.min(Math.max(deadlineAt - Date.now(), 0), MAX_TIMEOUT_DELAY);
    const timer = setTimeout(() => {
      setTimerTick((tick) => tick + 1);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
    // `timerTick` is a dependency so a clamped deadline gets a successor timer: that wake-up
    // expires nothing, leaves `deadlineAt` unchanged, and would otherwise be the last one armed.
  }, [deadlineAt, timerTick]);

  const recordInteraction = useCallback((action: string) => {
    setInteractions((previous) => {
      // Deduplicated. The evaluator only asks membership questions of this list (ADR 0018), so a
      // repeat says nothing new — but appending it would produce a new array, a re-render, and a
      // fresh signals object. Returning the same reference makes React bail out instead, which is
      // what "recording the same action twice must not schedule work twice" actually requires.
      if (previous.includes(action)) return previous;
      return [...previous, action];
    });
  }, []);

  const expired = firedRule !== undefined;
  // `forcedReadonly` widens the lock and deliberately does not short-circuit evaluation. A
  // rehydrated widget is mounted read-only and still has to report *why* it is terminal, because
  // `firedRule` and `afterExpiry` are what select the treatment the renderer applies.
  const readonly = forcedReadonly || expired;

  return useMemo(
    () => ({ expired, readonly, afterExpiry: lifecycle.afterExpiry, recordInteraction, firedRule }),
    [expired, readonly, lifecycle.afterExpiry, recordInteraction, firedRule],
  );
}

/**
 * Reset a widget's lifecycle bookkeeping — used when a persisted widget is rehydrated read-only.
 *
 * Runs `reset` when `key` changes, and never on the first render. The call happens *during* render
 * rather than from an effect — React's documented way to adjust state when a prop changes — which
 * constrains `reset` to updating state owned by the calling component. React discards the render
 * that requested the reset and immediately re-runs it, so the new bookkeeping is what paints.
 *
 * An effect would be one paint too late in a way that matters here. Recycling a hook instance onto
 * a different `messageId` — a keyless list, a re-ordered transcript — would otherwise render the
 * new message once carrying the previous one's interactions and mount instant, so a fresh widget
 * could paint already expired. That is the same stale-baseline failure ADR 0018 rules out for the
 * mount capture, arriving through reconciliation rather than through an effect.
 */
export function useResetLifecycleOnChange(key: unknown, reset: () => void): void {
  const [previousKey, setPreviousKey] = useState<unknown>(key);

  if (!Object.is(previousKey, key)) {
    // Latched before `reset` runs. `reset` sets state and React re-renders immediately; a latch
    // still holding the old key would compare unequal again, which is an infinite render loop
    // rather than a one-off adjustment.
    setPreviousKey(key);
    reset();
  }
}
