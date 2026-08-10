/**
 * The `@nerey/core/mock` barrel (ADR 0028 — one of exactly two published subpaths).
 *
 * Everything a widget author needs to build, demo and test a widget with no backend and no network
 * (FR-37 / AC-21): a host with working defaults, message fixtures, an in-memory persistence
 * implementation, and a registry that says out loud when a `type@version` does not resolve.
 *
 * It imports freely from core's own source, and is subject to the same boundaries: no I/O, no CSS.
 */

export { MockWidgetHost, createSendRecorder, mockRegistry } from './mock-host';
export type { MockHostOptions, SendRecorder, SentMessage } from './mock-host';

export { sampleConversation, textMessage, widgetMessage } from './fixtures';
export type { TextMessageInput, WidgetMessageInput } from './fixtures';

export { createDevRegistry } from './dev-registry';
export type { DevRegistryOptions } from './dev-registry';

export { DevDiagnosticCard } from './diagnostic-card';
export type { DevDiagnosticProps } from './diagnostic-card';

// Re-exported rather than reimplemented. FR-37 lists in-memory persistence as part of this layer,
// and the implementation lives in `state/` because `DEFAULT_HOST_VALUE` documents it as the opt-in
// alternative to the null port (ADR 0016) — the subpath is where it is *found*, not where it lives.
export { createMemoryPersistence } from '../state/memory-persistence';
export type { MemoryPersistence } from '../state/memory-persistence';
