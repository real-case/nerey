import { Slider as BaseSlider } from '@base-ui/react/slider';
import type { HTMLAttributes, OutputHTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import styles from './slider.module.css';

/**
 * A value chosen by position, with one thumb or two.
 *
 * ADR 0022 — `Root / Control / Track / Indicator / Thumb / Value` stay six parts. The range case
 * is what makes that worth defending: a range slider is the same anatomy with a second `Thumb`
 * inside the same `Track`, so it needs no `range` prop, no second component, and no branch in
 * this file. Pass an array and add a thumb.
 *
 * There is no `orientation`. A vertical slider is not a rotated horizontal one — the drag axis,
 * the hit area, the label placement and the keyboard mapping all change — and shipping one as a
 * prop would mean claiming a layout nothing here has been checked in. It can be added
 * deliberately when something needs it.
 */

type NativeDivProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked'
>;

/** One number for a single thumb, one entry per thumb for a range. */
export type SliderValue = number | readonly number[];

export type SliderRootProps = NativeDivProps & {
  value?: SliderValue;
  defaultValue?: SliderValue;
  /** The new value only; Base UI's `eventDetails` argument is not forwarded (ADR 0022). */
  onValueChange?: (value: SliderValue) => void;
  /** Fires when the drag or key repeat ends — the one to persist from. */
  onValueCommitted?: (value: SliderValue) => void;
  min?: number;
  max?: number;
  step?: number;
  /** The step taken by Page Up / Page Down and Shift + arrow. */
  largeStep?: number;
  /** How close two thumbs of a range may get, counted in steps. */
  minStepsBetweenValues?: number;
  /** What happens when two thumbs meet: push (default), swap, or stop. */
  thumbCollisionBehavior?: 'push' | 'swap' | 'none';
  format?: Intl.NumberFormatOptions;
  locale?: Intl.LocalesArgument;
  name?: string;
  form?: string;
  disabled?: boolean;
  /** Swap the rendered element while keeping every style and attribute. */
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

function SliderRoot({ render, children, ref, ...rest }: SliderRootProps): ReactElement {
  return (
    <BaseSlider.Root ref={ref} className={styles.root} render={render} {...rest}>
      {children}
    </BaseSlider.Root>
  );
}

export type SliderControlProps = NativeDivProps & {
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

function SliderControl({ render, children, ref, ...rest }: SliderControlProps): ReactElement {
  return (
    <BaseSlider.Control ref={ref} className={styles.control} render={render} {...rest}>
      {children}
    </BaseSlider.Control>
  );
}

export type SliderTrackProps = NativeDivProps & {
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

function SliderTrack({ render, children, ref, ...rest }: SliderTrackProps): ReactElement {
  return (
    <BaseSlider.Track ref={ref} className={styles.track} render={render} {...rest}>
      {children}
    </BaseSlider.Track>
  );
}

/** No `children`: the indicator is the filled part of the bar, and it has no inside. */
export type SliderIndicatorProps = Omit<NativeDivProps, 'children'> & {
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
};

function SliderIndicator({ render, ref, ...rest }: SliderIndicatorProps): ReactElement {
  return <BaseSlider.Indicator ref={ref} className={styles.indicator} render={render} {...rest} />;
}

export type SliderThumbProps = NativeDivProps & {
  /**
   * Which entry of a range value this thumb owns. Required for a range slider that is rendered
   * on a server: without it the two thumbs cannot be told apart before hydration and both land
   * on the first value.
   */
  index?: number;
  disabled?: boolean;
  /**
   * Names one thumb of a range. A `Field.Label` names the whole slider, which is right for a
   * single thumb and ambiguous for two — "Price" read twice tells the user nothing about which
   * end they are on.
   */
  'aria-label'?: string;
  /** Overrides how the value is read aloud — "£240" rather than "240". */
  getAriaValueText?: (formattedValue: string, value: number, index: number) => string;
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

function SliderThumb({ render, children, ref, ...rest }: SliderThumbProps): ReactElement {
  return (
    <BaseSlider.Thumb ref={ref} className={styles.thumb} render={render} {...rest}>
      {children}
    </BaseSlider.Thumb>
  );
}

type NativeOutputProps = Omit<
  OutputHTMLAttributes<HTMLOutputElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked' | 'children'
>;

export type SliderValueProps = NativeOutputProps & {
  /**
   * Formats the value for display. Both arguments arrive as arrays with one entry per thumb, so
   * a range renders "£20 – £60" from the same part that renders "£20".
   */
  children?: (formattedValues: readonly string[], values: readonly number[]) => ReactNode;
  render?: ReactElement;
  ref?: Ref<HTMLOutputElement>;
};

/**
 * Renders an `<output>`, which is the element the value of a control belongs in — it is
 * announced as a live region, so a screen-reader user dragging the thumb hears the number change
 * rather than having to leave the control to find out where they landed.
 */
function SliderValueDisplay({ children, render, ref, ...rest }: SliderValueProps): ReactElement {
  return (
    <BaseSlider.Value ref={ref} className={styles.value} render={render} {...rest}>
      {children}
    </BaseSlider.Value>
  );
}

export const Slider = {
  Root: SliderRoot,
  Control: SliderControl,
  Track: SliderTrack,
  Indicator: SliderIndicator,
  Thumb: SliderThumb,
  Value: SliderValueDisplay,
};
