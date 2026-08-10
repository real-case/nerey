import { createElement } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';

import { partAttributes } from '../data-attrs';
import type { NereyState } from '../data-attrs';
import { renderWith } from './render-prop';
import type { RenderProp } from './render-prop';

/**
 * A closed list rather than `keyof JSX.IntrinsicElements`. The point of `as` is picking the
 * semantically correct container for a region of a widget; anything beyond that — a router link,
 * a design-system component, an element that needs its own props — goes through `render`, which
 * handles it without core growing a generic polymorphic signature that collapses to `any` under
 * strict mode (ADR 0021).
 */
export type WidgetPartElement = 'div' | 'span' | 'section' | 'header' | 'footer' | 'ul' | 'li' | 'p';

export type WidgetPartProps = {
  part: string;
  state?: NereyState;
  as?: WidgetPartElement;
  className?: string;
  style?: CSSProperties;
  render?: RenderProp<Record<string, unknown>>;
  children?: ReactNode;
};

/**
 * A named region inside a widget, carrying `data-nerey-part` and, when the region has one, its
 * `data-state` (ADR 0020). Parts are how a consumer's stylesheet reaches inside a widget without
 * descendant selectors against an element tree core is free to change.
 *
 * `className` and `render` are accepted for the same reason as on `WidgetRoot` (ADR 0021): core
 * ships no CSS, so there is nothing here for a consumer's class to fight with, and a part that
 * cannot become the consumer's own component gets wrapped in a `<div>` instead — which changes
 * the box model of the thing they were trying to style. Themed components make the opposite
 * choice under ADR 0026, because there the CSS on the node is the deliverable.
 */
export function WidgetPart(props: WidgetPartProps): ReactElement {
  const { part, state, as = 'div', className, style, render, children } = props;

  const domProps: Record<string, unknown> = {
    ...partAttributes(part, state),
    ...(className !== undefined ? { className } : {}),
    ...(style !== undefined ? { style } : {}),
    children,
  };

  // `createElement` rather than JSX, because JSX would need a capitalised alias for `as` and that
  // reads as a component when it is a tag name. The closure is rebuilt every render and that is
  // fine: `renderWith` calls it synchronously, so its identity never reaches React.
  return renderWith(render, domProps, (merged) => createElement(as, merged));
}
