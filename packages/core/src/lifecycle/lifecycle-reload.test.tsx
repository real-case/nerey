import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import { WidgetRoot } from '../primitives/widget-root';
import { asAnyWidget, createWidgetRegistry, defineWidget } from '../registry';
import { WidgetRenderer } from '../render/widget-renderer';
import type {
  Lifecycle,
  LifecycleRecord,
  MessagePersistence,
  NereyMessage,
  WidgetComponentProps,
  WidgetHostValue,
  WidgetStateRecord,
} from '../types';

/**
 * ADR 0046 / 0047 — the reload case ADR 0018 was written against, end to end through the renderer.
 *
 * The widget below has **no lock of its own**: it never reads its state to decide whether it may be
 * pressed, only `readonly`. The built-in poll derives `locked` from its persisted answer and so looks
 * correct whether or not core keeps its promise. This one only looks correct if core does.
 */

const CREATED_AT = Date.UTC(2026, 0, 1);

function Lockless(props: WidgetComponentProps<{ label: string }, unknown>): ReactElement {
  return (
    <WidgetRoot
      type="lockless"
      version="1.0.0"
      slot="message"
      status={props.status}
      readonly={props.readonly}
    >
      <button
        type="button"
        disabled={props.readonly}
        onClick={() => {
          props.onInteraction('go', { text: 'Go ahead' });
        }}
      >
        {props.payload.label}
      </button>
    </WidgetRoot>
  );
}

function entry(lifecycle: Lifecycle) {
  return asAnyWidget(
    defineWidget<{ label: string }, unknown>({
      type: 'lockless',
      version: '1.0.0',
      component: Lockless,
      placement: { slot: 'message' },
      lifecycle,
    }),
  );
}

const ON_INTERACT: Lifecycle = { persist: 'forever', expiry: [{ on: 'interact' }], afterExpiry: 'snapshot' };
const ON_TIMEOUT: Lifecycle = {
  persist: 'forever',
  expiry: [{ on: 'timeout', ms: 60_000 }],
  afterExpiry: 'snapshot',
};

const MESSAGE: NereyMessage = {
  id: 'm1',
  role: 'assistant',
  createdAt: CREATED_AT,
  text: 'Shall I go ahead?',
  widget: { type: 'lockless', version: '1.0.0', payload: { label: 'Go' } },
};

/**
 * A backend that outlives the page. Each `connect()` is one page load: a new port object, so the
 * session-scoped marker cache core keeps per port starts empty, exactly as it does after a reload.
 */
function backend() {
  const markers = new Map<string, LifecycleRecord>();
  const states = new Map<string, WidgetStateRecord>();
  const calls = { getLifecycleRecord: 0, updateLifecycleRecord: 0, updateWidgetState: 0 };

  function connect(options: { readHangs?: boolean; readFails?: boolean } = {}): MessagePersistence {
    return {
      getWidgetState: (c, m) => Promise.resolve(states.get(`${c}:${m}`)),
      updateWidgetState: (c, m, record) => {
        calls.updateWidgetState += 1;
        states.set(`${c}:${m}`, record);
        return Promise.resolve();
      },
      getLifecycleRecord: (c, m) => {
        calls.getLifecycleRecord += 1;
        if (options.readHangs) return new Promise<never>(() => {});
        if (options.readFails) return Promise.reject(new Error('store offline'));
        return Promise.resolve(markers.get(`${c}:${m}`));
      },
      updateLifecycleRecord: (c, m, record) => {
        calls.updateLifecycleRecord += 1;
        markers.set(`${c}:${m}`, record);
        return Promise.resolve();
      },
    };
  }

  return { connect, markers, calls };
}

function mount(
  lifecycle: Lifecycle,
  persistence: MessagePersistence,
  overrides: Partial<WidgetHostValue> = {},
) {
  const sendUserMessage = vi.fn<WidgetHostValue['sendUserMessage']>();
  const onWidgetError = vi.fn<NonNullable<WidgetHostValue['onWidgetError']>>();
  const host: WidgetHostValue = {
    ...DEFAULT_HOST_VALUE,
    registry: createWidgetRegistry([entry(lifecycle)]),
    conversationId: 'c1',
    persistence,
    sendUserMessage,
    onWidgetError,
    ...overrides,
  };
  const view = render(
    <WidgetHostProvider value={host}>
      <WidgetRenderer message={MESSAGE} />
    </WidgetHostProvider>,
  );
  return { ...view, sendUserMessage, onWidgetError };
}

