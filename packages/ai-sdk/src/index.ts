/**
 * `@nerey/ai-sdk` — the Vercel AI SDK adapter for `@nerey/core` (ADR 0051 / 0055).
 *
 * Inbound, a widget tool part becomes a `{ message, status }` frame for `WidgetRenderer`: one per
 * tool call, `correlationId` = `toolCallId`, the payload never validated while it streams, and an
 * answered call expired so it renders read-only after a reload. Outbound, a widget's answer becomes
 * `addToolOutput` (or `addToolApprovalResponse`) on the call it answers.
 *
 * The model's tools are derived from the registry on the server: see `@nerey/ai-sdk/server`.
 */

/* ── Binding tool calls to widgets ─────────────────────────────────────────────────── */

export { RENDER_WIDGET_TOOL } from './binding';
export type { AiSdkBinding, WidgetRef } from './binding';

/* ── UIMessage → widget frames ─────────────────────────────────────────────────────── */

export { createWidgetFrameMapper, toWidgetFrames } from './messages';
export type {
  AiSdkMessageLike,
  AiSdkWidgetFrame,
  KnownWidgetData,
  ToWidgetFramesOptions,
  WidgetFrameMapper,
  WidgetFrameMapperOptions,
  WidgetTextOf,
} from './messages';

/* ── Widget answers → the chat ─────────────────────────────────────────────────────── */

export { createAiSdkHost, defaultApprovalOf } from './host';
export type { AiSdkChatLike, AiSdkHost, AiSdkHostOptions, AiSdkToolOutput } from './host';

/* ── React ─────────────────────────────────────────────────────────────────────────── */

export { useAiSdkHost, useAiSdkWidgetFrames } from './hooks';
