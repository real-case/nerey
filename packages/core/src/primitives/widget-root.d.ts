import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { NereyState } from '../data-attrs';
import type { Placement, WidgetStatus } from '../types';
import type { RenderProp } from './render-prop';
export type WidgetRootProps = {
  type: string;
  version: string;
  slot: Placement['slot'];
  status: WidgetStatus;
  state?: NereyState;
  readonly?: boolean;
  className?: string;
  style?: CSSProperties;
  render?: RenderProp<Record<string, unknown>>;
  children?: ReactNode;
};
/**
 * The outermost node of a rendered widget, carrying the ADR 0020 identity and state attributes.
 *
 * `className` and `render` are offered here on purpose (ADR 0021 / FR-27). This is the layer
 * whose entire purpose is being styled and composed from outside, and `@nerey/core` ships no CSS
 * of its own, so a consumer's class is the only paint on the node — nothing to override, no
 * specificity contest, no internal names frozen. Withholding the escape hatch would not prevent
 * passthrough styling either; it would relocate it into consumer wrapper components, adding a
 * `<div>` to a node whose job is layout and positioning.
 *
 * The contrast with ADR 0026 is deliberate rather than an inconsistency: `@nerey/theme`
 * components already carry theme-owned CSS, so a caller's class there wins ties by stylesheet
 * order and turns the theme's element tree into de-facto public API. Themed deviation therefore
 * goes through `variant` / `size` / `tone` and token overrides, and those components take no
 * `className` at all. The rule generalises — `className` is safe exactly where the library ships
 * no CSS, and corrosive exactly where it does.
 *
 * Props are forwarded explicitly. There is no `{...rest}`, so an unrecognised prop is a type
 * error instead of a stray DOM attribute.
 */
export declare function WidgetRoot(props: WidgetRootProps): ReactElement;
//# sourceMappingURL=widget-root.d.ts.map
