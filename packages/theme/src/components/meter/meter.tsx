import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { Meter as BaseMeter } from '@base-ui/react/meter';

import { cx } from '../../internal/cx';
import styles from './meter.module.css';

/**
 * A gauge for a value inside a known range — disk used, budget spent, seats taken.
 *
 * Meter and Progress look almost identical and mean opposite things, so both exist. A progressbar
 * describes a TASK that is running and will end; a meter describes a QUANTITY that is simply true
 * right now and has no completion. Screen readers announce them differently, `role="meter"` has no
 * "complete" state to reach, and merging them behind one component with a `kind` prop would make
 * the choice invisible at the call site — which is where it is actually being made.
 *
 * ADR 0022 — Base UI 1.7.0 does ship Meter (`@base-ui/react/meter`), with `Root / Label / Track /
 * Indicator / Value` and, unlike every other family, ZERO `data-*` attributes: `MeterRootState` is
 * empty because a meter has no states. So this stylesheet keys off nothing but its own classes,
 * and the tone axis is the only thing that varies.
 *
 * `label` is REQUIRED for the reason it is required on Progress: a meter with no accessible name
 * is a WCAG 1.1.1 failure that axe reports as `aria-meter-name`, and ADR 0032 fails the build on
 * it. `value` is not nullable here — a meter has no indeterminate state to express.
 */

export type MeterTone = 'accent' | 'success' | 'warning' | 'danger';
export type MeterSize = 'sm' | 'md';

type NativeProps<T extends HTMLElement> = Omit<HTMLAttributes<T>, 'className' | 'style' | 'color'>;

export type MeterRootProps = Omit<NativeProps<HTMLDivElement>, 'aria-label'> & {
  /** The current quantity. Clamped into `[min, max]` before it is announced. */
  value: number;
  /** The gauge's accessible name. Not optional — see the note above. */
  label: string;
  min?: number;
  max?: number;
  tone?: MeterTone;
  size?: MeterSize;
  /** Passed to `Intl.NumberFormat`. `{ style: 'percent' }` is the useful one. */
  format?: Intl.NumberFormatOptions;
  locale?: Intl.LocalesArgument;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export type MeterTrackProps = NativeProps<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export type MeterIndicatorProps = NativeProps<HTMLDivElement> & {
  ref?: Ref<HTMLDivElement>;
};

export type MeterLabelProps = NativeProps<HTMLSpanElement> & {
  ref?: Ref<HTMLSpanElement>;
  children?: ReactNode;
};

export type MeterValueProps = Omit<NativeProps<HTMLSpanElement>, 'children'> & {
  /** Replaces the formatted text. Receives the formatted string and the clamped number. */
  children?: (formattedValue: string, value: number) => ReactNode;
  ref?: Ref<HTMLSpanElement>;
};

const TONE_CLASS: Record<MeterTone, string | undefined> = {
  accent: undefined,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
  danger: styles.toneDanger,
};

const SIZE_CLASS: Record<MeterSize, string | undefined> = {
  sm: styles.sizeSm,
  md: undefined,
};

function MeterRoot({
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
}: MeterRootProps): ReactElement {
  return (
    <BaseMeter.Root
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
    </BaseMeter.Root>
  );
}

function MeterTrack({ children, ref, ...rest }: MeterTrackProps): ReactElement {
  return (
    <BaseMeter.Track ref={ref} className={styles.track} {...rest}>
      {children}
    </BaseMeter.Track>
  );
}

function MeterIndicator({ ref, ...rest }: MeterIndicatorProps): ReactElement {
  return <BaseMeter.Indicator ref={ref} className={styles.indicator} {...rest} />;
}

function MeterLabel({ children, ref, ...rest }: MeterLabelProps): ReactElement {
  return (
    <BaseMeter.Label ref={ref} className={styles.label} {...rest}>
      {children}
    </BaseMeter.Label>
  );
}

function MeterValue({ children, ref, ...rest }: MeterValueProps): ReactElement {
  return (
    <BaseMeter.Value ref={ref} className={styles.value} {...rest}>
      {children}
    </BaseMeter.Value>
  );
}

export const Meter = {
  Root: MeterRoot,
  Track: MeterTrack,
  Indicator: MeterIndicator,
  Label: MeterLabel,
  Value: MeterValue,
} as const;
