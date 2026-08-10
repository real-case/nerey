import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import { asAnyWidget, createWidgetRegistry } from '../registry';
import { createMemoryPersistence } from '../state/memory-persistence';
import type { FallbackRenderer, MessagePersistence, WidgetHostValue, WidgetRegistry } from '../types';
import { confirmationWidget } from '../widgets/confirmation';
import { textWidget } from '../widgets/text';

/**
 * ADR 0037 / FR-37 — core deliberately ships no transport, no model binding and no data layer, so
 * the only way a widget can be built or demonstrated is against something that stands in for all
 * three. That stand-in is this module: it is what makes AC-21 ("renders, interacts and persists in
 * Storybook with no backend and no network") reachable.
 */

const DEFAULT_CONVERSATION_ID = 'mock-conversation';

/**
 * The two built-ins (ADR 0035), so a story that registers nothing still renders plain assistant
 * text and a confirmation.
 *
 * Exported because extending it is the common case: `composeRegistries(mockRegistry, myWidgets)`
 * keeps the text entry, and without the text entry every plain message in the transcript degrades
 * to the fallback (ADR 0009 — `resolveEnvelope` synthesises `text@1.0.0` for messages with no
 * widget, and resolution is an exact match).
 */
export const mockRegistry: WidgetRegistry = createWidgetRegistry([
  asAnyWidget(textWidget),
  asAnyWidget(confirmationWidget),
]);

export type MockHostOptions = {
  registry?: WidgetRegistry;
  conversationId?: string;
  persistence?: MessagePersistence;
  renderFallback?: FallbackRenderer;
  onSend?: (text: string, meta?: Record<string, unknown>) => void;
  messageCount?: number;
  firedEvents?: Iterable<string>;
};

export type SentMessage = { text: string; meta?: Record<string, unknown> };

export type SendRecorder = {
  send: (text: string, meta?: Record<string, unknown>) => void;
  sent: SentMessage[];
  reset(): void;
};

/**
 * Records every message a widget sends, for assertions and for the Storybook actions panel.
 *
 * `send` is a closure over `sent` and never reads `this`, so `onSend={recorder.send}` — the way it
 * is always written — does not silently lose its receiver.
 */
export function createSendRecorder(): SendRecorder {
  const sent: SentMessage[] = [];

  return {
    send(text: string, meta?: Record<string, unknown>): void {
      // `meta` omitted rather than set to `undefined`, so `expect(sent[0]).toEqual({ text })`
      // passes for a widget that sent no meta — the assertion a test actually wants to write.
      sent.push(meta === undefined ? { text } : { text, meta });
    },
    sent,
    reset(): void {
      // Emptied in place, never reassigned. A test that captured `recorder.sent` in a `beforeEach`
      // would otherwise keep asserting against the array `reset()` orphaned, and see nothing.
      sent.length = 0;
    },
  };
}

/**
 * A NUL byte: it cannot appear in an expiry rule's event name, so it can never split one key into
 * two. See `firedEventsKey` below for why the set is keyed on its contents at all.
 */
const EVENT_KEY_SEPARATOR = '\u0000';

/**
 * A ready-to-use host for Storybook, tests and docs examples.
 *
 * Every default here is chosen so that *doing nothing* produces a working transcript, which is the
 * opposite of `DEFAULT_HOST_VALUE`'s job: that value is the no-provider fallback and its persistence
 * is a null port precisely so an unwired production host cannot look like it persists (ADR 0016).
 * A mock host has the opposite failure mode — a demo where the confirmation forgets which button was
 * pressed proves nothing — so persistence defaults to a real in-memory store.
 *
 * The registry is passed through verbatim rather than wrapped in `createDevRegistry`. A mock host
 * that quietly changed resolution behaviour would stop being a faithful stand-in for the consumer's
 * own host, and the difference would only show up as "it worked in Storybook". Wrapping is one
 * explicit call: `registry={createDevRegistry(myWidgets)}`.
 */
export function MockWidgetHost(props: MockHostOptions & { children: ReactNode }): ReactElement {
  const {
    registry,
    conversationId,
    persistence,
    renderFallback,
    onSend,
    messageCount,
    firedEvents,
    children,
  } = props;

  // Lazily created once per mounted host. A store rebuilt on re-render would hand `useWidgetState`
  // a new `persistence` identity every time, which re-runs its load effect and reads back the
  // empty store it just created — a widget that forgets its state whenever anything re-renders.
  const [ownPersistence] = useState(() => createMemoryPersistence());

  // `sendUserMessage` is kept identity-stable while still calling the *latest* `onSend`. Stories
  // and tests pass an inline arrow, and putting it straight into the host value would rebuild that
  // value — and re-render every widget in the transcript — on every parent render (see the note on
  // `WidgetHostProvider` about who owns that identity).
  const onSendRef = useRef(onSend);
  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  const sendUserMessage = useCallback((text: string, meta?: Record<string, unknown>) => {
    onSendRef.current?.(text, meta);
  }, []);

  // Consumed exactly once: `firedEvents` is an `Iterable`, so it may be a generator that a second
  // traversal would find exhausted. The joined key is what the memo compares, because
  // `firedEvents={['checkout-complete']}` written inline is a new array on every render and
  // identity comparison would rebuild the set — and the host value with it — for no change at all.
  const firedEventsKey = firedEvents === undefined ? undefined : [...firedEvents].join(EVENT_KEY_SEPARATOR);

  const value = useMemo<WidgetHostValue>(() => {
    const host: WidgetHostValue = {
      registry: registry ?? mockRegistry,
      conversationId: conversationId ?? DEFAULT_CONVERSATION_ID,
      sendUserMessage,
      persistence: persistence ?? ownPersistence,
      renderFallback: renderFallback ?? DEFAULT_HOST_VALUE.renderFallback,
    };

    // Assigned only when supplied, so an unset option leaves the field genuinely absent and the
    // lifecycle runtime's own defaults (`?? 0`, `?? NO_EVENTS`) apply rather than being shadowed.
    if (messageCount !== undefined) host.messageCount = messageCount;
    if (firedEventsKey !== undefined) {
      // Rebuilt from the key rather than from the captured array, so the memo has exactly one
      // dependency and cannot go stale against a list it did not compare.
      host.firedEvents = new Set(firedEventsKey === '' ? [] : firedEventsKey.split(EVENT_KEY_SEPARATOR));
    }

    return host;
  }, [
    registry,
    conversationId,
    sendUserMessage,
    persistence,
    ownPersistence,
    renderFallback,
    messageCount,
    firedEventsKey,
  ]);

  return <WidgetHostProvider value={value}>{children}</WidgetHostProvider>;
}
