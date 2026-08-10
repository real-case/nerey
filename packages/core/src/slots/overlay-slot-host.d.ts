import type { ReactElement } from 'react';
import type { NereyMessage } from '../types';
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
export declare const DEFAULT_DISMISS_LABEL = 'Dismiss';
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
export declare function OverlaySlotHost(props: OverlaySlotHostProps): ReactElement | null;
//# sourceMappingURL=overlay-slot-host.d.ts.map
