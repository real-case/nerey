import type { BaseEvent, Message } from '@ag-ui/core';
import type { LifecycleRecord, NereyMessage, NereyWidgetEnvelope, WidgetStatus } from '@nerey/core';

import { renderWidgetToolOf, tableRowOf } from './bindings';
import type { AgUiToolBindings } from './bindings';
import { parsePartialJson } from './partial-json';

/**
 * ADR 0054 — the AG-UI event stream folded into Nerey frames.
 *
 * One frame per text message and one per WIDGET tool call, in arrival order. A widget call's frame
 * is keyed by its `toolCallId`, which is also its envelope's `correlationId`, so persistence,
 * lifecycle and the answer all hang off the one id the protocol guarantees is unique and stable.
 *
 * The types come from `@ag-ui/core`, and only the types: the event discriminator is compared as a
 * string, so the adapter's bundle imports nothing from the protocol package at runtime.
 */

/** One rendered state of one message: exactly what `WidgetRenderer` takes. */
export type AgUiFrame = { message: NereyMessage; status: WidgetStatus };

/** Turns a widget envelope into the plain text the transcript falls back to (ADR 0012). */
export type FallbackText = (widget: { type: string; version: string; payload: unknown }) => string;

export type AgUiTranscriptOptions = {
  /** Which tool calls are widgets, and how they name one (ADR 0054). */
  tools?: AgUiToolBindings;
  /** Epoch ms. Used to stamp a message that arrived with no time of its own, and to judge expiry. */
  now?: () => number;
  /** The text a widget frame falls back to. Defaults to the payload's question or title, then the type. */
  fallbackText?: FallbackText;
};

/** What the host needs to know about one widget call to answer it. */
export type AgUiWidgetCall = {
  toolCallId: string;
  ended: boolean;
  answered: boolean;
  expired: boolean;
  /** The interrupt that names this call, when the run ended waiting on it. */
  interruptId?: string;
};

export type AgUiTranscript = {
  /** Folds one event in. Events the adapter has no use for are ignored. */
  apply: (event: BaseEvent) => void;
  /** Folds several events in and notifies once. */
  applyAll: (events: readonly BaseEvent[]) => void;
  /**
   * Records a message the host itself added to the agent — the user's text, a tool answer — so it
   * shows at once rather than on the next snapshot.
   */
  addLocalMessage: (message: Message) => void;
  /** The current frames. Referentially stable until something changes, for `useSyncExternalStore`. */
  getFrames: () => readonly AgUiFrame[];
  subscribe: (listener: () => void) => () => void;
  /** Re-judges time-dependent expiry. The React hook calls it when an interrupt's deadline passes. */
  refresh: () => void;
  /** Milliseconds until the next unanswered interrupt expires, or `undefined` when none will. */
  msUntilNextDeadline: () => number | undefined;
  getCall: (toolCallId: string) => AgUiWidgetCall | undefined;
  /** Widget calls since the last user message that are ready and still await an answer. */
  awaitingAnswer: () => readonly AgUiWidgetCall[];
  /** Unanswered interrupts that name a widget call. */
  openInterrupts: () => readonly { interruptId: string; toolCallId: string }[];
  /** The ids of every widget call in the transcript, in order. */
  widgetCallIds: () => readonly string[];
  /**
   * Hands over a widget's saved state, which becomes its envelope's `state` (ADR 0008). The protocol
   * does not carry widget state, and core reads it from the envelope rather than from the port, so
   * a reloaded transcript gets it here — see `hydrateWidgetStates`.
   */
  setWidgetState: (toolCallId: string, state: unknown) => void;
};

/* ── Internal state ──────────────────────────────────────────────────────────────────── */

type TextItem = {
  kind: 'text';
  id: string;
  role: NereyMessage['role'];
  content: string;
  createdAt: number;
};

type CallItem = {
  kind: 'call';
  id: string;
  name: string;
  args: string;
  ended: boolean;
  createdAt: number;
  interrupt?: { id: string; expiresAt?: number };
  answeredAt?: number;
};

/** Widget state the host handed over, by tool-call id, with a revision for the frame memo. */
type HandedState = { value: unknown; revision: number };

type Item = TextItem | CallItem;

