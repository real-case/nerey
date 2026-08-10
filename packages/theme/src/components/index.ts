/**
 * The theme's component surface, re-exported one directory per component.
 *
 * ADR 0028 — nothing here is reachable by a deep import once the package is published, so this
 * file is the whole contract: a component that is not listed is free to change in a patch, and
 * a component that is listed is not. Types are exported alongside their component because a
 * consumer who wraps `Surface` needs `SurfaceProps` to type the wrapper, and forcing them to
 * reconstruct it with `ComponentProps<typeof Surface>` would make the wrapper break whenever the
 * signature moves (ADR 0022).
 */

export { Accordion } from './accordion/accordion';
export type {
  AccordionHeaderProps,
  AccordionHeadingLevel,
  AccordionItemProps,
  AccordionPanelProps,
  AccordionRootProps,
  AccordionTriggerProps,
} from './accordion/accordion';

export { AlertDialog } from './alert-dialog/alert-dialog';
export type {
  AlertDialogBackdropProps,
  AlertDialogCloseProps,
  AlertDialogDescriptionProps,
  AlertDialogFooterProps,
  AlertDialogPopupProps,
  AlertDialogPortalProps,
  AlertDialogRootProps,
  AlertDialogTitleProps,
  AlertDialogTone,
  AlertDialogTriggerProps,
} from './alert-dialog/alert-dialog';

export { Badge } from './badge/badge';
export type { BadgeProps, BadgeSize, BadgeTone, BadgeVariant } from './badge/badge';

export { Button } from './button/button';
export type { ButtonProps, ButtonSize, ButtonTone, ButtonVariant } from './button/button';

export { Checkbox, CheckboxGroup } from './checkbox/checkbox';
export type { CheckboxGroupProps, CheckboxIndicatorProps, CheckboxRootProps } from './checkbox/checkbox';

export { Collapsible } from './collapsible/collapsible';
export type {
  CollapsiblePanelProps,
  CollapsibleRootProps,
  CollapsibleTriggerProps,
} from './collapsible/collapsible';

export { Combobox, DEFAULT_COMBOBOX_CLEAR_LABEL, DEFAULT_COMBOBOX_TRIGGER_LABEL } from './combobox/combobox';
export type {
  ComboboxClearProps,
  ComboboxEmptyProps,
  ComboboxGroupLabelProps,
  ComboboxGroupProps,
  ComboboxInputGroupProps,
  ComboboxInputProps,
  ComboboxItemIndicatorProps,
  ComboboxItemProps,
  ComboboxListProps,
  ComboboxPopupProps,
  ComboboxPortalProps,
  ComboboxPositionerProps,
  ComboboxRootProps,
  ComboboxTriggerProps,
} from './combobox/combobox';

export { DEFAULT_DIALOG_DISMISS_LABEL, Dialog } from './dialog/dialog';
export type {
  DialogBackdropProps,
  DialogCloseProps,
  DialogDescriptionProps,
  DialogFooterProps,
  DialogPopupProps,
  DialogPortalProps,
  DialogRootProps,
  DialogSize,
  DialogTitleProps,
  DialogTriggerProps,
} from './dialog/dialog';

export { Field } from './field/field';
export type {
  FieldControlProps,
  FieldControlSize,
  FieldDescriptionProps,
  FieldErrorProps,
  FieldItemProps,
  FieldLabelProps,
  FieldRootProps,
  FieldValidate,
  FieldValidationMode,
  FieldValidityFlags,
  FieldValidityProps,
  FieldValidityState,
} from './field/field';

export { Form } from './field/form';
export type { FormProps } from './field/form';

export { IconButton } from './icon-button/icon-button';
export type {
  IconButtonProps,
  IconButtonSize,
  IconButtonTone,
  IconButtonVariant,
} from './icon-button/icon-button';

export {
  AlertCircleIcon,
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  DotsHorizontalIcon,
  ExternalLinkIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  SpinnerArcIcon,
} from './icons/icons';
export type { IconProps } from './icons/icons';

export { Input } from './input/input';
export type { InputProps, InputSize } from './input/input';

export { Menu } from './menu/menu';
export type {
  MenuAlign,
  MenuCheckboxItemProps,
  MenuGroupLabelProps,
  MenuGroupProps,
  MenuItemProps,
  MenuPopupProps,
  MenuPortalProps,
  MenuPositionerProps,
  MenuRadioGroupProps,
  MenuRadioItemProps,
  MenuRootProps,
  MenuSeparatorProps,
  MenuSide,
  MenuSubmenuRootProps,
  MenuSubmenuTriggerProps,
  MenuTriggerProps,
  MenuTriggerSize,
  MenuTriggerVariant,
} from './menu/menu';

