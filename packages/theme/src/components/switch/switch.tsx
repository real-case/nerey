import { Switch as BaseSwitch } from '@base-ui/react/switch';
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import styles from './switch.module.css';

/**
 * A control that takes effect the moment it is flipped.
 *
 * That is the whole difference from `Checkbox`, and it is a semantic one rather than a visual
 * one: a switch says "this is now on", a checkbox says "this will be included when you submit".
 * Base UI gives the two different roles for exactly that reason, so the choice between them is
 * a decision about the form, not about which one looks better in a row.
 *
 * ADR 0022 — `Root` and `Thumb` stay separate parts. The thumb is what moves, and a caller who
 * wants an icon inside it, or a different easing, needs a node to put it on.
 */

type NativeSpanProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'className' | 'style' | 'color' | 'defaultValue' | 'defaultChecked' | 'onChange'
>;

export type SwitchRootProps = NativeSpanProps & {
  checked?: boolean;
  defaultChecked?: boolean;
  /** The new state only; Base UI's `eventDetails` argument is not forwarded (ADR 0022). */
  onCheckedChange?: (checked: boolean) => void;
  /** Submitted when the switch is on. Defaults to the native `"on"`. */
  value?: string;
  /** Submitted when it is off. By default an off switch submits nothing, like a checkbox. */
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

function SwitchRoot({ render, children, ref, ...rest }: SwitchRootProps): ReactElement {
  return (
    <BaseSwitch.Root ref={ref} className={styles.root} render={render} {...rest}>
      {children}
    </BaseSwitch.Root>
  );
}

export type SwitchThumbProps = NativeSpanProps & {
  render?: ReactElement;
  ref?: Ref<HTMLSpanElement>;
  children?: ReactNode;
};

function SwitchThumb({ render, children, ref, ...rest }: SwitchThumbProps): ReactElement {
  return (
    <BaseSwitch.Thumb ref={ref} className={styles.thumb} render={render} {...rest}>
      {children}
    </BaseSwitch.Thumb>
  );
}

export const Switch = {
  Root: SwitchRoot,
  Thumb: SwitchThumb,
};