const textKey = (id: string): string => `text:${id}`;
const callKey = (id: string): string => `call:${id}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `metadata.nerey.<field>` as a finite number, when a producer or this adapter wrote one. */
function nereyTime(metadata: unknown, field: 'createdAt' | 'respondedAt'): number | undefined {
  if (!isRecord(metadata)) return undefined;
  const nerey = metadata.nerey;
  if (!isRecord(nerey)) return undefined;
  const value = nerey[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** The text of string-or-parts content: text parts concatenated, everything else dropped. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: unknown) =>
      isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : '',
    )
    .join('');
}

function textRole(role: unknown): NereyMessage['role'] | undefined {
  if (role === 'user' || role === 'assistant' || role === 'system') return role;
  if (role === 'developer') return 'system';
  return undefined;
}

const FALLBACK_FIELDS = ['question', 'title', 'prompt', 'label', 'message', 'text', 'content'] as const;

export const defaultFallbackText: FallbackText = ({ type, payload }) => {
  if (isRecord(payload)) {
    for (const field of FALLBACK_FIELDS) {
      const value = payload[field];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
  }
  return type;
};

/* ── Binding a call to a widget ──────────────────────────────────────────────────────── */

type Bound = { type: string; version: string; payload: unknown; status: WidgetStatus };

function parseStrict(args: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(args) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * The longest prefix of broken arguments that still reads as JSON. Only on the error path, after
 * `TOOL_CALL_END`, so the quadratic worst case is paid once per broken call, never per delta.
 */
function longestReadablePrefix(args: string): ReturnType<typeof parsePartialJson> {
  for (let end = args.length; end > 0; end--) {
    const ch = args.charAt(end - 1);
    if (ch !== ',' && ch !== '"' && ch !== '}' && ch !== ']') continue;
    const read = parsePartialJson(args.slice(0, end));
    if (read) return read;
  }
  return undefined;
}

function bindCall(call: CallItem, tools: AgUiToolBindings | undefined): Bound | undefined {
  const row = tableRowOf(tools, call.name);
  if (row) {
    if (!call.ended) {
      const partial = parsePartialJson(call.args);
      return { type: row.type, version: row.version, payload: partial?.value ?? {}, status: 'streaming' };
    }
    // A tool with no arguments sends none; that is an empty payload, not a broken one.
    if (call.args.trim() === '')
      return { type: row.type, version: row.version, payload: {}, status: 'ready' };
    const parsed = parseStrict(call.args);
    return parsed.ok
      ? { type: row.type, version: row.version, payload: parsed.value, status: 'ready' }
      : { type: row.type, version: row.version, payload: undefined, status: 'error' };
  }

  if (call.name !== renderWidgetToolOf(tools)) return undefined;

  if (call.ended) {
    const parsed = parseStrict(call.args);
    if (parsed.ok) {
      const value = parsed.value;
      if (!isRecord(value) || typeof value.type !== 'string' || typeof value.version !== 'string') {
        return undefined;
      }
      return { type: value.type, version: value.version, payload: value.payload, status: 'ready' };
    }
  }

  // Streaming — or ended with arguments that are not JSON, where a prefix may still name the widget.
  const partial = call.ended ? longestReadablePrefix(call.args) : parsePartialJson(call.args);
  if (!partial || !isRecord(partial.value)) return undefined;
  // Only whole strings name a widget: a truncated `"1."` would render as an unknown `type@version`.
  if (!partial.isComplete(['type']) || !partial.isComplete(['version'])) return undefined;
  const { type, version } = partial.value as { type: string; version: string };
  return call.ended
    ? { type, version, payload: undefined, status: 'error' }
    : { type, version, payload: partial.value.payload ?? {}, status: 'streaming' };
}

/* ── The transcript ──────────────────────────────────────────────────────────────────── */

export function createAgUiTranscript(options: AgUiTranscriptOptions = {}): AgUiTranscript {
  const now = options.now ?? Date.now;
  const fallbackText = options.fallbackText ?? defaultFallbackText;
  const tools = options.tools;

  let items = new Map<string, Item>();
  /** Messages the host added, kept across a snapshot until the producer echoes them. */
  let local: Message[] = [];
  /** The open call of a `TOOL_CALL_CHUNK` sequence, and of a `TEXT_MESSAGE_CHUNK` one. */
  let chunkCallId: string | undefined;
  let chunkTextId: string | undefined;

  const states = new Map<string, HandedState>();
  let stateRevision = 0;

  const listeners = new Set<() => void>();
  let frames: readonly AgUiFrame[] = [];
  let dirty = true;
  /** Per-item memo, so an unrelated event never hands the renderer a new envelope. */
  const memo = new Map<string, { signature: string; frame: AgUiFrame }>();

  const isWidgetCall = (item: Item): item is CallItem =>
    item.kind === 'call' &&
    (tableRowOf(tools, item.name) !== undefined || item.name === renderWidgetToolOf(tools));

  function stamp(metadataTime: number | undefined, previous: number | undefined, event?: BaseEvent): number {
    return metadataTime ?? previous ?? finite(event?.timestamp) ?? now();
  }

  /* ── event folding ── */

  function upsertText(id: string, role: NereyMessage['role'], event: BaseEvent): TextItem {
    const existing = items.get(textKey(id));
    if (existing?.kind === 'text') return existing;
    const item: TextItem = {
      kind: 'text',
      id,
      role,
      content: '',
      createdAt: stamp(undefined, undefined, event),
    };
    items.set(textKey(id), item);
    return item;
  }

  function upsertCall(id: string, name: string, event: BaseEvent): CallItem {
    const existing = items.get(callKey(id));
    if (existing?.kind === 'call') return existing;
    const item: CallItem = {
      kind: 'call',
      id,
      name,
      args: '',
      ended: false,
      createdAt: stamp(nereyTime(event.metadata, 'createdAt'), undefined, event),
    };
    items.set(callKey(id), item);
    return item;
  }

  function call(id: string): CallItem | undefined {
    const item = items.get(callKey(id));
    return item?.kind === 'call' ? item : undefined;
  }

  function closeChunkedCall(): void {
    if (chunkCallId === undefined) return;
    const open = call(chunkCallId);
    if (open) open.ended = true;
    chunkCallId = undefined;
  }

  function markAnswered(toolCallId: string, at: number): void {
    const target = call(toolCallId);
    if (target && target.answeredAt === undefined) target.answeredAt = at;
  }

  /** Folds one message, the way a snapshot or a local addition carries it. */
  function foldMessage(message: Message, previous: Map<string, Item>, event?: BaseEvent): void {
    if (message.role === 'tool') {
      const answered = previous.get(callKey(message.toolCallId));
      const at =
        nereyTime(message.metadata, 'respondedAt') ??
        (answered?.kind === 'call' ? answered.answeredAt : undefined) ??
        finite(event?.timestamp) ??
        now();
      markAnswered(message.toolCallId, at);
      return;
    }

    const role = textRole(message.role);
    if (role === undefined) return; // activity and reasoning messages render nothing here

    const before = previous.get(textKey(message.id));
    const content = 'content' in message ? contentText(message.content) : '';
    items.set(textKey(message.id), {
      kind: 'text',
      id: message.id,
      role,
      content,
      createdAt: stamp(
        nereyTime(message.metadata, 'createdAt'),
        before?.kind === 'text' ? before.createdAt : undefined,
        event,
      ),
    });

    if (message.role !== 'assistant') return;
    for (const toolCall of message.toolCalls ?? []) {
      const prior = previous.get(callKey(toolCall.id));
      const priorCall = prior?.kind === 'call' ? prior : undefined;
      const item: CallItem = {
        kind: 'call',
        id: toolCall.id,
        name: toolCall.function.name,
        args: toolCall.function.arguments,
        ended: true,
        createdAt: stamp(
          nereyTime(toolCall.metadata, 'createdAt') ?? nereyTime(message.metadata, 'createdAt'),
          priorCall?.createdAt,
          event,
        ),
      };
      if (priorCall?.interrupt) item.interrupt = priorCall.interrupt;
      if (priorCall?.answeredAt !== undefined) item.answeredAt = priorCall.answeredAt;
      items.set(callKey(toolCall.id), item);
    }
  }

  function foldSnapshot(messages: readonly Message[], event: BaseEvent): void {
    const previous = items;
    items = new Map();
    chunkCallId = undefined;
    chunkTextId = undefined;
    for (const message of messages) foldMessage(message, previous, event);

    // Answers first seen in the snapshot apply to calls folded before them, in any order.
    for (const message of messages) {
      if (message.role === 'tool') {
        const at = nereyTime(message.metadata, 'respondedAt');
        if (at !== undefined) markAnswered(message.toolCallId, at);
      }
    }

    const echoed = new Set(messages.map((message) => message.id));
    local = local.filter((message) => !echoed.has(message.id));
    for (const message of local) foldMessage(message, previous, event);
  }

  function fold(event: BaseEvent): void {
    const type: string = event.type;
    if (type !== 'TOOL_CALL_CHUNK') closeChunkedCall();
    if (type !== 'TEXT_MESSAGE_CHUNK') chunkTextId = undefined;

    switch (type) {
      case 'TEXT_MESSAGE_START': {
        const id = str(event.messageId);
        if (id !== undefined) upsertText(id, textRole(event.role) ?? 'assistant', event);
        return;
      }
      case 'TEXT_MESSAGE_CONTENT': {
        const id = str(event.messageId);
        if (id !== undefined) upsertText(id, 'assistant', event).content += str(event.delta) ?? '';
        return;
      }
      case 'TEXT_MESSAGE_CHUNK': {
        const id = str(event.messageId) ?? chunkTextId;
        if (id === undefined) return;
        chunkTextId = id;
        upsertText(id, textRole(event.role) ?? 'assistant', event).content += str(event.delta) ?? '';
        return;
      }
      case 'TOOL_CALL_START': {
        const id = str(event.toolCallId);
        const name = str(event.toolCallName);
        if (id !== undefined && name !== undefined) upsertCall(id, name, event);
        return;
      }
      case 'TOOL_CALL_ARGS': {
        const target = call(str(event.toolCallId) ?? '');
        if (target && !target.ended) target.args += str(event.delta) ?? '';
        return;
      }
      case 'TOOL_CALL_END': {
        const target = call(str(event.toolCallId) ?? '');
        if (target) target.ended = true;
        return;
      }
      case 'TOOL_CALL_CHUNK': {
        const id = str(event.toolCallId) ?? chunkCallId;
        if (id === undefined) return;
        if (id !== chunkCallId) closeChunkedCall();
        const name = str(event.toolCallName);
        const target = call(id) ?? (name !== undefined ? upsertCall(id, name, event) : undefined);
        if (!target) return;
        chunkCallId = id;
        if (!target.ended) target.args += str(event.delta) ?? '';
        return;
      }
      case 'TOOL_CALL_RESULT': {
        const id = str(event.toolCallId);
        if (id !== undefined) markAnswered(id, finite(event.timestamp) ?? now());
        return;
      }
      case 'MESSAGES_SNAPSHOT': {
        if (Array.isArray(event.messages)) foldSnapshot(event.messages as Message[], event);
        return;
      }
      case 'RUN_FINISHED': {
        const outcome = event.outcome;
        if (!isRecord(outcome) || outcome.type !== 'interrupt' || !Array.isArray(outcome.interrupts)) return;
        for (const interrupt of outcome.interrupts as unknown[]) {
          if (!isRecord(interrupt)) continue;
          const id = str(interrupt.id);
          const target = call(str(interrupt.toolCallId) ?? '');
          if (id === undefined || !target) continue;
          const expiresAt =
            typeof interrupt.expiresAt === 'string' ? Date.parse(interrupt.expiresAt) : Number.NaN;
          target.interrupt = Number.isFinite(expiresAt) ? { id, expiresAt } : { id };
        }
        return;
      }
      default:
        return;
    }
  }

  /* ── projection ── */

  function expiryOf(item: CallItem, at: number): LifecycleRecord | undefined {
    // A tool call has exactly one answer, so an answered widget is over whatever its rules say.
    if (item.answeredAt !== undefined) return { expiredAt: item.answeredAt, reason: { on: 'interact' } };
    const deadline = item.interrupt?.expiresAt;
    if (deadline !== undefined && deadline <= at) {
      return { expiredAt: deadline, reason: { on: 'timeout', ms: Math.max(0, deadline - item.createdAt) } };
    }
    return undefined;
  }

  function project(): readonly AgUiFrame[] {
    const at = now();
    const out: AgUiFrame[] = [];
    const seen = new Set<string>();

    for (const [key, item] of items) {
      seen.add(key);
      let signature: string;
      let build: () => AgUiFrame;

      if (item.kind === 'text') {
        if (item.content === '') continue;
        signature = `${item.role}|${item.createdAt}|${item.content}`;
        build = () => ({
          message: { id: item.id, role: item.role, text: item.content, createdAt: item.createdAt },
          status: 'ready',
        });
      } else {
        const bound = bindCall(item, tools);
        if (!bound) continue;
        const expiry = expiryOf(item, at);
        const handed = states.get(item.id);
        signature = [
          handed?.revision ?? '',
          item.args,
          bound.status,
          bound.type,
          bound.version,
          item.createdAt,
          expiry ? `${expiry.expiredAt}:${expiry.reason.on}` : '',
        ].join('|');
        build = () => {
          const widget: NereyWidgetEnvelope = {
            type: bound.type,
            version: bound.version,
            payload: bound.payload,
            correlationId: item.id,
          };
          if (handed) widget.state = handed.value;
          if (expiry) widget.expiry = expiry;
          return {
            message: {
              id: item.id,
              role: 'assistant',
              text: fallbackText({ type: bound.type, version: bound.version, payload: bound.payload }),
              createdAt: item.createdAt,
              widget,
            },
            status: bound.status,
          };
        };
      }

      const cached = memo.get(key);
      if (cached && cached.signature === signature) {
        out.push(cached.frame);
      } else {
        const frame = build();
        memo.set(key, { signature, frame });
        out.push(frame);
      }
    }

    for (const key of memo.keys()) if (!seen.has(key)) memo.delete(key);
    return out;
  }

  function changed(): void {
    dirty = true;
    for (const listener of listeners) listener();
  }

  function widgetCall(item: CallItem): AgUiWidgetCall {
    const view: AgUiWidgetCall = {
      toolCallId: item.id,
      ended: item.ended,
      answered: item.answeredAt !== undefined,
      expired: expiryOf(item, now()) !== undefined,
    };
    if (item.interrupt && item.answeredAt === undefined) view.interruptId = item.interrupt.id;
    return view;
  }

  function widgetCallsSinceLastUserMessage(): CallItem[] {
    const calls: CallItem[] = [];
    for (const item of items.values()) {
      if (item.kind === 'text' && item.role === 'user') calls.length = 0;
      else if (isWidgetCall(item)) calls.push(item);
    }
    return calls;
  }

  return {
    apply(event) {
      fold(event);
      changed();
    },
    applyAll(events) {
      for (const event of events) fold(event);
      changed();
    },
    addLocalMessage(message) {
      local = [...local.filter((m) => m.id !== message.id), message];
      foldMessage(message, items);
      changed();
    },
    getFrames() {
      if (dirty) {
        frames = project();
        dirty = false;
      }
      return frames;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh() {
      changed();
    },
    msUntilNextDeadline() {
      const at = now();
      let next: number | undefined;
      for (const item of items.values()) {
        if (item.kind !== 'call' || item.answeredAt !== undefined) continue;
        const deadline = item.interrupt?.expiresAt;
        if (deadline !== undefined && deadline > at && (next === undefined || deadline < next))
          next = deadline;
      }
      return next === undefined ? undefined : next - at;
    },
    getCall(toolCallId) {
      const item = call(toolCallId);
      return item && isWidgetCall(item) ? widgetCall(item) : undefined;
    },
    awaitingAnswer() {
      return widgetCallsSinceLastUserMessage()
        .map(widgetCall)
        .filter((view) => view.ended && !view.answered && !view.expired);
    },
    widgetCallIds() {
      const ids: string[] = [];
      for (const item of items.values()) if (isWidgetCall(item)) ids.push(item.id);
      return ids;
    },
    setWidgetState(toolCallId, state) {
      states.set(toolCallId, { value: state, revision: ++stateRevision });
      changed();
    },
    openInterrupts() {
      const open: { interruptId: string; toolCallId: string }[] = [];
      for (const item of items.values()) {
        if (item.kind === 'call' && item.interrupt && item.answeredAt === undefined && isWidgetCall(item)) {
          open.push({ interruptId: item.interrupt.id, toolCallId: item.id });
        }
      }
      return open;
    },
  };
}
