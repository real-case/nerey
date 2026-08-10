import type { ReactElement } from 'react';
import type { FallbackReason } from '../data-attrs';
export type FallbackProps = {
  text: string;
  messageId: string | number;
  reason: FallbackReason;
};
/**
 * The terminal step of the degradation chain (ADR 0012) and the one guarantee Nerey makes
 * unconditionally: whatever went wrong, the message stays readable.
 *
 * The text goes through the host's injected `renderFallback` rather than through anything Nerey
 * owns, because the consumer's markdown pipeline already encodes their sanitisation and link
 * policy — shipping a second one would make a security decision on behalf of an application core
 * knows nothing about (ADR 0012 / FR-14).
 *
 * `reason` is emitted rather than inferred so a consumer's CSS and a bug report can tell an
 * unknown widget from a bad payload from an expired one without reading the error stream
 * (ADR 0020). No error is emitted from here: whichever step routed here has already reported.
 */
export declare function WidgetFallback(props: FallbackProps): ReactElement;
//# sourceMappingURL=fallback.d.ts.map
