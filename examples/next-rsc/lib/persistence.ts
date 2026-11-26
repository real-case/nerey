import type { LifecycleRecord, MessagePersistence, WidgetStateRecord } from '@nerey/core';

/**
 * The client half of the persistence port: plain `fetch` against `/api/widget-state`. Widgets never
 * see this — they call `useWidgetState`, and the host's write queue calls the port (ADR 0047).
 */

function url(kind: 'state' | 'lifecycle', conversationId: string, messageId: string | number): string {
  const query = new URLSearchParams({ kind, conversation: conversationId, message: String(messageId) });
  return `/api/widget-state?${query.toString()}`;
}

async function read<T>(href: string): Promise<T | undefined> {
  const response = await fetch(href);
  if (!response.ok) throw new Error(`widget-state read failed: ${response.status}`);
  const value = (await response.json()) as T | null;
  return value ?? undefined;
}

async function write(href: string, value: unknown, signal?: AbortSignal): Promise<void> {
  const response = await fetch(href, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(value),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`widget-state write failed: ${response.status}`);
}

export const fetchPersistence: MessagePersistence = {
  getWidgetState: (conversationId, messageId) =>
    read<WidgetStateRecord>(url('state', conversationId, messageId)),
  updateWidgetState: (conversationId, messageId, state, options) =>
    write(url('state', conversationId, messageId), state, options?.signal),
  getLifecycleRecord: (conversationId, messageId) =>
    read<LifecycleRecord>(url('lifecycle', conversationId, messageId)),
  updateLifecycleRecord: (conversationId, messageId, record) =>
    write(url('lifecycle', conversationId, messageId), record),
};
