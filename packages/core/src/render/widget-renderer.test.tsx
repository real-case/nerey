import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { z } from 'zod';

import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import { EXPIRE_ON_INTERACT, NEVER_EXPIRES } from '../lifecycle/expiry';
import { WidgetRoot } from '../primitives/widget-root';
import { asAnyWidget, createWidgetRegistry, defineWidget } from '../registry';
import type {
  AnyWidgetRegistryEntry,
  Lifecycle,
  NereyMessage,
  NereyWidgetEnvelope,
  WidgetComponentProps,
  WidgetHostValue,
  WidgetMigration,
  WidgetRegistryEntry,
  WidgetStatus,
} from '../types';
import { WidgetRenderer } from './widget-renderer';

/* ────────────────────────────────────────────────────────────────────────────────────
 * Fixtures
 * ──────────────────────────────────────────────────────────────────────────────────── */

const payloadSchema = z.object({ question: z.string(), options: z.array(z.string()).min(1) });
const stateSchema = z.object({ choice: z.string() }).optional();

type PollPayload = z.infer<typeof payloadSchema>;
type PollState = z.infer<typeof stateSchema>;

const VALID_PAYLOAD: PollPayload = { question: 'Which region?', options: ['EU', 'US'] };

/** Deliberately ignores `readonly`, so the renderer's own no-op guard is what gets tested. */
function PollView(props: WidgetComponentProps<PollPayload, PollState>): ReactElement {
  return (
    <WidgetRoot type="poll" version="1.0.0" slot="message" status={props.status} readonly={props.readonly}>
      <span data-testid="question">
        {props.status === 'streaming' ? 'still arriving' : props.payload.question}
      </span>
      <span data-testid="choice">{props.state?.choice ?? 'none'}</span>
      <button
        type="button"
        onClick={() => {
          props.onInteraction('vote', { text: 'I vote EU', meta: { choice: 'EU' } });
        }}
      >
        vote
      </button>
    </WidgetRoot>
  );
}

function pollEntry(overrides: Partial<WidgetRegistryEntry<PollPayload, PollState>> = {}) {
  return asAnyWidget(
    defineWidget<PollPayload, PollState>({
      type: 'poll',
      version: '1.0.0',
      component: PollView,
      placement: { slot: 'message' },
      lifecycle: NEVER_EXPIRES,
      payloadSchema,
      stateSchema,
      ...overrides,
    }),
  );
}

/** Registered at 2.0.0 and opted into reading 1.0.0, which is the only way migration is reached. */
function archiveEntry(migrate?: WidgetMigration) {
  return asAnyWidget(
    defineWidget<PollPayload, PollState>({
      type: 'archive',
      version: '2.0.0',
      component: PollView,
      placement: { slot: 'message' },
      lifecycle: NEVER_EXPIRES,
      payloadSchema,
      acceptsVersion: (requested) => requested === '1.0.0',
      ...(migrate ? { migrate } : {}),
    }),
  );
}

