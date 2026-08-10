import { render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createWidgetRegistry, emptyRegistry } from '../registry';
import type { WidgetHostValue } from '../types';
import { DEFAULT_HOST_VALUE, WidgetHostProvider, useConversationId, useWidgetHost } from './host-context';

function hostValue(overrides: Partial<WidgetHostValue> = {}): WidgetHostValue {
  return { ...DEFAULT_HOST_VALUE, ...overrides };
}

describe('useWidgetHost with no provider mounted', () => {
  it('returns the frozen default rather than undefined', () => {
    const { result } = renderHook(() => useWidgetHost());

    expect(result.current).toBe(DEFAULT_HOST_VALUE);
    expect(Object.isFrozen(DEFAULT_HOST_VALUE)).toBe(true);
  });

  it('defaults the registry to emptyRegistry', () => {
    const { result } = renderHook(() => useWidgetHost());

    expect(result.current.registry).toBe(emptyRegistry);
    expect(result.current.registry.get('confirmation', '1.0.0')).toBeUndefined();
    expect(result.current.registry.has('confirmation', '1.0.0')).toBe(false);
    expect(result.current.registry.entries()).toEqual([]);
  });

  it('defaults conversationId to the empty string', () => {
    const { result } = renderHook(() => useConversationId());

    expect(result.current).toBe('');
  });

  it('has a sendUserMessage that is callable and does nothing observable', () => {
    const { result } = renderHook(() => useWidgetHost());

    expect(() => {
      result.current.sendUserMessage('hello', { a: 1 });
    }).not.toThrow();
    expect(result.current.sendUserMessage('hello')).toBeUndefined();
  });

  it('renders the fallback as the text itself', () => {
    const { result } = renderHook(() => useWidgetHost());

    expect(result.current.renderFallback('plain text', { messageId: 'm1' })).toBe('plain text');
  });

  it('has a persistence port that reads undefined and writes successfully', async () => {
    const { result } = renderHook(() => useWidgetHost());
    const { persistence } = result.current;

    await expect(persistence.getWidgetState('c1', 'm1')).resolves.toBeUndefined();
    await expect(persistence.updateWidgetState('c1', 'm1', { picked: 'yes' })).resolves.toBeUndefined();
    // The null port stores nothing, so a write is not followed by a read (ADR 0016).
    await expect(persistence.getWidgetState('c1', 'm1')).resolves.toBeUndefined();
  });

  it('keeps the same value identity across re-renders', () => {
    const { result, rerender } = renderHook(() => useWidgetHost());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
  });

  it('refuses mutation of the shared default', () => {
    expect(() => {
      (DEFAULT_HOST_VALUE as { conversationId: string }).conversationId = 'hijacked';
    }).toThrow(TypeError);
    expect(DEFAULT_HOST_VALUE.conversationId).toBe('');
  });
});

describe('WidgetHostProvider', () => {
  it('supplies the provided value to consumers', () => {
    const registry = createWidgetRegistry([]);
    const sendUserMessage = vi.fn();
    const value = hostValue({ registry, conversationId: 'conv-7', sendUserMessage });

    const { result } = renderHook(() => useWidgetHost(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WidgetHostProvider value={value}>{children}</WidgetHostProvider>
      ),
    });

    expect(result.current).toBe(value);
    expect(result.current.registry).toBe(registry);
    expect(result.current.conversationId).toBe('conv-7');

    result.current.sendUserMessage('yes please', { action: 'confirm' });
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    expect(sendUserMessage).toHaveBeenCalledWith('yes please', { action: 'confirm' });
  });

  it('exposes conversationId through useConversationId', () => {
    const value = hostValue({ conversationId: 'conv-7' });

    const { result } = renderHook(() => useConversationId(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WidgetHostProvider value={value}>{children}</WidgetHostProvider>
      ),
    });

    expect(result.current).toBe('conv-7');
  });

  it('gives the innermost value when providers nest', () => {
    const outer = hostValue({ conversationId: 'outer' });
    const inner = hostValue({ conversationId: 'inner' });

    const { result } = renderHook(() => useWidgetHost(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WidgetHostProvider value={outer}>
          <WidgetHostProvider value={inner}>{children}</WidgetHostProvider>
        </WidgetHostProvider>
      ),
    });

    expect(result.current).toBe(inner);
    expect(result.current.conversationId).toBe('inner');
  });

  it('propagates a new value object even when it is structurally identical', () => {
    // The provider must not memoise the caller's object: a host that rebuilds an equal value
    // every render is a real re-render bug, and hiding it here would only relocate it.
    const first = hostValue({ conversationId: 'conv-7' });
    const second = hostValue({ conversationId: 'conv-7' });
    const seen: WidgetHostValue[] = [];

    function Probe() {
      seen.push(useWidgetHost());
      return null;
    }

    const { rerender } = render(
      <WidgetHostProvider value={first}>
        <Probe />
      </WidgetHostProvider>,
    );
    expect(seen.at(-1)).toBe(first);

    rerender(
      <WidgetHostProvider value={second}>
        <Probe />
      </WidgetHostProvider>,
    );

    expect(seen.at(-1)).toBe(second);
  });

  it('does not leak the provided value to a sibling tree', () => {
    const value = hostValue({ conversationId: 'conv-7' });

    renderHook(() => useWidgetHost(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <WidgetHostProvider value={value}>{children}</WidgetHostProvider>
      ),
    });
    const { result } = renderHook(() => useWidgetHost());

    expect(result.current).toBe(DEFAULT_HOST_VALUE);
  });
});
