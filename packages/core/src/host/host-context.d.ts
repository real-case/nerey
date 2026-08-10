import type { ReactElement, ReactNode } from 'react';
import type { WidgetHostValue } from '../types';
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
export declare const DEFAULT_HOST_VALUE: WidgetHostValue;
export declare function WidgetHostProvider(props: {
  value: WidgetHostValue;
  children: ReactNode;
}): ReactElement;
export declare function useWidgetHost(): WidgetHostValue;
export declare function useConversationId(): string;
//# sourceMappingURL=host-context.d.ts.map
