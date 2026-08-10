import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { TEXT_WIDGET_TYPE, TEXT_WIDGET_VERSION } from '../../adapter';
import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../../host/host-context';
import { NEVER_EXPIRES } from '../../lifecycle/expiry';
import type { FallbackRenderer, WidgetHostValue } from '../../types';
import { TextWidget } from './component';
import type { TextWidgetProps } from './component';
import { textWidget } from './index';
import { textPayloadSchema } from './schema';

function widgetProps(overrides: Partial<TextWidgetProps> = {}): TextWidgetProps {
  return {
    messageId: 'm1',
    payload: { content: 'Hello there.' },
    state: {},
    readonly: false,
    status: 'ready',
    onInteraction: () => {},
    ...overrides,
  };
}

function mount(ui: ReactElement, host?: Partial<WidgetHostValue>): HTMLElement {
  const wrapped = host ? (
    <WidgetHostProvider value={{ ...DEFAULT_HOST_VALUE, ...host }}>{ui}</WidgetHostProvider>
  ) : (
    ui
  );
  const { container } = render(wrapped);
  const node = container.firstElementChild;
  if (!(node instanceof HTMLElement)) throw new Error('TextWidget rendered no element');
  return node;
}

describe('TextWidget rendering', () => {
  it('renders the content through the host renderer rather than emitting it itself', () => {
    const renderFallback: FallbackRenderer = (text) => <em data-testid="injected">{text}</em>;

    mount(<TextWidget {...widgetProps({ payload: { content: 'Hello there.' } })} />, { renderFallback });

    // The consumer's element, not one of Nerey's: swapping in markdown must change how *every*
    // message renders, which is only true if this path is the only path (ADR 0012 / 0035).
    expect(screen.getByTestId('injected')).toHaveTextContent('Hello there.');
    expect(screen.getByTestId('injected').tagName).toBe('EM');
  });

  it('passes the messageId to the renderer as context', () => {
    const renderFallback = vi.fn<FallbackRenderer>(() => null);

    mount(<TextWidget {...widgetProps({ messageId: 42, payload: { content: 'body' } })} />, {
      renderFallback,
    });

    expect(renderFallback).toHaveBeenCalledWith('body', { messageId: 42 });
  });

  it('falls back to plain text when no provider is mounted', () => {
    const node = mount(<TextWidget {...widgetProps({ payload: { content: 'unwrapped' } })} />);

    expect(node).toHaveTextContent('unwrapped');
  });

  it('renders a renderer that produces nothing without throwing', () => {
    const node = mount(<TextWidget {...widgetProps()} />, { renderFallback: () => null });

    expect(node).toBeEmptyDOMElement();
  });

  it('never calls onInteraction — text has no outbound channel', () => {
    const onInteraction = vi.fn();

    mount(<TextWidget {...widgetProps({ onInteraction })} />);

    expect(onInteraction).not.toHaveBeenCalled();
  });
});

// The type says `TextPayload`; the stream says otherwise, and only a cast can express that gap.
const partialPayloads: [label: string, payload: unknown][] = [
  ['an empty payload object', {}],
  ['a non-string content', { content: 42 }],
  ['an absent payload', undefined],
];

describe('TextWidget with an unvalidated streaming payload', () => {
  // ADR 0019 — a partial payload is never validated, so the component is the first thing that
  // sees a `content` the type promised and the stream has not delivered.
  it.each(partialPayloads)('hands the renderer an empty string for %s', (_label, payload) => {
    const renderFallback = vi.fn<FallbackRenderer>(() => null);

    expect(() =>
      mount(
        <TextWidget
          {...widgetProps({ status: 'streaming', payload: payload as TextWidgetProps['payload'] })}
        />,
        { renderFallback },
      ),
    ).not.toThrow();
    expect(renderFallback).toHaveBeenCalledWith('', { messageId: 'm1' });
  });

  it('still renders partial content as it arrives', () => {
    const node = mount(<TextWidget {...widgetProps({ status: 'streaming', payload: { content: 'Hel' } })} />);

    expect(node).toHaveTextContent('Hel');
    expect(node).toHaveAttribute('data-nerey-status', 'streaming');
  });
});

