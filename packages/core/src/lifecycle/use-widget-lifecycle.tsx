import { useCallback, useEffect, useMemo, useState } from 'react';

import { persistenceError } from '../errors';
import { useWidgetHost } from '../host/host-context';
import type { AfterExpiry, ExpiryRule, Lifecycle, LifecycleRecord, MessagePersistence } from '../types';
import { firstFiredRule, msUntilNextTimeout } from './expiry';
import type { LifecycleSignals } from './expiry';

/**
 * ADR 0018 / 0046 / 0047 — the React layer over the pure evaluator in `./expiry`. It owns what the
 * evaluator deliberately does not: where the signals come from, when the widget re-renders because
 * time passed, and the expiry marker — read before the widget may be pressed, written once when a
 * rule fires.
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

/**
 * Where markers live when the port cannot hold them: `persist: 'ephemeral'`, or a port without the
 * optional lifecycle methods (ADR 0047). Keyed by the port object, so two hosts in one page never
 * see each other's markers, and garbage-collected with it. Session-scoped by construction: a reload
 * starts empty, which is the documented cost of an ephemeral widget.
 */
const SESSION_MARKERS = new WeakMap<MessagePersistence, Map<string, LifecycleRecord>>();

function sessionMarkers(persistence: MessagePersistence): Map<string, LifecycleRecord> {
  let markers = SESSION_MARKERS.get(persistence);
  if (!markers) {
    markers = new Map();
    SESSION_MARKERS.set(persistence, markers);
  }
  return markers;
}

/**
 * What is known about the stored marker. `pending` and `failed` both mean "not known", and both
 * keep an action-bearing widget read-only: a late enable costs a moment, an early one can cost a
 * duplicate reply (ADR 0046).
 */
type Stored = LifecycleRecord | 'none' | 'pending' | 'failed';

function isRecord(stored: Stored): stored is LifecycleRecord {
  return typeof stored === 'object';
}

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
  /** The message's creation time, epoch ms — the anchor for `timeout` (ADR 0046). */
  createdAt: number;
  /** A marker the host already holds, from `NereyWidgetEnvelope.expiry`. Authoritative when set. */
  expiry?: LifecycleRecord;
  /** The host mounted this widget read-only regardless of lifecycle. */
  forcedReadonly?: boolean;
  /** Identifies the widget in a `PersistenceError` if reading or writing the marker fails. */
  widgetType?: string;
  widgetVersion?: string;
};

/** What `{ on: 'message' }` is measured against. Fixed at mount; re-taken when the widget is re-keyed. */
type Baseline = { messageCountAtMount: number };

