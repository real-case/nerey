import { createElement } from 'react';
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { cx } from '../../internal/cx';
import { renderElement } from '../../internal/render-element';
import styles from './surface.module.css';

/**
 * ADR 0026 — `variant` / `padding` / `radius`, and no `className`.
 *
 * Surface is the panel every widget sits in, which makes it the component a consumer is most
 * tempted to reach into: one `className` here and the theme's nesting becomes their layout
 * contract. The three axes cover what a panel actually varies by — how it separates itself from
 * the canvas, how much room it gives its content, how round it is — and per-instance deviation
 * goes through the `--nerey-*` tokens on a container the consumer owns.
 *
 * `render` is allowed for the same reason it is on Button: a panel is frequently a `<section>`
 * or an `<article>`, and choosing the element is a semantic decision, not a visual one.
 */

export type SurfaceVariant = 'raised' | 'sunken' | 'outline' | 'ghost';
export type SurfacePadding = 'none' | 'sm' | 'md' | 'lg';
export type SurfaceRadius = 'md' | 'lg' | 'xl';

type NativeSurfaceProps = Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'color'>;

export type SurfaceProps = NativeSurfaceProps & {
  variant?: SurfaceVariant;
  padding?: SurfacePadding;
  radius?: SurfaceRadius;
  /** Swap the rendered element while keeping every style and attribute. */
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

const VARIANT_CLASS: Record<SurfaceVariant, string | undefined> = {
  raised: styles.raised,
  sunken: styles.sunken,
  outline: styles.outline,
  ghost: styles.ghost,
};

const PADDING_CLASS: Record<SurfacePadding, string | undefined> = {
  none: styles.padNone,
  sm: styles.padSm,
  md: undefined,
  lg: styles.padLg,
};

const RADIUS_CLASS: Record<SurfaceRadius, string | undefined> = {
  md: styles.radiusMd,
  lg: undefined,
  xl: styles.radiusXl,
};

export function Surface({
  variant = 'raised',
  padding = 'md',
  radius = 'lg',
  render,
  children,
  ref,
  ...rest
}: SurfaceProps): ReactElement {
  const domProps: Record<string, unknown> = {
    ...rest,
    ref,
    className: cx(styles.root, VARIANT_CLASS[variant], PADDING_CLASS[padding], RADIUS_CLASS[radius]),
    children,
  };

  // The merge composes the caller's `className` and event handlers with ours instead of letting
  // one side silently win, which is the failure mode that makes `render` props untrustworthy
  // (ADR 0021).
  return renderElement(render, domProps, (merged) => createElement('div', merged));
}
