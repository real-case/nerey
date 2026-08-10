import { Radio as BaseRadio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import styles from './radio-group.module.css';

/**
 * A single choice from a set.
 *
 * ADR 0022 — `RadioGroup` is a bare component and `Radio` is a namespace, which mirrors Base UI
 * exactly. The asymmetry is not an accident upstream and is not one here: the group is a single
 * element with a single job, while a radio has a box and a mark inside it that are placed and
 * animated separately.
 *
 * The value is typed as `string` rather than left generic. A radio group's value is a form value
 * — it is submitted, it appears in `FormData`, and it round-trips through a URL — so a generic
 * `Value` buys type-level expressiveness in exchange for a runtime shape that is a string
 * anyway, and it pushes a type parameter into every consumer that wraps the component.
 */

type NativeDivProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked'
>;

export type RadioGroupProps = NativeDivProps & {
  value?: string;
  defaultValue?: string;
  /** The new value only; Base UI's `eventDetails` argument is not forwarded (ADR 0022). */
  onValueChange?: (value: string) => void;
  name?: string;
  form?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  /** Swap the rendered element while keeping every style and attribute. */
  render?: ReactElement;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

/**
 * Base UI puts `role="radiogroup"` on this element and points its `aria-labelledby` at the
 * surrounding `Field.Label`, so a group inside a field is named without anything being wired up
 * here. Outside a field, name it with `aria-label` — a radio group with no name announces its
 * options with nothing to hang them on.
 */
export function RadioGroup({ render, children, ref, ...rest }: RadioGroupProps): ReactElement {
  return (
    <BaseRadioGroup<string> ref={ref} className={styles.group} render={render} {...rest}>
      {children}
    </BaseRadioGroup>
  );
}

type NativeSpanProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked'
>;

export type RadioRootProps = NativeSpanProps & {
  /** REQUIRED. What this radio contributes to the group's value; nothing else identifies it. */
  value: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  render?: ReactElement;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
};

function RadioRoot({ value, render, children, ref, ...rest }: RadioRootProps): ReactElement {
  return (
    <BaseRadio.Root<string> ref={ref} className={styles.radio} value={value} render={render} {...rest}>
      {children}
    </BaseRadio.Root>
  );
}

export type RadioIndicatorProps = NativeSpanProps & {
  /** Keep the mark in the DOM while the radio is unselected, so it can be animated out. */
  keepMounted?: boolean;
  render?: ReactElement;
  ref?: Ref<HTMLSpanElement>;
  children?: ReactNode;
};

function RadioIndicator({ render, children, ref, ...rest }: RadioIndicatorProps): ReactElement {
  return (
    <BaseRadio.Indicator ref={ref} className={styles.indicator} render={render} {...rest}>
      {children}
    </BaseRadio.Indicator>
  );
}

export const Radio = {
  Root: RadioRoot,
  Indicator: RadioIndicator,
};