/** Lets the port's resolved promises settle and React commit what they set. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

const button = (): HTMLButtonElement => screen.getByRole('button', { name: 'Go' });

afterEach(() => {
  vi.useRealTimers();
});

describe('an interact widget with no lock of its own', () => {
  it('writes the marker once when the rule fires', async () => {
    const store = backend();
    const first = mount(ON_INTERACT, store.connect());
    await settle();
    expect(button().disabled).toBe(false);

    await userEvent.click(button());
    await settle();

    expect(first.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(store.calls.updateLifecycleRecord).toBe(1);
    expect(store.markers.get('c1:m1')?.reason).toEqual({ on: 'interact' });
    expect(button().disabled).toBe(true);
  });

  it('is read-only after a reload when the port returns a marker', async () => {
    const store = backend();
    const first = mount(ON_INTERACT, store.connect());
    await settle();
    await userEvent.click(button());
    await settle();
    first.unmount();

    const reloaded = mount(ON_INTERACT, store.connect());
    await settle();

    expect(store.calls.getLifecycleRecord).toBe(2);
    expect(button().disabled).toBe(true);
    expect(reloaded.container.querySelector('[data-nerey-widget]')?.hasAttribute('data-readonly')).toBe(true);
  });

  it('makes no call at all on a snapshot remount', async () => {
    const store = backend();
    const first = mount(ON_INTERACT, store.connect());
    await settle();
    await userEvent.click(button());
    await settle();
    first.unmount();
    const writesBefore = { ...store.calls };

    const reloaded = mount(ON_INTERACT, store.connect());
    await settle();
    await userEvent.click(button());
    await settle();

    expect(reloaded.sendUserMessage).not.toHaveBeenCalled();
    expect(store.calls.updateLifecycleRecord).toBe(writesBefore.updateLifecycleRecord);
    expect(store.calls.updateWidgetState).toBe(writesBefore.updateWidgetState);
  });

  it('stays read-only while the marker read is pending', async () => {
    const store = backend();
    const view = mount(ON_INTERACT, store.connect({ readHangs: true }));
    await settle();

    expect(button().disabled).toBe(true);
    await userEvent.click(button());
    expect(view.sendUserMessage).not.toHaveBeenCalled();
  });

  it('fails closed and reports when the marker read rejects', async () => {
    const store = backend();
    const view = mount(ON_INTERACT, store.connect({ readFails: true }));
    await settle();

    expect(button().disabled).toBe(true);
    expect(view.onWidgetError).toHaveBeenCalledTimes(1);
    expect(view.onWidgetError.mock.calls[0]?.[0]).toMatchObject({ code: 'persistence', messageId: 'm1' });
  });

  it('uses a marker handed over on the envelope without reading the port', async () => {
    const store = backend();
    const handedOver: NereyMessage = {
      ...MESSAGE,
      widget: { ...MESSAGE.widget!, expiry: { expiredAt: CREATED_AT + 1, reason: { on: 'interact' } } },
    };
    const host: WidgetHostValue = {
      ...DEFAULT_HOST_VALUE,
      registry: createWidgetRegistry([entry(ON_INTERACT)]),
      conversationId: 'c1',
      persistence: store.connect(),
    };
    render(
      <WidgetHostProvider value={host}>
        <WidgetRenderer message={handedOver} />
      </WidgetHostProvider>,
    );

    expect(button().disabled).toBe(true);
    await settle();
    expect(store.calls.getLifecycleRecord).toBe(0);
  });
});

describe('a timeout widget', () => {
  it('renders expired on the first frame when its deadline passed before the reload', () => {
    const store = backend();
    // The host's clock says the page loaded two minutes after the message was created; the rule is
    // one minute. Measured from mount, this widget would be live for another minute.
    mount(ON_TIMEOUT, store.connect({ readHangs: true }), { now: () => CREATED_AT + 120_000 });

    expect(button().disabled).toBe(true);
  });

  it('is live before its deadline and never waits on the marker read', () => {
    const store = backend();
    mount(ON_TIMEOUT, store.connect({ readHangs: true }), { now: () => CREATED_AT + 59_999 });

    expect(button().disabled).toBe(false);
  });
});
