import { describe, expect, it } from 'vitest';

import type { ExpiryRule, Lifecycle } from '../types';

import {
  EXPIRE_ON_INTERACT,
  NEVER_EXPIRES,
  firstFiredRule,
  isExpired,
  msUntilNextTimeout,
  ruleHasFired,
  type LifecycleSignals,
} from './expiry';

const MOUNTED_AT = 1_700_000_000_000;

function signals(overrides: Partial<LifecycleSignals> = {}): LifecycleSignals {
  return {
    interactions: [],
    mountedAt: MOUNTED_AT,
    now: MOUNTED_AT,
    messageCountAtMount: 3,
    messageCount: 3,
    navigated: false,
    firedEvents: new Set<string>(),
    ...overrides,
  };
}

function lifecycle(expiry: readonly ExpiryRule[]): Lifecycle {
  return { persist: 'forever', expiry, afterExpiry: 'snapshot' };
}

describe('ruleHasFired — interact', () => {
  it('does not fire before any interaction', () => {
    expect(ruleHasFired({ on: 'interact' }, signals())).toBe(false);
  });

  it('fires on any interaction when no action is named', () => {
    expect(ruleHasFired({ on: 'interact' }, signals({ interactions: ['dismiss'] }))).toBe(true);
  });

  it('fires only for the named action', () => {
    const rule: ExpiryRule = { on: 'interact', action: 'submit' };
    expect(ruleHasFired(rule, signals({ interactions: ['change', 'focus'] }))).toBe(false);
    expect(ruleHasFired(rule, signals({ interactions: ['change', 'submit'] }))).toBe(true);
  });

  it('does not fire for a named action against an empty history', () => {
    expect(ruleHasFired({ on: 'interact', action: 'submit' }, signals())).toBe(false);
  });

  it('stays fired for an action buried earlier in the history', () => {
    // Expiry is one-way: a later unrelated action must not un-expire the widget.
    const later = signals({ interactions: ['submit', 'change', 'change'] });
    expect(ruleHasFired({ on: 'interact', action: 'submit' }, later)).toBe(true);
  });
});

