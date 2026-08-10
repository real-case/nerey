import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import type { AfterExpiry, ExpiryRule, Lifecycle, WidgetHostValue } from '../types';
import { EXPIRE_ON_INTERACT, NEVER_EXPIRES } from './expiry';
import {
  NAVIGATE_EVENT,
  useResetLifecycleOnChange,
  useWidgetLifecycle,
  type UseWidgetLifecycleArgs,
  type WidgetLifecycleState,
} from './use-widget-lifecycle';

const START = 1_700_000_000_000;

/** The signed 32-bit ceiling `setTimeout` truncates to; mirrored here rather than exported. */
const MAX_TIMEOUT_DELAY = 2_147_483_647;

function lc(expiry: readonly ExpiryRule[], afterExpiry: AfterExpiry = 'snapshot'): Lifecycle {
  return { persist: 'forever', expiry, afterExpiry };
}

/**
 * `renderHook` gives the wrapper no props, so the host value is read from a closure the helper
 * reassigns before re-rendering. That is the only way to drive `messageCount` and `firedEvents`
 * through a real provider, which is the point: these signals must arrive by context, not by
 * argument.
 */
function renderLifecycle(initialArgs: UseWidgetLifecycleArgs, initialHost: Partial<WidgetHostValue> = {}) {
  let args = initialArgs;
  let host: WidgetHostValue = { ...DEFAULT_HOST_VALUE, ...initialHost };
  let renderCount = 0;

  const view = renderHook(
    (props: UseWidgetLifecycleArgs) => {
      renderCount += 1;
      return useWidgetLifecycle(props);
    },
    {
      initialProps: args,
      wrapper: ({ children }: { children: ReactNode }) => (
        <WidgetHostProvider value={host}>{children}</WidgetHostProvider>
      ),
    },
  );

  return {
    unmount: view.unmount,
    get state(): WidgetLifecycleState {
      return view.result.current;
    },
    get renderCount(): number {
      return renderCount;
    },
    update(next: { args?: Partial<UseWidgetLifecycleArgs>; host?: Partial<WidgetHostValue> } = {}): void {
      if (next.args) args = { ...args, ...next.args };
      if (next.host) host = { ...host, ...next.host };
      view.rerender(args);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a lifecycle that never expires', () => {
  it('stays live under every signal at once', () => {
    const view = renderLifecycle({ lifecycle: NEVER_EXPIRES, messageId: 'm1' }, { messageCount: 3 });

    act(() => {
      view.state.recordInteraction('vote');
    });
    view.update({ host: { messageCount: 99, firedEvents: new Set(['anything', NAVIGATE_EVENT]) } });
    act(() => {
      vi.advanceTimersByTime(10_000_000);
    });

    expect(view.state.expired).toBe(false);
    expect(view.state.readonly).toBe(false);
    expect(view.state.firedRule).toBeUndefined();
  });

  it('arms no timer at all', () => {
    renderLifecycle({ lifecycle: NEVER_EXPIRES, messageId: 'm1' });

    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports afterExpiry verbatim, expired or not', () => {
    for (const afterExpiry of ['snapshot', 'fallback', 'hide'] as const) {
      const view = renderLifecycle({ lifecycle: lc([{ on: 'interact' }], afterExpiry), messageId: 'm1' });

      expect(view.state.afterExpiry).toBe(afterExpiry);
      act(() => {
        view.state.recordInteraction('go');
      });
      expect(view.state.afterExpiry).toBe(afterExpiry);
    }
  });
});

describe('expiry on interaction', () => {
  it('flips readonly after the first interaction of any name (AC-12)', () => {
    const view = renderLifecycle({ lifecycle: EXPIRE_ON_INTERACT, messageId: 'm1' });

    expect(view.state.expired).toBe(false);
    expect(view.state.readonly).toBe(false);

    act(() => {
      view.state.recordInteraction('vote');
    });

    expect(view.state.expired).toBe(true);
    expect(view.state.readonly).toBe(true);
    expect(view.state.firedRule).toEqual({ on: 'interact' });
  });

  it('fires only for the named action, and reports the declared rule object', () => {
    const rule: ExpiryRule = { on: 'interact', action: 'submit' };
    const view = renderLifecycle({ lifecycle: lc([rule]), messageId: 'm1' });

    act(() => {
      view.state.recordInteraction('change');
    });
    expect(view.state.expired).toBe(false);

    act(() => {
      view.state.recordInteraction('focus');
    });
    expect(view.state.expired).toBe(false);

    act(() => {
      view.state.recordInteraction('submit');
    });
    expect(view.state.expired).toBe(true);
    // Identity, not equality: the runtime hands back the rule the entry declared, so a consumer
    // can branch on it without re-matching the union.
    expect(view.state.firedRule).toBe(rule);
  });

  it('stays expired when an unrelated action is recorded afterwards', () => {
    const view = renderLifecycle({ lifecycle: EXPIRE_ON_INTERACT, messageId: 'm1' });

    act(() => {
      view.state.recordInteraction('vote');
    });
    act(() => {
      view.state.recordInteraction('hover');
    });

    expect(view.state.expired).toBe(true);
  });

  it('keeps recordInteraction identity across re-renders and across expiry', () => {
    const view = renderLifecycle({ lifecycle: EXPIRE_ON_INTERACT, messageId: 'm1' }, { messageCount: 1 });
    const first = view.state.recordInteraction;

    view.update({ host: { messageCount: 2 } });
    expect(view.state.recordInteraction).toBe(first);

    act(() => {
      first('vote');
    });
    expect(view.state.recordInteraction).toBe(first);
  });

  it('is idempotent when the same action is recorded twice', () => {
    const view = renderLifecycle({ lifecycle: NEVER_EXPIRES, messageId: 'm1' });

    act(() => {
      view.state.recordInteraction('vote');
    });
    const afterFirst = view.renderCount;
    const stateAfterFirst = view.state;

    act(() => {
      view.state.recordInteraction('vote');
    });
    act(() => {
      view.state.recordInteraction('vote');
    });

    // Identity, because that is what stops the work cascading: an unchanged lifecycle state means
    // unchanged effect dependencies downstream and no re-armed timer. React itself may still run
    // the component once per bailed-out update, which is why the render budget is a ceiling rather
    // than an equality — what must not happen is a growing interactions list behind it.
    expect(view.state).toBe(stateAfterFirst);
    expect(view.renderCount).toBeLessThanOrEqual(afterFirst + 2);
  });

  it('collapses a burst of recordings into one re-render', () => {
    const view = renderLifecycle({ lifecycle: NEVER_EXPIRES, messageId: 'm1' });
    const before = view.renderCount;

    act(() => {
      view.state.recordInteraction('vote');
      view.state.recordInteraction('vote');
      view.state.recordInteraction('vote');
    });

    expect(view.renderCount).toBe(before + 1);
  });
});

describe('expiry on timeout', () => {
  it('does not expire a millisecond early and does expire on the deadline (AC-12)', () => {
    const view = renderLifecycle({ lifecycle: lc([{ on: 'timeout', ms: 30_000 }]), messageId: 'm1' });

    expect(view.state.expired).toBe(false);

    act(() => {
      vi.advanceTimersByTime(29_999);
    });
    expect(view.state.expired).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(view.state.expired).toBe(true);
    expect(view.state.readonly).toBe(true);
    expect(view.state.firedRule).toEqual({ on: 'timeout', ms: 30_000 });
  });

  it('schedules exactly one timer and disarms once it has fired', () => {
    renderLifecycle({ lifecycle: lc([{ on: 'timeout', ms: 30_000 }]), messageId: 'm1' });

    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not re-arm the timer when an unrelated re-render happens', () => {
    const view = renderLifecycle(
      { lifecycle: lc([{ on: 'timeout', ms: 30_000 }]), messageId: 'm1' },
      { messageCount: 1 },
    );

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    // A re-render at t+20s must not restart the countdown; keying the effect on the remaining
    // interval rather than the absolute deadline would push expiry out to t+50s here.
    view.update({ host: { messageCount: 2 } });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(view.state.expired).toBe(true);
  });

  it('re-arms across the 32-bit setTimeout ceiling instead of firing early', () => {
    const ms = MAX_TIMEOUT_DELAY + 1_000_000;
    const view = renderLifecycle({ lifecycle: lc([{ on: 'timeout', ms }]), messageId: 'm1' });

    act(() => {
      vi.advanceTimersByTime(MAX_TIMEOUT_DELAY);
    });
    // The clamped timer woke the hook up without expiring it; a design that armed one timer and
    // stopped would leave the widget interactive forever.
    expect(view.state.expired).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1_000_000);
    });
    expect(view.state.expired).toBe(true);
  });

  it('expires on the first render for a pathological ms, arming nothing', () => {
    const view = renderLifecycle({ lifecycle: lc([{ on: 'timeout', ms: 0 }]), messageId: 'm1' });

    expect(view.state.expired).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('picks the earliest deadline when several timeouts are declared', () => {
    const view = renderLifecycle({
      lifecycle: lc([
        { on: 'timeout', ms: 90_000 },
        { on: 'timeout', ms: 20_000 },
      ]),
      messageId: 'm1',
    });

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(view.state.expired).toBe(true);
    expect(view.state.firedRule).toEqual({ on: 'timeout', ms: 20_000 });
  });
});

