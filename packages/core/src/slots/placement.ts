import { resolveEnvelope } from '../adapter';
import { NEREY_ATTR } from '../data-attrs';
import type { NereyMessage, Placement, WidgetRegistry } from '../types';

/**
 * ADR 0017 — where a message renders, resolved once and shared by the three slot hosts.
 *
 * A host cannot answer "is this mine?" from the message alone: placement lives on the registry
 * entry, not on the envelope, so the answer depends on which registry is mounted. Keeping the
 * lookup here is what stops the three hosts from drifting into three slightly different notions of
 * the same question — the failure mode being a widget that either renders twice or nowhere.
 */

export type OverlayPlacement = Extract<Placement, { slot: 'overlay' }>;

/**
 * Derived from `Placement` rather than restated, so widening the union (a fourth position, a third
 * scope) breaks every host that has not been taught the new member instead of silently filtering
 * it out — which is the "registered but nothing renders" failure ADR 0017 exists to prevent.
 */
export type InputPosition = NonNullable<Extract<Placement, { slot: 'input' }>['position']>;
export type OverlayScope = OverlayPlacement['scope'];

/** ADR 0017 — an input entry that names no position sits above the composer. */
export const DEFAULT_INPUT_POSITION: InputPosition = 'above';

/**
 * ADR 0017 names `data-nerey-position` and `data-nerey-scope` as part of the styling contract,
 * next to `data-nerey-slot`. The ADR 0020 vocabulary in `data-attrs.ts` predates both, and they are
 * spelled here rather than bolted onto `NEREY_ATTR` so the contract module keeps a single owner —
 * they belong in it, and `check-data-contract` will need them, the next time it is opened.
 */
const ATTR_POSITION = 'data-nerey-position';
const ATTR_SCOPE = 'data-nerey-scope';

/**
 * The placement of the entry that will render this message, or `undefined` when nothing resolves.
 *
 * Routed through `resolveEnvelope` rather than reading `message.widget` directly, so a plain-text
 * message is placed by whatever entry the synthesised `text` envelope resolves to — the same single
 * code path the renderer takes (ADR 0035). A transcript where plain text is special-cased is a
 * transcript where the special case is the one nobody tests.
 */
export function resolvedPlacement(registry: WidgetRegistry, message: NereyMessage): Placement | undefined {
  const envelope = resolveEnvelope(message);
  return registry.get(envelope.type, envelope.version)?.placement;
}

/**
 * An unresolved message has no placement to read, and the degradation chain renders it as the
 * injected fallback — the message's own text (ADR 0012). That text belongs in the transcript and
 * nowhere else, so an unknown widget stays in the message slot rather than disappearing from the
 * conversation on the strength of a registry miss.
 */
export function belongsInTranscript(placement: Placement | undefined): boolean {
  return placement === undefined || placement.slot === 'message';
}

/** The position an input-placed entry occupies, or `undefined` for any other slot. */
export function inputPositionOf(placement: Placement | undefined): InputPosition | undefined {
  if (placement === undefined || placement.slot !== 'input') return undefined;
  return placement.position ?? DEFAULT_INPUT_POSITION;
}

/**
 * ADR 0017 — `dismissible` defaults to true. Only an explicit `false` removes the user-initiated
 * exit, and an entry that does so is obliged to declare an expiry rule instead; the conformance kit
 * rejects the combination that leaves a widget with no way out at all.
 */
export function isDismissible(placement: OverlayPlacement): boolean {
  return placement.dismissible !== false;
}

/**
 * The slot containers repeat `data-nerey-slot`, which the widget's own root already carries, so a
 * bare `[data-nerey-slot='input']` matches both the container and the widget nested inside it. That
 * is why ADR 0017 pairs the slot with `data-nerey-position` / `data-nerey-scope`: the pair selects
 * the positioning box and nothing else, and dropping the slot from the container would leave the
 * consumer selecting on a modifier with no subject.
 */
export function inputSlotAttributes(position: InputPosition): Record<string, string> {
  return { [NEREY_ATTR.slot]: 'input', [ATTR_POSITION]: position };
}

export function overlaySlotAttributes(scope: OverlayScope): Record<string, string> {
  return { [NEREY_ATTR.slot]: 'overlay', [ATTR_SCOPE]: scope };
}