export function useWidgetLifecycle(args: UseWidgetLifecycleArgs): WidgetLifecycleState {
  const { lifecycle, messageId, createdAt, expiry: handedOver, forcedReadonly = false } = args;
  const { widgetType, widgetVersion } = args;

  const host = useWidgetHost();
  const { conversationId, persistence, onWidgetError } = host;
  const clock = host.now ?? Date.now;
  const messageCount = host.messageCount ?? 0;
  const firedEvents = host.firedEvents ?? NO_EVENTS;

  // Only a rule a person can trigger needs the marker before the widget may be pressed. `timeout`
  // is recomputed from `createdAt` and the clock on every render, so it never waits for a read.
  const actionBearing = lifecycle.expiry.some((rule) => rule.on !== 'timeout');
  const durable =
    lifecycle.persist === 'forever' &&
    typeof persistence.getLifecycleRecord === 'function' &&
    typeof persistence.updateLifecycleRecord === 'function';
  const markerKey = `${conversationId}:${String(messageId)}`;

  const initialStored = (): Stored => {
    const remembered = sessionMarkers(persistence).get(markerKey);
    if (remembered) return remembered;
    return durable && actionBearing ? 'pending' : 'none';
  };

  const [interactions, setInteractions] = useState<readonly string[]>(NO_INTERACTIONS);
  const [stored, setStored] = useState<Stored>(initialStored);

  // ADR 0018 — the message-count baseline is captured on the FIRST RENDER, never from an effect.
  // An effect runs after the first paint; by then the host may already have appended the message
  // that should have expired this widget, and an `{ on: 'message' }` rule would compare a number
  // against itself forever. A lazy state initialiser rather than a ref, because a ref written
  // during a render React discards (StrictMode, a concurrent restart) would survive the discard.
  const [baseline, setBaseline] = useState<Baseline>(() => ({ messageCountAtMount: messageCount }));

  useResetLifecycleOnChange(markerKey, () => {
    setBaseline({ messageCountAtMount: messageCount });
    setInteractions(NO_INTERACTIONS);
    setStored(initialStored());
  });

  // The read (ADR 0046 / 0047). Skipped when the host handed the marker over with the envelope —
  // that path exists so a server render and the first client frame need no read at all.
  const mustRead = stored === 'pending' && handedOver === undefined;
  useEffect(() => {
    if (!mustRead || !persistence.getLifecycleRecord) return;
    let live = true;
    persistence.getLifecycleRecord(conversationId, messageId).then(
      (record) => {
        if (!live) return;
        if (record) sessionMarkers(persistence).set(markerKey, record);
        setStored(record ?? 'none');
      },
      (cause: unknown) => {
        if (!live) return;
        // Fail-closed: the marker's state is unknown, so the widget stays read-only. Reported,
        // because a widget that silently never becomes interactive is a bug nobody can find.
        setStored('failed');
        onWidgetError?.(persistenceError({ messageId, widgetType, widgetVersion }, cause));
      },
    );
    return () => {
      live = false;
    };
  }, [mustRead, persistence, conversationId, messageId, markerKey, onWidgetError, widgetType, widgetVersion]);

  // Bumped by the timer below purely to re-run this hook against a later clock. The number itself
  // means nothing; it is read only as an effect dependency, so a clamped deadline can re-arm.
  const [timerTick, setTimerTick] = useState(0);

  const signals: LifecycleSignals = {
    interactions,
    createdAt,
    // Read during render, deliberately: expiry is a question about the clock, and answering it
    // from an effect would paint an already-dead widget as live once — the reload case ADR 0018
    // calls out. The clock is injected (ADR 0046), so a story, a test, a server render and the
    // hydrating client can all agree on the instant they evaluate.
    now: clock(),
    messageCountAtMount: baseline.messageCountAtMount,
    messageCount,
    navigated: firedEvents.has(NAVIGATE_EVENT),
    firedEvents,
  };

  // The session store is read on every render, not only at mount: the write below puts the marker
  // there without setting state, and the next render — whatever causes it — must see it, so a
  // re-run of the write effect finds a record and writes nothing.
  const record =
    handedOver ?? (isRecord(stored) ? stored : undefined) ?? sessionMarkers(persistence).get(markerKey);
  const liveRule = firstFiredRule(lifecycle, signals);
  // A stored marker wins over live evaluation: it is the reason recorded when the widget actually
  // expired, and `afterExpiry` must replay the same terminal state on every reload.
  const firedRule = record?.reason ?? liveRule;
  const remaining = record ? undefined : msUntilNextTimeout(lifecycle, signals);
  // An absolute deadline, not the remaining interval, because it is what the timer effect keys on.
  // `remaining` shrinks on every render, so keying on it would re-arm the timer whenever anything
  // else re-rendered the widget.
  const deadlineAt = remaining === undefined ? undefined : signals.now + remaining;

  useEffect(() => {
    if (deadlineAt === undefined) return;

    // Measured against the clock rather than reusing `remaining`: this runs after commit, and the
    // render-to-commit gap is real time the widget has already spent.
    const delay = Math.min(Math.max(deadlineAt - clock(), 0), MAX_TIMEOUT_DELAY);
    const timer = setTimeout(() => {
      setTimerTick((tick) => tick + 1);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
    // `timerTick` is a dependency so a clamped deadline gets a successor timer: that wake-up
    // expires nothing, leaves `deadlineAt` unchanged, and would otherwise be the last one armed.
  }, [deadlineAt, timerTick, clock]);

  // The write (ADR 0018 / 0047). Once, when a rule fires and no marker exists yet — never while the
  // read is pending, so a marker written on another device is not overwritten by a guess, and
  // never for a widget replaying a stored marker, so a `snapshot` reload fires no effect.
  const toWrite =
    liveRule !== undefined && record === undefined && stored !== 'pending' ? liveRule : undefined;
  useEffect(() => {
    if (toWrite === undefined) return;
    const marker: LifecycleRecord = { expiredAt: clock(), reason: toWrite };
    // No `setStored`: `liveRule` already reports the same rule this render, so nothing on screen
    // changes, and the session store is what the next render reads the record from.
    sessionMarkers(persistence).set(markerKey, marker);
    if (durable && persistence.updateLifecycleRecord) {
      persistence.updateLifecycleRecord(conversationId, messageId, marker).catch((cause: unknown) => {
        // The widget stays expired: the marker is already in this session's memory, and the
        // reply that expired it is already in the transcript (ADR 0016's lock rule, unchanged).
        onWidgetError?.(persistenceError({ messageId, widgetType, widgetVersion }, cause));
      });
    }
  }, [
    toWrite,
    clock,
    persistence,
    markerKey,
    durable,
    conversationId,
    messageId,
    onWidgetError,
    widgetType,
    widgetVersion,
  ]);

  const recordInteraction = useCallback((action: string) => {
    setInteractions((previous) => {
      // Deduplicated. The evaluator only asks membership questions of this list (ADR 0018), so a
      // repeat says nothing new — but appending it would produce a new array, a re-render, and a
      // fresh signals object. Returning the same reference makes React bail out instead.
      if (previous.includes(action)) return previous;
      return [...previous, action];
    });
  }, []);

  const expired = firedRule !== undefined;
  // Unknown is not live. Until the marker read settles, an action-bearing widget is read-only
  // without being expired: `data-state` is untouched and no `afterExpiry` treatment applies.
  const unknown = record === undefined && !durableKnown(stored, handedOver);
  // `forcedReadonly` widens the lock and deliberately does not short-circuit evaluation. A
  // rehydrated widget is mounted read-only and still has to report *why* it is terminal, because
  // `firedRule` and `afterExpiry` are what select the treatment the renderer applies.
  const readonly = forcedReadonly || expired || unknown;

  return useMemo(
    () => ({ expired, readonly, afterExpiry: lifecycle.afterExpiry, recordInteraction, firedRule }),
    [expired, readonly, lifecycle.afterExpiry, recordInteraction, firedRule],
  );
}

function durableKnown(stored: Stored, handedOver: LifecycleRecord | undefined): boolean {
  return handedOver !== undefined || (stored !== 'pending' && stored !== 'failed');
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
