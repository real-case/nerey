import { render, screen } from '@testing-library/react';

import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import { asAnyWidget, createWidgetRegistry } from '../registry';
import { WidgetRenderer } from '../render/widget-renderer';
import type { NereyErrorLike, NereyMessage, WidgetRegistry } from '../types';
import { confirmationWidget } from '../widgets/confirmation';
import { createDevRegistry } from './dev-registry';
import { widgetMessage } from './fixtures';
import { MockWidgetHost } from './mock-host';

const base: WidgetRegistry = createWidgetRegistry([asAnyWidget(confirmationWidget)]);

/** The most common wiring bug: the widget exists, the version does not (ADR 0009). */
function mismatched(): NereyMessage {
  return widgetMessage({
    id: 'm1',
    type: 'confirmation',
    version: '2.0.0',
    payload: { title: 'Archive it?' },
    text: 'Archive it? Reply yes or no.',
  });
}

function mount(registry: WidgetRegistry, message: NereyMessage = mismatched()): HTMLElement {
  const { container } = render(
    <MockWidgetHost registry={registry}>
      <WidgetRenderer message={message} />
    </MockWidgetHost>,
  );
  const node = container.firstElementChild;
  if (!(node instanceof HTMLElement)) throw new Error('nothing rendered');
  return node;
}

function part(root: HTMLElement, name: string): HTMLElement {
  const node = root.querySelector(`[data-nerey-part="${name}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`no part named ${name}`);
  return node;
}

describe('createDevRegistry', () => {
  it('is a no-op when disabled, down to the registry identity', () => {
    const dev = createDevRegistry(base, { enabled: false });

    // Identity matters: a host value memoised on `registry` would otherwise churn every render.
    expect(dev).toBe(base);
    expect(dev.get('confirmation', '2.0.0')).toBeUndefined();
  });

  it('resolves a registered entry unchanged', () => {
    const dev = createDevRegistry(base);

    expect(dev.get('confirmation', '1.0.0')).toBe(base.get('confirmation', '1.0.0'));
  });

  it('synthesises an entry under the requested coordinates for an unknown key', () => {
    const dev = createDevRegistry(base);
    const entry = dev.get('confirmation', '2.0.0');

    // The requested version, not the registered one — anything else fails migration and lands back
    // in the fallback this card exists to replace (ADR 0030).
    expect(entry?.type).toBe('confirmation');
    expect(entry?.version).toBe('2.0.0');
    expect(entry?.payloadSchema).toBeUndefined();
    expect(entry?.lifecycle.expiry).toHaveLength(0);
  });

  it('returns the same synthesised entry for repeated lookups', () => {
    const dev = createDevRegistry(base);

    // A fresh component identity per lookup would remount the card on every render.
    expect(dev.get('poll', '1.0.0')).toBe(dev.get('poll', '1.0.0'));
    expect(dev.get('poll', '1.0.0')).not.toBe(dev.get('poll', '2.0.0'));
  });

  it('keeps has() and entries() honest — a diagnostic is not a registration', () => {
    const dev = createDevRegistry(base);
    dev.get('poll', '1.0.0');

    expect(dev.has('confirmation', '1.0.0')).toBe(true);
    expect(dev.has('poll', '1.0.0')).toBe(false);
    expect(dev.entries()).toEqual(base.entries());
  });

  it('leaves the synthesised text envelope alone', () => {
    // `text@1.0.0` is core's own construct for a message with no widget, and the plain fallback
    // renders exactly what the text widget would. Diagnosing it would turn every ordinary
    // assistant message in the transcript into an error card.
    const dev = createDevRegistry(createWidgetRegistry([]));

    expect(dev.get('text', '1.0.0')).toBeUndefined();
    expect(dev.get('text', '2.0.0')).toBeDefined();
  });
});

describe('the diagnostic card', () => {
  it('replaces the silent fallback with the missing key', () => {
    const root = mount(createDevRegistry(base));

    expect(part(root, 'dev-headline')).toHaveTextContent('No widget registered for `confirmation@2.0.0`');
    // The message text is what the ordinary chain would have shown, and its absence is the point:
    // a fallback that reads as prose is indistinguishable from a model that produced prose.
    expect(root).not.toHaveTextContent('Reply yes or no');
  });

  it('shows the plain message text instead when the dev registry is not used', () => {
    const root = mount(base);

    expect(root).toHaveAttribute('data-nerey-fallback', 'unknown-widget');
    expect(root).toHaveTextContent('Archive it? Reply yes or no.');
  });

  it('names a version mismatch as such, rather than as a missing widget', () => {
    const root = mount(createDevRegistry(base));

    expect(part(root, 'dev-detail')).toHaveTextContent('`confirmation` IS registered, at 1.0.0');
  });

  it('lists everything that is registered', () => {
    const root = mount(createDevRegistry(base));
    const listed = [...root.querySelectorAll('[data-nerey-part="dev-entry"]')].map(
      (node) => node.textContent,
    );

    expect(listed).toEqual(['confirmation@1.0.0']);
  });

  it('says so when the registry is empty', () => {
    const root = mount(createDevRegistry(createWidgetRegistry([])));

    expect(part(root, 'dev-detail')).toHaveTextContent('The registry is empty');
    expect(part(root, 'dev-registered')).toBeEmptyDOMElement();
  });

  it('reports an unrelated type without claiming a version mismatch', () => {
    const message = widgetMessage({ id: 'm2', type: 'poll', payload: { question: 'Which?' } });
    const root = mount(createDevRegistry(base), message);

    expect(part(root, 'dev-detail')).toHaveTextContent('Nothing is registered under the type `poll`');
  });

  it('carries the requested coordinates on the ADR 0020 attributes', () => {
    const root = mount(createDevRegistry(base));

    expect(root).toHaveAttribute('data-nerey-widget', 'confirmation');
    expect(root).toHaveAttribute('data-nerey-version', '2.0.0');
    expect(root).toHaveAttribute('data-nerey-slot', 'message');
    expect(root).toHaveAttribute('data-state', 'error');
    expect(root).toHaveAttribute('data-readonly', '');
  });

  it('renders without reporting an error, because resolution succeeded', () => {
    const errors: NereyErrorLike[] = [];
    render(
      <WidgetHostProvider
        value={{
          ...DEFAULT_HOST_VALUE,
          registry: createDevRegistry(base),
          onWidgetError: (error) => errors.push(error),
        }}
      >
        <WidgetRenderer message={mismatched()} />
      </WidgetHostProvider>,
    );

    // The card IS the report. Emitting `unknown-widget` alongside it would double-count a failure
    // the consumer is already looking straight at.
    expect(errors).toEqual([]);
    expect(screen.getByText(/No widget registered for/)).toBeInTheDocument();
  });
});
