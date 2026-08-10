import type { AfterExpiry, ExpiryRule, Lifecycle } from '../types';
/**
 * `WidgetHostValue` carries no navigation flag, and core knows nothing about routers (ADR 0037),
 * so `{ on: 'navigate' }` arrives through the same `firedEvents` set as every other
 * host-dispatched signal — the extension seam ADR 0018 nominates for exactly this case. The
 * alternative, hard-coding `navigated: false`, would leave a rule that is part of the published
 * vocabulary and dead in the runtime: the silent never-expires failure the ADR exists to prevent.
 */
export declare const NAVIGATE_EVENT = 'nerey:navigate';
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
export declare function useWidgetLifecycle(args: UseWidgetLifecycleArgs): WidgetLifecycleState;
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
export declare function useResetLifecycleOnChange(key: unknown, reset: () => void): void;
//# sourceMappingURL=use-widget-lifecycle.d.ts.map
