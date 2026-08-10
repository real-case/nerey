import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { cx } from '../../internal/cx';
import styles from './badge.module.css';

/**
 * ADR 0026 — `variant` / `size` / `tone`, and no `className`.
 *
 * A badge carries no interaction and no accessible role of its own: it is a `<span>` whose text
 * is the whole message. That is deliberate. A status pill that is announced as "status, Live"
 * because someone reached for `role="status"` turns every re-render into a live-region
 * announcement; if a badge's change needs announcing, the live region belongs to the region
 * that changed, not to the pill inside it.
 */

export type BadgeTone = 'neutral' | 'accent' | 'danger' | 'success' | 'warning';
export type BadgeVariant = 'subtle' | 'solid' | 'outline';
export type BadgeSize = 'sm' | 'md';

type NativeBadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'style' | 'color'>;

export type BadgeProps = NativeBadgeProps & {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: BadgeSize;
  ref?: Ref<HTMLSpanElement>;
  children?: ReactNode;
};

const TONE_CLASS: Record<BadgeTone, string | undefined> = {
  neutral: undefined,
  accent: styles.toneAccent,
  danger: styles.toneDanger,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
};

const VARIANT_CLASS: Record<BadgeVariant, string | undefined> = {
  subtle: undefined,
  solid: styles.solid,
  outline: styles.outline,
};

const SIZE_CLASS: Record<BadgeSize, string | undefined> = {
  sm: styles.sizeSm,
  md: undefined,
};

export function Badge({
  tone = 'neutral',
  variant = 'subtle',
  size = 'md',
  children,
  ref,
  ...rest
}: BadgeProps): ReactElement {
  const className = cx(styles.root, TONE_CLASS[tone], VARIANT_CLASS[variant], SIZE_CLASS[size]);

  return (
    <span ref={ref} className={className} {...rest}>
      {children}
    </span>
  );
}
