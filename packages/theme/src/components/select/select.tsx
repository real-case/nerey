import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ButtonHTMLAttributes, ReactElement, ReactNode, Ref } from 'react';
import { Select as BaseSelect } from '@base-ui/react/select';

import { cx } from '../../internal/cx';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from '../icons/icons';
import styles from './select.module.css';

/**
 * A single-choice listbox, built on Base UI's headless select.
 *
 * ADR 0022 — wrapped, never re-exported, and no prop type here is derived from a Base UI
 * component. ADR 0028 — the compound shape is kept, because grouping, separators and the
 * placement of the check mark are structure, not configuration.
 *
 * Base UI's `Select.Item` reports selection as `data-selected`, NOT the `data-checked` that
 * Checkbox, Radio and the menu's own selectable items use. That is a real difference and not a
 * typo to normalise away: `data-checked` belongs to controls that hold an independent boolean,
 * `data-selected` to one option among a set that a listbox owns.
 */

export type SelectSize = 'sm' | 'md';

/**
 * Size travels through React rather than through the DOM. The popup is portalled to `<body>`,
 * so no descendant selector and no inherited custom property can reach it from the trigger —
 * the two halves of one control are not in the same subtree. Setting `size` twice at the call
 * site would work and would be wrong the first time somebody changed only one of them.
 */
const SelectSizeContext = createContext<SelectSize>('md');

const TRIGGER_SIZE_CLASS: Record<SelectSize, string | undefined> = {
  sm: styles.triggerSizeSm,
  md: undefined,
};

const POPUP_SIZE_CLASS: Record<SelectSize, string | undefined> = {
  sm: styles.popupSizeSm,
  md: undefined,
};

/**
 * The trigger's accessible name, carried to the portalled popup.
 *
 * Base UI names the listbox NOTHING. `Select.Popup` (and `Select.List`, when one is present)
 * puts `role="listbox"` on an element and gives it an id and an orientation — not the trigger's
 * label, and not `Select.Label`'s either. `listbox` is one of ARIA's input-field roles, so an
 * unnamed one is a WCAG 4.1.2 failure under axe's `aria-input-field-name` (ADR 0032).
 *
 * It is easy to miss because axe exempts a listbox that some `role="combobox"` currently points
 * `aria-controls` at — the combobox is taken to name it. Base UI drops that attribute from the
 * trigger as soon as the select closes, and the popup outlives the close (it stays mounted and
 * `hidden` so the closed trigger's typeahead keeps its labels), so the exemption is a property
 * of one transient DOM relationship rather than of this component. Naming the listbox outright
 * is what makes it independent of that: the popup is a named listbox in every state, whether or
 * not a trigger happens to be claiming it, and whether or not one exists at all.
 *
 * The name travels through React for the same reason `size` does: the popup is portalled to
 * `<body>`, so the trigger is not its ancestor in any sense the DOM or the cascade can see. The
 * trigger publishes its `label` from an effect rather than during render because the two are
 * siblings — the popup has already rendered by the time the trigger runs.
 */
type SelectLabelStore = {
  label: string | undefined;
  publish: (label: string) => void;
};

const SelectLabelContext = createContext<SelectLabelStore>({
  label: undefined,
  publish: () => {},
});

/* ── Root ──────────────────────────────────────────────────────────────────────────────── */

/**
 * A value-to-label lookup, either as a map or as the list you probably already have.
 *
 * Without it `Select.Value` renders the RAW value — `"business"`, not `"Business"`. That is not
 * a bug in Base UI and it is not something `Select.ItemText` can fix: the trigger has to show a
 * label while the popup is CLOSED, and the items that carry the labels do not exist in the DOM
 * then. A select whose trigger reads `premium_economy` is the most common way this component is
 * shipped broken, so the mechanism is a documented prop rather than a footnote.
 */
export type SelectItems<Value extends string = string> =
  Readonly<Record<string, ReactNode>> | readonly { readonly value: Value; readonly label: ReactNode }[];

export type SelectRootProps<Value extends string = string> = {
  value?: Value | null;
  defaultValue?: Value | null;
  onValueChange?: (value: Value | null) => void;
  /** See `SelectItems` — required in practice for the trigger to show a label, not a value. */
  items?: SelectItems<Value>;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: SelectSize;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  /** Submits the selection with a surrounding form under this name. */
  name?: string;
  /** Focus is trapped and the page behind is inert while open. Base UI's default is `true`. */
  modal?: boolean;
  children?: ReactNode;
};

