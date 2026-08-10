import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { dedupeById } from '../adapter';
import { useWidgetHost } from '../host/host-context';
import { WidgetRenderer } from '../render/widget-renderer';
import type { NereyMessage } from '../types';
import { inputPositionOf, inputSlotAttributes, resolvedPlacement } from './placement';
import type { InputPosition } from './placement';

export type InputSlotHostProps = {
  messages: readonly NereyMessage[];
  position: InputPosition;
  /** The host's own composer. */
  children?: ReactNode;
};

/**
 * ADR 0017 — the composer slot. A widget placed at `{ slot: 'input' }` renders adjacent to the
 * host's composer, or in place of it when the entry asks for `position: 'replace'`.
 *
 * The composer is passed as `children` rather than located by core. That shape is what lets
 * `'replace'` work at all — core can only take the composer away if the composer is something core
 * renders — and it makes the three positions compose by nesting, innermost first:
 *
 *     <InputSlotHost messages={messages} position="above">
 *       <InputSlotHost messages={messages} position="below">
 *         <InputSlotHost messages={messages} position="replace">
 *           <Composer />
 *
 * which lays out as `above → (composer | replacement) → below`. Nesting the other way round would
 * put the `above` and `below` widgets inside the subtree `replace` removes, so answering a takeover
 * widget would silently drop the two unrelated ones.
 */
export function InputSlotHost(props: InputSlotHostProps): ReactElement | null {
  const { messages, position, children } = props;
  const { registry } = useWidgetHost();

  const selected = useMemo(() => {
    const ordered = dedupeById(messages);

    // Scanned from the end, and exactly one match is taken. Two widgets competing for the composer
    // is a bug on the producing side — a stale prompt that was never answered, a duplicate tool
    // call — and rendering both would dress that bug up as a layout: two "Confirm" rows under one
    // text box, one of them answering a question three turns old. ADR 0017 resolves the contention
    // in favour of the most recent message, which is the only one the user is being asked about.
    //
    // The consequence is recorded rather than hidden: the displaced widget vanishes, and because
    // its placement keeps it out of the transcript it does not reappear there either. ADR 0017
    // wants it *expired* through the lifecycle runtime (ADR 0018) so it leaves a legible terminal
    // state behind; that needs a signal from the renderer back to the host which the current API
    // does not carry, and faking it here — evaluating the same rules against a second, independent
    // baseline that never sees the widget's interactions — would expire the wrong widget at the
    // wrong time. An entry that occupies this slot should declare `{ on: 'message' }` expiry.
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const message = ordered[index];
      // `noUncheckedIndexedAccess`. The index is in range by construction; a guard costs nothing
      // and the non-null assertion that would replace it is banned outright (ADR 0003).
      if (message === undefined) continue;
      if (inputPositionOf(resolvedPlacement(registry, message)) === position) return message;
    }

    return undefined;
  }, [messages, registry, position]);

  if (selected === undefined) {
    // Nothing claims this position, so the composer is whatever the caller passed — including for
    // `'replace'`, which is how the composer comes back once the widget is gone. `null` rather than
    // an empty fragment when there are no children at all, so "no slot content" is distinguishable
    // from "an empty box" by a caller that inspects the result.
    return children === undefined ? null : <>{children}</>;
  }

  // One box per widget, carrying the positioning seam (ADR 0017 / 0020). Core writes no layout and
  // no `z-index` onto it; `[data-nerey-slot='input'][data-nerey-position='above']` is where the
  // consumer's stylesheet does that. Note that this wraps only the widget and never the composer:
  // putting the caller's own input inside a Nerey-owned element would change the box it laid out.
  const widget = (
    <div {...inputSlotAttributes(position)}>
      <WidgetRenderer message={selected} />
    </div>
  );

  // `replace` renders the widget INSTEAD of the children — the widget is the input surface for as
  // long as it is live. Nothing else in core takes a consumer's UI away, which is why ADR 0017
  // pairs this with the obligation to reach a terminal state.
  if (position === 'replace') return widget;

  return position === 'above' ? (
    <>
      {widget}
      {children}
    </>
  ) : (
    <>
      {children}
      {widget}
    </>
  );
}
