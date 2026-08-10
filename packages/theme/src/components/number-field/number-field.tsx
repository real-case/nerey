import { NumberField as BaseNumberField } from '@base-ui/react/number-field';
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  Ref,
} from 'react';

import { cx } from '../../internal/cx';
import { MinusIcon, PlusIcon } from '../icons/icons';
import styles from './number-field.module.css';

/**
 * A numeric text control with steppers and a drag-to-change area.
 *
 * ADR 0022 — the compound shape is kept compound under Nerey's namespace. `Root / ScrubArea /
 * Group / Decrement / Input / Increment` are six parts because they are six placements: a form
 * that puts the steppers on one side, or drags on the label rather than on a handle, is a
 * rearrangement of these parts and not a new component with another six props.
 *
 * The parts are also the reason there is no `label` prop. A number field is named by a
 * `Field.Label`, exactly like every other control here, and the labelling is Base UI's Field
 * doing its job rather than this component reimplementing it.
 */

export type NumberFieldSize = 'sm' | 'md' | 'lg';

type NativeDivProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked'
>;

export type NumberFieldRootProps = NativeDivProps & {
  size?: NumberFieldSize;
  /** The raw number, or `null` for an empty field. `null` is a value, not a missing prop. */
  value?: number | null;
  defaultValue?: number;
  /** The new value only; Base UI's `eventDetails` argument is not forwarded (ADR 0022). */
  onValueChange?: (value: number | null) => void;
  /** Fires when the interaction ends — on blur, or when a drag or a stepper press is released. */
  onValueCommitted?: (value: number | null) => void;
  min?: number;
  max?: number;
  /** `'any'` turns step validation off; the arrows still move by 1. */
  step?: number | 'any';
  /** The step taken while Alt is held. */
  smallStep?: number;
  /** The step taken while Shift is held. */
  largeStep?: number;
  snapOnStep?: boolean;
  /** Lets typed text sit outside `min`/`max` so native range validation can report it. */
  allowOutOfRange?: boolean;
  allowWheelScrub?: boolean;
  format?: Intl.NumberFormatOptions;
  locale?: Intl.LocalesArgument;
  name?: string;
  form?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

const SIZE_CLASS: Record<NumberFieldSize, string | undefined> = {
  sm: styles.sizeSm,
  md: undefined,
  lg: styles.sizeLg,
};

function NumberFieldRoot({
  size = 'md',
  render,
  children,
  ref,
  ...rest
}: NumberFieldRootProps): ReactElement {
  return (
    <BaseNumberField.Root ref={ref} className={cx(styles.root, SIZE_CLASS[size])} render={render} {...rest}>
      {children}
    </BaseNumberField.Root>
  );
}

type NativeSpanProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked'
>;

export type NumberFieldScrubAreaProps = NativeSpanProps & {
  /** Which axis the drag reads. Horizontal matches the direction the digits run in. */
  direction?: 'horizontal' | 'vertical';
  /** Pixels of movement per step. Higher is less sensitive. */
  pixelSensitivity?: number;
  /** Distance from the centre before the pointer wraps around, for an unbounded drag. */
  teleportDistance?: number;
  render?: ReactElement;
  ref?: Ref<HTMLSpanElement>;
  children?: ReactNode;
};

function NumberFieldScrubArea({ render, children, ref, ...rest }: NumberFieldScrubAreaProps): ReactElement {
  return (
    <BaseNumberField.ScrubArea ref={ref} className={styles.scrubArea} render={render} {...rest}>
      {children}
    </BaseNumberField.ScrubArea>
  );
}

export type NumberFieldGroupProps = NativeDivProps & {
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

function NumberFieldGroup({ render, children, ref, ...rest }: NumberFieldGroupProps): ReactElement {
  return (
    <BaseNumberField.Group ref={ref} className={styles.group} render={render} {...rest}>
      {children}
    </BaseNumberField.Group>
  );
}

type NativeNumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked' | 'size' | 'prefix'
>;

export type NumberFieldInputProps = NativeNumberInputProps & {
  render?: ReactElement;
  ref?: Ref<HTMLInputElement>;
};

function NumberFieldInput({ render, ref, ...rest }: NumberFieldInputProps): ReactElement {
  return <BaseNumberField.Input ref={ref} className={styles.input} render={render} {...rest} />;
}

type NativeStepperProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked'
>;

export type NumberFieldStepperProps = NativeStepperProps & {
  render?: ReactElement;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

/**
 * The two steppers default their own glyph.
 *
 * An empty stepper is not a design choice anybody makes on purpose, and unlike a general-purpose
 * button there is exactly one right glyph for each: the direction is the semantics. Base UI
 * supplies the accessible name ("Increase" / "Decrease"), and the icons are `aria-hidden` by
 * construction, so the pair is named without the caller writing anything.
 */
function NumberFieldDecrement({ render, children, ref, ...rest }: NumberFieldStepperProps): ReactElement {
  return (
    <BaseNumberField.Decrement
      ref={ref}
      className={cx(styles.stepper, styles.decrement)}
      render={render}
      {...rest}
    >
      {children ?? <MinusIcon size={14} />}
    </BaseNumberField.Decrement>
  );
}

function NumberFieldIncrement({ render, children, ref, ...rest }: NumberFieldStepperProps): ReactElement {
  return (
    <BaseNumberField.Increment
      ref={ref}
      className={cx(styles.stepper, styles.increment)}
      render={render}
      {...rest}
    >
      {children ?? <PlusIcon size={14} />}
    </BaseNumberField.Increment>
  );
}

export const NumberField = {
  Root: NumberFieldRoot,
  ScrubArea: NumberFieldScrubArea,
  Group: NumberFieldGroup,
  Decrement: NumberFieldDecrement,
  Input: NumberFieldInput,
  Increment: NumberFieldIncrement,
};
