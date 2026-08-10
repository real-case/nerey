import { Input as BaseInput } from '@base-ui/react/input';
import type { InputHTMLAttributes, ReactElement, Ref } from 'react';

import { cx } from '../../internal/cx';
import styles from './input.module.css';

/**
 * A single-line text control.
 *
 * ADR 0022 — Base UI's `Input` is wrapped, never re-exported, and every prop is declared here by
 * hand. Its one job upstream is that it registers itself with a surrounding `Field.Root`, which
 * is why this component needs no `id`, no `aria-labelledby` and no plumbing to be named by a
 * `Field.Label`: the association is made by the substrate, and the story proves it.
 *
 * `onValueChange` forwards the value only. Base UI's second `eventDetails` argument is a vendor
 * type, and putting it in the signature would leak `@base-ui/react` into the emitted declaration
 * for the sake of a `.reason` string nobody reads on a text field. `onChange` is still there,
 * untouched, for anyone who wants the event.
 */

export type InputSize = 'sm' | 'md' | 'lg';

/**
 * `size` and `prefix` are removed from the native set on purpose. Both exist on
 * `InputHTMLAttributes` — `size` is the ancient character-count attribute, `prefix` is an RDFa
 * one — and both are names this component needs for something a caller will actually reach for.
 */
type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked' | 'size' | 'prefix'
>;

export type InputProps = NativeInputProps & {
  size?: InputSize;
  /**
   * Marks the control invalid outside a `Field`. Inside one, validity is the field's business
   * and this is not needed — Base UI writes `data-invalid` and the same stylesheet reacts.
   */
  invalid?: boolean;
  /**
   * Content pinned before the value, inside the box: a currency mark, a unit, an icon.
   *
   * An ELEMENT rather than a string, because the two cases need opposite treatment — a "$" is
   * text a screen reader should read, an icon is decoration that must be `aria-hidden` — and a
   * component handed a bare string has to guess which one it was given.
   */
  prefix?: ReactElement;
  /** Content pinned after the value, inside the box. Same reasoning as `prefix`. */
  suffix?: ReactElement;
  defaultValue?: string | number | readonly string[];
  /** The new value only; Base UI's `eventDetails` argument is not forwarded (ADR 0022). */
  onValueChange?: (value: string) => void;
  ref?: Ref<HTMLInputElement>;
};

const SIZE_CLASS: Record<InputSize, string | undefined> = {
  sm: styles.sizeSm,
  md: undefined,
  lg: styles.sizeLg,
};

export function Input({
  size = 'md',
  invalid = false,
  prefix,
  suffix,
  onValueChange,
  ref,
  ...rest
}: InputProps): ReactElement {
  return (
    <div className={cx(styles.root, SIZE_CLASS[size])}>
      {prefix ? <span className={styles.affix}>{prefix}</span> : null}
      <BaseInput
        ref={ref}
        className={styles.control}
        aria-invalid={invalid || undefined}
        // Re-wrapped rather than forwarded, the same shape as Tabs.Root and Accordion.Root.
        // This handler used to ride along in `{...rest}`, which meant Base UI called it with
        // `(value, eventDetails)` while the declared type above — and the doc comment on it —
        // promised the value alone. A vendor object arriving as an undeclared second argument is
        // exactly the leak ADR 0022 keeps out of the public surface, and it is invisible to
        // `tsc`: the emitted `.d.ts` stayed unary while the runtime was binary.
        onValueChange={onValueChange ? (next: string) => onValueChange(next) : undefined}
        {...rest}
      />
      {suffix ? <span className={styles.affix}>{suffix}</span> : null}
    </div>
  );
}
