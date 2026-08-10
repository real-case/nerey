import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { CheckboxGroup as BaseCheckboxGroup } from '@base-ui/react/checkbox-group';
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { CheckIcon, MinusIcon } from '../icons/icons';
import styles from './checkbox.module.css';

/**
 * A tri-state tick box, and the group that shares state between several of them.
 *
 * ADR 0022 — `Checkbox` is a namespace (`Root` + `Indicator`) because the indicator is a real
 * placement decision: it is what animates, what a caller may want to replace with their own
 * glyph, and what disappears from the DOM when the box is empty. `CheckboxGroup` is deliberately
 * NOT a namespace, matching Base UI's own shape — it is one element with one job, and inventing
 * a `.Root` for it would be a Nerey-only ceremony that reads as an error to anyone who knows the
 * dependency.
 *
 * Neither takes a `label`. A checkbox is named by wrapping it in a `Field.Label`, which is what
 * makes the text beside it clickable as well as announced; a `label` prop would produce the same
 * markup with less control and one more thing to keep in step.
 */

type NativeSpanProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked' | 'onChange'
>;

export type CheckboxRootProps = NativeSpanProps & {
  checked?: boolean;
  defaultChecked?: boolean;
  /** The new state only; Base UI's `eventDetails` argument is not forwarded (ADR 0022). */
  onCheckedChange?: (checked: boolean) => void;
  /**
   * Neither ticked nor unticked. Always caller-driven — there is no uncontrolled form, because
   * "some of the children" is a fact about other state, never about this box.
   */
  indeterminate?: boolean;
  /**
   * Makes this box control the others in its `CheckboxGroup`. Requires the group's `allValues`,
   * which is how it knows what "all" means.
   */
  parent?: boolean;
  /** Identifies the box inside a `CheckboxGroup`, falling back to `name`. */
  value?: string;
  /** Submitted when the box is unticked. By default an unticked box submits nothing. */
  uncheckedValue?: string;
  name?: string;
  form?: string;
  id?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  /** Swap the rendered element while keeping every style and attribute. */
  render?: ReactElement;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
};

function CheckboxRoot({ render, children, ref, ...rest }: CheckboxRootProps): ReactElement {
  return (
    <BaseCheckbox.Root ref={ref} className={styles.root} render={render} {...rest}>
      {children}
    </BaseCheckbox.Root>
  );
}

export type CheckboxIndicatorProps = NativeSpanProps & {
  /**
   * Keep the indicator in the DOM while the box is empty. Off by default; turn it on only to
   * animate the glyph out, since an element that is always present is one more thing between a
   * screen reader and the control.
   */
  keepMounted?: boolean;
  render?: ReactElement;
  ref?: Ref<HTMLSpanElement>;
  children?: ReactNode;
};

/**
 * Both glyphs are rendered and the stylesheet picks one from `data-indeterminate`.
 *
 * The alternative — reading Base UI's state object in a `render` callback and building a single
 * glyph — puts the vendor's state shape into this file for a decision CSS is already making, on
 * an attribute the rest of the stylesheet already selects on.
 */
function CheckboxIndicator({ render, children, ref, ...rest }: CheckboxIndicatorProps): ReactElement {
  return (
    <BaseCheckbox.Indicator ref={ref} className={styles.indicator} render={render} {...rest}>
      {children ?? (
        <>
          <span className={styles.tick}>
            <CheckIcon size={14} />
          </span>
          <span className={styles.dash}>
            <MinusIcon size={14} />
          </span>
        </>
      )}
    </BaseCheckbox.Indicator>
  );
}

export const Checkbox = {
  Root: CheckboxRoot,
  Indicator: CheckboxIndicator,
};

type NativeDivProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked'
>;

export type CheckboxGroupProps = NativeDivProps & {
  /** The values of the boxes that are ticked. */
  value?: string[];
  defaultValue?: string[];
  /** The new value only; Base UI's `eventDetails` argument is not forwarded (ADR 0022). */
  onValueChange?: (value: string[]) => void;
  /** Every value in the group. Required before a `parent` box can mean anything. */
  allValues?: string[];
  disabled?: boolean;
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export function CheckboxGroup({ render, children, ref, ...rest }: CheckboxGroupProps): ReactElement {
  return (
    <BaseCheckboxGroup ref={ref} className={styles.group} render={render} {...rest}>
      {children}
    </BaseCheckboxGroup>
  );
}
