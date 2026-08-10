import type { ReactElement } from 'react';
import type { NereyMessage, WidgetStatus } from '../types';
export type MessageSlotHostProps = {
  messages: readonly NereyMessage[];
  /** Per-message streaming status, e.g. the last message while a response streams. */
  statusOf?: (message: NereyMessage) => WidgetStatus;
  readonlyOf?: (message: NereyMessage) => boolean;
};
/**
 * ADR 0017 — the transcript slot. Every message whose entry places it inline renders here, in
 * message order, at the position of its own message.
 *
 * A message with no resolvable entry renders here too. That is not leniency: the degradation chain
 * turns it into the injected fallback (ADR 0012), and a fallback is the message's text, which has
 * exactly one correct home. Filtering unresolved messages out would delete an exchange from the
 * conversation because of a registry gap — the transcript would silently lose turns on a version
 * bump, which is the most expensive way to discover a mismatched registration.
 */
export declare function MessageSlotHost(props: MessageSlotHostProps): ReactElement;
//# sourceMappingURL=message-slot-host.d.ts.map
