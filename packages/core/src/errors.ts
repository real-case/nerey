import type { NereyErrorCode, NereyErrorLike } from './types';

/**
 * ADR 0013 / 0048 — a typed error taxonomy. Every failure Nerey can produce is one of six codes,
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

/**
 * D-5 — the widget an error is about, in prose. A host that logs `error.message` alone, which is
 * the common case, must still learn which widget failed: the structured fields are for code that
 * reads them, and most logging does not. Every part is optional because some layers legitimately
 * do not know it (the write queue has a message id and nothing else), and inventing coordinates
 * would be worse than omitting them.
 */
function subjectOf(coords: Coords): string {
  const { widgetType, widgetVersion, messageId } = coords;
  const widget =
    widgetType === undefined
      ? undefined
      : widgetVersion === undefined
        ? `\`${widgetType}\``
        : `\`${widgetType}@${widgetVersion}\``;
  const message = messageId === undefined ? undefined : `message \`${String(messageId)}\``;
  if (widget !== undefined && message !== undefined) return ` for ${widget} in ${message}`;
  if (widget !== undefined) return ` for ${widget}`;
  if (message !== undefined) return ` in ${message}`;
  return '';
}

function issueDetail(issues: readonly { path: string; message: string }[]): string {
  return issues.length
    ? issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ')
    : 'no issue detail supplied by the schema';
}

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
  return new NereyError({
    code: 'invalid-payload',
    message: `Widget payload${subjectOf(coords)} failed validation — ${issueDetail(issues)}`,
    issues,
    ...coords,
  });
}

export function invalidStateError(coords: Coords, issues: readonly { path: string; message: string }[]) {
  return new NereyError({
    code: 'invalid-state',
    message: `Persisted widget state${subjectOf(coords)} failed validation — ${issueDetail(issues)}`,
    issues,
    ...coords,
  });
}

/**
 * ADR 0048 — a widget's outbound `result` failed its entry's `resultSchema`, or the entry has no
 * `resultSchema` to check it against. Either way the interaction went out as text only.
 */
export function invalidResultError(coords: Coords, issues: readonly { path: string; message: string }[]) {
  return new NereyError({
    code: 'invalid-result',
    message: `Widget result${subjectOf(coords)} was not sent — ${issueDetail(issues)}`,
    issues,
    ...coords,
  });
}

export function widgetRenderError(coords: Coords, cause: unknown) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new NereyError({
    code: 'widget-render',
    message: `Widget${subjectOf(coords)} threw while rendering — ${detail}`,
    cause,
    ...coords,
  });
}

export function persistenceError(coords: Coords, cause: unknown) {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new NereyError({
    code: 'persistence',
    message:
      `Persisting widget state${subjectOf(coords)} failed — ${detail}. The widget stays in its ` +
      `committed state; it must not re-enable, because the reply it produced is already in the ` +
      `transcript (ADR 0016).`,
    cause,
    ...coords,
  });
}

export function isNereyError(value: unknown): value is NereyError {
  return value instanceof NereyError;
}
