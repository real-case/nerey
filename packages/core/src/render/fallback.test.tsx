import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import type { FallbackReason } from '../data-attrs';
import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import type { WidgetHostValue } from '../types';
import { WidgetFallback } from './fallback';

function mount(ui: ReactElement, host: WidgetHostValue = DEFAULT_HOST_VALUE): HTMLElement {
  const { container } = render(<WidgetHostProvider value={host}>{ui}</WidgetHostProvider>);
  const node = container.firstElementChild;
  if (!(node instanceof HTMLElement)) throw new Error('WidgetFallback rendered no element');
  return node;
}

describe('WidgetFallback', () => {
  it('routes the text through the host renderer with the message id as context', () => {
    const renderFallback = vi.fn((text: string) => <em data-testid="markdown">{text}</em>);
    const node = mount(<WidgetFallback text="the poll, in words" messageId={7} reason="render-error" />, {
      ...DEFAULT_HOST_VALUE,
      renderFallback,
    });

    expect(screen.getByTestId('markdown')).toHaveTextContent('the poll, in words');
    expect(renderFallback).toHaveBeenCalledWith('the poll, in words', { messageId: 7 });
    expect(node).toHaveTextContent('the poll, in words');
  });

  it.each([
    'unknown-widget',
    'invalid-payload',
    'render-error',
    'expired',
    'no-widget',
  ] satisfies FallbackReason[])('publishes %s as the fallback reason', (reason) => {
    const node = mount(<WidgetFallback text="text" messageId="m1" reason={reason} />);

    expect(node).toHaveAttribute('data-nerey-fallback', reason);
  });

  it('renders plain text when the host supplies no renderer at all', () => {
    // Step 4 of the chain (ADR 0012). Only reachable from untyped JavaScript, which is exactly the
    // host that would otherwise call `undefined` and take the transcript down with it.
    const host = { ...DEFAULT_HOST_VALUE, renderFallback: undefined } as unknown as WidgetHostValue;
    const node = mount(<WidgetFallback text="still readable" messageId="m1" reason="unknown-widget" />, host);

    expect(node).toHaveTextContent('still readable');
    expect(node).toHaveAttribute('data-nerey-fallback', 'unknown-widget');
  });

  it('renders nothing but the marked node when the host renderer returns nothing', () => {
    const host: WidgetHostValue = { ...DEFAULT_HOST_VALUE, renderFallback: () => null };
    const node = mount(<WidgetFallback text="dropped" messageId="m1" reason="expired" />, host);

    expect(node).toBeEmptyDOMElement();
    expect(node).toHaveAttribute('data-nerey-fallback', 'expired');
  });
});
