/**
 * `@nerey/ai-sdk/server` — the React-free half of the adapter (ADR 0052 / 0055).
 *
 * Built with no `'use client'` banner, so a route handler or a server component gets functions:
 * `toolsFromRegistry` where `streamText` is called, and `toWidgetFrames` to map a stored transcript
 * on the server. Nothing reachable from here imports `react` at runtime.
 */

export { toolsFromRegistry } from './tools';
export type { ToolsFromRegistryOptions, ToolsSource } from './tools';

export { RENDER_WIDGET_TOOL } from '../binding';
export type { AiSdkBinding, WidgetRef } from '../binding';

export { toWidgetFrames } from '../messages';
export type { AiSdkMessageLike, AiSdkWidgetFrame, ToWidgetFramesOptions, WidgetTextOf } from '../messages';
