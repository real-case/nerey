import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';

import { migratePayload, resolveEnvelope } from '../adapter';
import type { FallbackReason } from '../data-attrs';
import {
  NereyError,
  invalidPayloadError,
  invalidStateError,
  unknownWidgetError,
  widgetRenderError,
} from '../errors';
import { useWidgetHost } from '../host/host-context';
import { NEVER_EXPIRES } from '../lifecycle/expiry';
import { useWidgetLifecycle } from '../lifecycle/use-widget-lifecycle';
import type {
  AnyWidgetRegistryEntry,
  NereyErrorLike,
  NereyMessage,
  NereyWidgetEnvelope,
  WidgetComponent,
  WidgetInteractionHandler,
  WidgetStatus,
} from '../types';
import { validateOptional } from '../validate';
import { WidgetErrorBoundary } from './error-boundary';
import { WidgetFallback } from './fallback';

export type WidgetRendererProps = {
  message: NereyMessage;
  status?: WidgetStatus;
  /** Forces read-only regardless of lifecycle — a replayed transcript, a disabled conversation. */
  readonly?: boolean;
};

/**
 * `render: 'widget'` may still carry an `error`: a rejected *state* is reported and survived,
 * while a rejected *payload* is reported and routed to the fallback. See `runChain`.
 */
type ChainOutcome =
  | {
      render: 'widget';
      entry: AnyWidgetRegistryEntry;
      payload: unknown;
      state: unknown;
      error?: NereyError;
    }
  | { render: 'fallback'; reason: FallbackReason; error: NereyError };

/**
 * The degradation chain (ADR 0012), as a pure function of the message and the registry. Keeping
 * it outside the component is what makes "step 2 cannot be reached while streaming" a property of
 * one readable function rather than a claim about a render body.
 */
function runChain(
  entry: AnyWidgetRegistryEntry | undefined,
  envelope: NereyWidgetEnvelope,
  messageId: string | number,
  status: WidgetStatus,
): ChainOutcome {
  const coords = { messageId, widgetType: envelope.type, widgetVersion: envelope.version };

  if (!entry) {
    return {
      render: 'fallback',
      reason: 'unknown-widget',
      error: unknownWidgetError(envelope.type, envelope.version, messageId),
    };
  }

  const migrated = migratePayload(entry, envelope);
  if (!migrated.ok) {
    // Reported as `unknown-widget` rather than `invalid-payload`, because the payload was never
    // read: what failed is resolution finishing the job that `registry.get` started. An entry that
    // cannot convert version X *is* the absence of a widget for version X, which is the diagnosis
    // `unknown-widget` already describes (ADR 0009 / 0030) — and `invalid-payload` would send the
    // reader looking at model output for a fault that lives in the registry.
    return {
      render: 'fallback',
      reason: 'unknown-widget',
      error: new NereyError({ code: 'unknown-widget', message: migrated.reason, ...coords }),
    };
  }

  if (status === 'streaming') {
    // ADR 0019 — the load-bearing rule of the whole chain. A partial payload fails a complete
    // schema by definition, so validating mid-stream would fall back on every delta: the message
    // flickers between text and widget, and `onWidgetError` emits a burst of `invalid-payload`
    // that describes nothing but the speed of the stream. State is skipped with it, so validation
    // runs exactly once, on arrival at the terminal input state.
    return { render: 'widget', entry, payload: migrated.payload, state: envelope.state };
  }

  // `validateSync` throws for a schema that validates asynchronously (ADR 0011). That is left to
  // propagate on purpose: it is a wiring mistake in the entry, not a failure of this message, and
  // degrading it would hide a permanently broken widget behind output that looks merely unlucky.
  const payload = validateOptional(entry.payloadSchema, migrated.payload);
  if (!payload.ok) {
    return {
      render: 'fallback',
      reason: 'invalid-payload',
      error: invalidPayloadError(coords, payload.issues),
    };
  }

  const state = validateOptional(entry.stateSchema, envelope.state);
  if (!state.ok) {
    // The asymmetry with the payload branch above is the point. A payload is the message: without
    // it there is nothing to render, so the chain degrades. State is only what the user did to the
    // widget since, and a corrupt saved selection — a stale shape from an older release, a
    // half-written record — must not make the exchange itself unreadable. So the failure is
    // reported and the widget renders anyway, seeded as though nothing had been persisted.
    //
    // `undefined` rather than `{}`: it is exactly what a widget with no persisted state receives,
    // so this path needs no branch of its own in any widget, whereas `{}` would satisfy a schema
    // check the value has already failed.
    return {
      render: 'widget',
      entry,
      payload: payload.value,
      state: undefined,
      error: invalidStateError(coords, state.issues),
    };
  }

  return { render: 'widget', entry, payload: payload.value, state: state.value };
}

/**
 * ADR 0013 — `onWidgetError` is the sole observability surface for a subsystem that is
 * deliberately failure-tolerant, so it is never swallowed and never replaced by a `console` call.
 * A hook that throws is contained here for the same reason the error boundary contains a widget:
 * a broken telemetry integration must not blank the transcript the chain just rescued.
 */
function report(onWidgetError: ((error: NereyErrorLike) => void) | undefined, error: NereyError): void {
  if (!onWidgetError) return;
  try {
    onWidgetError(error);
  } catch {
    // Intentionally discarded — see above.
  }
}