describe('ruleHasFired — timeout', () => {
  it('does not fire before the deadline', () => {
    const rule: ExpiryRule = { on: 'timeout', ms: 30_000 };
    expect(ruleHasFired(rule, signals({ now: MOUNTED_AT + 29_999 }))).toBe(false);
  });

  it('fires exactly at the deadline', () => {
    const rule: ExpiryRule = { on: 'timeout', ms: 30_000 };
    expect(ruleHasFired(rule, signals({ now: MOUNTED_AT + 30_000 }))).toBe(true);
  });

  it('fires for a deadline that passed while the tab was closed', () => {
    const rule: ExpiryRule = { on: 'timeout', ms: 30_000 };
    expect(ruleHasFired(rule, signals({ now: MOUNTED_AT + 86_400_000 }))).toBe(true);
  });

  it('does not fire when the clock reads before the mount instant', () => {
    const rule: ExpiryRule = { on: 'timeout', ms: 1_000 };
    expect(ruleHasFired(rule, signals({ now: MOUNTED_AT - 5_000 }))).toBe(false);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('fires immediately for a pathological ms (%s)', (_label, ms) => {
    expect(ruleHasFired({ on: 'timeout', ms }, signals())).toBe(true);
  });
});

describe('ruleHasFired — message', () => {
  it('does not fire while the count is unchanged', () => {
    expect(ruleHasFired({ on: 'message' }, signals())).toBe(false);
  });

  it('fires once a later message arrives', () => {
    expect(ruleHasFired({ on: 'message' }, signals({ messageCount: 4 }))).toBe(true);
  });

  it('does not fire when the count went backwards', () => {
    // A shrinking transcript (a deleted or rolled-back message) is not "a later message".
    expect(ruleHasFired({ on: 'message' }, signals({ messageCount: 2 }))).toBe(false);
  });
});

describe('ruleHasFired — navigate', () => {
  it('does not fire while the conversation is still open', () => {
    expect(ruleHasFired({ on: 'navigate' }, signals())).toBe(false);
  });

  it('fires once the host reports navigation', () => {
    expect(ruleHasFired({ on: 'navigate' }, signals({ navigated: true }))).toBe(true);
  });
});

describe('ruleHasFired — event', () => {
  it('does not fire when no event has been dispatched', () => {
    expect(ruleHasFired({ on: 'event', name: 'checkout-complete' }, signals())).toBe(false);
  });

  it('fires on the matching name', () => {
    const fired = signals({ firedEvents: new Set(['checkout-complete']) });
    expect(ruleHasFired({ on: 'event', name: 'checkout-complete' }, fired)).toBe(true);
  });

  it('ignores a different name', () => {
    const fired = signals({ firedEvents: new Set(['cart-cleared']) });
    expect(ruleHasFired({ on: 'event', name: 'checkout-complete' }, fired)).toBe(false);
  });
});

describe('firstFiredRule', () => {
  it('returns undefined for an empty expiry list', () => {
    expect(firstFiredRule(lifecycle([]), signals({ navigated: true, messageCount: 99 }))).toBeUndefined();
  });

  it('returns undefined while no rule has fired', () => {
    const rules = lifecycle([{ on: 'interact' }, { on: 'timeout', ms: 1_000 }, { on: 'navigate' }]);
    expect(firstFiredRule(rules, signals())).toBeUndefined();
  });

  it('returns the earliest declared rule when several have fired', () => {
    const rules = lifecycle([{ on: 'message' }, { on: 'navigate' }, { on: 'timeout', ms: 1_000 }]);
    const all = signals({ navigated: true, messageCount: 9, now: MOUNTED_AT + 5_000 });
    expect(firstFiredRule(rules, all)).toEqual({ on: 'message' });
  });

  it('skips rules that have not fired to reach one that has', () => {
    const rules = lifecycle([{ on: 'interact' }, { on: 'message' }, { on: 'navigate' }]);
    expect(firstFiredRule(rules, signals({ navigated: true }))).toEqual({ on: 'navigate' });
  });

  it('distinguishes the action-scoped rule from the bare one by declaration order', () => {
    const rules = lifecycle([{ on: 'interact', action: 'submit' }, { on: 'interact' }]);
    expect(firstFiredRule(rules, signals({ interactions: ['change'] }))).toEqual({ on: 'interact' });
  });
});

describe('isExpired', () => {
  it('is false for an empty expiry list regardless of signals', () => {
    const everything = signals({
      interactions: ['submit'],
      navigated: true,
      messageCount: 99,
      now: MOUNTED_AT + 10_000_000,
      firedEvents: new Set(['anything']),
    });
    expect(isExpired(lifecycle([]), everything)).toBe(false);
  });

  it('is true as soon as one rule fires', () => {
    const rules = lifecycle([
      { on: 'timeout', ms: 60_000 },
      { on: 'event', name: 'closed' },
    ]);
    expect(isExpired(rules, signals())).toBe(false);
    expect(isExpired(rules, signals({ firedEvents: new Set(['closed']) }))).toBe(true);
  });
});

describe('msUntilNextTimeout', () => {
  it('returns undefined when there are no rules at all', () => {
    expect(msUntilNextTimeout(lifecycle([]), signals())).toBeUndefined();
  });

  it('returns undefined when no rule is a timeout', () => {
    const rules = lifecycle([{ on: 'interact' }, { on: 'message' }, { on: 'navigate' }]);
    expect(msUntilNextTimeout(rules, signals())).toBeUndefined();
  });

  it('reports the remaining time for a single pending timeout', () => {
    const rules = lifecycle([{ on: 'timeout', ms: 30_000 }]);
    expect(msUntilNextTimeout(rules, signals({ now: MOUNTED_AT + 10_000 }))).toBe(20_000);
  });

  it('picks the earliest deadline, not the first declared', () => {
    const rules = lifecycle([
      { on: 'timeout', ms: 90_000 },
      { on: 'timeout', ms: 20_000 },
      { on: 'timeout', ms: 45_000 },
    ]);
    expect(msUntilNextTimeout(rules, signals())).toBe(20_000);
  });

  it('ignores non-timeout rules while measuring', () => {
    const rules = lifecycle([
      { on: 'interact' },
      { on: 'timeout', ms: 5_000 },
      { on: 'event', name: 'closed' },
    ]);
    expect(msUntilNextTimeout(rules, signals({ now: MOUNTED_AT + 1_000 }))).toBe(4_000);
  });

  it('returns undefined once the earliest timeout has elapsed', () => {
    const rules = lifecycle([
      { on: 'timeout', ms: 20_000 },
      { on: 'timeout', ms: 90_000 },
    ]);
    expect(msUntilNextTimeout(rules, signals({ now: MOUNTED_AT + 20_000 }))).toBeUndefined();
  });

  it('returns undefined when a non-timeout rule has already expired the widget', () => {
    // Nothing to schedule: expiry is one-way, so the later deadline can change nothing.
    const rules = lifecycle([{ on: 'navigate' }, { on: 'timeout', ms: 60_000 }]);
    expect(msUntilNextTimeout(rules, signals({ navigated: true }))).toBeUndefined();
  });

  it('never reports a non-finite delay for a pathological timeout', () => {
    const rules = lifecycle([{ on: 'timeout', ms: Number.POSITIVE_INFINITY }]);
    expect(msUntilNextTimeout(rules, signals())).toBeUndefined();
  });

  it('reports a delay larger than the interval when the clock reads before mount', () => {
    const rules = lifecycle([{ on: 'timeout', ms: 10_000 }]);
    expect(msUntilNextTimeout(rules, signals({ now: MOUNTED_AT - 2_000 }))).toBe(12_000);
  });
});

describe('preset lifecycles', () => {
  it('NEVER_EXPIRES survives every signal', () => {
    const everything = signals({
      interactions: ['submit', 'cancel'],
      navigated: true,
      messageCount: 500,
      now: MOUNTED_AT + 10_000_000,
      firedEvents: new Set(['checkout-complete']),
    });
    expect(NEVER_EXPIRES).toEqual({ persist: 'forever', expiry: [], afterExpiry: 'snapshot' });
    expect(isExpired(NEVER_EXPIRES, everything)).toBe(false);
    expect(msUntilNextTimeout(NEVER_EXPIRES, everything)).toBeUndefined();
  });

  it('EXPIRE_ON_INTERACT expires after the first interaction of any name', () => {
    expect(EXPIRE_ON_INTERACT).toEqual({
      persist: 'forever',
      expiry: [{ on: 'interact' }],
      afterExpiry: 'snapshot',
    });
    expect(isExpired(EXPIRE_ON_INTERACT, signals())).toBe(false);
    expect(isExpired(EXPIRE_ON_INTERACT, signals({ interactions: ['vote'] }))).toBe(true);
  });

  it('exposes the presets frozen, so one consumer cannot retune every widget', () => {
    expect(Object.isFrozen(NEVER_EXPIRES)).toBe(true);
    expect(Object.isFrozen(NEVER_EXPIRES.expiry)).toBe(true);
    expect(Object.isFrozen(EXPIRE_ON_INTERACT)).toBe(true);
    expect(Object.isFrozen(EXPIRE_ON_INTERACT.expiry)).toBe(true);
  });
});
