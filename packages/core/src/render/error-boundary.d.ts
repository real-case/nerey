import { Component } from 'react';
import type { ReactNode } from 'react';
export type WidgetErrorBoundaryProps = {
  onError: (cause: unknown) => void;
  fallback: ReactNode;
  /** Changing this resets the boundary — a new message id must get a fresh attempt. */
  resetKey?: unknown;
  children: ReactNode;
};
type WidgetErrorBoundaryState = {
  failedFor: unknown;
  hasError: boolean;
};
/**
 * Step 3 of the degradation chain (ADR 0012): one boundary per widget instance, so a widget that
 * throws costs the transcript that widget and nothing else. A boundary shared across the message
 * list would unmount its whole subtree — every neighbouring widget — which is the blast radius
 * the chain exists to prevent.
 *
 * A class component is unavoidable: React exposes no hook that catches a render throw. ADR 0012
 * records this as a permanent, contained exception in an otherwise function-component package.
 */
export declare class WidgetErrorBoundary extends Component<
  WidgetErrorBoundaryProps,
  WidgetErrorBoundaryState
> {
  constructor(props: WidgetErrorBoundaryProps);
  static getDerivedStateFromError(): Partial<WidgetErrorBoundaryState>;
  /**
   * React applies this on EVERY render, including the one that immediately follows
   * `getDerivedStateFromError`. That ordering is the whole reason the state records which key it
   * failed for: a reset condition phrased against anything else — a sentinel, a mounted flag —
   * clears `hasError` on that very next render, puts the throwing child straight back on screen,
   * and loops until the stack overflows.
   */
  static getDerivedStateFromProps(
    props: WidgetErrorBoundaryProps,
    state: WidgetErrorBoundaryState,
  ): Partial<WidgetErrorBoundaryState> | null;
  /**
   * `cause` is typed `unknown` and not `Error` because React hands over whatever was thrown, and
   * a widget may well throw a string. The base signature is method syntax, so the wider parameter
   * is still assignable, and the error constructors downstream already narrow (ADR 0013).
   */
  componentDidCatch(cause: unknown): void;
  render(): ReactNode;
}
export {};
//# sourceMappingURL=error-boundary.d.ts.map
