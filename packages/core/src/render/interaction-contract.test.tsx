import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { DEFAULT_HOST_VALUE, WidgetHostProvider } from '../host/host-context';
import { NEVER_EXPIRES } from '../lifecycle/expiry';
import { WidgetRoot } from '../primitives/widget-root';
import { asAnyWidget, createWidgetRegistry, defineWidget } from '../registry';
import type {
  NereyMessage,
  WidgetComponentProps,
  WidgetHostValue,
  WidgetInteractionPayload,
  WidgetRegistryEntry,
  WidgetStatus,
} from '../types';
import { WidgetRenderer } from './widget-renderer';

/**
 * ADR 0048 — the reply channel. One callback out of the widget; core decides whether its `text`
 * goes to `sendUserMessage` or, with a validated `result`, to the host's `respond` for a
 * correlated tool call.
 */

/* ── Compile-time contract ────────────────────────────────────────────────────────── */

// @ts-expect-error — `text` is required, even when a structured `result` is supplied.
const noText: WidgetInteractionPayload = { result: { approved: true } };
// @ts-expect-error — `text` is a string, never a number.
const numericText: WidgetInteractionPayload = { text: 123 };
void noText;
void numericText;

/* ── Fixtures ─────────────────────────────────────────────────────────────────────── */

const resultSchema = z.object({ approved: z.boolean() });

type Payload = { label: string };

/** Sends whatever `result` the test handed it, so one component covers every case. */
function makeWidget(result: unknown) {
  return function Approve(props: WidgetComponentProps<Payload, unknown>): ReactElement {
    return (
      <WidgetRoot type="approve" version="1.0.0" slot="message" status={props.status}>
        <button
          type="button"
          onClick={() => {
            props.onInteraction('approve', {
              text: 'Approved',
              meta: { via: 'button' },
              ...(result === undefined ? {} : { result }),
            });
          }}
        >
          {props.payload.label}
        </button>
      </WidgetRoot>
    );
  };
}

function entry(result: unknown, overrides: Partial<WidgetRegistryEntry<Payload, unknown>> = {}) {
  return asAnyWidget(
    defineWidget<Payload, unknown>({
      type: 'approve',
      version: '1.0.0',
      component: makeWidget(result),
      placement: { slot: 'message' },
      lifecycle: NEVER_EXPIRES,
      ...overrides,
    }),
  );
}

function message(correlationId?: string): NereyMessage {
  return {
    id: 'm1',
    role: 'assistant',
    createdAt: 0,
    text: 'Approve the deploy?',
    widget: {
      type: 'approve',
      version: '1.0.0',
      payload: { label: 'Approve' },
      ...(correlationId === undefined ? {} : { correlationId }),
    },
  };
}

function mount(
  options: {
    result?: unknown;
    entry?: Partial<WidgetRegistryEntry<Payload, unknown>>;
    correlationId?: string;
    withRespond?: boolean;
    status?: WidgetStatus;
  } = {},
) {
  const sendUserMessage = vi.fn<WidgetHostValue['sendUserMessage']>();
  const respond = vi.fn<NonNullable<WidgetHostValue['respond']>>();
  const onWidgetError = vi.fn<NonNullable<WidgetHostValue['onWidgetError']>>();
  const host: WidgetHostValue = {
    ...DEFAULT_HOST_VALUE,
    persistence: { ...DEFAULT_HOST_VALUE.persistence },
    registry: createWidgetRegistry([entry(options.result, options.entry)]),
    conversationId: 'c1',
    sendUserMessage,
    onWidgetError,
    ...(options.withRespond === false ? {} : { respond }),
  };
  render(
    <WidgetHostProvider value={host}>
      <WidgetRenderer
        message={message(options.correlationId)}
        {...(options.status ? { status: options.status } : {})}
      />
    </WidgetHostProvider>,
  );
  return { sendUserMessage, respond, onWidgetError };
}

const press = () => userEvent.click(screen.getByRole('button', { name: 'Approve' }));

/* ── Routing ──────────────────────────────────────────────────────────────────────── */

