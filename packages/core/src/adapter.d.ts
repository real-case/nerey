import type { AnyWidgetRegistryEntry, NereyMessage, NereyWidgetEnvelope } from './types';
/**
 * ADR 0008 — what crosses the boundary is `{ type, version, payload }` and never markup or
 * code, so "normalising a message" can only ever mean choosing an envelope. Nothing in this
 * module evaluates, parses or executes anything the model produced.
 */
export declare const TEXT_WIDGET_TYPE = 'text';
export declare const TEXT_WIDGET_VERSION = '1.0.0';
/**
 * The consumer's conversion from their own message type into Nerey's (FR-5). It is a type and
 * nothing more on purpose: Nerey must not import an application schema, so the function is
 * authored on the consumer's side and injected at the host boundary.
 */
export type MessageAdapter<TSource> = (source: TSource) => NereyMessage;
/**
 * Returns the widget envelope to render for a message. A message with no widget gets a
 * synthesised text envelope, so the renderer has exactly ONE code path.
 *
 * That single path is what keeps the degradation chain (ADR 0012) honest: plain assistant text
 * resolves, validates and renders through the same steps as a `confirmation`, so the fallback
 * port is exercised on every ordinary message rather than only on the bad day (ADR 0035).
 */
export declare function resolveEnvelope(message: NereyMessage): NereyWidgetEnvelope;
/**
 * True when the message carries a real widget rather than a synthesised text envelope.
 *
 * The check is presence only. An envelope with an empty or unrecognised `type` still counts as
 * a widget, because letting it through to resolution produces `unknown-widget` (ADR 0013) —
 * a diagnosable error — whereas silently treating it as text would hide a producer bug behind
 * output that looks correct.
 */
export declare function hasWidget(message: NereyMessage): boolean;
/**
 * Deduplicates messages by id, keeping the LAST occurrence — a reconnection replay resends
 * earlier messages and the later copy is the more current one.
 *
 * The later copy wins on *content*, but it inherits the *position* of the first occurrence. A
 * message that gets resent has not moved in the conversation, and letting it jump to the end
 * would visibly scramble a transcript every time the socket reconnects.
 */
export declare function dedupeById(messages: readonly NereyMessage[]): NereyMessage[];
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
export declare function migratePayload(
  entry: Pick<AnyWidgetRegistryEntry, 'version' | 'migrate'>,
  envelope: NereyWidgetEnvelope,
):
  | {
      ok: true;
      payload: unknown;
    }
  | {
      ok: false;
      reason: string;
    };
//# sourceMappingURL=adapter.d.ts.map
