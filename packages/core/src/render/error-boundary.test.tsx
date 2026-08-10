import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import { WidgetErrorBoundary } from './error-boundary';

/**
 * React logs every error a boundary catches through `console.error` before handing it over. That
 * is React's own output, not Nerey's, and it would otherwise bury the assertions in noise.
 */
function silenceReactErrorLog(): void {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
}

function Bomb({ explode }: { explode: boolean }): ReactElement {
  if (explode) throw new Error('kaboom');
  return <span data-testid="child">intact</span>;
}

function mount(props: {
  explode: boolean;
  onError: (cause: unknown) => void;
  resetKey?: unknown;
}): ReturnType<typeof render> {
  return render(
    <WidgetErrorBoundary
      onError={props.onError}
      fallback={<span data-testid="fallback">degraded</span>}
      resetKey={props.resetKey}
    >
      <Bomb explode={props.explode} />
    </WidgetErrorBoundary>,
  );
}

describe('WidgetErrorBoundary', () => {
  silenceReactErrorLog();

  it('renders its children and reports nothing while they render', () => {
    const onError = vi.fn();
    mount({ explode: false, onError, resetKey: 'm1' });

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  it('swaps in the fallback and reports the thrown value exactly once', () => {
    const onError = vi.fn();
    mount({ explode: true, onError, resetKey: 'm1' });

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('kaboom');
  });

  it('keeps the fallback across re-renders that do not change the key, and reports once', () => {
    // The loop guard. `getDerivedStateFromProps` runs after `getDerivedStateFromError`, so a reset
    // condition that ignored which key failed would clear the error here, re-render the child,
    // catch again, and repeat — visible as a re-entrant report count rather than as a crash.
    const onError = vi.fn();
    const { rerender } = mount({ explode: true, onError, resetKey: 'm1' });

    rerender(
      <WidgetErrorBoundary
        onError={onError}
        fallback={<span data-testid="fallback">degraded</span>}
        resetKey="m1"
      >
        <Bomb explode={false} />
      </WidgetErrorBoundary>,
    );

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('gives a new key a fresh attempt', () => {
    const onError = vi.fn();
    const { rerender } = mount({ explode: true, onError, resetKey: 'm1' });

    rerender(
      <WidgetErrorBoundary
        onError={onError}
        fallback={<span data-testid="fallback">degraded</span>}
        resetKey="m2"
      >
        <Bomb explode={false} />
      </WidgetErrorBoundary>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('reports again when the retry under a new key also throws', () => {
    const onError = vi.fn();
    const { rerender } = mount({ explode: true, onError, resetKey: 'm1' });

    rerender(
      <WidgetErrorBoundary
        onError={onError}
        fallback={<span data-testid="fallback">degraded</span>}
        resetKey="m2"
      >
        <Bomb explode />
      </WidgetErrorBoundary>,
    );

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('catches a throw even with no resetKey supplied at all', () => {
    const onError = vi.fn();
    mount({ explode: true, onError });

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('contains a reporting hook that throws, so the fallback still renders', () => {
    // ADR 0013 — a broken telemetry integration must not blank the transcript the boundary just
    // rescued. If the throw escaped, `render` itself would reject.
    const onError = vi.fn(() => {
      throw new Error('telemetry is down');
    });

    expect(() => mount({ explode: true, onError, resetKey: 'm1' })).not.toThrow();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('reports a non-Error throw as it was thrown', () => {
    const onError = vi.fn();

    function ThrowsString(): ReactElement {
      // A widget may throw anything, and `componentDidCatch`'s typed `Error` parameter is a
      // fiction — which is the whole point of this case.
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- see above
      throw 'just a string';
    }

    render(
      <WidgetErrorBoundary onError={onError} fallback={<span data-testid="fallback">degraded</span>}>
        <ThrowsString />
      </WidgetErrorBoundary>,
    );

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith('just a string');
  });
});
