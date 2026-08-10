import { Form as BaseForm } from '@base-ui/react/form';
import type { FormHTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import type { FieldValidationMode } from './field';
import styles from './form.module.css';

/**
 * A `<form>` that knows about the fields inside it.
 *
 * It is worth wrapping for one behaviour that is tedious and easy to get wrong by hand: on a
 * failed submit, focus moves to the first invalid field in document order. Without it a keyboard
 * or screen-reader user is told the form failed and left standing wherever the submit button
 * was, with no way to find out which of nine fields is the problem short of tabbing through all
 * of them.
 *
 * ADR 0022 — `errors` is the seam for validation that happens somewhere else. Server-side rules,
 * a schema run in an action, a rate limit — none of it can be expressed as a field-level
 * `validate`, and all of it has to end up rendered under the right label. Keying the object by
 * `Field.Root`'s `name` is what does that.
 */

type NativeFormProps = Omit<
  FormHTMLAttributes<HTMLFormElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked'
>;

export type FormProps = NativeFormProps & {
  /** Errors from outside the form, keyed by each `Field.Root`'s `name`. */
  errors?: Record<string, string | string[]>;
  /** When fields validate. A `Field.Root`'s own `validationMode` wins over this. */
  validationMode?: FieldValidationMode;
  /**
   * The collected field values. Base UI calls `preventDefault()` on the native submit event
   * before this runs, so a handler here replaces the browser's navigation rather than racing it.
   */
  onFormSubmit?: (values: Record<string, unknown>) => void;
  /** Swap the rendered element while keeping every style and attribute. */
  render?: ReactElement;
  ref?: Ref<HTMLFormElement>;
  children?: ReactNode;
};

export function Form({ render, children, ref, ...rest }: FormProps): ReactElement {
  return (
    <BaseForm ref={ref} className={styles.root} render={render} {...rest}>
      {children}
    </BaseForm>
  );
}
