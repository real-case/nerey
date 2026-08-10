import type { ButtonHTMLAttributes, HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';

import { Accordion as BaseAccordion } from '@base-ui/react/accordion';

import { ChevronDownIcon } from '../icons/icons';
import styles from './accordion.module.css';

/**
 * A stack of disclosures, one or many open at a time.
 *
 * ADR 0022 — the value is `string[]` even in single-open mode, because that is Base UI's contract
 * and mapping it to `string | null` for `multiple={false}` would produce two different callback
 * signatures behind one prop name. `Value` is pinned to `string` rather than left generic: Base
 * declares it `<Value = any>`, and a generic that defaults to `any` is a type-checked API in name
 * only (ADR 0003). Item identity is a key in a list — it has always been a string in practice.
 *
 * `Header` takes a heading `level` instead of a `render` element. Base UI renders an `<h3>`, which
 * is right roughly half the time: an accordion inside a widget that already has an `<h2>` title
 * needs `<h3>`, one that IS the widget's top-level structure needs `<h2>`, and a closed set of
 * three is both easier to get right than a raw element and impossible to fill with a `<div>`.
 * The heading is real markup, not decoration — it is how a screen-reader user lists the sections
 * and jumps between them.
 *
 * `Panel` renders its own inner element around `children`, for the reason Collapsible's does: the
 * animated box has to be able to reach zero height, and padding on it never lets it.
 */

export type AccordionHeadingLevel = 2 | 3 | 4;

type NativeDivProps = Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'style' | 'color'>;
type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style' | 'color'>;

export type AccordionRootProps = Omit<NativeDivProps, 'defaultValue'> & {
  /** Values of the open items. Always an array, including when `multiple` is false. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  /** Whether more than one item may be open at once. */
  multiple?: boolean;
  disabled?: boolean;
  keepMounted?: boolean;
  /** Let the browser's find-in-page open a panel. Uses `hidden="until-found"`. */
  hiddenUntilFound?: boolean;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export type AccordionItemProps = NativeDivProps & {
  /** Identifies the item in `value` / `defaultValue`. Base generates one when omitted. */
  value?: string;
  disabled?: boolean;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

export type AccordionHeaderProps = Omit<
  HTMLAttributes<HTMLHeadingElement>,
  'className' | 'style' | 'color'
> & {
  /** Where this section sits in the document outline. */
  level?: AccordionHeadingLevel;
  ref?: Ref<HTMLHeadingElement>;
  children?: ReactNode;
};

export type AccordionTriggerProps = NativeButtonProps & {
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

export type AccordionPanelProps = NativeDivProps & {
  keepMounted?: boolean;
  hiddenUntilFound?: boolean;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

/**
 * The elements are module constants rather than freshly built per render: Base UI clones the
 * element it is given, so one instance per level is enough and re-creating it every render would
 * hand the reconciler a new type identity for no reason.
 */
const HEADING_ELEMENT: Record<AccordionHeadingLevel, ReactElement> = {
  2: <h2 />,
  3: <h3 />,
  4: <h4 />,
};

function AccordionRoot({
  value,
  defaultValue,
  onValueChange,
  multiple = false,
  disabled,
  keepMounted,
  hiddenUntilFound,
  children,
  ref,
  ...rest
}: AccordionRootProps): ReactElement {
  return (
    <BaseAccordion.Root<string>
      ref={ref}
      value={value}
      defaultValue={defaultValue}
      // Re-wrapped rather than forwarded — see the note on Collapsible.Root. Base UI calls with a
      // second `eventDetails` argument, and a signature that promises one parameter has to deliver
      // one parameter at runtime too.
      onValueChange={onValueChange ? (next) => onValueChange(next) : undefined}
      multiple={multiple}
      disabled={disabled}
      keepMounted={keepMounted}
      hiddenUntilFound={hiddenUntilFound}
      className={styles.root}
      {...rest}
    >
      {children}
    </BaseAccordion.Root>
  );
}

function AccordionItem({ value, disabled, children, ref, ...rest }: AccordionItemProps): ReactElement {
  return (
    <BaseAccordion.Item ref={ref} value={value} disabled={disabled} className={styles.item} {...rest}>
      {children}
    </BaseAccordion.Item>
  );
}

function AccordionHeader({ level = 3, children, ref, ...rest }: AccordionHeaderProps): ReactElement {
  return (
    <BaseAccordion.Header ref={ref} render={HEADING_ELEMENT[level]} className={styles.header} {...rest}>
      {children}
    </BaseAccordion.Header>
  );
}

function AccordionTrigger({ children, ref, ...rest }: AccordionTriggerProps): ReactElement {
  return (
    <BaseAccordion.Trigger ref={ref} className={styles.trigger} {...rest}>
      <span className={styles.triggerLabel}>{children}</span>
      <span className={styles.indicator}>
        <ChevronDownIcon />
      </span>
    </BaseAccordion.Trigger>
  );
}

function AccordionPanel({
  keepMounted,
  hiddenUntilFound,
  children,
  ref,
  ...rest
}: AccordionPanelProps): ReactElement {
  return (
    <BaseAccordion.Panel
      ref={ref}
      keepMounted={keepMounted}
      hiddenUntilFound={hiddenUntilFound}
      className={styles.panel}
      {...rest}
    >
      <div className={styles.panelContent}>{children}</div>
    </BaseAccordion.Panel>
  );
}

export const Accordion = {
  Root: AccordionRoot,
  Item: AccordionItem,
  Header: AccordionHeader,
  Trigger: AccordionTrigger,
  Panel: AccordionPanel,
} as const;
