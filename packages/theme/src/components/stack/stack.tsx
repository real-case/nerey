import { createElement } from 'react';
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { cx } from '../../internal/cx';
import { renderElement } from '../../internal/render-element';
import styles from './stack.module.css';

/**
 * ADR 0026 — layout is an axis of the component, not a class the caller writes.
 *
 * Stack exists so that no component in this theme has to own external margin. A margin belongs
 * to the relationship between two elements, not to either one of them: the moment a card sets
 * `margin-block-end`, it is wrong in every layout that does not stack cards vertically, and the
 * fix is a `className` override — which ADR 0026 does not have. Handing the gap to the parent
 * makes the spacing decision visible at the site that actually knows the answer.
 */

export type StackDirection = 'row' | 'column';
/** Indices into the `--nerey-space-*` scale, not raw lengths (ADR 0024). */
export type StackGap = 0 | 1 | 2 | 3 | 4 | 6 | 8;
export type StackAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type StackJustify = 'start' | 'center' | 'end' | 'between' | 'around';

type NativeStackProps = Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'color'>;

export type StackProps = NativeStackProps & {
  direction?: StackDirection;
  gap?: StackGap;
  align?: StackAlign;
  justify?: StackJustify;
  wrap?: boolean;
  /** Swap the rendered element while keeping every style and attribute. */
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

const DIRECTION_CLASS: Record<StackDirection, string | undefined> = {
  row: styles.row,
  column: undefined,
};

const GAP_CLASS: Record<StackGap, string | undefined> = {
  0: undefined,
  1: styles.gap1,
  2: styles.gap2,
  3: styles.gap3,
  4: styles.gap4,
  6: styles.gap6,
  8: styles.gap8,
};

const ALIGN_CLASS: Record<StackAlign, string | undefined> = {
  start: styles.alignStart,
  center: styles.alignCenter,
  end: styles.alignEnd,
  stretch: undefined,
  baseline: styles.alignBaseline,
};

const JUSTIFY_CLASS: Record<StackJustify, string | undefined> = {
  start: undefined,
  center: styles.justifyCenter,
  end: styles.justifyEnd,
  between: styles.justifyBetween,
  around: styles.justifyAround,
};

export function Stack({
  direction = 'column',
  // A layout primitive that invents spacing nobody asked for is a primitive every call site has
  // to argue with, so the default is no gap at all.
  gap = 0,
  align = 'stretch',
  justify = 'start',
  wrap = false,
  render,
  children,
  ref,
  ...rest
}: StackProps): ReactElement {
  const domProps: Record<string, unknown> = {
    ...rest,
    ref,
    className: cx(
      styles.root,
      DIRECTION_CLASS[direction],
      GAP_CLASS[gap],
      ALIGN_CLASS[align],
      JUSTIFY_CLASS[justify],
      wrap && styles.wrap,
    ),
    children,
  };

  return renderElement(render, domProps, (merged) => createElement('div', merged));
}
