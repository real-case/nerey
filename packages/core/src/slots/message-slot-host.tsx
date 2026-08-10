import { useMemo } from 'react';
import type { ReactElement } from 'react';

import { dedupeById } from '../adapter';
import { useWidgetHost } from '../host/host-context';
import { WidgetRenderer } from '../render/widget-renderer';
import type { NereyMessage, WidgetStatus } from '../types';
import { belongsInTranscript, resolvedPlacement } from './placement';

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
export function MessageSlotHost(props: MessageSlotHostProps): ReactElement {
  const { messages, statusOf, readonlyOf } = props;
  const { registry } = useWidgetHost();

  const transcript = useMemo(
    // Deduplicated before filtering, not after: `dedupeById` keeps the LAST copy's content at the
    // FIRST copy's position (see `adapter.ts`), and a socket reconnect that replays the tail must
    // not be able to duplicate a React key — two children under one key is a reconciliation bug
    // that surfaces as a widget resetting its own state.
    () => dedupeById(messages).filter((message) => belongsInTranscript(resolvedPlacement(registry, message))),
    [messages, registry],
  );

  // A fragment, not a container. The transcript's layout — spacing, alignment, virtualisation — is
  // the consumer's, and a wrapper here would insert a box between their list element and its
  // children, breaking `display: grid` and `gap` on the very element they laid the list out with.
  // The per-widget `data-nerey-slot="message"` is already on each `WidgetRoot` (ADR 0020), so
  // nothing about the styling contract needs a node of its own.
  return (
    <>
      {transcript.map((message) => (
        // `status` and `readonly` are forwarded as-is, including `undefined`. `WidgetRenderer`
        // owns the defaults, and restating them here would be a second place to change them.
        <WidgetRenderer
          key={message.id}
          message={message}
          status={statusOf?.(message)}
          readonly={readonlyOf?.(message)}
        />
      ))}
    </>
  );
}