function SelectRoot<Value extends string = string>({
  size = 'md',
  children,
  ...rest
}: SelectRootProps<Value>): ReactElement {
  const [triggerLabel, setTriggerLabel] = useState<string>();
  const labelStore = useMemo<SelectLabelStore>(
    () => ({ label: triggerLabel, publish: setTriggerLabel }),
    [triggerLabel],
  );

  return (
    <SelectSizeContext.Provider value={size}>
      <SelectLabelContext.Provider value={labelStore}>
        <BaseSelect.Root {...rest}>{children}</BaseSelect.Root>
      </SelectLabelContext.Provider>
    </SelectSizeContext.Provider>
  );
}

/* ── Trigger ───────────────────────────────────────────────────────────────────────────── */

type NativeSelectTriggerProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'style' | 'color' | 'value' | 'aria-label' | 'aria-labelledby'
>;

export type SelectTriggerProps = NativeSelectTriggerProps & {
  /**
   * The field's accessible name — "Cabin class", not the selected value.
   *
   * Required, and `aria-label` is removed from the accepted native props so this is the only
   * way to supply it. Base UI renders the trigger as `role="combobox"`, and a combobox does not
   * take its name from its own content: without this the control reads as an unnamed combobox
   * whose value happens to be "Economy", which is exactly the axe failure that survives review
   * because the component looks finished (ADR 0032).
   *
   * It names the popup's listbox too — see `SelectLabelContext`.
   */
  label: string;
  /** Swap the rendered element while keeping every style and attribute. */
  render?: ReactElement;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

function SelectTrigger({
  label,
  render,
  type = 'button',
  children,
  ref,
  ...rest
}: SelectTriggerProps): ReactElement {
  const size = useContext(SelectSizeContext);
  const { publish } = useContext(SelectLabelContext);

  useEffect(() => {
    publish(label);
  }, [label, publish]);

  return (
    <BaseSelect.Trigger
      ref={ref}
      type={type}
      aria-label={label}
      className={cx(styles.trigger, TRIGGER_SIZE_CLASS[size])}
      render={render}
      {...rest}
    >
      {children}
    </BaseSelect.Trigger>
  );
}

export type SelectValueProps = {
  /** Shown until something is chosen. Base UI marks the span `data-placeholder` while it is. */
  placeholder?: ReactNode;
};

function SelectValue({ placeholder }: SelectValueProps): ReactElement {
  return <BaseSelect.Value className={styles.value} placeholder={placeholder} />;
}

export type SelectIconProps = {
  children?: ReactNode;
};

/** Decorative by construction — the trigger is already named, so the glyph names nothing. */
function SelectIcon({ children }: SelectIconProps): ReactElement {
  return <BaseSelect.Icon className={styles.icon}>{children ?? <ChevronDownIcon />}</BaseSelect.Icon>;
}

/* ── Portal / Positioner / Popup ───────────────────────────────────────────────────────── */

export type SelectPortalProps = {
  container?: HTMLElement | null;
  keepMounted?: boolean;
  children?: ReactNode;
};

/**
 * Select is the one floating component in Base UI whose Portal is genuinely optional — it
 * publishes no context, so nothing throws without it. It is still a part here, and still used
 * in every example: a listbox that renders inside the trigger's own stacking context is one
 * `overflow: hidden` away from being clipped by a card the consumer wrote months earlier.
 */
function SelectPortal({ children, ...rest }: SelectPortalProps): ReactElement {
  return <BaseSelect.Portal {...rest}>{children}</BaseSelect.Portal>;
}

export type SelectPositionerProps = {
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /**
   * Overlap the trigger so the selected item's text lands on the trigger's text. Base UI
   * defaults this to `true`; Nerey defaults it to `false` because while it is on, `side` and
   * `align` are silently ignored and `data-side` reports `"none"` — a positioning API that
   * quietly does nothing is worse than one that is off.
   */
  alignItemWithTrigger?: boolean;
  children?: ReactNode;
};

function SelectPositioner({
  sideOffset = 6,
  alignItemWithTrigger = false,
  children,
  ...rest
}: SelectPositionerProps): ReactElement {
  return (
    <BaseSelect.Positioner
      className={styles.positioner}
      sideOffset={sideOffset}
      alignItemWithTrigger={alignItemWithTrigger}
      {...rest}
    >
      {children}
    </BaseSelect.Positioner>
  );
}

export type SelectPopupProps = {
  /**
   * The listbox's accessible name. Defaults to the `label` of the `Select.Trigger` in the same
   * Root, which is what a call site wants — the field and its list of options are one control
   * and share one name. Pass it only for a Root with no trigger of its own.
   */
  label?: string;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

/**
 * `Select.List` is deliberately absent from this surface. When no List is present Base UI puts
 * `role="listbox"` on the Popup itself and drops it to `role="presentation"` when one appears,
 * so the semantics are identical either way — and one fewer mandatory wrapper is one fewer part
 * a call site can leave out and still render something that looks right.
 *
 * That also means this element is the listbox, and therefore the element that has to be named
 * (see `SelectLabelContext`).
 */
function SelectPopup({ label, children, ref }: SelectPopupProps): ReactElement {
  const size = useContext(SelectSizeContext);
  const { label: triggerLabel } = useContext(SelectLabelContext);

  return (
    <BaseSelect.Popup
      ref={ref}
      aria-label={label ?? triggerLabel}
      className={cx(styles.popup, POPUP_SIZE_CLASS[size])}
    >
      {children}
    </BaseSelect.Popup>
  );
}

/* ── Items ─────────────────────────────────────────────────────────────────────────────── */

export type SelectItemProps = {
  value: string;
  disabled?: boolean;
  /** The string typeahead matches against, when `children` is not plain text. */
  label?: string;
  ref?: Ref<HTMLElement>;
  children?: ReactNode;
};

function SelectItem({ children, ref, ...rest }: SelectItemProps): ReactElement {
  return (
    <BaseSelect.Item ref={ref} className={styles.item} {...rest}>
      {children}
    </BaseSelect.Item>
  );
}

export type SelectItemTextProps = {
  children?: ReactNode;
};

/**
 * The item's label, kept separate from its indicator so the two can be laid out independently
 * and so the label alone is what typeahead matches.
 *
 * It does NOT feed the closed trigger — that is what `items` on the Root is for. The two are
 * easy to confuse, and confusing them produces a select that reads correctly while open and
 * shows a raw value the moment it closes.
 */
function SelectItemText({ children }: SelectItemTextProps): ReactElement {
  return <BaseSelect.ItemText className={styles.itemText}>{children}</BaseSelect.ItemText>;
}

export type SelectItemIndicatorProps = {
  children?: ReactNode;
};

function SelectItemIndicator({ children }: SelectItemIndicatorProps): ReactElement {
  return (
    <BaseSelect.ItemIndicator className={styles.itemIndicator}>
      {children ?? <CheckIcon />}
    </BaseSelect.ItemIndicator>
  );
}

/* ── Structure ─────────────────────────────────────────────────────────────────────────── */

export type SelectGroupProps = {
  children?: ReactNode;
};

function SelectGroup({ children }: SelectGroupProps): ReactElement {
  return <BaseSelect.Group className={styles.group}>{children}</BaseSelect.Group>;
}

export type SelectGroupLabelProps = {
  children?: ReactNode;
};

/** Base UI points the group's `aria-labelledby` at this, so it is structure, not decoration. */
function SelectGroupLabel({ children }: SelectGroupLabelProps): ReactElement {
  return <BaseSelect.GroupLabel className={styles.groupLabel}>{children}</BaseSelect.GroupLabel>;
}

export type SelectScrollArrowProps = Record<string, never>;

/**
 * The two scroll affordances are `aria-hidden` inside Base UI, which is what keeps the popup a
 * conforming listbox: `role="listbox"` may only own options and groups, and a visible `<div>`
 * between the options would fail `aria-required-children` for a purely decorative gradient.
 */
function SelectScrollUpArrow(_props: SelectScrollArrowProps): ReactElement {
  return (
    <BaseSelect.ScrollUpArrow className={cx(styles.scrollArrow, styles.scrollArrowUp)}>
      <ChevronUpIcon />
    </BaseSelect.ScrollUpArrow>
  );
}

function SelectScrollDownArrow(_props: SelectScrollArrowProps): ReactElement {
  return (
    <BaseSelect.ScrollDownArrow className={cx(styles.scrollArrow, styles.scrollArrowDown)}>
      <ChevronDownIcon />
    </BaseSelect.ScrollDownArrow>
  );
}

/** The namespace is the export — see the note on `Menu` (ADR 0028). */
export const Select = {
  Root: SelectRoot,
  Trigger: SelectTrigger,
  Value: SelectValue,
  Icon: SelectIcon,
  Portal: SelectPortal,
  Positioner: SelectPositioner,
  Popup: SelectPopup,
  Item: SelectItem,
  ItemText: SelectItemText,
  ItemIndicator: SelectItemIndicator,
  Group: SelectGroup,
  GroupLabel: SelectGroupLabel,
  ScrollUpArrow: SelectScrollUpArrow,
  ScrollDownArrow: SelectScrollDownArrow,
};