describe('expiry on a later message', () => {
  it('takes the mount-time count as the baseline and expires when it grows', () => {
    const view = renderLifecycle(
      { lifecycle: lc([{ on: 'message' }]), messageId: 'm1' },
      { messageCount: 3 },
    );

    expect(view.state.expired).toBe(false);

    view.update({ host: { messageCount: 4 } });

    expect(view.state.expired).toBe(true);
    expect(view.state.readonly).toBe(true);
    expect(view.state.firedRule).toEqual({ on: 'message' });
  });

  it('does not expire when the transcript shrinks', () => {
    const view = renderLifecycle(
      { lifecycle: lc([{ on: 'message' }]), messageId: 'm1' },
      { messageCount: 3 },
    );

    view.update({ host: { messageCount: 2 } });

    expect(view.state.expired).toBe(false);
  });

  it('never fires when the host supplies no count at all', () => {
    // ADR 0018 — a signal the host never delivers simply never fires; it is a wiring defect the
    // conformance kit catches, not something the runtime papers over.
    const view = renderLifecycle({ lifecycle: lc([{ on: 'message' }]), messageId: 'm1' });

    view.update();

    expect(view.state.expired).toBe(false);
  });
});

describe('expiry on a host-dispatched event', () => {
  it('fires on the matching name only', () => {
    const view = renderLifecycle(
      { lifecycle: lc([{ on: 'event', name: 'checkout-complete' }]), messageId: 'm1' },
      { firedEvents: new Set<string>() },
    );

    view.update({ host: { firedEvents: new Set(['cart-cleared']) } });
    expect(view.state.expired).toBe(false);

    view.update({ host: { firedEvents: new Set(['cart-cleared', 'checkout-complete']) } });
    expect(view.state.expired).toBe(true);
    expect(view.state.firedRule).toEqual({ on: 'event', name: 'checkout-complete' });
  });

  it('never fires when the host dispatches nothing', () => {
    const view = renderLifecycle({ lifecycle: lc([{ on: 'event', name: 'closed' }]), messageId: 'm1' });

    view.update();

    expect(view.state.expired).toBe(false);
  });

  it('routes { on: navigate } through the reserved event name', () => {
    const view = renderLifecycle({ lifecycle: lc([{ on: 'navigate' }]), messageId: 'm1' });

    view.update({ host: { firedEvents: new Set(['unrelated']) } });
    expect(view.state.expired).toBe(false);

    view.update({ host: { firedEvents: new Set([NAVIGATE_EVENT]) } });
    expect(view.state.expired).toBe(true);
    expect(view.state.firedRule).toEqual({ on: 'navigate' });
  });

  it('does not let the navigate signal expire a widget listening for a different event', () => {
    const view = renderLifecycle({ lifecycle: lc([{ on: 'event', name: 'closed' }]), messageId: 'm1' });

    view.update({ host: { firedEvents: new Set([NAVIGATE_EVENT]) } });

    expect(view.state.expired).toBe(false);
  });
});

