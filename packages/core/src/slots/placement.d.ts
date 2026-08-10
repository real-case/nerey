import type { NereyMessage, Placement, WidgetRegistry } from '../types';
/**
 * ADR 0017 — where a message renders, resolved once and shared by the three slot hosts.
 *
 * A host cannot answer "is this mine?" from the message alone: placement lives on the registry
 * entry, not on the envelope, so the answer depends on which registry is mounted. Keeping the
 * lookup here is what stops the three hosts from drifting into three slightly different notions of
 * the same question — the failure mode being a widget that either renders twice or nowhere.
 */
export type OverlayPlacement = Extract<
  Placement,
  {
    slot: 'overlay';
  }
>;
/**
 * Derived from `Placement` rather than restated, so widening the union (a fourth position, a third
 * scope) breaks every host that has not been taught the new member instead of silently filtering
 * it out — which is the "registered but nothing renders" failure ADR 0017 exists to prevent.
 */
export type InputPosition = NonNullable<
  Extract<
    Placement,
    {
      slot: 'input';
    }
  >['position']
>;
export type OverlayScope = OverlayPlacement['scope'];
/** ADR 0017 — an input entry that names no position sits above the composer. */
export declare const DEFAULT_INPUT_POSITION: InputPosition;
/**
 * The placement of the entry that will render this message, or `undefined` when nothing resolves.
 *
 * Routed through `resolveEnvelope` rather than reading `message.widget` directly, so a plain-text
 * message is placed by whatever entry the synthesised `text` envelope resolves to — the same single
 * code path the renderer takes (ADR 0035). A transcript where plain text is special-cased is a
 * transcript where the special case is the one nobody tests.
 */
export declare function resolvedPlacement(
  registry: WidgetRegistry,
  message: NereyMessage,
): Placement | undefined;
/**
 * An unresolved message has no placement to read, and the degradation chain renders it as the
 * injected fallback — the message's own text (ADR 0012). That text belongs in the transcript and
 * nowhere else, so an unknown widget stays in the message slot rather than disappearing from the
 * conversation on the strength of a registry miss.
 */
export declare function belongsInTranscript(placement: Placement | undefined): boolean;
/** The position an input-placed entry occupies, or `undefined` for any other slot. */
export declare function inputPositionOf(placement: Placement | undefined): InputPosition | undefined;
/**
 * ADR 0017 — `dismissible` defaults to true. Only an explicit `false` removes the user-initiated
 * exit, and an entry that does so is obliged to declare an expiry rule instead; the conformance kit
 * rejects the combination that leaves a widget with no way out at all.
 */
export declare function isDismissible(placement: OverlayPlacement): boolean;
/**
 * The slot containers repeat `data-nerey-slot`, which the widget's own root already carries, so a
 * bare `[data-nerey-slot='input']` matches both the container and the widget nested inside it. That
 * is why ADR 0017 pairs the slot with `data-nerey-position` / `data-nerey-scope`: the pair selects
 * the positioning box and nothing else, and dropping the slot from the container would leave the
 * consumer selecting on a modifier with no subject.
 */
export declare function inputSlotAttributes(position: InputPosition): Record<string, string>;
export declare function overlaySlotAttributes(scope: OverlayScope): Record<string, string>;
//# sourceMappingURL=placement.d.ts.map