export { Meter } from './meter/meter';
export type {
  MeterIndicatorProps,
  MeterLabelProps,
  MeterRootProps,
  MeterSize,
  MeterTone,
  MeterTrackProps,
  MeterValueProps,
} from './meter/meter';

export { NumberField } from './number-field/number-field';
export type {
  NumberFieldGroupProps,
  NumberFieldInputProps,
  NumberFieldRootProps,
  NumberFieldScrubAreaProps,
  NumberFieldSize,
  NumberFieldStepperProps,
} from './number-field/number-field';

export { Popover } from './popover/popover';
export type {
  PopoverAlign,
  PopoverArrowProps,
  PopoverCloseProps,
  PopoverDescriptionProps,
  PopoverPopupProps,
  PopoverPortalProps,
  PopoverPositionerProps,
  PopoverRootProps,
  PopoverSide,
  PopoverTitleProps,
  PopoverTriggerProps,
} from './popover/popover';

export { Progress } from './progress/progress';
export type {
  ProgressIndicatorProps,
  ProgressLabelProps,
  ProgressRootProps,
  ProgressSize,
  ProgressTone,
  ProgressTrackProps,
  ProgressValueProps,
} from './progress/progress';

export { Radio, RadioGroup } from './radio-group/radio-group';
export type { RadioGroupProps, RadioIndicatorProps, RadioRootProps } from './radio-group/radio-group';

export { Select } from './select/select';
export type {
  SelectGroupLabelProps,
  SelectGroupProps,
  SelectIconProps,
  SelectItemIndicatorProps,
  SelectItemProps,
  SelectItems,
  SelectItemTextProps,
  SelectPopupProps,
  SelectPortalProps,
  SelectPositionerProps,
  SelectRootProps,
  SelectScrollArrowProps,
  SelectSize,
  SelectTriggerProps,
  SelectValueProps,
} from './select/select';

export { Separator } from './separator/separator';
export type { SeparatorOrientation, SeparatorProps } from './separator/separator';

export { Skeleton } from './skeleton/skeleton';
export type { SkeletonProps, SkeletonVariant } from './skeleton/skeleton';

export { Slider } from './slider/slider';
export type {
  SliderControlProps,
  SliderIndicatorProps,
  SliderRootProps,
  SliderThumbProps,
  SliderTrackProps,
  SliderValue,
  SliderValueProps,
} from './slider/slider';

export { DEFAULT_SPINNER_LABEL, Spinner } from './spinner/spinner';
export type { SpinnerProps, SpinnerSize } from './spinner/spinner';

export { Stack } from './stack/stack';
export type { StackAlign, StackDirection, StackGap, StackJustify, StackProps } from './stack/stack';

export { Surface } from './surface/surface';
export type { SurfacePadding, SurfaceProps, SurfaceRadius, SurfaceVariant } from './surface/surface';

export { Switch } from './switch/switch';
export type { SwitchRootProps, SwitchThumbProps } from './switch/switch';

export { Tabs } from './tabs/tabs';
export type {
  TabsIndicatorProps,
  TabsListProps,
  TabsOrientation,
  TabsPanelProps,
  TabsRootProps,
  TabsTabProps,
} from './tabs/tabs';

export { Text } from './text/text';
export type { TextElement, TextProps, TextSize, TextTone, TextWeight } from './text/text';

export { Textarea } from './input/textarea';
export type { TextareaProps, TextareaSize } from './input/textarea';

export {
  createToastManager,
  DEFAULT_TOAST_CLOSE_LABEL,
  DEFAULT_TOAST_VIEWPORT_LABEL,
  Toast,
  useToastManager,
} from './toast/toast';
export type {
  ToastActionOptions,
  ToastActionProps,
  ToastCloseProps,
  ToastDescriptionProps,
  ToastItem,
  ToastListProps,
  ToastManager,
  ToastOptions,
  ToastPortalProps,
  ToastProviderProps,
  ToastRootProps,
  ToastTitleProps,
  ToastTone,
  ToastViewportProps,
} from './toast/toast';

export { Toggle, ToggleGroup } from './toggle-group/toggle-group';
export type {
  ToggleGroupOrientation,
  ToggleGroupProps,
  ToggleGroupSize,
  ToggleGroupVariant,
  ToggleProps,
} from './toggle-group/toggle-group';

export { Tooltip } from './tooltip/tooltip';
export type {
  TooltipAlign,
  TooltipArrowProps,
  TooltipPopupProps,
  TooltipPortalProps,
  TooltipPositionerProps,
  TooltipProviderProps,
  TooltipRootProps,
  TooltipSide,
  TooltipTriggerProps,
} from './tooltip/tooltip';

export { VisuallyHidden } from './visually-hidden/visually-hidden';
export type { VisuallyHiddenProps } from './visually-hidden/visually-hidden';
