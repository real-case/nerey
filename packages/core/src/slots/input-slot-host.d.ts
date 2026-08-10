import type { ReactElement, ReactNode } from 'react';
import type { NereyMessage } from '../types';
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
export declare function InputSlotHost(props: InputSlotHostProps): ReactElement | null;
//# sourceMappingURL=input-slot-host.d.ts.map
