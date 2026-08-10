import { Field as BaseField } from '@base-ui/react/field';
import type { HTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { cx } from '../../internal/cx';
import controlStyles from '../input/input.module.css';
import styles from './field.module.css';

/**
 * The labelling substrate every other control in this theme composes with.
 *
 * ADR 0022 — Base UI supplies the behaviour (the id relationships, the validity machine, the
 * form registration) and none of it is re-exported. Every prop below is declared by hand rather
 * than derived with `ComponentProps<typeof BaseField.Root>`: a derived type would put
 * `@base-ui/react` into the emitted `.d.ts`, which makes the vendor a type-level peer for every
 * consumer and turns a runtime-only swap into a breaking change.
 *
 * The API stays compound under Nerey's own namespace. Flattening `Field.Root / Label / Control /
 * Description / Error` into one component with a `label` and an `error` prop would look tidier
 * and would remove the ability to place a description above the control, to put a checkbox
 * INSIDE its label, or to render two errors for two validity reasons — all of which are things
 * real forms do.
 *
 * ADR 0026 — the parts take no `className`. Per-instance deviation goes through the private
 * `--_*` custom properties the stylesheets declare.
 */

/** When a field re-runs its validators. `Form`'s setting is the default; this overrides it. */
export type FieldValidationMode = 'onSubmit' | 'onBlur' | 'onChange';

/**
 * Returns the error message(s), or `null` when the value is valid.
 *
 * `formValues` is deliberately `Record<string, unknown>` rather than a generic tied to `Form`:
 * a field validator that has to be generic over the whole form's shape makes every call site
 * carry a type parameter for the sake of one lookup that is `unknown` anyway.
 */
export type FieldValidate = (
  value: unknown,
  formValues: Record<string, unknown>,
) => string | string[] | null | Promise<string | string[] | null>;

type NativeDivProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked'
>;

export type FieldRootProps = NativeDivProps & {
  /** Identifies the field when a form is submitted. Wins over the control's own `name`. */
  name?: string;
  disabled?: boolean;
  /** Force the invalid state, for a field whose validity is owned by something else. */
  invalid?: boolean;
  dirty?: boolean;
  touched?: boolean;
  validate?: FieldValidate;
  validationMode?: FieldValidationMode;
  /** Milliseconds to coalesce `validate` calls under `validationMode="onChange"`. */
  validationDebounceTime?: number;
  /** Swap the rendered element while keeping every style and attribute. */
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

function FieldRoot({
  name,
  disabled,
  invalid,
  dirty,
  touched,
  validate,
  validationMode,
  validationDebounceTime,
  render,
  children,
  ref,
  ...rest
}: FieldRootProps): ReactElement {
  return (
    <BaseField.Root
      ref={ref}
      className={styles.root}
      name={name}
      disabled={disabled}
      invalid={invalid}
      dirty={dirty}
      touched={touched}
      validate={validate}
      validationMode={validationMode}
      validationDebounceTime={validationDebounceTime}
      render={render}
      {...rest}
    >
      {children}
    </BaseField.Root>
  );
}

type NativeLabelProps = Omit<
  HTMLAttributes<HTMLLabelElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked'
>;

export type FieldLabelProps = NativeLabelProps & {
  /**
   * Set `false` when `render` produces something that is not a `<label>` — a heading over a
   * radio group, say. Native label behaviour (click-to-focus, hover pass-through) only applies
   * to a real `<label>`, and claiming it on a `<div>` produces pointer behaviour nobody asked
   * for.
   */
  nativeLabel?: boolean;
  render?: ReactElement;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
};

function FieldLabel({ nativeLabel, render, children, ref, ...rest }: FieldLabelProps): ReactElement {
  return (
    <BaseField.Label ref={ref} className={styles.label} nativeLabel={nativeLabel} render={render} {...rest}>
      {children}
    </BaseField.Label>
  );
}

export type FieldControlSize = 'sm' | 'md' | 'lg';

type NativeControlProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked' | 'size'
>;

export type FieldControlProps = NativeControlProps & {
  size?: FieldControlSize;
  defaultValue?: string | number | readonly string[];
  /** The new value only. Base UI's second `eventDetails` argument is not forwarded (ADR 0022). */
  onValueChange?: (value: string) => void;
  /** Swap the rendered element — a `<textarea>`, a `<select>`, a date input. */
  render?: ReactElement;
  ref?: Ref<HTMLInputElement>;
};

const CONTROL_SIZE_CLASS: Record<FieldControlSize, string | undefined> = {
  sm: controlStyles.sizeSm,
  md: undefined,
  lg: controlStyles.sizeLg,
};

/**
 * The generic control slot, for an element this theme does not ship a component for.
 *
 * It wears `input.module.css` rather than a stylesheet of its own. A text box's chrome is one
 * decision — height, border, focus ring, invalid stroke — and duplicating it here would produce
 * two files that must be edited together and will not be. `Input` is the same box with Base UI's
 * standalone `Input` inside it; reach for that one unless you are swapping the element.
 */
function FieldControl({ size = 'md', render, ref, ...rest }: FieldControlProps): ReactElement {
  return (
    <div className={cx(controlStyles.root, CONTROL_SIZE_CLASS[size])}>
      <BaseField.Control ref={ref} className={controlStyles.control} render={render} {...rest} />
    </div>
  );
}

type NativeParagraphProps = Omit<
  HTMLAttributes<HTMLParagraphElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked'
>;

export type FieldDescriptionProps = NativeParagraphProps & {
  render?: ReactElement;
  ref?: Ref<HTMLParagraphElement>;
  children?: ReactNode;
};

function FieldDescription({ render, children, ref, ...rest }: FieldDescriptionProps): ReactElement {
  return (
    <BaseField.Description ref={ref} className={styles.description} render={render} {...rest}>
      {children}
    </BaseField.Description>
  );
}

/**
 * `match` narrows an error to one `ValidityState` reason, so a field can say "that is not an
 * email address" and "we need an email address" in two different sentences instead of one that
 * covers neither case well. `true` always shows it, for a validity story owned elsewhere.
 *
 * `ValidityState` is a DOM lib type, not a Base UI one, so naming it here leaks nothing.
 */
export type FieldErrorProps = NativeDivProps & {
  match?: boolean | keyof ValidityState;
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

/**
 * `children` is left in the rest bag rather than destructured and re-applied.
 *
 * `<Field.Error />` with no children takes its text from the field's own validity message — the
 * native constraint's, the `validate` return, or the entry in `Form`'s `errors`. Writing
 * `{children}` back into the JSX would pass `children: undefined` when the caller gave none,
 * which overrides that message with nothing and produces an empty error box that is styled,
 * announced, and blank.
 */
function FieldError({ match, render, ref, ...rest }: FieldErrorProps): ReactElement {
  return <BaseField.Error ref={ref} className={styles.error} match={match} render={render} {...rest} />;
}

export type FieldItemProps = NativeDivProps & {
  disabled?: boolean;
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

/**
 * One row of a checkbox or radio group, holding its own label and description.
 *
 * Without it, every `Field.Label` in a group would associate with the group's first control,
 * which is the kind of defect that looks perfect on screen and reads as nonsense aloud.
 */
function FieldItem({ disabled, render, children, ref, ...rest }: FieldItemProps): ReactElement {
  return (
    <BaseField.Item ref={ref} className={styles.item} disabled={disabled} render={render} {...rest}>
      {children}
    </BaseField.Item>
  );
}

/** The eleven native constraint flags, plus the field's overall verdict. */
export type FieldValidityFlags = {
  badInput: boolean;
  customError: boolean;
  patternMismatch: boolean;
  rangeOverflow: boolean;
  rangeUnderflow: boolean;
  stepMismatch: boolean;
  tooLong: boolean;
  tooShort: boolean;
  typeMismatch: boolean;
  valueMissing: boolean;
  /** `null` until the field has been validated at least once. */
  valid: boolean | null;
};

export type FieldValidityState = {
  validity: FieldValidityFlags;
  error: string;
  errors: readonly string[];
  value: unknown;
  initialValue: unknown;
};

export type FieldValidityProps = {
  children: (state: FieldValidityState) => ReactNode;
};

/**
 * Renders no element of its own — it hands the field's validity to a function so a caller can
 * draw something the `Field.Error` vocabulary does not cover, such as a strength meter.
 *
 * The state object is re-declared rather than re-exported, and it omits Base UI's
 * `transitionStatus`: that value belongs to the vendor's animation machinery, and putting it in
 * Nerey's public type would make an implementation detail of the dependency into API.
 */
function FieldValidity({ children }: FieldValidityProps): ReactElement {
  return <BaseField.Validity>{children}</BaseField.Validity>;
}

export const Field = {
  Root: FieldRoot,
  Label: FieldLabel,
  Control: FieldControl,
  Description: FieldDescription,
  Error: FieldError,
  Item: FieldItem,
  Validity: FieldValidity,
};
