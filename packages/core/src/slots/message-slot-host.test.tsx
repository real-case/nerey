import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import { NEVER_EXPIRES } from '../lifecycle/expiry';
import { WidgetRoot } from '../primitives/widget-root';
import { asAnyWidget, createWidgetRegistry, defineWidget } from '../registry';
import type {
  AnyWidgetRegistryEntry,
  NereyMessage,
  Placement,
  WidgetHostValue,
  WidgetStatus,
} from '../types';
import { MessageSlotHost } from './message-slot-host';

/* ────────────────────────────────────────────────────────────────────────────────────
 * Fixtures
 * ──────────────────────────────────────────────────────────────────────────────────── */

const VERSION = '1.0.0';

type Payload = { label: string };

function stubEntry(type: string, placement: Placement): AnyWidgetRegistryEntry {
  return asAnyWidget(
    defineWidget<Payload, unknown>({
      type,
      version: VERSION,
      placement,
      lifecycle: NEVER_EXPIRES,
      component: (props) => (
        <WidgetRoot
          type={type}
          version={VERSION}
          slot={placement.slot}
          status={props.status}
          readonly={props.readonly}
        >
          <span data-testid={`widget-${type}`}>{props.payload.label}</span>
        </WidgetRoot>
      ),
    }),
  );
}

function widgetMessage(id: string, type: string, label: string): NereyMessage {
  return {
    id,
    role: 'assistant',
    text: `plain text for ${id}`,
    widget: { type, version: VERSION, payload: { label }, state: {} },
  };
}

function renderHost(ui: ReactElement, entries: readonly AnyWidgetRegistryEntry[]) {
  const value: WidgetHostValue = { ...DEFAULT_HOST_VALUE, registry: createWidgetRegistry(entries) };
  return render(<WidgetHostProvider value={value}>{ui}</WidgetHostProvider>);
}

const inline = stubEntry('inline', { slot: 'message' });
const composer = stubEntry('composer', { slot: 'input', position: 'above' });
const overlay = stubEntry('modal', { slot: 'overlay', scope: 'chat' });

