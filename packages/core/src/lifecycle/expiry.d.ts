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
export declare function ruleHasFired(rule: ExpiryRule, signals: LifecycleSignals): boolean;
/**
 * The rule that terminated the widget, or `undefined` while it is still live. Rules are OR-ed
 * with no priority (ADR 0018); declaration order is the tiebreak purely so the recorded
 * *reason* for expiry is deterministic.
 */
export declare function firstFiredRule(
  lifecycle: Lifecycle,
  signals: LifecycleSignals,
): ExpiryRule | undefined;
export declare function isExpired(lifecycle: Lifecycle, signals: LifecycleSignals): boolean;
/** ms until the earliest pending timeout rule, or undefined if none. Used to schedule a re-render. */
export declare function msUntilNextTimeout(
  lifecycle: Lifecycle,
  signals: LifecycleSignals,
): number | undefined;
/** For a widget that stays interactive for the lifetime of the transcript. */
export declare const NEVER_EXPIRES: Lifecycle;
/**
 * The right default for anything that sends a message: `snapshot` rather than `hide` because
 * an acted-upon widget is disabled, not removed (ADR 0018 / FR-24).
 */
export declare const EXPIRE_ON_INTERACT: Lifecycle;
//# sourceMappingURL=expiry.d.ts.map