describe('forcedReadonly', () => {
  it('locks the widget without claiming it expired', () => {
    const view = renderLifecycle({
      lifecycle: EXPIRE_ON_INTERACT,
      messageId: 'm1',
      forcedReadonly: true,
    });

    expect(view.state.readonly).toBe(true);
    expect(view.state.expired).toBe(false);
    expect(view.state.firedRule).toBeUndefined();
  });

  it('still evaluates the rules underneath, so the treatment stays selectable', () => {
    const view = renderLifecycle({
      lifecycle: lc([{ on: 'timeout', ms: 5_000 }], 'fallback'),
      messageId: 'm1',
      forcedReadonly: true,
    });

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(view.state.expired).toBe(true);
    expect(view.state.readonly).toBe(true);
    expect(view.state.afterExpiry).toBe('fallback');
  });

  it('releases the lock when the host stops forcing it', () => {
    const view = renderLifecycle({
      lifecycle: NEVER_EXPIRES,
      messageId: 'm1',
      forcedReadonly: true,
    });
    expect(view.state.readonly).toBe(true);

    view.update({ args: { forcedReadonly: false } });

    expect(view.state.readonly).toBe(false);
  });

  it('defaults to false when omitted', () => {
    const view = renderLifecycle({ lifecycle: NEVER_EXPIRES, messageId: 'm1' });

    expect(view.state.readonly).toBe(false);
  });
});

