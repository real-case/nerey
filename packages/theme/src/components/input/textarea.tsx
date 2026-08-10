import { Input as BaseInput } from '@base-ui/react/input';
import type { ReactElement, Ref, TextareaHTMLAttributes } from 'react';

import { cx } from '../../internal/cx';
import styles from './input.module.css';

/**
 * A multi-line text control.
 *
 * A separate component rather than a `multiline` prop on `Input`, because the two differ in
 * their props and not only in their paint: a textarea has `rows`, grows, and has nowhere sane to
 * put a prefix or a suffix, while an input has a fixed height and slots that sit beside the
 * value. A boolean that silently invalidates three of the surrounding props is a worse API than
 * a second name.
 *
 * Base UI ships no `Textarea`; the documented way to get one is to swap the element under
 * `Input`, which is what happens here. The swap is invisible from outside — `render` is not on
 * this component's public surface, because a textarea that renders something other than a
 * `<textarea>` is not a textarea.
 */

export type TextareaSize = 'sm' | 'md' | 'lg';

type NativeTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'className' | 'style' | 'color' | 'value' | 'defaultValue' | 'defaultChecked' | 'rows' | 'prefix'
>;

export type TextareaProps = NativeTextareaProps & {
  size?: TextareaSize;
  /** Visible lines before the control scrolls. The user can still drag it taller. */
  rows?: number;
  /** Marks the control invalid outside a `Field`. See the note on `Input`. */
  invalid?: boolean;
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  /** The new value only; Base UI's `eventDetails` argument is not forwarded (ADR 0022). */
  onValueChange?: (value: string) => void;
  ref?: Ref<HTMLTextAreaElement>;
};

const SIZE_CLASS: Record<TextareaSize, string | undefined> = {
  sm: styles.sizeSm,
  md: undefined,
  lg: styles.sizeLg,
};

/**
 * The native attributes ride on the `<textarea>` and the value pipeline stays with Base UI.
 *
 * That split is not arbitrary. Base UI types `Input`'s handlers against `HTMLInputElement`, so
 * handing it a textarea's `onChange` would either not compile or compile to an event whose
 * `currentTarget` lies about what it is. Attributes belong on the element they describe; the
 * value, the Field registration and the validity state belong to the component that tracks them.
 * Base UI merges the two, composing handlers rather than replacing them.
 */
export function Textarea({
  size = 'md',
  rows = 3,
  invalid = false,
  value,
  defaultValue,
  onValueChange,
  ref,
  ...rest
}: TextareaProps): ReactElement {
  return (
    <div className={cx(styles.root, styles.multiline, SIZE_CLASS[size])}>
      <BaseInput
        className={cx(styles.control, styles.textarea)}
        aria-invalid={invalid || undefined}
        value={value}
        defaultValue={defaultValue}
        // Re-wrapped rather than forwarded, for the reason given on `Input`: Base UI calls this
        // with `(value, eventDetails)`, and passing the caller's function straight through handed
        // it a `@base-ui/react` object as a second argument that the declared unary type never
        // mentions (ADR 0022).
        onValueChange={onValueChange ? (next: string) => onValueChange(next) : undefined}
        render={<textarea ref={ref} rows={rows} {...rest} />}
      />
    </div>
  );
}
