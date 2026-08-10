import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { Progress as BaseProgress } from '@base-ui/react/progress';

import { cx } from '../../internal/cx';
import styles from './progress.module.css';

/**
 * A determinate or indeterminate progress bar.
 *
 * ADR 0022 — Base UI supplies `role="progressbar"`, the `aria-valuenow` / `aria-valuemin` /
 * `aria-valuemax` triple, the `Intl.NumberFormat` formatting and the label association; Nerey
 * supplies every pixel and the whole prop surface. The parts stay compound under Nerey's own
 * namespace rather than collapsing into one component with a `label` and a `showValue` flag,
 * because a caller who wants the value above the bar instead of beside it should move a JSX line,
 * not discover that a prop bag cannot express it.
 *
 * `label` is REQUIRED on Root. A progressbar with no accessible name is a WCAG 1.1.1 failure that
 * axe reports as `aria-progressbar-name`, and the gate of ADR 0032 fails the build on it — so the
 * type refuses to compile rather than letting the defect reach a story. A visible
 * `<Progress.Label>` is still optional: when one is present Base registers its id and the
 * resulting `aria-labelledby` takes precedence over `aria-label`, so the two never fight.
 *
 * `value={null}` is indeterminate. That is Base UI's contract and Nerey keeps it rather than
 * adding an `indeterminate` boolean: two ways to say the same thing produces a state where both
 * are set and nobody knows which wins.
 */

export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger';
export type ProgressSize = 'sm' | 'md';

type NativeProps<T extends HTMLElement> = Omit<HTMLAttributes<T>, 'className' | 'style' | 'color'>;

export type ProgressRootProps = Omit<NativeProps<HTMLDivElement>, 'aria-label'> & {
  /** The completed amount, or `null` while the total is unknown. */
  value: number | null;
  /** The bar's accessible name. Not optional — see the note above. */
  label: string;
  min?: number;
  max?: number;
  tone?: ProgressTone;
  size?: ProgressSize;
  /** Passed to `Intl.NumberFormat`. `{ style: 'percent' }` is the useful one. */
  format?: Intl.NumberFormatOptions;
  locale?: Intl.LocalesArgument;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export type ProgressTrackProps = NativeProps<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export type ProgressIndicatorProps = NativeProps<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
};

export type ProgressLabelProps = NativeProps<HTMLSpanElement> & {
  ref?: Ref<HTMLSpanElement>;
  children?: ReactNode;
};

export type ProgressValueProps = Omit<NativeProps<HTMLSpanElement>, 'children'> & {
  /** Replaces the formatted text. Receives the formatted string and the raw number. */
  children?: (formattedValue: string | null, value: number | null) => ReactNode;
  ref?: Ref<HTMLSpanElement>;
};

const TONE_CLASS: Record<ProgressTone, string | undefined> = {
  accent: undefined,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
  danger: styles.toneDanger,
};

const SIZE_CLASS: Record<ProgressSize, string | undefined> = {
  sm: styles.sizeSm,
  md: undefined,
};

function ProgressRoot({
  value,
  label,
  min,
  max,
  tone = 'accent',
  size = 'md',
  format,
  locale,
  children,
  ref,
  ...rest
}: ProgressRootProps): ReactElement {
  return (
    <BaseProgress.Root
      ref={ref}
      value={value}
      min={min}
      max={max}
      format={format}
      locale={locale}
      aria-label={label}
      className={cx(styles.root, TONE_CLASS[tone], SIZE_CLASS[size])}
      {...rest}
    >
      {children}
    </BaseProgress.Root>
  );
}

function ProgressTrack({ children, ref, ...rest }: ProgressTrackProps): ReactElement {
  return (
    <BaseProgress.Track ref={ref} className={styles.track} {...rest}>
      {children}
    </BaseProgress.Track>
  );
}

function ProgressIndicator({ ref, ...rest }: ProgressIndicatorProps): ReactElement {
  return <BaseProgress.Indicator ref={ref} className={styles.indicator} {...rest} />;
}

function ProgressLabel({ children, ref, ...rest }: ProgressLabelProps): ReactElement {
  return (
    <BaseProgress.Label ref={ref} className={styles.label} {...rest}>
      {children}
    </BaseProgress.Label>
  );
}

function ProgressValue({ children, ref, ...rest }: ProgressValueProps): ReactElement {
  return (
    <BaseProgress.Value ref={ref} className={styles.value} {...rest}>
      {children}
    </BaseProgress.Value>
  );
}

export const Progress = {
  Root: ProgressRoot,
  Track: ProgressTrack,
  Indicator: ProgressIndicator,
  Label: ProgressLabel,
  Value: ProgressValue,
} as const;
