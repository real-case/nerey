import { useMemo } from 'react';
import type { ReactElement } from 'react';

import { dedupeById } from '../adapter';
import { useWidgetHost } from '../host/host-context';
import { WidgetPart } from '../primitives/widget-part';
import { WidgetRenderer } from '../render/widget-renderer';
import type { NereyMessage } from '../types';
import { isDismissible, overlaySlotAttributes, resolvedPlacement } from './placement';
import type { OverlayScope } from './placement';

export type OverlaySlotHostProps = {
  messages: readonly NereyMessage[];
  scope: OverlayScope;
  onDismiss?: (messageId: string | number) => void;
};

/**
 * The accessible name of the dismiss control. English and not overridable, which is a stated
 * limitation rather than an oversight: the props of this host are fixed by ADR 0017, and a control
 * with no accessible name fails the WCAG 2.2 AA gate (ADR 0032) with no legitimate way to pass. A
 * `dismissLabel` prop is the intended fix when core grows an i18n seam.
 */
export const DEFAULT_DISMISS_LABEL = 'Dismiss';

type MatchedOverlay = { message: NereyMessage; dismissible: boolean };

/**
 * ADR 0017 — the overlay slot, for widgets that sit above the conversation rather than in it.
 *
 * **It does not portal, and it writes no `z-index`.** ADR 0017 records `scope: 'page'` as an open
 * problem, not a solved one: portalling outside the conversation subtree lands core in DOM the
 * consumer owns, next to their own portal roots and their own stacking contexts, and the survey
 * behind the requirements found no precedent to copy — MCP Apps has no placement concept, the
 * Vercel AI SDK renders tool parts inline, and the OpenAI Apps SDK's display modes are host-owned
 * surfaces an app cannot portal into. So the widget renders where the host is mounted, `'page'` and
 * `'chat'` differ only by the attribute on the container, and **positioning is the consumer's**:
 * `[data-nerey-slot='overlay'][data-nerey-scope='page']` is the selector they take `position:
 * fixed` and their own layer number to.
 *
 * For the same reason there is no `role="dialog"`, no `aria-modal`, no focus trap and no scroll
 * lock. Core cannot name the dialog — the name lives inside the widget's payload, which core does
 * not read — and it cannot trap focus without the wrapped Base UI dialog that belongs to
 * `@nerey/theme` (ADR 0022). Dialog semantics with neither is not a partial implementation; it is
 * an axe failure and a keyboard trap, and announcing a dialog that does not behave like one is
 * worse for a screen-reader user than announcing nothing.
 */
export function OverlaySlotHost(props: OverlaySlotHostProps): ReactElement | null {
  const { messages, scope, onDismiss } = props;
  const { registry } = useWidgetHost();

  const overlays = useMemo<readonly MatchedOverlay[]>(() => {
    const matched: MatchedOverlay[] = [];

    // Deduplicated first, so a replayed message cannot put the same key on two children of the
    // stack — React would reconcile them as one and the second overlay would inherit the first
    // one's widget state.
    for (const message of dedupeById(messages)) {
      const placement = resolvedPlacement(registry, message);
      if (placement === undefined || placement.slot !== 'overlay') continue;
      // Scope is a filter and never a fallback: an overlay declared `'page'` must not appear in a
      // `'chat'`-scoped host just because that host happens to be the one mounted. Rendering it in
      // the wrong surface is indistinguishable from rendering it in the right one until it is on
      // top of the composer.
      if (placement.scope !== scope) continue;
      matched.push({ message, dismissible: isDismissible(placement) });
    }

    return matched;
  }, [messages, registry, scope]);

  if (overlays.length === 0) return null;

  // Message order, not reverse: ADR 0017 resolves overlay contention in favour of the most recent
  // message, and the way a stack expresses "most recent" is by being last — later siblings paint
  // over earlier ones under any positioning the consumer chooses. The displaced overlay is left
  // mounted deliberately; ADR 0017 requires it to be expired through the lifecycle runtime
  // (ADR 0018) rather than unmounted behind the user, so that whatever it was showing reaches a
  // terminal state instead of disappearing mid-decision.
  return (
    <>
      {overlays.map(({ message, dismissible }) => (
        // One container per overlay rather than one around the stack. An overlay is a surface: it
        // has to contain its own widget AND its own dismiss control for a consumer to position and
        // paint the pair as a unit, which a shared wrapper with flattened children cannot express.
        <div key={message.id} {...overlaySlotAttributes(scope)}>
          <WidgetRenderer message={message} />
          {/* The control is omitted with no `onDismiss` to call, even when the placement is
              dismissible. Core cannot remove a message from a list it does not own, so the button
              would be inert — and an inert close button reads as a broken overlay, which is worse
              than an overlay that visibly has no close button at all. */}
          {dismissible && onDismiss !== undefined && (
            <WidgetPart
              part="dismiss"
              // Deliberately childless. Core ships no CSS and no glyph, so a visible label would be
              // untranslatable English chrome in a headless library; the accessible name carries
              // the meaning and `[data-nerey-part='dismiss']` is where the consumer puts the ×.
              render={(partProps) => (
                <button
                  {...partProps}
                  type="button"
                  aria-label={DEFAULT_DISMISS_LABEL}
                  onClick={() => {
                    onDismiss(message.id);
                  }}
                />
              )}
            />
          )}
        </div>
      ))}
    </>
  );
}
