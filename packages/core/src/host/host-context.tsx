import { createContext, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { emptyRegistry } from '../registry';
import type { MessagePersistence, WidgetHostValue } from '../types';

/**
 * ADR 0016 — the default port is a *null* port, not an in-memory store. An in-memory default
 * would make an unwired host look like it persists: state survives the session, the reload
 * that would have exposed the missing wiring never happens in development, and the bug ships.
 * Reads resolve `undefined` and writes resolve successfully, which is honest — nothing was
 * stored and nothing pretended otherwise. `createInMemoryPersistence()` from `@nerey/core/mock`
 * is the opt-in when a demo genuinely wants state to stick.
 */
const NULL_PERSISTENCE: MessagePersistence = Object.freeze({
  getWidgetState: () => Promise.resolve(undefined),
  updateWidgetState: () => Promise.resolve(),
});

/**
 * ADR 0014 / FR-16 — `useWidgetHost()` must return a usable value with no provider mounted, so
 * a widget renders in a unit test or a story without a wrapper. That is only true if the
 * default is complete: every field present, every function callable, nothing throwing.
 *
 * Frozen and module-level on purpose. Constructing it per render would give every consumer a
 * fresh `persistence` and `renderFallback` identity on every render, which is exactly the
 * dependency-array churn that turns a provider-less widget's effects into an infinite loop.
 * Freezing means a widget that mutates the shared default fails loudly at the mutation instead
 * of silently poisoning every other test in the file.
 */
export const DEFAULT_HOST_VALUE: WidgetHostValue = Object.freeze({
  registry: emptyRegistry,
  conversationId: '',
  sendUserMessage: () => {},
  persistence: NULL_PERSISTENCE,
  // The last link of the degradation chain (ADR 0012). Core ships no markdown renderer, so the
  // default is the identity: plain text is always readable, which is the whole guarantee.
  renderFallback: (text: string) => text,
});

const WidgetHostContext = createContext<WidgetHostValue>(DEFAULT_HOST_VALUE);
WidgetHostContext.displayName = 'NereyWidgetHost';

export function WidgetHostProvider(props: { value: WidgetHostValue; children: ReactNode }): ReactElement {
  // `value` is passed straight through — deliberately NOT wrapped in `useMemo`. The caller owns
  // this object's identity: if they rebuild it every render, every widget in the transcript
  // re-renders, and that is their bug to see and fix. Memoising it here would hide the symptom
  // while leaving the cause, and would additionally lie about staleness — a memo keyed on the
  // fields we happened to think of drops updates to the ones we did not.
  return <WidgetHostContext value={props.value}>{props.children}</WidgetHostContext>;
}

export function useWidgetHost(): WidgetHostValue {
  return useContext(WidgetHostContext);
}

export function useConversationId(): string {
  return useContext(WidgetHostContext).conversationId;
}
