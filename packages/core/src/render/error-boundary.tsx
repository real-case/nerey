import { Component } from 'react';
import type { ReactNode } from 'react';

export type WidgetErrorBoundaryProps = {
  onError: (cause: unknown) => void;
  fallback: ReactNode;
  /** Changing this resets the boundary — a new message id must get a fresh attempt. */
  resetKey?: unknown;
  children: ReactNode;
};

type WidgetErrorBoundaryState = { failedFor: unknown; hasError: boolean };

/**
 * Step 3 of the degradation chain (ADR 0012): one boundary per widget instance, so a widget that
 * throws costs the transcript that widget and nothing else. A boundary shared across the message
 * list would unmount its whole subtree — every neighbouring widget — which is the blast radius
 * the chain exists to prevent.
 *
 * A class component is unavoidable: React exposes no hook that catches a render throw. ADR 0012
 * records this as a permanent, contained exception in an otherwise function-component package.
 */
export class WidgetErrorBoundary extends Component<WidgetErrorBoundaryProps, WidgetErrorBoundaryState> {
  constructor(props: WidgetErrorBoundaryProps) {
    super(props);
    // `failedFor` starts at the current key rather than at a sentinel, so the first render is
    // already in sync and cannot be mistaken for a key change by the check below.
    this.state = { failedFor: props.resetKey, hasError: false };
  }

  static getDerivedStateFromError(): Partial<WidgetErrorBoundaryState> {
    return { hasError: true };
  }

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
  ): Partial<WidgetErrorBoundaryState> | null {
    if (Object.is(state.failedFor, props.resetKey)) return null;
    // The key moved on, so this is a different widget in a recycled fiber — a keyless transcript,
    // a virtualised list — and it is owed an attempt of its own rather than its predecessor's
    // verdict.
    return { failedFor: props.resetKey, hasError: false };
  }

  /**
   * `cause` is typed `unknown` and not `Error` because React hands over whatever was thrown, and
   * a widget may well throw a string. The base signature is method syntax, so the wider parameter
   * is still assignable, and the error constructors downstream already narrow (ADR 0013).
   */
  override componentDidCatch(cause: unknown): void {
    try {
      this.props.onError(cause);
    } catch {
      // ADR 0013 — the one place Nerey discards an error, deliberately. Reporting must never
      // affect rendering: a telemetry hook that throws would otherwise blank the transcript this
      // boundary has just rescued, and rethrowing would escape to the consumer's application-level
      // boundary, which is precisely the outcome the per-widget boundary prevents. Nothing is
      // logged either — a library that writes to `console` shows up in someone else's error budget.
    }
  }

  override render(): ReactNode {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
