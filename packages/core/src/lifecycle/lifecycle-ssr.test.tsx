import { act } from '@testing-library/react';
import type { ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import { WidgetRoot } from '../primitives/widget-root';
import { asAnyWidget, createWidgetRegistry, defineWidget } from '../registry';
import { WidgetRenderer } from '../render/widget-renderer';
import type { Lifecycle, NereyMessage, WidgetComponentProps, WidgetHostValue } from '../types';

/**
 * ADR 0046 — a server render and the hydrating client agree on whether a widget has expired,
 * because both evaluate against the host's injected `now` rather than against their own clocks or
 * the moment each happened to mount. One millisecond either side of the deadline is where a
 * mount-anchored or wall-clock implementation would disagree with itself.
 */

const CREATED_AT = Date.UTC(2026, 0, 1);
const TIMEOUT_MS = 60_000;
const DEADLINE = CREATED_AT + TIMEOUT_MS;

function Clock(props: WidgetComponentProps<{ label: string }, unknown>): ReactElement {
  return (
    <WidgetRoot type="clock" version="1.0.0" slot="message" status={props.status} readonly={props.readonly}>
      <button type="button" disabled={props.readonly}>
        {props.payload.label}
      </button>
    </WidgetRoot>
  );
}

const LIFECYCLE: Lifecycle = {
  persist: 'forever',
  expiry: [{ on: 'timeout', ms: TIMEOUT_MS }],
  afterExpiry: 'snapshot',
};

const MESSAGE: NereyMessage = {
  id: 'm1',
  role: 'assistant',
  createdAt: CREATED_AT,
  text: 'Quick question.',
  widget: { type: 'clock', version: '1.0.0', payload: { label: 'Answer' } },
};

function tree(now: number): ReactElement {
  const host: WidgetHostValue = {
    ...DEFAULT_HOST_VALUE,
    persistence: { ...DEFAULT_HOST_VALUE.persistence },
    registry: createWidgetRegistry([
      asAnyWidget(
        defineWidget<{ label: string }, unknown>({
          type: 'clock',
          version: '1.0.0',
          component: Clock,
          placement: { slot: 'message' },
          lifecycle: LIFECYCLE,
        }),
      ),
    ]),
    conversationId: 'c1',
    now: () => now,
  };
  return (
    <WidgetHostProvider value={host}>
      <WidgetRenderer message={MESSAGE} />
    </WidgetHostProvider>
  );
}

let container: HTMLElement | undefined;

afterEach(() => {
  container?.remove();
  container = undefined;
});

async function serverThenClient(now: number) {
  const html = renderToString(tree(now));
  container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);

  const recoverable: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot> | undefined;
  await act(async () => {
    root = hydrateRoot(container!, tree(now), {
      onRecoverableError: (error) => {
        recoverable.push(error);
      },
    });
    await Promise.resolve();
  });

  const button = container.querySelector('button');
  const result = { html, recoverable, disabled: button?.disabled };
  act(() => {
    root?.unmount();
  });
  return result;
}

describe('server render and hydration share one clock', () => {
  it('agrees the widget is live one millisecond before the deadline', async () => {
    const { html, recoverable, disabled } = await serverThenClient(DEADLINE - 1);

    expect(recoverable).toEqual([]);
    expect(html).not.toContain('disabled');
    expect(disabled).toBe(false);
  });

  it('agrees the widget is expired one millisecond after the deadline', async () => {
    const { html, recoverable, disabled } = await serverThenClient(DEADLINE + 1);

    expect(recoverable).toEqual([]);
    expect(html).toContain('disabled');
    expect(disabled).toBe(true);
  });
});
