import type { HTMLAttributes, ReactElement, Ref } from 'react';

import { VisuallyHidden } from '../visually-hidden/visually-hidden';
import { cx } from '../../internal/cx';
import styles from './spinner.module.css';

/**
 * An indeterminate busy indicator.
 *
 * The split between the graphic and the label is the whole accessibility design. The arc is
 * `aria-hidden` because a rotating quarter-circle means nothing to a screen reader, and the
 * label is real text inside a `role="status"` region because a live region with no content
 * announces nothing when it updates — `aria-label` on the wrapper would look equivalent and
 * would be silent.
 *
 * The arc is drawn here rather than imported from `icons.tsx`: the icon set is sized by a
 * `size` NUMBER, and this graphic has to be sized and animated from CSS so that both follow the
 * `size` prop and `prefers-reduced-motion` without a second render.
 */

export type SpinnerSize = 'sm' | 'md' | 'lg';

/** Exported so a host can translate it once instead of at every call site. */
export const DEFAULT_SPINNER_LABEL = 'Loading';

type NativeSpinnerProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'className' | 'style' | 'color' | 'role' | 'children'
>;

export type SpinnerProps = NativeSpinnerProps & {
  size?: SpinnerSize;
  label?: string;
  ref?: Ref<HTMLSpanElement>;
};

const SIZE_CLASS: Record<SpinnerSize, string | undefined> = {
  sm: styles.sizeSm,
  md: undefined,
  lg: styles.sizeLg,
};

export function Spinner({
  size = 'md',
  label = DEFAULT_SPINNER_LABEL,
  ref,
  ...rest
}: SpinnerProps): ReactElement {
  return (
    <span ref={ref} role="status" className={cx(styles.root, SIZE_CLASS[size])} {...rest}>
      <svg className={styles.glyph} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle className={styles.track} cx="8" cy="8" r="6" />
        {/* A 270° arc: starts at the top and sweeps clockwise to the left of the circle, which
            leaves a gap big enough to read the rotation at 1rem. */}
        <path className={styles.arc} d="M8 2a6 6 0 1 1-6 6" />
      </svg>
      <VisuallyHidden>{label}</VisuallyHidden>
    </span>
  );
}
