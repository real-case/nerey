import type { LifecycleRecord, WidgetStateRecord } from '@nerey/core';

import { stateKey, store } from '../../../lib/store';

/**
 * The server half of the persistence port (ADR 0047). The client port in `lib/persistence.ts` reads
 * and writes through here, and the page reads the same maps when it renders, so a reload hands the
 * widget its state and its expiry marker on the first frame.
 */

type Kind = 'state' | 'lifecycle';

function target(url: URL): { kind: Kind; key: string } | undefined {
  const kind = url.searchParams.get('kind');
  const conversation = url.searchParams.get('conversation');
  const message = url.searchParams.get('message');
  if ((kind !== 'state' && kind !== 'lifecycle') || !conversation || !message) return undefined;
  return { kind, key: stateKey(conversation, message) };
}

export function GET(request: Request): Response {
  const at = target(new URL(request.url));
  if (!at) return new Response('bad request', { status: 400 });
  const map = at.kind === 'state' ? store().widgetState : store().lifecycle;
  return Response.json(map.get(at.key) ?? null);
}

export async function POST(request: Request): Promise<Response> {
  const at = target(new URL(request.url));
  if (!at) return new Response('bad request', { status: 400 });
  const value = (await request.json()) as unknown;
  if (at.kind === 'state') store().widgetState.set(at.key, value as WidgetStateRecord);
  // The marker is written once, when a rule fires (ADR 0047); a second write keeps the first.
  else if (!store().lifecycle.has(at.key)) store().lifecycle.set(at.key, value as LifecycleRecord);
  return new Response(null, { status: 204 });
}
