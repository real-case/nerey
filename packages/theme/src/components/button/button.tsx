import type { ButtonHTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { cx } from '../../internal/cx';
import styles from './button.module.css';

/**
 * ADR 0026 — the public API is `variant` / `size` / `tone`, and there is no `className`.
 *
 * Accepting a className here would look harmless and would end the theme's life as a
 * replaceable layer: features would style Nerey's DOM directly, the class names would become
 * a de-facto contract, and swapping the theme would touch every call site instead of one
 * package. Per-instance deviation goes through the CSS custom properties this stylesheet
 * declares (`--_bg`, `--_fg`, `--_border`), scoped to a container the consumer owns.
 *
 * `render` is a different thing and is allowed: it changes which ELEMENT is produced — a link
 * that looks like a button, a Base UI trigger — not how it is painted.
 */

export type ButtonVariant = 'solid' | 'outline' | 'ghost';
export type ButtonTone = 'accent' | 'neutral' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style' | 'color'>;

export type ButtonProps = NativeButtonProps & {
  variant?: ButtonVariant;
  tone?: ButtonTone;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Swap the rendered element while keeping every style and attribute. */
  render?: ReactElement;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  solid: styles.solid,
  outline: styles.outline,
  ghost: styles.ghost,
};

const TONE_CLASS: Record<ButtonTone, string | undefined> = {
  accent: undefined,
  neutral: styles.toneNeutral,
  danger: styles.toneDanger,
};

const SIZE_CLASS: Record<ButtonSize, string | undefined> = {
  sm: styles.sizeSm,
  md: undefined,
  lg: styles.sizeLg,
};

export function Button({
  variant = 'solid',
  tone = 'accent',
  size = 'md',
  fullWidth = false,
  render,
  type = 'button',
  children,
  ref,
  ...rest
}: ButtonProps): ReactElement {
  const className = cx(
    styles.root,
    VARIANT_CLASS[variant],
    TONE_CLASS[tone],
    SIZE_CLASS[size],
    fullWidth && styles.fullWidth,
  );

  // `type` defaults to 'button' rather than the HTML default of 'submit'. A button inside a
  // widget that happens to sit inside someone's form would otherwise submit it — a bug that
  // only appears in the consumer's app and never in this repo's stories.
  if (render) {
    const rendered = render as ReactElement<Record<string, unknown>>;
    const renderProps = rendered.props;
    return {
      ...rendered,
      props: {
        ...renderProps,
        ...rest,
        className: cx(
          className,
          typeof renderProps.className === 'string' ? renderProps.className : undefined,
        ),
        children: renderProps.children ?? children,
      },
    } as ReactElement;
  }

  return (
    <button ref={ref} type={type} className={className} {...rest}>
      {children}
    </button>
  );
}
