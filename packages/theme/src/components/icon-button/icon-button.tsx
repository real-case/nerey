import { createElement } from 'react';
import type { ButtonHTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { cx } from '../../internal/cx';
import { renderElement } from '../../internal/render-element';
import styles from './icon-button.module.css';

/**
 * A square button whose content is a glyph.
 *
 * `label` is REQUIRED, and `aria-label` is removed from the accepted native props so it is the
 * only way to name the control. An icon-only button with no accessible name is the most common
 * defect in component libraries — a screen reader reads "button" and stops — and it is a defect
 * that no amount of review catches reliably, because the button looks finished. Making the type
 * refuse to compile moves the failure to the one place it cannot be missed (ADR 0032).
 *
 * The variant / tone / size axes match Button exactly, so the two are interchangeable in a
 * toolbar. The rules are restated in `icon-button.module.css` rather than composed from
 * `button.module.css`: sharing them would make one edit surface out of two geometries that must
 * be free to diverge — a square control's padding, minimum size and glyph alignment have
 * nothing to say about a label-bearing one.
 */

export type IconButtonVariant = 'solid' | 'outline' | 'ghost';
export type IconButtonTone = 'accent' | 'neutral' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';

type NativeIconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'style' | 'color' | 'aria-label' | 'aria-labelledby'
>;

export type IconButtonProps = NativeIconButtonProps & {
  /** The control's accessible name. Not optional — see the note above. */
  label: string;
  variant?: IconButtonVariant;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  /** Swap the rendered element while keeping every style and attribute. */
  render?: ReactElement;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

const VARIANT_CLASS: Record<IconButtonVariant, string | undefined> = {
  solid: styles.solid,
  outline: styles.outline,
  ghost: styles.ghost,
};

const TONE_CLASS: Record<IconButtonTone, string | undefined> = {
  accent: styles.toneAccent,
  neutral: undefined,
  danger: styles.toneDanger,
};

const SIZE_CLASS: Record<IconButtonSize, string | undefined> = {
  sm: styles.sizeSm,
  md: undefined,
  lg: styles.sizeLg,
};

export function IconButton({
  label,
  variant = 'ghost',
  tone = 'neutral',
  size = 'md',
  render,
  type = 'button',
  children,
  ref,
  ...rest
}: IconButtonProps): ReactElement {
  const domProps: Record<string, unknown> = {
    ...rest,
    ref,
    // `type` defaults to 'button' rather than the HTML default of 'submit'. An icon button
    // inside a widget that happens to sit inside someone's form would otherwise submit it — a
    // bug that only appears in the consumer's app and never in this repo's stories.
    type,
    'aria-label': label,
    className: cx(styles.root, VARIANT_CLASS[variant], TONE_CLASS[tone], SIZE_CLASS[size]),
    children,
  };

  return renderElement(render, domProps, (merged) => createElement('button', merged));
}
