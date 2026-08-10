import { createElement } from 'react';
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { cx } from '../../internal/cx';
import styles from './text.module.css';

/**
 * ADR 0026 — `size`, `tone` and `weight` are the axes; `as` is not one of them.
 *
 * `as` picks the ELEMENT, which is a document-structure decision: a section heading is an `<h3>`
 * because it is a heading, not because it is large. Appearance stays on `size` and `weight`, so
 * a heading that has to look like body copy needs no override and body copy that has to look
 * like a heading does not silently enter the document outline. The two are separable precisely
 * because they answer different questions.
 *
 * The list is closed rather than `keyof JSX.IntrinsicElements` for the same reason it is closed
 * on core's `WidgetPart` (ADR 0021): a generic polymorphic signature collapses to `any` under
 * strict mode, and everything outside this list is a component, not a tag.
 */

export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type TextTone = 'primary' | 'secondary' | 'muted' | 'accent' | 'danger' | 'success';
export type TextWeight = 'normal' | 'medium' | 'semibold';
export type TextElement = 'p' | 'span' | 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'strong' | 'em';

type NativeTextProps = Omit<HTMLAttributes<HTMLElement>, 'className' | 'style' | 'color'>;

export type TextProps = NativeTextProps & {
  size?: TextSize;
  tone?: TextTone;
  weight?: TextWeight;
  as?: TextElement;
  truncate?: boolean;
  mono?: boolean;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
};

const SIZE_CLASS: Record<TextSize, string | undefined> = {
  xs: styles.sizeXs,
  sm: styles.sizeSm,
  md: undefined,
  lg: styles.sizeLg,
  xl: styles.sizeXl,
};

const TONE_CLASS: Record<TextTone, string | undefined> = {
  primary: undefined,
  secondary: styles.toneSecondary,
  muted: styles.toneMuted,
  accent: styles.toneAccent,
  danger: styles.toneDanger,
  success: styles.toneSuccess,
};

const WEIGHT_CLASS: Record<TextWeight, string | undefined> = {
  normal: undefined,
  medium: styles.weightMedium,
  semibold: styles.weightSemibold,
};

export function Text({
  size = 'md',
  tone = 'primary',
  weight = 'normal',
  as = 'p',
  truncate = false,
  mono = false,
  children,
  ref,
  ...rest
}: TextProps): ReactElement {
  const domProps: Record<string, unknown> = {
    ...rest,
    ref,
    className: cx(
      styles.root,
      SIZE_CLASS[size],
      TONE_CLASS[tone],
      WEIGHT_CLASS[weight],
      truncate && styles.truncate,
      mono && styles.mono,
    ),
    children,
  };

  // `createElement` rather than JSX, because JSX would need a capitalised alias for `as` and
  // that reads as a component when it is a tag name.
  return createElement(as, domProps);
}
