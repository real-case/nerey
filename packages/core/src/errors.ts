import type { NereyErrorCode, NereyErrorLike } from './types';

/**
 * ADR 0013 — a typed error taxonomy. Every failure Nerey can produce is one of five codes,
 * carries the widget coordinates that identify it, and reaches the consumer through the
 * host's `onWidgetError`. Nerey never writes to `console` on a consumer's behalf: a library
 * that logs is a library that shows up in someone else's error budget.
 */
export class NereyError extends Error implements NereyErrorLike {
  readonly code: NereyErrorCode;
  readonly widgetType?: string;
  readonly widgetVersion?: string;
  readonly messageId?: string | number;
  readonly issues?: readonly { path: string; message: string }[];

  constructor(init: NereyErrorLike) {
    // `cause` goes through ErrorOptions rather than being redeclared as a field: Error
    // already owns the property, and shadowing it breaks `instanceof`-based cause walking.
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'NereyError';
    this.code = init.code;
    if (init.widgetType !== undefined) this.widgetType = init.widgetType;
    if (init.widgetVersion !== undefined) this.widgetVersion = init.widgetVersion;
    if (init.messageId !== undefined) this.messageId = init.messageId;
    if (init.issues !== undefined) this.issues = init.issues;
  }
}

type Coords = { messageId?: string | number; widgetType?: string; widgetVersion?: string };

export function unknownWidgetError(type: string, version: string, messageId?: string | number) {
  return new NereyError({
    code: 'unknown-widget',
    message:
      `No widget registered for \`${type}@${version}\`. Resolution is an exact match on ` +
      `type@version (ADR 0009) — check for a version mismatch such as "1.0" against "1.0.0" ` +
      `before assuming the entry is missing.`,
    widgetType: type,
    widgetVersion: version,
    ...(messageId !== undefined ? { messageId } : {}),
  });
}

export function invalidPayloadError(coords: Coords, issues: readonly { path: string; message: string }[]) {
  const detail = issues.length
    ? issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ')
    : 'no issue detail supplied by the schema';
  return new NereyError({
    code: 'invalid-payload',
    message: `Widget payload failed validation — ${detail}`,
    issues,
    ...coords,
  });
}

export function invalidStateError(coords: Coords, issues: readonly { path: string; message: string }[]) {
  const detail = issues.length
    ? issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ')
    : 'no issue detail supplied by the schema';
  return new NereyError({
    code: 'invalid-state',
    message: `Persisted widget state failed validation — ${detail}`,
    issues,
    ...coords,
  });
}

export function widgetRenderError(coords: Coords, cause: unknown) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new NereyError({
    code: 'widget-render',
    message: `Widget threw while rendering — ${detail}`,
    cause,
    ...coords,
  });
}

export function persistenceError(coords: Coords, cause: unknown) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new NereyError({
    code: 'persistence',
    message:
      `Persisting widget state failed — ${detail}. The widget stays in its committed state; ` +
      `it must not re-enable, because the reply it produced is already in the transcript ` +
      `(ADR 0016).`,
    cause,
    ...coords,
  });
}

export function isNereyError(value: unknown): value is NereyError {
  return value instanceof NereyError;
}
