import type { NereyErrorCode, NereyErrorLike } from './types';
/**
 * ADR 0013 — a typed error taxonomy. Every failure Nerey can produce is one of five codes,
 * carries the widget coordinates that identify it, and reaches the consumer through the
 * host's `onWidgetError`. Nerey never writes to `console` on a consumer's behalf: a library
 * that logs is a library that shows up in someone else's error budget.
 */
export declare class NereyError extends Error implements NereyErrorLike {
  readonly code: NereyErrorCode;
  readonly widgetType?: string;
  readonly widgetVersion?: string;
  readonly messageId?: string | number;
  readonly issues?: readonly {
    path: string;
    message: string;
  }[];
  constructor(init: NereyErrorLike);
}
type Coords = {
  messageId?: string | number;
  widgetType?: string;
  widgetVersion?: string;
};
export declare function unknownWidgetError(
  type: string,
  version: string,
  messageId?: string | number,
): NereyError;
export declare function invalidPayloadError(
  coords: Coords,
  issues: readonly {
    path: string;
    message: string;
  }[],
): NereyError;
export declare function invalidStateError(
  coords: Coords,
  issues: readonly {
    path: string;
    message: string;
  }[],
): NereyError;
export declare function widgetRenderError(coords: Coords, cause: unknown): NereyError;
export declare function persistenceError(coords: Coords, cause: unknown): NereyError;
export declare function isNereyError(value: unknown): value is NereyError;
export {};
//# sourceMappingURL=errors.d.ts.map
