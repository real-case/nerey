import type { HTMLAttributes, ReactElement, Ref } from 'react';

import { cx } from '../../internal/cx';
import styles from './skeleton.module.css';

/**
 * A placeholder for content that has not arrived.
 *
 * The whole thing is `aria-hidden`. A skeleton is a picture of a paragraph that does not exist:
 * announcing it produces "loading, loading, loading" once per bar and tells the reader nothing
 * they could act on. The announcement belongs to the region that is waiting — `aria-busy` on the
 * container, or a Spinner beside it — which says it once and says it about something real.
 *
 * ADR 0026 — there is no `width` or `height` prop. Size is per-instance deviation, and
 * per-instance deviation is a custom property set on a container the caller owns:
 *
 *   .avatarSlot { --_width: 2.5rem; --_height: 2.5rem; }
 *
 * A prop would have to become an inline `style`, which is the escape hatch ADR 0026 closes.
 */

export type SkeletonVariant = 'text' | 'block' | 'circle';

type NativeSkeletonProps = Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'color' | 'children'>;

export type SkeletonProps = NativeSkeletonProps & {
  variant?: SkeletonVariant;
  /** Number of bars for `variant="text"`. Ignored by the other variants, which are one shape. */
  lines?: number;
  ref?: Ref<HTMLDivElement>;
};

const VARIANT_CLASS: Record<SkeletonVariant, string | undefined> = {
  text: styles.text,
  block: styles.block,
  circle: styles.circle,
};

export function Skeleton({ variant = 'text', lines = 1, ref, ...rest }: SkeletonProps): ReactElement {
  // `lines` arrives from a payload often enough to be worth clamping here rather than trusting.
  // A widget that asks for 0 or 2.5 or -1 bars should render one, not crash the transcript.
  const count = Number.isFinite(lines) ? Math.max(1, Math.trunc(lines)) : 1;

  if (variant === 'text' && count > 1) {
    return (
      <div ref={ref} aria-hidden="true" className={styles.lines} {...rest}>
        {Array.from({ length: count }, (_, index) => (
          <span key={index} className={cx(styles.root, styles.text)} />
        ))}
      </div>
    );
  }

  return <div ref={ref} aria-hidden="true" className={cx(styles.root, VARIANT_CLASS[variant])} {...rest} />;
}