/**
 * Renders one message: envelope → registry → migration → validation → lifecycle → widget, with a
 * legible fallback at every step that can fail (ADR 0012).
 *
 * Every hook runs before the first conditional return, so the order is stable across all of those
 * outcomes — a chain that returned early would change its hook count between a valid payload and
 * an invalid one, which is the one bug in here React would not merely render wrong but crash on.
 */
export function WidgetRenderer(props: WidgetRendererProps): ReactElement {
  const { message, status = 'ready', readonly: forcedReadonly } = props;
  const { registry, onWidgetError, sendUserMessage } = useWidgetHost();

  // Memoised on the message rather than recomputed, because `resolveEnvelope` synthesises a fresh
  // envelope for a plain-text message (ADR 0035) and that new identity would re-run validation —
  // and re-create the error object the reporting effect keys on — on every unrelated render.
  const envelope = useMemo(() => resolveEnvelope(message), [message]);
  const entry = registry.get(envelope.type, envelope.version);
  const outcome = useMemo(
    () => runChain(entry, envelope, message.id, status),
    [entry, envelope, message.id, status],
  );

  // A message with no registry entry still has to call the hook — rules of hooks — so it borrows a
  // lifecycle with no rules. Nothing can fire, so a fallback can never be `hide`-ed out of the
  // transcript on the strength of a lifecycle it does not have.
  const lifecycle = entry?.lifecycle ?? NEVER_EXPIRES;
  const { expired, readonly, afterExpiry, recordInteraction } = useWidgetLifecycle({
    lifecycle,
    messageId: message.id,
    forcedReadonly,
  });

  const error = outcome.error;
  const reported = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!error) {
      reported.current = undefined;
      return;
    }
    // Reported from an effect and not from `runChain`, so a render React discards — a StrictMode
    // double-invoke, an abandoned concurrent attempt — cannot invent an incident.
    //
    // The signature guard covers the other direction: a host that rebuilds its message objects
    // every render busts the memo above, and one bad payload would otherwise become an unbounded
    // stream of identical reports. Cleared when the failure goes away, so the same fault recurring
    // after a good render is a new report rather than silence.
    const signature = `${error.code}::${error.message}`;
    if (reported.current === signature) return;
    reported.current = signature;
    report(onWidgetError, error);
  }, [error, onWidgetError]);

  const handleRenderError = useCallback(
    (cause: unknown) => {
      report(
        onWidgetError,
        widgetRenderError(
          { messageId: message.id, widgetType: envelope.type, widgetVersion: envelope.version },
          cause,
        ),
      );
    },
    [onWidgetError, message.id, envelope.type, envelope.version],
  );

  const onInteraction = useCallback<WidgetInteractionHandler>(
    (action, data) => {
      // Belt and braces (ADR 0018). The lifecycle runtime already renders an expired widget
      // read-only, but `readonly` is a prop a widget is free to ignore, and the cost of ignoring
      // it is a second message sent against a side effect that has already happened.
      if (readonly) return;
      // Recorded before the message is sent, so an `{ on: 'interact' }` rule has expired the widget
      // by the time the host's optimistic insertion re-renders the transcript. Sending first would
      // leave a live widget on screen for the width of that gap — long enough for a second click.
      recordInteraction(action);
      sendUserMessage(data.text, data.meta);
    },
    [readonly, recordInteraction, sendUserMessage],
  );

  if (outcome.render === 'fallback') {
    return <WidgetFallback text={message.text} messageId={message.id} reason={outcome.reason} />;
  }

  if (expired) {
    // ADR 0018 — expiry is not a failure. Nothing reaches `onWidgetError` on this path, and the
    // two cases stay distinguishable in the DOM by `data-nerey-fallback="expired"`.
    if (afterExpiry === 'hide') {
      // "Render nothing", spelled as the empty element: the signature is `ReactElement`, and a
      // fragment commits no DOM. `hide` collapses a live surface — the message's own text is still
      // rendered by whatever renders the transcript, so no recorded exchange is deleted.
      return <></>;
    }
    if (afterExpiry === 'fallback') {
      return <WidgetFallback text={message.text} messageId={message.id} reason="expired" />;
    }
    // `snapshot` falls through deliberately: the widget renders again, read-only, from its
    // terminal state, because an acted-upon widget is disabled and not removed.
  }

  // `AnyWidgetRegistryEntry` erases its generics to `never`, which leaves the component's props
  // unassignable from outside — correctly, since only the entry's author knows the real shapes.
  // The renderer is the single place that has to reassert them, and it widens to `unknown` rather
  // than `any`: the values it hands over have already been through the entry's own schemas.
  const Widget = outcome.entry.component as unknown as WidgetComponent<unknown, unknown>;

  return (
    <WidgetErrorBoundary
      resetKey={message.id}
      onError={handleRenderError}
      fallback={<WidgetFallback text={message.text} messageId={message.id} reason="render-error" />}
    >
      <Widget
        messageId={message.id}
        payload={outcome.payload}
        state={outcome.state}
        readonly={readonly}
        status={status}
        onInteraction={onInteraction}
      />
    </WidgetErrorBoundary>
  );
}
