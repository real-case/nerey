import type { InputHTMLAttributes, ReactElement, ReactNode, Ref } from 'react';
import { Combobox as BaseCombobox } from '@base-ui/react/combobox';

import { cx } from '../../internal/cx';
import { CheckIcon, ChevronDownIcon, CloseIcon } from '../icons/icons';
import styles from './combobox.module.css';

/**
 * A text input that filters a list of predefined options, built on Base UI's `Combobox`.
 *
 * Base UI 1.7 ships TWO components for typing-against-a-list and they are not aliases.
 * `Combobox` is the selection component: it holds a committed `value` separate from the input
 * string, renders item indicators, and supports multi-select with chips. `Autocomplete` is the
 * text component: its value IS the input string, and it suggests completions rather than
 * committing a choice — it has no `Label`, no `ItemIndicator`, and its items carry no
 * `data-selected`. Filtered SELECTION is `Combobox`, so that is what this wraps.
 *
 * ADR 0022 — wrapped, never re-exported, and no prop type here is derived from a Base UI
 * component. ADR 0028 — the compound shape is kept.
 *
 * Multi-select and its `Chips` / `Chip` / `ChipRemove` parts are deliberately not wrapped yet.
 * Chips are a second selection model with their own keyboard contract (Backspace removes the
 * last chip, arrow keys move between them) and shipping them half-styled would be worse than
 * not shipping them.
 */

/** Exported so a host can translate them once instead of at every call site. */
export const DEFAULT_COMBOBOX_CLEAR_LABEL = 'Clear selection';
export const DEFAULT_COMBOBOX_TRIGGER_LABEL = 'Show suggestions';

/* ── Root ──────────────────────────────────────────────────────────────────────────────── */

