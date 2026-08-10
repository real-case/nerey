import type { ExpiryRule, Lifecycle } from '../types';

/**
 * ADR 0018 — lifecycle evaluation is a pure function. No React, no timers, no DOM, so rule
 * precedence and deadline arithmetic are testable as a table rather than through a rendered
 * tree with fake timers.
 *
 * `now` and `mountedAt` are both injected instead of read from `Date.now()`. That is not only
 * for testability: it lets the runtime start a deadline from the widget's *message* timestamp
 * rather than from the instant this tab painted it, which is what makes a widget whose
 * deadline passed while the tab was closed already expired on first paint (ADR 0018).
 */
export type LifecycleSignals = {
  /** Actions performed on this widget, in order. */
  interactions: readonly string[];
  /** Epoch ms when the widget first mounted. */
  mountedAt: number;
  /** Epoch ms "now". Injected so the runtime is testable without fake timers. */
  now: number;
  /** Conversation message count when the widget mounted. */
  messageCountAtMount: number;
  /** Current conversation message count. */
  messageCount: number;
  /** The conversation was navigated away from. */
  navigated: boolean;
  /** Host-dispatched named events that have fired. */
  firedEvents: ReadonlySet<string>;
};

export function ruleHasFired(rule: ExpiryRule, signals: LifecycleSignals): boolean {
  switch (rule.on) {
    case 'interact':
      // An absent `action` means *any* interaction. Widening this to "the last interaction
      // was `action`" would be wrong: expiry is one-way, so a matching action anywhere in the
      // history has already terminated the widget.
      return rule.action === undefined
        ? signals.interactions.length > 0
        : signals.interactions.includes(rule.action);

    case 'timeout':
      // A non-positive or non-finite `ms` is a programming error, not a deadline. Firing
      // immediately surfaces it on the first render; the alternative — treating it as "not
      // yet" — hands the scheduling layer a NaN or Infinity delay, and the widget stays
      // interactive forever with nothing to point at.
      if (!Number.isFinite(rule.ms) || rule.ms <= 0) return true;
      return signals.now - signals.mountedAt >= rule.ms;

    case 'message':
      return signals.messageCount > signals.messageCountAtMount;

    case 'navigate':
      return signals.navigated;

    case 'event':
      return signals.firedEvents.has(rule.name);

    default: {
      // Widening `ExpiryRule` without extending this switch must break the build. An
      // unhandled rule kind would return `false` forever, which reads in the UI as a widget
      // that simply never expires — the exact silent failure ADR 0018 exists to prevent.
      const exhaustive: never = rule;
      return exhaustive;
    }
  }
}

/**
 * The rule that terminated the widget, or `undefined` while it is still live. Rules are OR-ed
 * with no priority (ADR 0018); declaration order is the tiebreak purely so the recorded
 * *reason* for expiry is deterministic.
 */
export function firstFiredRule(lifecycle: Lifecycle, signals: LifecycleSignals): ExpiryRule | undefined {
  return lifecycle.expiry.find((rule) => ruleHasFired(rule, signals));
}

export function isExpired(lifecycle: Lifecycle, signals: LifecycleSignals): boolean {
  return firstFiredRule(lifecycle, signals) !== undefined;
}

/** ms until the earliest pending timeout rule, or undefined if none. Used to schedule a re-render. */
export function msUntilNextTimeout(lifecycle: Lifecycle, signals: LifecycleSignals): number | undefined {
  // Once anything has fired there is nothing left to schedule: expiry is one-way (ADR 0018),
  // so a timer armed now could only re-announce a state the widget is already in.
  if (isExpired(lifecycle, signals)) return undefined;

  let earliest: number | undefined;
  for (const rule of lifecycle.expiry) {
    if (rule.on !== 'timeout') continue;
    // Reaching here implies a usable deadline: `isExpired` was false, and the pathological
    // `ms` values fire immediately, so they can never survive to this loop.
    const remaining = signals.mountedAt + rule.ms - signals.now;
    if (earliest === undefined || remaining < earliest) earliest = remaining;
  }

  // Deliberately unclamped. A caller feeding this to `setTimeout` must clamp to the 32-bit
  // delay limit itself — truncating here would report a deadline that is not the declared
  // one, and callers that are not timers (devtools, tests) want the true figure.
  return earliest;
}

// Frozen because they are shared module-level objects: a consumer who spread-mutated one
// would silently retune expiry for every widget that reuses it.
const NO_RULES: readonly ExpiryRule[] = Object.freeze([]);
const INTERACT_ONCE: readonly ExpiryRule[] = Object.freeze([{ on: 'interact' }]);

/** For a widget that stays interactive for the lifetime of the transcript. */
export const NEVER_EXPIRES: Lifecycle = Object.freeze({
  persist: 'forever',
  expiry: NO_RULES,
  afterExpiry: 'snapshot',
});

/**
 * The right default for anything that sends a message: `snapshot` rather than `hide` because
 * an acted-upon widget is disabled, not removed (ADR 0018 / FR-24).
 */
export const EXPIRE_ON_INTERACT: Lifecycle = Object.freeze({
  persist: 'forever',
  expiry: INTERACT_ONCE,
  afterExpiry: 'snapshot',
});
