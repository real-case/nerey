import type { AnyWidgetRegistryEntry, NereyMessage, NereyWidgetEnvelope } from './types';

/**
 * ADR 0008 — what crosses the boundary is `{ type, version, payload }` and never markup or
 * code, so "normalising a message" can only ever mean choosing an envelope. Nothing in this
 * module evaluates, parses or executes anything the model produced.
 */

export const TEXT_WIDGET_TYPE = 'text';
export const TEXT_WIDGET_VERSION = '1.0.0';

/**
 * The consumer's conversion from their own message type into Nerey's (FR-5). It is a type and
 * nothing more on purpose: Nerey must not import an application schema, so the function is
 * authored on the consumer's side and injected at the host boundary.
 */
export type MessageAdapter<TSource> = (source: TSource) => NereyMessage;

/** `widget` is optional *and* nullable, so both absences are collapsed in exactly one place. */
function widgetOf(message: NereyMessage): NereyWidgetEnvelope | undefined {
  return message.widget ?? undefined;
}

/**
 * Returns the widget envelope to render for a message. A message with no widget gets a
 * synthesised text envelope, so the renderer has exactly ONE code path.
 *
 * That single path is what keeps the degradation chain (ADR 0012) honest: plain assistant text
 * resolves, validates and renders through the same steps as a `confirmation`, so the fallback
 * port is exercised on every ordinary message rather than only on the bad day (ADR 0035).
 */
export function resolveEnvelope(message: NereyMessage): NereyWidgetEnvelope {
  // Returned by reference when it exists — a fresh copy per call would give React a new prop
  // identity on every render and defeat memoisation in every widget downstream.
  const widget = widgetOf(message);
  if (widget) return widget;

  return {
    type: TEXT_WIDGET_TYPE,
    version: TEXT_WIDGET_VERSION,
    payload: { content: message.text },
    state: {},
  };
}

/**
 * True when the message carries a real widget rather than a synthesised text envelope.
 *
 * The check is presence only. An envelope with an empty or unrecognised `type` still counts as
 * a widget, because letting it through to resolution produces `unknown-widget` (ADR 0013) —
 * a diagnosable error — whereas silently treating it as text would hide a producer bug behind
 * output that looks correct.
 */
export function hasWidget(message: NereyMessage): boolean {
  return widgetOf(message) !== undefined;
}

/**
 * Deduplicates messages by id, keeping the LAST occurrence — a reconnection replay resends
 * earlier messages and the later copy is the more current one.
 *
 * The later copy wins on *content*, but it inherits the *position* of the first occurrence. A
 * message that gets resent has not moved in the conversation, and letting it jump to the end
 * would visibly scramble a transcript every time the socket reconnects.
 */
export function dedupeById(messages: readonly NereyMessage[]): NereyMessage[] {
  const slotById = new Map<string | number, number>();
  const deduped: NereyMessage[] = [];

  for (const message of messages) {
    const slot = slotById.get(message.id);
    if (slot === undefined) {
      slotById.set(message.id, deduped.length);
      deduped.push(message);
    } else {
      deduped[slot] = message;
    }
  }

  return deduped;
}

/**
 * Applies an entry's `migrate` when the persisted payload version differs from the entry's.
 *
 * ADR 0030 — this runs before validation, so `migrate` is the only code that ever sees a
 * historical shape and the component only ever sees a current one. The result is a value, not
 * an exception: a failed migration is an expected branch of the degradation chain (ADR 0012),
 * and the caller turns `reason` into an `invalid-payload` error.
 *
 * The entry is narrowed to `version` and `migrate`, which means `acceptsVersion` is invisible
 * here by construction. An entry that opts into ranged resolution (ADR 0009) must therefore
 * also declare a `migrate` — an identity function is enough — or its off-version payloads
 * resolve and then fail to read.
 */
export function migratePayload(
  entry: Pick<AnyWidgetRegistryEntry, 'version' | 'migrate'>,
  envelope: NereyWidgetEnvelope,
): { ok: true; payload: unknown } | { ok: false; reason: string } {
  if (envelope.version === entry.version) return { ok: true, payload: envelope.payload };

  if (!entry.migrate) {
    return {
      ok: false,
      reason:
        `Widget \`${envelope.type}\` carries payload version ${envelope.version} but the registered ` +
        `entry is version ${entry.version}, and the entry declares no \`migrate\`. Add one to read ` +
        `historical payloads (ADR 0030).`,
    };
  }

  let migrated: unknown;
  try {
    migrated = entry.migrate(envelope.version, envelope.payload);
  } catch (cause) {
    // A migration is ordinary consumer code reading a shape from months ago; it will throw
    // eventually. Catching it here is what keeps one bad branch from taking the transcript
    // down with it (ADR 0030).
    const detail = cause instanceof Error ? cause.message : String(cause);
    return {
      ok: false,
      reason:
        `\`migrate\` for \`${envelope.type}\` threw while converting version ${envelope.version} to ` +
        `${entry.version} — ${detail}`,
    };
  }

  // Only `undefined` means "I cannot read that version". `null` is a payload a schema may well
  // accept, so treating it as failure would take the decision away from `payloadSchema`.
  if (migrated === undefined) {
    return {
      ok: false,
      reason:
        `\`migrate\` for \`${envelope.type}\` returned undefined for payload version ` +
        `${envelope.version}; the entry (version ${entry.version}) cannot read that shape.`,
    };
  }

  return { ok: true, payload: migrated };
}