function throwingEntry() {
  return asAnyWidget(
    defineWidget<PollPayload, PollState>({
      type: 'boom',
      version: '1.0.0',
      component: () => {
        throw new Error('kaboom');
      },
      placement: { slot: 'message' },
      lifecycle: NEVER_EXPIRES,
    }),
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * Harness
 * ──────────────────────────────────────────────────────────────────────────────────── */

function makeHost(entries: AnyWidgetRegistryEntry[], overrides: Partial<WidgetHostValue> = {}) {
  const sendUserMessage = vi.fn<WidgetHostValue['sendUserMessage']>();
  const onWidgetError = vi.fn<NonNullable<WidgetHostValue['onWidgetError']>>();
  const host: WidgetHostValue = {
    ...DEFAULT_HOST_VALUE,
    registry: createWidgetRegistry(entries),
    conversationId: 'c1',
    sendUserMessage,
    onWidgetError,
    renderFallback: (text) => <em data-testid="fallback">{text}</em>,
    ...overrides,
  };
  return { host, sendUserMessage, onWidgetError };
}

type RendererProps = { message: NereyMessage; status?: WidgetStatus; readonly?: boolean };

function mount(props: RendererProps, host: WidgetHostValue) {
  const view = render(
    <WidgetHostProvider value={host}>
      <WidgetRenderer {...props} />
    </WidgetHostProvider>,
  );

  return {
    ...view,
    update: (next: Partial<RendererProps> = {}) => {
      view.rerender(
        <WidgetHostProvider value={host}>
          <WidgetRenderer {...props} {...next} />
        </WidgetHostProvider>,
      );
    },
  };
}

function message(widget: NereyWidgetEnvelope | null, text = 'Which region? EU or US.'): NereyMessage {
  return { id: 'm1', role: 'assistant', text, widget };
}

function pollMessage(overrides: Partial<NereyWidgetEnvelope> = {}): NereyMessage {
  return message({ type: 'poll', version: '1.0.0', payload: VALID_PAYLOAD, ...overrides });
}

function fallbackNode(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-nerey-fallback]');
}

/** React logs every boundary-caught error itself; that output is not Nerey's and not under test. */
function silenceReactErrorLog(): void {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
}

/* ────────────────────────────────────────────────────────────────────────────────────
 * Step 1 — resolution
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('degradation step 1: unknown type@version', () => {
  it('falls back to the message text and reports unknown-widget', () => {
    const { host, onWidgetError } = makeHost([pollEntry()]);
    const { container } = mount({ message: message({ type: 'nope', version: '1.0.0', payload: {} }) }, host);

    expect(screen.getByTestId('fallback')).toHaveTextContent('Which region? EU or US.');
    expect(fallbackNode(container)).toHaveAttribute('data-nerey-fallback', 'unknown-widget');
    expect(onWidgetError).toHaveBeenCalledTimes(1);
    expect(onWidgetError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'unknown-widget',
        widgetType: 'nope',
        widgetVersion: '1.0.0',
        messageId: 'm1',
      }),
    );
  });

  it('treats a version the registry does not hold as an unknown widget (ADR 0009)', () => {
    const { host, onWidgetError } = makeHost([pollEntry()]);
    const { container } = mount({ message: pollMessage({ version: '1.0' }) }, host);

    expect(fallbackNode(container)).toHaveAttribute('data-nerey-fallback', 'unknown-widget');
    expect(onWidgetError.mock.calls[0]?.[0]).toMatchObject({ code: 'unknown-widget', widgetVersion: '1.0' });
  });

  it('sends a plain-text message down the same chain, so the fallback port is always exercised', () => {
    // ADR 0035 — a message with no widget resolves to a synthesised `text@1.0.0` envelope. No entry
    // is registered for it here, so the whole transcript demonstrably runs through step 1.
    const { host, onWidgetError } = makeHost([pollEntry()]);
    const { container } = mount({ message: message(null, 'just prose') }, host);

    expect(screen.getByTestId('fallback')).toHaveTextContent('just prose');
    expect(fallbackNode(container)).toHaveAttribute('data-nerey-fallback', 'unknown-widget');
    expect(onWidgetError.mock.calls[0]?.[0]).toMatchObject({ widgetType: 'text', widgetVersion: '1.0.0' });
  });

  it('renders a registered text widget rather than degrading', () => {
    const textEntry = asAnyWidget(
      defineWidget<{ content: string }, unknown>({
        type: 'text',
        version: '1.0.0',
        component: (props) => <p data-testid="prose">{props.payload.content}</p>,
        placement: { slot: 'message' },
        lifecycle: NEVER_EXPIRES,
      }),
    );
    const { host, onWidgetError } = makeHost([textEntry]);
    const { container } = mount({ message: message(null, 'just prose') }, host);

    expect(screen.getByTestId('prose')).toHaveTextContent('just prose');
    expect(fallbackNode(container)).toBeNull();
    expect(onWidgetError).not.toHaveBeenCalled();
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * Step 2 — migration on read
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('degradation step 2: migration on read', () => {
  it('renders the migrated payload, proving migration runs before validation', () => {
    const migrate: WidgetMigration = (fromVersion, payload) => {
      const legacy = payload as { q?: string };
      return { question: `${legacy.q ?? ''} (from ${fromVersion})`, options: ['EU'] };
    };
    const { host, onWidgetError } = makeHost([archiveEntry(migrate)]);

    mount({ message: message({ type: 'archive', version: '1.0.0', payload: { q: 'Which region?' } }) }, host);

    // The raw `{ q }` shape would have failed `payloadSchema`; it renders, so it never saw it.
    expect(screen.getByTestId('question')).toHaveTextContent('Which region? (from 1.0.0)');
    expect(onWidgetError).not.toHaveBeenCalled();
  });

  it('falls back and reports unknown-widget when the migration cannot read the version', () => {
    const { host, onWidgetError } = makeHost([archiveEntry(() => undefined)]);
    const { container } = mount(
      { message: message({ type: 'archive', version: '1.0.0', payload: { q: 'x' } }) },
      host,
    );

    expect(fallbackNode(container)).toHaveAttribute('data-nerey-fallback', 'unknown-widget');
    expect(onWidgetError).toHaveBeenCalledTimes(1);
    expect(onWidgetError.mock.calls[0]?.[0]).toMatchObject({ code: 'unknown-widget' });
    expect(onWidgetError.mock.calls[0]?.[0].message).toContain('returned undefined');
  });

  it('contains a migration that throws instead of letting it reach the boundary', () => {
    const { host, onWidgetError } = makeHost([
      archiveEntry(() => {
        throw new Error('the 1.0 shape is gone');
      }),
    ]);
    const { container } = mount(
      { message: message({ type: 'archive', version: '1.0.0', payload: {} }) },
      host,
    );

    expect(fallbackNode(container)).toHaveAttribute('data-nerey-fallback', 'unknown-widget');
    expect(onWidgetError.mock.calls[0]?.[0].message).toContain('the 1.0 shape is gone');
  });

  it('reports an entry that accepts an off version but declares no migration', () => {
    const { host, onWidgetError } = makeHost([archiveEntry()]);
    const { container } = mount(
      { message: message({ type: 'archive', version: '1.0.0', payload: VALID_PAYLOAD }) },
      host,
    );

    expect(fallbackNode(container)).toHaveAttribute('data-nerey-fallback', 'unknown-widget');
    expect(onWidgetError.mock.calls[0]?.[0].message).toContain('declares no `migrate`');
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * Steps 3 and 4 — validation, and its suppression while streaming
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('degradation step 3: payload validation', () => {
  it('falls back with the issue paths when the payload fails its schema', () => {
    const { host, onWidgetError } = makeHost([pollEntry()]);
    const { container } = mount({ message: pollMessage({ payload: { question: 'Which region?' } }) }, host);

    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(fallbackNode(container)).toHaveAttribute('data-nerey-fallback', 'invalid-payload');
    expect(onWidgetError).toHaveBeenCalledTimes(1);

    const error = onWidgetError.mock.calls[0]?.[0];
    expect(error?.code).toBe('invalid-payload');
    expect(error?.issues?.map((issue) => issue.path)).toContain('options');
  });

  it('passes an unvalidated payload straight through when the entry declares no schema', () => {
    const { host, onWidgetError } = makeHost([pollEntry({ payloadSchema: undefined })]);

    mount({ message: pollMessage({ payload: { question: 'trusted', options: [] } }) }, host);

    expect(screen.getByTestId('question')).toHaveTextContent('trusted');
    expect(onWidgetError).not.toHaveBeenCalled();
  });

  it('reports one error per failure and does not re-report on an unrelated re-render', () => {
    const { host, onWidgetError } = makeHost([pollEntry()]);
    const { update } = mount({ message: pollMessage({ payload: {} }) }, host);

    update();
    update();

    expect(onWidgetError).toHaveBeenCalledTimes(1);
  });

  it('reports once even when the host rebuilds an equivalent message object every render', () => {
    // The failure mode this guards: a host that maps its own messages inline hands the renderer a
    // new object each render, and one bad payload becomes an unbounded stream of identical reports.
    const { host, onWidgetError } = makeHost([pollEntry()]);
    const { update } = mount({ message: pollMessage({ payload: {} }) }, host);

    update({ message: pollMessage({ payload: {} }) });
    update({ message: pollMessage({ payload: {} }) });

    expect(onWidgetError).toHaveBeenCalledTimes(1);
  });

  it('reports again when the same fault recurs after a good render', () => {
    const { host, onWidgetError } = makeHost([pollEntry()]);
    const { update } = mount({ message: pollMessage({ payload: {} }) }, host);

    update({ message: pollMessage() });
    expect(screen.getByTestId('question')).toBeInTheDocument();

    update({ message: pollMessage({ payload: {} }) });

    expect(onWidgetError).toHaveBeenCalledTimes(2);
  });
});

describe('degradation step 4 is suppressed while streaming (ADR 0019)', () => {
  const partial = pollMessage({ payload: { question: 'Which regi' } });

  it('renders the widget from a partial payload and reports nothing', () => {
    const { host, onWidgetError } = makeHost([pollEntry()]);
    const { container } = mount({ message: partial, status: 'streaming' }, host);

    expect(screen.getByTestId('question')).toHaveTextContent('still arriving');
    expect(fallbackNode(container)).toBeNull();
    expect(onWidgetError).not.toHaveBeenCalled();
  });

  it('validates exactly once, on the transition to ready, so suppression is scoped not swallowed', () => {
    const { host, onWidgetError } = makeHost([pollEntry()]);
    const { container, update } = mount({ message: partial, status: 'streaming' }, host);

    expect(onWidgetError).not.toHaveBeenCalled();

    update({ status: 'ready' });

    expect(fallbackNode(container)).toHaveAttribute('data-nerey-fallback', 'invalid-payload');
    expect(onWidgetError).toHaveBeenCalledTimes(1);
    expect(onWidgetError.mock.calls[0]?.[0]).toMatchObject({ code: 'invalid-payload' });
  });

  it('does not validate persisted state either, so a stream produces no diagnostics at all', () => {
    const { host, onWidgetError } = makeHost([pollEntry()]);
    mount({ message: pollMessage({ payload: {}, state: { choice: 42 } }), status: 'streaming' }, host);

    expect(onWidgetError).not.toHaveBeenCalled();
  });

  it('still validates at status error, which is the transport failing rather than the payload arriving', () => {
    const { host, onWidgetError } = makeHost([pollEntry()]);
    const { container } = mount({ message: pollMessage({ payload: {} }), status: 'error' }, host);

    expect(fallbackNode(container)).toHaveAttribute('data-nerey-fallback', 'invalid-payload');
    expect(onWidgetError).toHaveBeenCalledTimes(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * Step 5 — state validation, which reports without degrading
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('state validation is reported but never degrades the message', () => {
  it('renders the widget with no state when the persisted value fails its schema', () => {
    const { host, onWidgetError } = makeHost([pollEntry()]);
    const { container } = mount({ message: pollMessage({ state: { choice: 42 } }) }, host);

    expect(screen.getByTestId('question')).toHaveTextContent('Which region?');
    expect(screen.getByTestId('choice')).toHaveTextContent('none');
    expect(fallbackNode(container)).toBeNull();

    expect(onWidgetError).toHaveBeenCalledTimes(1);
    const error = onWidgetError.mock.calls[0]?.[0];
    expect(error?.code).toBe('invalid-state');
    expect(error?.issues?.map((issue) => issue.path)).toContain('choice');
  });

  it('hands a valid persisted state to the widget', () => {
    const { host, onWidgetError } = makeHost([pollEntry()]);
    mount({ message: pollMessage({ state: { choice: 'US' } }) }, host);

    expect(screen.getByTestId('choice')).toHaveTextContent('US');
    expect(onWidgetError).not.toHaveBeenCalled();
  });

  it('never reaches state validation when the payload already failed', () => {
    const { host, onWidgetError } = makeHost([pollEntry()]);
    mount({ message: pollMessage({ payload: {}, state: { choice: 42 } }) }, host);

    expect(onWidgetError).toHaveBeenCalledTimes(1);
    expect(onWidgetError.mock.calls[0]?.[0]).toMatchObject({ code: 'invalid-payload' });
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * Step 6 — the render boundary
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('degradation step 6: the widget throws while rendering', () => {
  silenceReactErrorLog();

  it('falls back to the message text and reports widget-render with the original cause', () => {
    const { host, onWidgetError } = makeHost([throwingEntry()]);
    const { container } = mount(
      { message: message({ type: 'boom', version: '1.0.0', payload: VALID_PAYLOAD }) },
      host,
    );

    expect(screen.getByTestId('fallback')).toHaveTextContent('Which region? EU or US.');
    expect(fallbackNode(container)).toHaveAttribute('data-nerey-fallback', 'render-error');
    expect(onWidgetError).toHaveBeenCalledTimes(1);

    const error = onWidgetError.mock.calls[0]?.[0];
    expect(error?.code).toBe('widget-render');
    expect((error?.cause as Error).message).toBe('kaboom');
  });

  it('costs the transcript one widget and not its neighbours', () => {
    const { host } = makeHost([throwingEntry(), pollEntry()]);
    render(
      <WidgetHostProvider value={host}>
        <WidgetRenderer
          message={{
            id: 'a',
            role: 'assistant',
            text: 'boom text',
            widget: { type: 'boom', version: '1.0.0', payload: {} },
          }}
        />
        <WidgetRenderer
          message={{
            id: 'b',
            role: 'assistant',
            text: 'poll text',
            widget: { type: 'poll', version: '1.0.0', payload: VALID_PAYLOAD },
          }}
        />
      </WidgetHostProvider>,
    );

    expect(screen.getByTestId('fallback')).toHaveTextContent('boom text');
    expect(screen.getByTestId('question')).toHaveTextContent('Which region?');
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * Lifecycle treatments (ADR 0018)
 * ──────────────────────────────────────────────────────────────────────────────────── */

function lifecycleOf(afterExpiry: Lifecycle['afterExpiry']): Lifecycle {
  return { persist: 'forever', expiry: [{ on: 'interact' }], afterExpiry };
}

describe('afterExpiry treatments', () => {
  it('snapshot keeps the widget on screen, read-only, after it expires', async () => {
    const user = userEvent.setup();
    const { host, sendUserMessage, onWidgetError } = makeHost([pollEntry({ lifecycle: EXPIRE_ON_INTERACT })]);
    const { container } = mount({ message: pollMessage() }, host);

    await user.click(screen.getByRole('button', { name: 'vote' }));

    expect(screen.getByTestId('question')).toBeInTheDocument();
    expect(container.querySelector('[data-nerey-widget="poll"]')).toHaveAttribute('data-readonly', '');
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(onWidgetError).not.toHaveBeenCalled();
  });

  it('hide renders nothing once the widget expires', async () => {
    const user = userEvent.setup();
    const { host, onWidgetError } = makeHost([pollEntry({ lifecycle: lifecycleOf('hide') })]);
    const { container } = mount({ message: pollMessage() }, host);

    await user.click(screen.getByRole('button', { name: 'vote' }));

    expect(container).toBeEmptyDOMElement();
    expect(onWidgetError).not.toHaveBeenCalled();
  });

  it('fallback replaces the widget with the message text and reports nothing', async () => {
    const user = userEvent.setup();
    const { host, onWidgetError } = makeHost([pollEntry({ lifecycle: lifecycleOf('fallback') })]);
    const { container } = mount({ message: pollMessage() }, host);

    await user.click(screen.getByRole('button', { name: 'vote' }));

    expect(screen.getByTestId('fallback')).toHaveTextContent('Which region? EU or US.');
    // Expiry is not a failure (ADR 0018); the DOM is what distinguishes it from a degradation.
    expect(fallbackNode(container)).toHaveAttribute('data-nerey-fallback', 'expired');
    expect(onWidgetError).not.toHaveBeenCalled();
  });

  it('degrades before it expires, so a broken payload stays diagnosable under hide', () => {
    const { host, onWidgetError } = makeHost([pollEntry({ lifecycle: lifecycleOf('hide') })]);
    const { container } = mount({ message: pollMessage({ payload: {} }) }, host);

    expect(fallbackNode(container)).toHaveAttribute('data-nerey-fallback', 'invalid-payload');
    expect(onWidgetError).toHaveBeenCalledTimes(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * The interaction channel (ADR 0014)
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('onInteraction wiring', () => {
  it('forwards the widget-formulated text and meta to the host', async () => {
    const user = userEvent.setup();
    const { host, sendUserMessage } = makeHost([pollEntry()]);
    mount({ message: pollMessage() }, host);

    await user.click(screen.getByRole('button', { name: 'vote' }));

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(sendUserMessage).toHaveBeenCalledWith('I vote EU', { choice: 'EU' });
  });

  it('is a no-op on a widget the host mounted read-only, even if the widget ignores the prop', async () => {
    const user = userEvent.setup();
    const { host, sendUserMessage } = makeHost([pollEntry()]);
    const { container } = mount({ message: pollMessage(), readonly: true }, host);

    expect(container.querySelector('[data-nerey-widget="poll"]')).toHaveAttribute('data-readonly', '');

    await user.click(screen.getByRole('button', { name: 'vote' }));

    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it('keeps a forced read-only widget on screen: readonly is not expiry', () => {
    // ADR 0019 / 0018 — `readonly` and expiry stay orthogonal, so `afterExpiry: 'hide'` must not
    // fire merely because the host replayed the transcript in a locked state.
    const { host } = makeHost([pollEntry({ lifecycle: lifecycleOf('hide') })]);
    mount({ message: pollMessage(), readonly: true }, host);

    expect(screen.getByTestId('question')).toBeInTheDocument();
  });

  it('stops sending once an expiring widget has been used', async () => {
    const user = userEvent.setup();
    const { host, sendUserMessage } = makeHost([pollEntry({ lifecycle: EXPIRE_ON_INTERACT })]);
    mount({ message: pollMessage() }, host);

    const vote = screen.getByRole('button', { name: 'vote' });
    await user.click(vote);
    await user.click(vote);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────────────
 * Diagnostics containment (ADR 0013)
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('the diagnostics hook never affects rendering', () => {
  silenceReactErrorLog();

  it('renders the fallback with no hook configured at all', () => {
    const { host } = makeHost([pollEntry()], { onWidgetError: undefined });

    expect(() => mount({ message: pollMessage({ payload: {} }) }, host)).not.toThrow();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('contains a hook that throws on a chain failure', () => {
    const { host } = makeHost([pollEntry()], {
      onWidgetError: () => {
        throw new Error('telemetry is down');
      },
    });

    expect(() => mount({ message: pollMessage({ payload: {} }) }, host)).not.toThrow();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });

  it('contains a hook that throws on a render failure', () => {
    const { host } = makeHost([throwingEntry()], {
      onWidgetError: () => {
        throw new Error('telemetry is down');
      },
    });

    expect(() =>
      mount({ message: message({ type: 'boom', version: '1.0.0', payload: {} }) }, host),
    ).not.toThrow();
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
  });
});
