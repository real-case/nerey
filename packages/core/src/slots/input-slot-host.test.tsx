import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import { NEVER_EXPIRES } from '../lifecycle/expiry';
import { WidgetRoot } from '../primitives/widget-root';
import { asAnyWidget, createWidgetRegistry, defineWidget } from '../registry';
import type { AnyWidgetRegistryEntry, NereyMessage, Placement, WidgetHostValue } from '../types';
import { InputSlotHost } from './input-slot-host';

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

function Composer(): ReactElement {
  return <textarea data-testid="composer" aria-label="Message" />;
}

/** Document order, which is what "above" and "below" actually mean once rendered. */
function precedes(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

const above = stubEntry('above', { slot: 'input', position: 'above' });
const below = stubEntry('below', { slot: 'input', position: 'below' });
const replace = stubEntry('replace', { slot: 'input', position: 'replace' });
const unpositioned = stubEntry('unpositioned', { slot: 'input' });
const inline = stubEntry('inline', { slot: 'message' });
const overlay = stubEntry('modal', { slot: 'overlay', scope: 'chat' });

const ENTRIES = [above, below, replace, unpositioned, inline, overlay];

/* ────────────────────────────────────────────────────────────────────────────────────
 * Composition
 * ──────────────────────────────────────────────────────────────────────────────────── */

describe('InputSlotHost', () => {
  it('renders an above-placed widget before the composer', () => {
    renderHost(
      <InputSlotHost messages={[widgetMessage('a', 'above', 'confirm?')]} position="above">
        <Composer />
      </InputSlotHost>,
      ENTRIES,
    );

    expect(precedes(screen.getByTestId('widget-above'), screen.getByTestId('composer'))).toBe(true);
  });

  it('renders a below-placed widget after the composer', () => {
    renderHost(
      <InputSlotHost messages={[widgetMessage('a', 'below', 'confirm?')]} position="below">
        <Composer />
      </InputSlotHost>,
      ENTRIES,
    );

    expect(precedes(screen.getByTestId('composer'), screen.getByTestId('widget-below'))).toBe(true);
  });

  it('takes the composer away for position replace', () => {
    renderHost(
      <InputSlotHost messages={[widgetMessage('a', 'replace', 'answer first')]} position="replace">
        <Composer />
      </InputSlotHost>,
      ENTRIES,
    );

    expect(screen.getByTestId('widget-replace')).toBeInTheDocument();
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument();
  });

  it('gives the composer back when no message claims replace', () => {
    renderHost(
      <InputSlotHost messages={[widgetMessage('a', 'inline', 'in transcript')]} position="replace">
        <Composer />
      </InputSlotHost>,
      ENTRIES,
    );

    expect(screen.getByTestId('composer')).toBeInTheDocument();
    expect(screen.queryByTestId('widget-inline')).not.toBeInTheDocument();
  });

  it('renders the children untouched when nothing claims the position', () => {
    renderHost(
      <InputSlotHost messages={[]} position="above">
        <Composer />
      </InputSlotHost>,
      ENTRIES,
    );

    expect(screen.getByTestId('composer')).toBeInTheDocument();
  });

  it('renders nothing when there is neither a widget nor a composer', () => {
    const { container } = renderHost(<InputSlotHost messages={[]} position="above" />, ENTRIES);

    expect(container).toBeEmptyDOMElement();
  });

  /* ──────────────────────────────────────────────────────────────────────────────────
   * Contention — only the last claimant renders
   * ────────────────────────────────────────────────────────────────────────────────── */

  it('renders only the most recent widget claiming a position', () => {
    const messages = [
      widgetMessage('a', 'above', 'stale question'),
      widgetMessage('b', 'above', 'current question'),
    ];

    renderHost(
      <InputSlotHost messages={messages} position="above">
        <Composer />
      </InputSlotHost>,
      ENTRIES,
    );

    expect(screen.getAllByTestId('widget-above')).toHaveLength(1);
    expect(screen.getByTestId('widget-above')).toHaveTextContent('current question');
  });

  it('renders only one widget when several claim replace', () => {
    const messages = [
      widgetMessage('a', 'replace', 'first takeover'),
      widgetMessage('b', 'replace', 'second takeover'),
    ];

    renderHost(
      <InputSlotHost messages={messages} position="replace">
        <Composer />
      </InputSlotHost>,
      ENTRIES,
    );

    expect(screen.getAllByTestId('widget-replace')).toHaveLength(1);
    expect(screen.getByTestId('widget-replace')).toHaveTextContent('second takeover');
  });

  it('resolves contention on the deduplicated order, not on the raw array', () => {
    // `a` is replayed last but its place in the conversation is first, so `b` is still the most
    // recent question — a reconnect must not resurrect an answered widget.
    const messages = [
      widgetMessage('a', 'above', 'older'),
      widgetMessage('b', 'above', 'newer'),
      widgetMessage('a', 'above', 'older, replayed'),
    ];

    renderHost(<InputSlotHost messages={messages} position="above" />, ENTRIES);

    expect(screen.getByTestId('widget-above')).toHaveTextContent('newer');
  });

  /* ──────────────────────────────────────────────────────────────────────────────────
   * Position filtering
   * ────────────────────────────────────────────────────────────────────────────────── */

  it('defaults an entry with no position to above', () => {
    const messages = [widgetMessage('a', 'unpositioned', 'no position declared')];

    const { rerender } = renderHost(<InputSlotHost messages={messages} position="above" />, ENTRIES);
    expect(screen.getByTestId('widget-unpositioned')).toBeInTheDocument();

    const value: WidgetHostValue = { ...DEFAULT_HOST_VALUE, registry: createWidgetRegistry(ENTRIES) };
    rerender(
      <WidgetHostProvider value={value}>
        <InputSlotHost messages={messages} position="below" />
      </WidgetHostProvider>,
    );
    expect(screen.queryByTestId('widget-unpositioned')).not.toBeInTheDocument();
  });

  it('ignores a widget claiming a different position', () => {
    const messages = [widgetMessage('a', 'below', 'under the box')];

    renderHost(
      <InputSlotHost messages={messages} position="above">
        <Composer />
      </InputSlotHost>,
      ENTRIES,
    );

    expect(screen.queryByTestId('widget-below')).not.toBeInTheDocument();
    expect(screen.getByTestId('composer')).toBeInTheDocument();
  });

  it('ignores message- and overlay-placed widgets entirely', () => {
    const messages = [widgetMessage('a', 'inline', 'transcript'), widgetMessage('b', 'modal', 'over')];

    renderHost(<InputSlotHost messages={messages} position="above" />, ENTRIES);

    expect(screen.queryByTestId('widget-inline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('widget-modal')).not.toBeInTheDocument();
  });

  it('ignores a message no registry entry resolves, leaving the composer alone', () => {
    const messages = [widgetMessage('a', 'never-registered', 'nothing renders this')];

    renderHost(
      <InputSlotHost messages={messages} position="replace">
        <Composer />
      </InputSlotHost>,
      ENTRIES,
    );

    // An unresolvable widget must never be able to take the composer away: its fallback belongs in
    // the transcript, and stranding the user behind one would be unrecoverable.
    expect(screen.getByTestId('composer')).toBeInTheDocument();
    expect(screen.queryByText('plain text for a')).not.toBeInTheDocument();
  });

  /* ──────────────────────────────────────────────────────────────────────────────────
   * Styling contract (ADR 0017 / 0020)
   * ────────────────────────────────────────────────────────────────────────────────── */

  it.each(['above', 'below', 'replace'] as const)(
    'marks the %s container with the slot and position attributes',
    (position) => {
      renderHost(
        <InputSlotHost messages={[widgetMessage('a', position, 'x')]} position={position}>
          <Composer />
        </InputSlotHost>,
        ENTRIES,
      );

      // Selected on the position attribute, because `data-nerey-slot="input"` is also on the
      // widget's own root — the container is identified by the PAIR, which is the selector
      // ADR 0017 describes.
      const container = screen.getByTestId(`widget-${position}`).closest('[data-nerey-position]');
      expect(container).not.toBeNull();
      expect(container).toHaveAttribute('data-nerey-slot', 'input');
      expect(container).toHaveAttribute('data-nerey-position', position);
    },
  );

  it('does not wrap the composer in a Nerey-owned container', () => {
    renderHost(
      <InputSlotHost messages={[widgetMessage('a', 'above', 'x')]} position="above">
        <Composer />
      </InputSlotHost>,
      ENTRIES,
    );

    expect(screen.getByTestId('composer').closest('[data-nerey-position]')).toBeNull();
  });
});
