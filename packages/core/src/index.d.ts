/**
 * @nerey/core — headless generative UI for React.
 *
 * ADR 0028: this is the ONLY public entry point for the runtime surface, alongside
 * `@nerey/core/mock` (development helpers) and `@nerey/core/testing` (the conformance kit).
 * There are no deep imports into `dist/`, so everything reachable here is public API and
 * everything not listed here is free to change in a patch release (ADR 0029).
 *
 * Grouped by what a consumer actually reaches for, in roughly the order they meet it.
 */
export type {
  AfterExpiry,
  AnyWidgetRegistryEntry,
  ExpiryRule,
  FallbackRenderer,
  Lifecycle,
  MessagePersistence,
  NereyErrorCode,
  NereyErrorLike,
  NereyMessage,
  NereyWidgetEnvelope,
  Placement,
  SlotName,
  WidgetComponent,
  WidgetComponentProps,
  WidgetHostValue,
  WidgetInteractionHandler,
  WidgetInteractionPayload,
  WidgetMigration,
  WidgetRegistry,
  WidgetRegistryEntry,
  WidgetStateRecord,
  WidgetStatus,
} from './types';
export {
  asAnyWidget,
  composeRegistries,
  createWidgetRegistry,
  defineWidget,
  emptyRegistry,
} from './registry';
export type { CreateRegistryOptions } from './registry';
export {
  DEFAULT_HOST_VALUE,
  useConversationId,
  useWidgetHost,
  WidgetHostProvider,
} from './host/host-context';
export { WidgetRenderer } from './render/widget-renderer';
export type { WidgetRendererProps } from './render/widget-renderer';
export { WidgetErrorBoundary } from './render/error-boundary';
export type { WidgetErrorBoundaryProps } from './render/error-boundary';
export { WidgetFallback } from './render/fallback';
export type { FallbackProps } from './render/fallback';
export { MessageSlotHost } from './slots/message-slot-host';
export type { MessageSlotHostProps } from './slots/message-slot-host';
export { InputSlotHost } from './slots/input-slot-host';
export type { InputSlotHostProps } from './slots/input-slot-host';
export { DEFAULT_DISMISS_LABEL, OverlaySlotHost } from './slots/overlay-slot-host';
export type { OverlaySlotHostProps } from './slots/overlay-slot-host';
export {
  DEFAULT_INPUT_POSITION,
  belongsInTranscript,
  inputPositionOf,
  isDismissible,
  resolvedPlacement,
} from './slots/placement';
export type { InputPosition, OverlayPlacement, OverlayScope } from './slots/placement';
export {
  EXPIRE_ON_INTERACT,
  NEVER_EXPIRES,
  firstFiredRule,
  isExpired,
  msUntilNextTimeout,
  ruleHasFired,
} from './lifecycle/expiry';
export type { LifecycleSignals } from './lifecycle/expiry';
export {
  NAVIGATE_EVENT,
  useResetLifecycleOnChange,
  useWidgetLifecycle,
} from './lifecycle/use-widget-lifecycle';
export type { UseWidgetLifecycleArgs, WidgetLifecycleState } from './lifecycle/use-widget-lifecycle';
export { useWidgetState } from './state/use-widget-state';
export type { UseWidgetStateResult, WidgetStateStatus } from './state/use-widget-state';
export { createMemoryPersistence } from './state/memory-persistence';
export type { MemoryPersistence } from './state/memory-persistence';
export { WidgetRoot } from './primitives/widget-root';
export type { WidgetRootProps } from './primitives/widget-root';
export { WidgetPart } from './primitives/widget-part';
export type { WidgetPartElement, WidgetPartProps } from './primitives/widget-part';
export { renderWith } from './primitives/render-prop';
export type { RenderProp } from './primitives/render-prop';
export {
  NEREY_ATTR,
  NEREY_STATES,
  fallbackAttributes,
  partAttributes,
  widgetRootAttributes,
} from './data-attrs';
export type { FallbackReason, NereyRootAttributes, NereyState } from './data-attrs';
export {
  TEXT_WIDGET_TYPE,
  TEXT_WIDGET_VERSION,
  dedupeById,
  hasWidget,
  migratePayload,
  resolveEnvelope,
} from './adapter';
export type { MessageAdapter } from './adapter';
export { flattenIssues, formatIssuePath, validateOptional, validateSync } from './validate';
export type { FlatIssue, ValidationOutcome } from './validate';
export {
  NereyError,
  invalidPayloadError,
  invalidStateError,
  isNereyError,
  persistenceError,
  unknownWidgetError,
  widgetRenderError,
} from './errors';
export { TextWidget, textPayloadSchema, textWidget } from './widgets/text';
export type { TextPayload, TextWidgetProps } from './widgets/text';
export {
  CONFIRMATION_PLACEMENT,
  CONFIRMATION_TYPE,
  CONFIRMATION_VERSION,
  ConfirmationWidget,
  DEFAULT_CANCEL_LABEL,
  DEFAULT_CONFIRM_LABEL,
  confirmationPayloadSchema,
  confirmationStateSchema,
  confirmationWidget,
  labelFor,
} from './widgets/confirmation';
export type {
  ConfirmationDecision,
  ConfirmationPayload,
  ConfirmationState,
  ConfirmationTone,
  ConfirmationWidgetProps,
} from './widgets/confirmation';
/**
 * The catalog @nerey/core ships. Two widgets on purpose (ADR 0035): `text`, which every
 * conversation needs, and `confirmation`, the minimum widget that exercises interaction,
 * lifecycle and persistence together. Everything else is a design decision and lives in
 * @nerey/theme or in the consumer's own catalog.
 */
export { builtInWidgets } from './widgets/catalog';
//# sourceMappingURL=index.d.ts.map
