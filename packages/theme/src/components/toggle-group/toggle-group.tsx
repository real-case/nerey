import type { ButtonHTMLAttributes, ReactElement, ReactNode, Ref } from 'react';
import { Toggle as BaseToggle } from '@base-ui/react/toggle';
import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group';

import { cx } from '../../internal/cx';
import styles from './toggle-group.module.css';

/**
 * A set of two-state buttons that share one selection, built on Base UI's `ToggleGroup`.
 *
 * ADR 0022 — wrapped, never re-exported, and no prop type here is derived from a Base UI
 * component. In Base UI these are two separate entry points (`@base-ui/react/toggle-group` and
 * `@base-ui/react/toggle`) rather than a namespace; they are re-composed here as two exports of
 * one module because they are useless apart — a `Toggle` outside a group has no group to change.
 *
 * `variant` is a real fork rather than a skin. `chips` is a wrapping set of pills, each one a
 * self-contained control, which is what a question with six possible answers needs. `segmented`
 * is a single joined bar with internal dividers, which is what a two-or-three-way mode switch
 * needs and what falls apart the moment it wraps. They are not interchangeable, and the widget
 * layer picks per question rather than per theme.
 *
 * The group's value is an ARRAY even when `multiple` is false — that is Base UI's contract, and
 * it is the honest one: single-select is the case where the array happens to hold at most one
 * entry, and pretending otherwise would mean inventing a second callback shape.
 */

export type ToggleGroupVariant = 'chips' | 'segmented';
export type ToggleGroupSize = 'sm' | 'md';
export type ToggleGroupOrientation = 'horizontal' | 'vertical';

const VARIANT_CLASS: Record<ToggleGroupVariant, string | undefined> = {
  chips: styles.groupChips,
  segmented: undefined,
};

const SIZE_CLASS: Record<ToggleGroupSize, string | undefined> = {
  sm: styles.groupSizeSm,
  md: undefined,
};

export type ToggleGroupProps<Value extends string = string> = {
  /**
   * The group's accessible name — the question the toggles answer.
   *
   * Required. Base UI renders `role="group"`, and a group with no name is a container a screen
   * reader announces as nothing: the user hears six unrelated buttons instead of six answers to
   * one question. Making the type refuse to compile is the only check that catches it, because
   * the rendered control looks finished either way (ADR 0032).
   */
  label: string;
  /** Pressed values. An array in both modes — see the note above. */
  value?: readonly Value[];
  defaultValue?: readonly Value[];
  onValueChange?: (value: Value[]) => void;
  /** Allow more than one pressed toggle at a time. */
  multiple?: boolean;
  variant?: ToggleGroupVariant;
  size?: ToggleGroupSize;
  orientation?: ToggleGroupOrientation;
  disabled?: boolean;
  /** Arrow-key navigation wraps at the ends. */
  loopFocus?: boolean;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export function ToggleGroup<Value extends string = string>({
  label,
  variant = 'segmented',
  size = 'md',
  children,
  ref,
  ...rest
}: ToggleGroupProps<Value>): ReactElement {
  return (
    <BaseToggleGroup
      ref={ref}
      aria-label={label}
      className={cx(styles.group, VARIANT_CLASS[variant], SIZE_CLASS[size])}
      {...rest}
    >
      {children}
    </BaseToggleGroup>
  );
}

type NativeToggleProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'style' | 'color' | 'value'
>;

export type ToggleProps<Value extends string = string> = NativeToggleProps & {
  /** Identifies this toggle inside its group. Omit only for a standalone toggle. */
  value?: Value;
  pressed?: boolean;
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  disabled?: boolean;
  /** Swap the rendered element while keeping every style and attribute. */
  render?: ReactElement;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

/**
 * The variant is applied by the group and reaches the toggle through a descendant selector, not
 * through a prop or a context. Both classes come from the same stylesheet and the toggle is a
 * DOM child of the group — the relationship the styling depends on is the one the markup
 * already guarantees, so there is nothing for a call site to get out of step.
 */
export function Toggle<Value extends string = string>({
  render,
  type = 'button',
  children,
  ref,
  ...rest
}: ToggleProps<Value>): ReactElement {
  return (
    <BaseToggle ref={ref} type={type} className={styles.toggle} render={render} {...rest}>
      {children}
    </BaseToggle>
  );
}