/* ────────────────────────────────────────────────────────────────────────────────────
 * Selection
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('MessageSlotHost', () => {
  it('renders message-placed widgets in message order', () => {
    const messages = [
      widgetMessage('a', 'inline', 'first'),
      widgetMessage('b', 'inline', 'second'),
      widgetMessage('c', 'inline', 'third'),
    ];

    renderHost(<MessageSlotHost messages={messages} />, [inline]);

    expect(screen.getAllByTestId('widget-inline').map((node) => node.textContent)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('leaves input- and overlay-placed messages to their own hosts', () => {
    const messages = [
      widgetMessage('a', 'inline', 'in transcript'),
      widgetMessage('b', 'composer', 'at the composer'),
      widgetMessage('c', 'modal', 'over the chat'),
    ];

    renderHost(<MessageSlotHost messages={messages} />, [inline, composer, overlay]);

    expect(screen.getByTestId('widget-inline')).toBeInTheDocument();
    expect(screen.queryByTestId('widget-composer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('widget-modal')).not.toBeInTheDocument();
    // Not merely hidden — the *text* of a message routed elsewhere must not leak into the
    // transcript either, or a confirmation would be answerable in two places.
    expect(screen.queryByText('plain text for b')).not.toBeInTheDocument();
  });

  it('keeps an unresolvable widget in the transcript as its fallback text', () => {
    const messages = [widgetMessage('a', 'never-registered', 'nothing renders this')];

    renderHost(<MessageSlotHost messages={messages} />, [inline]);

    expect(screen.getByText('plain text for a')).toBeInTheDocument();
    expect(screen.getByText('plain text for a')).toHaveAttribute('data-nerey-fallback', 'unknown-widget');
  });

  it('keeps a plain-text message in the transcript when no text widget is registered', () => {
    const messages: NereyMessage[] = [{ id: 'a', role: 'assistant', text: 'just words' }];

    renderHost(<MessageSlotHost messages={messages} />, []);

    expect(screen.getByText('just words')).toBeInTheDocument();
  });

  it('places a plain-text message through the registered text entry', () => {
    const text = stubEntry('text', { slot: 'message' });
    const messages: NereyMessage[] = [{ id: 'a', role: 'assistant', text: 'just words' }];

    // The synthesised envelope carries `{ content }`, not `{ label }`, so the stub renders an empty
    // label — what is under test is that the message was PLACED by the text entry at all.
    renderHost(<MessageSlotHost messages={messages} />, [text]);

    expect(screen.getByTestId('widget-text')).toBeInTheDocument();
  });

  it('drops a plain-text message whose text entry is placed outside the transcript', () => {
    const text = stubEntry('text', { slot: 'overlay', scope: 'page' });
    const messages: NereyMessage[] = [{ id: 'a', role: 'assistant', text: 'just words' }];

    renderHost(<MessageSlotHost messages={messages} />, [text]);

    expect(screen.queryByTestId('widget-text')).not.toBeInTheDocument();
  });

  it('renders nothing for an empty transcript', () => {
    const { container } = renderHost(<MessageSlotHost messages={[]} />, [inline]);

    expect(container).toBeEmptyDOMElement();
  });

  /* ──────────────────────────────────────────────────────────────────────────────────
   * Deduplication
   * ────────────────────────────────────────────────────────────────────────────────── */

  it("keeps the last copy of a replayed message at the first copy's position", () => {
    const messages = [
      widgetMessage('a', 'inline', 'first'),
      widgetMessage('b', 'inline', 'second'),
      widgetMessage('a', 'inline', 'first, revised'),
    ];

    renderHost(<MessageSlotHost messages={messages} />, [inline]);

    expect(screen.getAllByTestId('widget-inline').map((node) => node.textContent)).toEqual([
      'first, revised',
      'second',
    ]);
  });

  it('renders one child per id when the whole tail is replayed', () => {
    const messages = [
      widgetMessage('a', 'inline', 'first'),
      widgetMessage('a', 'inline', 'first again'),
      widgetMessage('a', 'inline', 'first once more'),
    ];

    renderHost(<MessageSlotHost messages={messages} />, [inline]);

    expect(screen.getAllByTestId('widget-inline')).toHaveLength(1);
  });

  /* ──────────────────────────────────────────────────────────────────────────────────
   * Per-message status and readonly
   * ────────────────────────────────────────────────────────────────────────────────── */

  it('applies statusOf per message', () => {
    const messages = [widgetMessage('a', 'inline', 'settled'), widgetMessage('b', 'inline', 'arriving')];
    const statusOf = (message: NereyMessage): WidgetStatus => (message.id === 'b' ? 'streaming' : 'ready');

    renderHost(<MessageSlotHost messages={messages} statusOf={statusOf} />, [inline]);

    const roots = screen.getAllByTestId('widget-inline').map((node) => node.parentElement);
    expect(roots[0]).toHaveAttribute('data-nerey-status', 'ready');
    expect(roots[1]).toHaveAttribute('data-nerey-status', 'streaming');
  });

  it('defaults to ready when no statusOf is supplied', () => {
    renderHost(<MessageSlotHost messages={[widgetMessage('a', 'inline', 'x')]} />, [inline]);

    expect(screen.getByTestId('widget-inline').parentElement).toHaveAttribute('data-nerey-status', 'ready');
  });

  it('applies readonlyOf per message', () => {
    const messages = [widgetMessage('a', 'inline', 'live'), widgetMessage('b', 'inline', 'replayed')];

    renderHost(<MessageSlotHost messages={messages} readonlyOf={(message) => message.id === 'b'} />, [
      inline,
    ]);

    const roots = screen.getAllByTestId('widget-inline').map((node) => node.parentElement);
    expect(roots[0]).not.toHaveAttribute('data-readonly');
    expect(roots[1]).toHaveAttribute('data-readonly', '');
  });
});