describe('routing an interaction', () => {
  it('calls respond exactly once, and not sendUserMessage, for a correlated envelope', async () => {
    const host = mount({ result: { approved: true }, entry: { resultSchema }, correlationId: 'call_1' });
    await press();

    expect(host.respond).toHaveBeenCalledTimes(1);
    expect(host.respond).toHaveBeenCalledWith('call_1', {
      action: 'approve',
      text: 'Approved',
      result: { approved: true },
    });
    expect(host.sendUserMessage).not.toHaveBeenCalled();
  });

  it('sends text through sendUserMessage when the envelope has no correlationId', async () => {
    const host = mount({ result: { approved: true }, entry: { resultSchema } });
    await press();

    expect(host.respond).not.toHaveBeenCalled();
    expect(host.sendUserMessage).toHaveBeenCalledExactlyOnceWith('Approved', { via: 'button' });
  });

  it('sends text through sendUserMessage when the host has no respond', async () => {
    const host = mount({
      result: { approved: true },
      entry: { resultSchema },
      correlationId: 'call_1',
      withRespond: false,
    });
    await press();

    expect(host.sendUserMessage).toHaveBeenCalledExactlyOnceWith('Approved', { via: 'button' });
  });

  it('responds with text alone when the widget sends no result', async () => {
    const host = mount({ entry: { resultSchema }, correlationId: 'call_1' });
    await press();

    expect(host.respond).toHaveBeenCalledExactlyOnceWith('call_1', { action: 'approve', text: 'Approved' });
    expect(host.onWidgetError).not.toHaveBeenCalled();
  });
});

/* ── Validation ───────────────────────────────────────────────────────────────────── */

describe('validating a result', () => {
  it('reports an invalid result as invalid-result and sends text only', async () => {
    const host = mount({ result: { approved: 'yes' }, entry: { resultSchema }, correlationId: 'call_1' });
    await press();

    expect(host.onWidgetError).toHaveBeenCalledTimes(1);
    expect(host.onWidgetError.mock.calls[0]?.[0]).toMatchObject({
      code: 'invalid-result',
      messageId: 'm1',
      widgetType: 'approve',
      widgetVersion: '1.0.0',
    });
    expect(host.respond).toHaveBeenCalledExactlyOnceWith('call_1', { action: 'approve', text: 'Approved' });
  });

  it('drops and reports a result on an entry with no resultSchema', async () => {
    const host = mount({ result: { approved: true }, correlationId: 'call_1' });
    await press();

    expect(host.onWidgetError.mock.calls[0]?.[0]).toMatchObject({ code: 'invalid-result' });
    expect(host.onWidgetError.mock.calls[0]?.[0].message).toMatch(/no `resultSchema`/);
    expect(host.respond).toHaveBeenCalledExactlyOnceWith('call_1', { action: 'approve', text: 'Approved' });
  });

  it('reports a schema that cannot validate synchronously instead of throwing into the widget', async () => {
    const asyncSchema = z.object({ approved: z.boolean() }).refine(() => Promise.resolve(true));
    const host = mount({
      result: { approved: true },
      entry: { resultSchema: asyncSchema },
      correlationId: 'call_1',
    });
    await press();

    expect(host.onWidgetError.mock.calls[0]?.[0]).toMatchObject({ code: 'invalid-result' });
    expect(host.respond).toHaveBeenCalledExactlyOnceWith('call_1', { action: 'approve', text: 'Approved' });
  });
});

/* ── How often the outbound schema runs ───────────────────────────────────────────── */

describe('the outbound schema', () => {
  function spiedSchema() {
    const validate = vi.fn(resultSchema['~standard'].validate);
    const schema = { '~standard': { ...resultSchema['~standard'], validate } };
    return { schema, validate };
  }

  it('runs once per interaction that carries a result', async () => {
    const { schema, validate } = spiedSchema();
    mount({ result: { approved: true }, entry: { resultSchema: schema }, correlationId: 'call_1' });
    await press();

    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('never runs for an interaction without a result', async () => {
    const { schema, validate } = spiedSchema();
    mount({ entry: { resultSchema: schema }, correlationId: 'call_1' });
    await press();

    expect(validate).not.toHaveBeenCalled();
  });

  it('never runs while the widget is streaming, and the partial result is not sent', async () => {
    const { schema, validate } = spiedSchema();
    const host = mount({
      result: { approved: true },
      entry: { resultSchema: schema },
      correlationId: 'call_1',
      status: 'streaming',
    });
    await press();

    expect(validate).not.toHaveBeenCalled();
    expect(host.respond).toHaveBeenCalledExactlyOnceWith('call_1', { action: 'approve', text: 'Approved' });
  });
});