describe('unmount', () => {
  it('clears the pending timer and renders nothing afterwards', () => {
    const view = renderLifecycle({ lifecycle: lc([{ on: 'timeout', ms: 30_000 }]), messageId: 'm1' });
    expect(vi.getTimerCount()).toBe(1);

    const rendersAtUnmount = view.renderCount;
    view.unmount();

    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    // No timer survived, so nothing could have called setState on the dead hook.
    expect(view.renderCount).toBe(rendersAtUnmount);
  });

  it('clears a re-armed timer too', () => {
    const view = renderLifecycle({
      lifecycle: lc([{ on: 'timeout', ms: MAX_TIMEOUT_DELAY + 1_000_000 }]),
      messageId: 'm1',
    });

    act(() => {
      vi.advanceTimersByTime(MAX_TIMEOUT_DELAY);
    });
    expect(vi.getTimerCount()).toBe(1);

    view.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('re-keying on messageId', () => {
  it('drops the previous message’s interactions', () => {
    const view = renderLifecycle({ lifecycle: EXPIRE_ON_INTERACT, messageId: 'm1' });

    act(() => {
      view.state.recordInteraction('vote');
    });
    expect(view.state.expired).toBe(true);

    view.update({ args: { messageId: 'm2' } });

    expect(view.state.expired).toBe(false);
    expect(view.state.readonly).toBe(false);
  });

  it('re-takes the message-count baseline, so a recycled hook does not paint pre-expired', () => {
    const view = renderLifecycle(
      { lifecycle: lc([{ on: 'message' }]), messageId: 'm1' },
      { messageCount: 3 },
    );

    view.update({ host: { messageCount: 4 } });
    expect(view.state.expired).toBe(true);

    view.update({ args: { messageId: 'm2' } });

    expect(view.state.expired).toBe(false);
  });

  it('re-takes the timeout baseline from the moment of the re-key', () => {
    const view = renderLifecycle({ lifecycle: lc([{ on: 'timeout', ms: 30_000 }]), messageId: 'm1' });

    act(() => {
      vi.advanceTimersByTime(25_000);
    });
    view.update({ args: { messageId: 'm2' } });

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(view.state.expired).toBe(false);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(view.state.expired).toBe(true);
  });

  it('leaves an unchanged messageId alone', () => {
    const view = renderLifecycle({ lifecycle: EXPIRE_ON_INTERACT, messageId: 7 });

    act(() => {
      view.state.recordInteraction('vote');
    });
    view.update({ host: { messageCount: 5 } });

    expect(view.state.expired).toBe(true);
  });
});

describe('useResetLifecycleOnChange', () => {
  function renderLatch(initialKey: unknown) {
    return renderHook(
      ({ latchKey }: { latchKey: unknown }) => {
        const [resets, setResets] = useState(0);
        useResetLifecycleOnChange(latchKey, () => {
          setResets((count) => count + 1);
        });
        return resets;
      },
      { initialProps: { latchKey: initialKey } },
    );
  }

  it('does not reset on the first render', () => {
    const { result } = renderLatch('m1');

    expect(result.current).toBe(0);
  });

  it('does not reset while the key is unchanged', () => {
    const { result, rerender } = renderLatch('m1');

    rerender({ latchKey: 'm1' });
    rerender({ latchKey: 'm1' });

    expect(result.current).toBe(0);
  });

  it('resets exactly once per change, with no render loop', () => {
    const { result, rerender } = renderLatch('m1');

    rerender({ latchKey: 'm2' });
    expect(result.current).toBe(1);

    rerender({ latchKey: 'm2' });
    expect(result.current).toBe(1);

    rerender({ latchKey: 'm3' });
    expect(result.current).toBe(2);
  });

  it('compares with Object.is, so NaN does not reset forever', () => {
    // A `!==` comparison would fire on every render here and never latch.
    const { result, rerender } = renderLatch(Number.NaN);

    rerender({ latchKey: Number.NaN });

    expect(result.current).toBe(0);
  });

  it('treats a changed identity as a change even when the value looks equal', () => {
    const { result, rerender } = renderLatch({ id: 'm1' });

    rerender({ latchKey: { id: 'm1' } });

    expect(result.current).toBe(1);
  });

  it('resets on a numeric key change', () => {
    const { result, rerender } = renderLatch(1);

    rerender({ latchKey: 2 });

    expect(result.current).toBe(1);
  });
});