describe('TextWidget data attributes', () => {
  it('identifies itself as the registered entry', () => {
    const node = mount(<TextWidget {...widgetProps()} />);

    expect(node).toHaveAttribute('data-nerey-widget', TEXT_WIDGET_TYPE);
    expect(node).toHaveAttribute('data-nerey-version', TEXT_WIDGET_VERSION);
    expect(node).toHaveAttribute('data-nerey-widget', 'text');
    expect(node).toHaveAttribute('data-nerey-version', '1.0.0');
  });

  it('renders in the slot its entry declares', () => {
    // Pinned against the entry rather than the literal: a placement change that missed the
    // component would put the widget in a slot the host never laid out (ADR 0017).
    expect(mount(<TextWidget {...widgetProps()} />)).toHaveAttribute(
      'data-nerey-slot',
      textWidget.placement.slot,
    );
  });

  it.each(['streaming', 'ready', 'error'] as const)('reflects the %s status', (status) => {
    expect(mount(<TextWidget {...widgetProps({ status })} />)).toHaveAttribute('data-nerey-status', status);
  });

  it('emits no data-state, because text has no state machine to be in', () => {
    expect(mount(<TextWidget {...widgetProps()} />)).not.toHaveAttribute('data-state');
  });

  it('forwards the read-only decision as a valueless attribute', () => {
    const node = mount(<TextWidget {...widgetProps({ readonly: true })} />);

    expect(node).toHaveAttribute('data-readonly', '');
    expect(mount(<TextWidget {...widgetProps({ readonly: false })} />)).not.toHaveAttribute('data-readonly');
  });

  it('carries the contract attributes and nothing else', () => {
    const node = mount(<TextWidget {...widgetProps()} />);

    expect(node.getAttributeNames().sort()).toEqual([
      'data-nerey-slot',
      'data-nerey-status',
      'data-nerey-version',
      'data-nerey-widget',
    ]);
  });
});

describe('textWidget entry', () => {
  it('resolves under the coordinates the message adapter synthesises', () => {
    // `resolveEnvelope` stamps every widget-less message with these constants; a mismatch would
    // degrade the whole transcript to `unknown-widget` instead of failing a build (ADR 0009).
    expect(textWidget.type).toBe(TEXT_WIDGET_TYPE);
    expect(textWidget.version).toBe(TEXT_WIDGET_VERSION);
  });

  it('wires the component, schema and placement it renders with', () => {
    expect(textWidget.component).toBe(TextWidget);
    expect(textWidget.payloadSchema).toBe(textPayloadSchema);
    expect(textWidget.placement).toEqual({ slot: 'message' });
  });

  it('never expires, because prose does not go stale', () => {
    expect(textWidget.lifecycle).toBe(NEVER_EXPIRES);
    expect(textWidget.lifecycle.expiry).toEqual([]);
    expect(textWidget.lifecycle.persist).toBe('forever');
  });

  it('declares no state schema, reducer or migration', () => {
    expect(textWidget.stateSchema).toBeUndefined();
    expect(textWidget.reducer).toBeUndefined();
    expect(textWidget.migrate).toBeUndefined();
    // Absent `acceptsVersion` keeps resolution exact (ADR 0009).
    expect(textWidget.acceptsVersion).toBeUndefined();
  });
});

describe('textWidget through a host that renders it', () => {
  it('renders a message end to end with the consumer renderer', () => {
    const renderFallback: FallbackRenderer = (text, context): ReactNode => (
      <span data-testid="md" data-message={String(context.messageId)}>
        {text.toUpperCase()}
      </span>
    );
    const Component = textWidget.component;

    mount(<Component {...widgetProps({ messageId: 'm9', payload: { content: 'shout' } })} />, {
      renderFallback,
    });

    const rendered = screen.getByTestId('md');
    expect(rendered).toHaveTextContent('SHOUT');
    expect(rendered).toHaveAttribute('data-message', 'm9');
  });
});