export type ComboboxRootProps<Item> = {
  /**
   * The full option set. Base UI filters it against the typed text and, critically, this is
   * also what makes `Combobox.Empty` work — without `items` the component has no way to know
   * that a query matched nothing rather than that the caller rendered nothing.
   */
  items?: readonly Item[];
  value?: Item | null;
  defaultValue?: Item | null;
  onValueChange?: (value: Item | null) => void;
  /** The text in the field, which is not the selection — a user can type without choosing. */
  inputValue?: string;
  defaultInputValue?: string;
  onInputValueChange?: (inputValue: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** How an item becomes the text shown in the field. Inferred for `{ value, label }` items. */
  itemToStringLabel?: (item: Item) => string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  name?: string;
  /** Focus is trapped and the page behind is inert while the list is open. */
  modal?: boolean;
  children?: ReactNode;
};

function ComboboxRoot<Item>({ children, ...rest }: ComboboxRootProps<Item>): ReactElement {
  return <BaseCombobox.Root {...rest}>{children}</BaseCombobox.Root>;
}

/* ── Field ─────────────────────────────────────────────────────────────────────────────── */

export type ComboboxInputGroupProps = {
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

/**
 * The bordered box. The input inside it is deliberately borderless: the focus ring belongs to
 * the whole field, including the clear and open buttons sitting in it, and a ring drawn around
 * only the text area reads as though the buttons were somewhere else.
 */
function ComboboxInputGroup({ children, ref }: ComboboxInputGroupProps): ReactElement {
  return (
    <BaseCombobox.InputGroup ref={ref} className={styles.inputGroup}>
      {children}
    </BaseCombobox.InputGroup>
  );
}

type NativeComboboxInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'style' | 'color' | 'value' | 'defaultValue' | 'aria-label' | 'aria-labelledby'
>;

export type ComboboxInputProps = NativeComboboxInputProps & {
  /**
   * The field's accessible name. Required, and `aria-label` is removed from the accepted native
   * props so this is the only way to supply it — Base UI leaves the input unnamed unless a
   * `Field` wraps it, and an unnamed text input is an axe failure that looks finished on
   * screen (ADR 0032).
   */
  label: string;
  ref?: Ref<HTMLInputElement>;
};

function ComboboxInput({ label, ref, ...rest }: ComboboxInputProps): ReactElement {
  return <BaseCombobox.Input ref={ref} aria-label={label} className={styles.input} {...rest} />;
}

export type ComboboxTriggerProps = {
  /**
   * The button's accessible name.
   *
   * Base UI marks this button `aria-hidden` and `tabindex="-1"` whenever a `Combobox.Input` is
   * present, because the input already carries `role="combobox"` and `aria-expanded` — a second
   * announced control for the same list is noise, not an affordance. The name is set anyway: it
   * is what a caller gets if they build a trigger-only combobox with no input, and an unnamed
   * button is a worse default than an unused one.
   */
  label?: string;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

function ComboboxTrigger({
  label = DEFAULT_COMBOBOX_TRIGGER_LABEL,
  children,
  ref,
}: ComboboxTriggerProps): ReactElement {
  return (
    <BaseCombobox.Trigger ref={ref} aria-label={label} className={styles.fieldButton}>
      {children ?? <ChevronDownIcon />}
    </BaseCombobox.Trigger>
  );
}

export type ComboboxClearProps = {
  label?: string;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

/**
 * Base UI mounts this button only while there is something to clear, so nothing here branches
 * on the value and the stylesheet has no hidden state to describe. It also means the button is
 * genuinely absent from the DOM — a test that expects to find it in an empty field is asserting
 * something that was never true.
 *
 * It carries `tabindex="-1"`: a pointer shortcut for something the keyboard can already do by
 * selecting the field's text and deleting it, and one more stop in the tab order that appears
 * and disappears as the user types would cost more than it saves. It is still named and still
 * in the accessibility tree, so it is reachable by touch and by screen-reader navigation.
 */
function ComboboxClear({
  label = DEFAULT_COMBOBOX_CLEAR_LABEL,
  children,
  ref,
}: ComboboxClearProps): ReactElement {
  return (
    <BaseCombobox.Clear ref={ref} aria-label={label} className={cx(styles.fieldButton, styles.clear)}>
      {children ?? <CloseIcon />}
    </BaseCombobox.Clear>
  );
}

/* ── Portal / Positioner / Popup ───────────────────────────────────────────────────────── */

export type ComboboxPortalProps = {
  container?: HTMLElement | null;
  keepMounted?: boolean;
  children?: ReactNode;
};

function ComboboxPortal({ children, ...rest }: ComboboxPortalProps): ReactElement {
  return <BaseCombobox.Portal {...rest}>{children}</BaseCombobox.Portal>;
}

export type ComboboxPositionerProps = {
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  children?: ReactNode;
};

/** Constraint only — all paint is on Popup (ADR 0025). See the stylesheet for why. */
function ComboboxPositioner({ sideOffset = 4, children, ...rest }: ComboboxPositionerProps): ReactElement {
  return (
    <BaseCombobox.Positioner className={styles.positioner} sideOffset={sideOffset} {...rest}>
      {children}
    </BaseCombobox.Positioner>
  );
}

export type ComboboxPopupProps = {
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

function ComboboxPopup({ children, ref }: ComboboxPopupProps): ReactElement {
  return (
    <BaseCombobox.Popup ref={ref} className={styles.popup}>
      {children}
    </BaseCombobox.Popup>
  );
}

/* ── Empty state ───────────────────────────────────────────────────────────────────────── */

export type ComboboxEmptyProps = {
  children?: ReactNode;
};

/**
 * The no-results message, and the reason the two-element structure exists.
 *
 * Base UI's `Empty` must stay mounted at all times — it is a polite live region, and a live
 * region that is conditionally rendered announces nothing when it changes. So the outer element
 * is permanently in the DOM with no padding and no text, and the padding lives on the inner
 * element that only exists while there are no matches. Putting the padding on the outer one
 * would leave an unexplained blank strip above every populated list.
 */
function ComboboxEmpty({ children }: ComboboxEmptyProps): ReactElement {
  return (
    <BaseCombobox.Empty className={styles.empty}>
      <div className={styles.emptyMessage}>{children}</div>
    </BaseCombobox.Empty>
  );
}

/* ── List and items ────────────────────────────────────────────────────────────────────── */

export type ComboboxListProps<Item> = {
  /**
   * Either ordinary children, or a function called once per item that SURVIVED the filter.
   * The function form is the one that makes filtering work without the caller re-implementing
   * it: Base UI owns the matching, and the call site only says what one row looks like.
   */
  children?: ReactNode | ((item: Item, index: number) => ReactNode);
  ref?: Ref<HTMLDivElement>;
};

function ComboboxList<Item>({ children, ref }: ComboboxListProps<Item>): ReactElement {
  return (
    <BaseCombobox.List ref={ref} className={styles.list}>
      {children}
    </BaseCombobox.List>
  );
}

export type ComboboxItemProps<Item> = {
  value?: Item;
  disabled?: boolean;
  /** Position in the unfiltered list. Base UI uses it to skip re-measuring long lists. */
  index?: number;
  ref?: Ref<HTMLDivElement>;
  children?: ReactNode;
};

function ComboboxItem<Item>({ children, ref, ...rest }: ComboboxItemProps<Item>): ReactElement {
  return (
    <BaseCombobox.Item ref={ref} className={styles.item} {...rest}>
      {children}
    </BaseCombobox.Item>
  );
}

export type ComboboxItemIndicatorProps = {
  children?: ReactNode;
};

function ComboboxItemIndicator({ children }: ComboboxItemIndicatorProps): ReactElement {
  return (
    <BaseCombobox.ItemIndicator className={styles.itemIndicator}>
      {children ?? <CheckIcon />}
    </BaseCombobox.ItemIndicator>
  );
}

/* ── Structure ─────────────────────────────────────────────────────────────────────────── */

export type ComboboxGroupProps = {
  children?: ReactNode;
};

function ComboboxGroup({ children }: ComboboxGroupProps): ReactElement {
  return <BaseCombobox.Group className={styles.group}>{children}</BaseCombobox.Group>;
}

export type ComboboxGroupLabelProps = {
  children?: ReactNode;
};

/** Base UI points the group's `aria-labelledby` at this, so it is structure, not decoration. */
function ComboboxGroupLabel({ children }: ComboboxGroupLabelProps): ReactElement {
  return <BaseCombobox.GroupLabel className={styles.groupLabel}>{children}</BaseCombobox.GroupLabel>;
}

/** The namespace is the export — see the note on `Menu` (ADR 0028). */
export const Combobox = {
  Root: ComboboxRoot,
  InputGroup: ComboboxInputGroup,
  Input: ComboboxInput,
  Trigger: ComboboxTrigger,
  Clear: ComboboxClear,
  Portal: ComboboxPortal,
  Positioner: ComboboxPositioner,
  Popup: ComboboxPopup,
  Empty: ComboboxEmpty,
  List: ComboboxList,
  Item: ComboboxItem,
  ItemIndicator: ComboboxItemIndicator,
  Group: ComboboxGroup,
  GroupLabel: ComboboxGroupLabel,
};
