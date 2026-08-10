import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';

import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import { NEVER_EXPIRES } from '../lifecycle/expiry';
import { WidgetRoot } from '../primitives/widget-root';
import { asAnyWidget, createWidgetRegistry, defineWidget } from '../registry';
import type { AnyWidgetRegistryEntry, NereyMessage, Placement, WidgetHostValue } from '../types';
import { DEFAULT_DISMISS_LABEL, OverlaySlotHost } from './overlay-slot-host';

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

const chat = stubEntry('chat-overlay', { slot: 'overlay', scope: 'chat' });
const page = stubEntry('page-overlay', { slot: 'overlay', scope: 'page' });
const sticky = stubEntry('sticky', { slot: 'overlay', scope: 'chat', dismissible: false });
const closable = stubEntry('closable', { slot: 'overlay', scope: 'chat', dismissible: true });
const inline = stubEntry('inline', { slot: 'message' });
const composer = stubEntry('composer', { slot: 'input', position: 'replace' });

const ENTRIES = [chat, page, sticky, closable, inline, composer];

/* ────────────────────────────────────────────────────────────────────────────────────
 * Scope filtering
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('OverlaySlotHost', () => {
  it('renders an overlay whose scope matches', () => {
    renderHost(
      <OverlaySlotHost messages={[widgetMessage('a', 'chat-overlay', 'over the chat')]} scope="chat" />,
      ENTRIES,
    );

    expect(screen.getByTestId('widget-chat-overlay')).toHaveTextContent('over the chat');
  });

  it('does not render an overlay declared for the other scope', () => {
    const messages = [
      widgetMessage('a', 'chat-overlay', 'chat scoped'),
      widgetMessage('b', 'page-overlay', 'page scoped'),
    ];

    renderHost(<OverlaySlotHost messages={messages} scope="chat" />, ENTRIES);

    expect(screen.getByTestId('widget-chat-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('widget-page-overlay')).not.toBeInTheDocument();
  });

  it('renders page-scoped overlays in place rather than portalling them out', () => {
    const { container } = renderHost(
      <OverlaySlotHost messages={[widgetMessage('a', 'page-overlay', 'page scoped')]} scope="page" />,
      ENTRIES,
    );

    // ADR 0017 records portalling as an open problem: the widget stays inside the subtree the host
    // was mounted in, and the consumer positions the container.
    expect(container).toContainElement(screen.getByTestId('widget-page-overlay'));
  });

  it('ignores message- and input-placed widgets', () => {
    const messages = [widgetMessage('a', 'inline', 'transcript'), widgetMessage('b', 'composer', 'composer')];

    const { container } = renderHost(<OverlaySlotHost messages={messages} scope="chat" />, ENTRIES);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no message claims the scope', () => {
    const { container } = renderHost(
      <OverlaySlotHost messages={[widgetMessage('a', 'page-overlay', 'elsewhere')]} scope="chat" />,
      ENTRIES,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('ignores a message no registry entry resolves', () => {
    const { container } = renderHost(
      <OverlaySlotHost messages={[widgetMessage('a', 'never-registered', 'x')]} scope="chat" />,
      ENTRIES,
    );

    // Its fallback belongs in the transcript, not floating over the conversation.
    expect(container).toBeEmptyDOMElement();
  });

  /* ──────────────────────────────────────────────────────────────────────────────────
   * Stacking
   * ────────────────────────────────────────────────────────────────────────────────── */

  it('stacks several overlays in message order', () => {
    const messages = [
      widgetMessage('a', 'chat-overlay', 'first'),
      widgetMessage('b', 'chat-overlay', 'second'),
    ];

    renderHost(<OverlaySlotHost messages={messages} scope="chat" />, ENTRIES);

    expect(screen.getAllByTestId('widget-chat-overlay').map((node) => node.textContent)).toEqual([
      'first',
      'second',
    ]);
  });

  it('renders a replayed overlay once', () => {
    const messages = [
      widgetMessage('a', 'chat-overlay', 'first'),
      widgetMessage('a', 'chat-overlay', 'first, revised'),
    ];

    renderHost(<OverlaySlotHost messages={messages} scope="chat" />, ENTRIES);

    expect(screen.getAllByTestId('widget-chat-overlay')).toHaveLength(1);
    expect(screen.getByTestId('widget-chat-overlay')).toHaveTextContent('first, revised');
  });

  /* ──────────────────────────────────────────────────────────────────────────────────
   * Styling contract (ADR 0017 / 0020)
   * ────────────────────────────────────────────────────────────────────────────────── */

  it.each([
    ['chat', 'chat-overlay'],
    ['page', 'page-overlay'],
  ] as const)('marks the %s container with the slot and scope attributes', (scope, type) => {
    renderHost(<OverlaySlotHost messages={[widgetMessage('a', type, 'x')]} scope={scope} />, ENTRIES);

    // Selected on the scope attribute, because `data-nerey-slot="overlay"` is also on the widget's
    // own root — the container is identified by the PAIR, which is the selector ADR 0017 describes.
    const container = screen.getByTestId(`widget-${type}`).closest('[data-nerey-scope]');
    expect(container).not.toBeNull();
    expect(container).toHaveAttribute('data-nerey-slot', 'overlay');
    expect(container).toHaveAttribute('data-nerey-scope', scope);
  });

  it('does not announce itself as a dialog it cannot behave like', () => {
    renderHost(
      <OverlaySlotHost messages={[widgetMessage('a', 'chat-overlay', 'x')]} scope="chat" />,
      ENTRIES,
    );

    // ADR 0022 — focus trapping belongs to the wrapped Base UI dialog in @nerey/theme. Core cannot
    // name or trap this surface, and a `role="dialog"` with neither is a keyboard trap announced as
    // a modal.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /* ──────────────────────────────────────────────────────────────────────────────────
   * Dismissal
   * ────────────────────────────────────────────────────────────────────────────────── */

  it('offers a named dismiss control when the placement is dismissible', () => {
    renderHost(
      <OverlaySlotHost messages={[widgetMessage('a', 'closable', 'x')]} scope="chat" onDismiss={() => {}} />,
      ENTRIES,
    );

    const button = screen.getByRole('button', { name: DEFAULT_DISMISS_LABEL });
    expect(button).toHaveAttribute('data-nerey-part', 'dismiss');
  });

  it('treats an unspecified dismissible as dismissible', () => {
    renderHost(
      <OverlaySlotHost
        messages={[widgetMessage('a', 'chat-overlay', 'x')]}
        scope="chat"
        onDismiss={() => {}}
      />,
      ENTRIES,
    );

    expect(screen.getByRole('button', { name: DEFAULT_DISMISS_LABEL })).toBeInTheDocument();
  });

  it('reports the dismissed message id', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    renderHost(
      <OverlaySlotHost
        messages={[widgetMessage('a', 'chat-overlay', 'x'), widgetMessage('b', 'chat-overlay', 'y')]}
        scope="chat"
        onDismiss={onDismiss}
      />,
      ENTRIES,
    );

    const buttons = screen.getAllByRole('button', { name: DEFAULT_DISMISS_LABEL });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]!);

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith('b');
  });

  it('omits the control for a non-dismissible placement', () => {
    renderHost(
      <OverlaySlotHost messages={[widgetMessage('a', 'sticky', 'x')]} scope="chat" onDismiss={() => {}} />,
      ENTRIES,
    );

    expect(screen.queryByRole('button', { name: DEFAULT_DISMISS_LABEL })).not.toBeInTheDocument();
    expect(screen.getByTestId('widget-sticky')).toBeInTheDocument();
  });

  it('omits the control when the host supplied no onDismiss', () => {
    renderHost(<OverlaySlotHost messages={[widgetMessage('a', 'closable', 'x')]} scope="chat" />, ENTRIES);

    // A close button with nothing to call is an inert control, which reads as a broken overlay.
    expect(screen.queryByRole('button', { name: DEFAULT_DISMISS_LABEL })).not.toBeInTheDocument();
  });
});
