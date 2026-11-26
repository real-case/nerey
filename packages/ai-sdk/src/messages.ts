// Type-only, so nothing of the client entry (and its `'use client'` banner) reaches the server build.
import type { LifecycleRecord, NereyMessage, NereyWidgetEnvelope, WidgetStatus } from '@nerey/core';

import { bindCall } from './binding';
import type { AiSdkBinding } from './binding';

/**
 * AI SDK `UIMessage` → Nerey frames (ADR 0055).
 *
 * The input types are structural on purpose. A consumer's `UIMessage<Metadata, DataParts, Tools>`
 * is assignable to them whatever its generics are, which a nominal `UIMessage` from `ai` is not, and
 * the module needs nothing from `ai` at runtime, so it stays usable on the server entry.
 */

/** The parts of an AI SDK `UIMessage` this adapter reads. */
export type AiSdkMessageLike = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  metadata?: unknown;
  parts: readonly unknown[];
};

/** One rendered state of a widget tool call: hand `message` and `status` to `WidgetRenderer`. */
export type AiSdkWidgetFrame = { message: NereyMessage; status: WidgetStatus };

export type WidgetTextOf = (context: { type: string; version: string; turnText: string }) => string;

export type ToWidgetFramesOptions = {
  binding: AiSdkBinding;
  /**
   * The message's time in epoch ms, when `metadata.createdAt` does not carry it. Required in that
   * case: a pure function has no first-seen time to fall back on (ADR 0046). The stateful
   * `createWidgetFrameMapper` supplies one.
   */
  createdAt?: number;
  /** The plain text a widget message falls back to. Defaults to the turn's text parts. */
  textOf?: WidgetTextOf;
  /**
   * What the host already knows per tool call, keyed by `toolCallId`: the widget's persisted state
   * and its expiry marker, typically loaded with the transcript on the server. Handed over on the
   * envelope, a reload renders the terminal state on the first frame, including during SSR, with no
   * read through the port (ADR 0046 / 0047). A known marker wins over the one an answered part implies.
   */
  known?: KnownWidgetData;
};

export type KnownWidgetData = {
  state?: Readonly<Record<string, unknown>>;
  expiry?: Readonly<Record<string, LifecycleRecord>>;
};

/** A tool part as the AI SDK shapes it: `tool-<name>` or `dynamic-tool` with a `toolName`. */
type ToolPart = {
  toolName: string;
  toolCallId: string;
  state: string;
  input: unknown;
  approvalId: string | undefined;
};

/** The tool-part states in which the call has been answered and must not be answered again. */
const ANSWERED_STATES: ReadonlySet<string> = new Set([
  'approval-responded',
  'output-available',
  'output-error',
  'output-denied',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrows one `UIMessage` part to a tool part, or `undefined` for anything else. */
export function readToolPart(part: unknown): ToolPart | undefined {
  if (!isRecord(part) || typeof part.type !== 'string') return undefined;
  if (typeof part.toolCallId !== 'string' || typeof part.state !== 'string') return undefined;

  let toolName: string | undefined;
  if (part.type === 'dynamic-tool') toolName = typeof part.toolName === 'string' ? part.toolName : undefined;
  else if (part.type.startsWith('tool-')) toolName = part.type.slice('tool-'.length);
  if (toolName === undefined) return undefined;

  const approval =
    isRecord(part.approval) && typeof part.approval.id === 'string' ? part.approval.id : undefined;
  return {
    toolName,
    toolCallId: part.toolCallId,
    state: part.state,
    input: part.input,
    approvalId: approval,
  };
}

/**
 * ADR 0019's table, extended to the approval states AI SDK 7 added. An approval request is a
 * complete call waiting for the person, so it renders `ready`; only a failed call is `error`.
 */
export function statusOf(state: string): WidgetStatus {
  if (state === 'input-streaming') return 'streaming';
  if (state === 'output-error') return 'error';
  return 'ready';
}

/** Whether a tool part in this state has already been answered (ADR 0055). */
export function isAnswered(state: string): boolean {
  return ANSWERED_STATES.has(state);
}

/** `metadata.createdAt` as epoch ms, when the server attached one in a form we can read. */
export function createdAtFromMetadata(metadata: unknown): number | undefined {
  if (!isRecord(metadata)) return undefined;
  const value = metadata.createdAt;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? undefined : time;
  }
  return undefined;
}

function ownValue<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

function turnTextOf(message: AiSdkMessageLike): string {
  const texts: string[] = [];
  for (const part of message.parts) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') texts.push(part.text);
  }
  return texts.join('\n').trim();
}

const defaultTextOf: WidgetTextOf = ({ type, turnText }) =>
  turnText === '' ? `The assistant showed a ${type} widget.` : turnText;

/**
 * The frame for one tool part, or `undefined` when the part is not a widget or cannot be rendered
 * yet (a `render-widget` call still streaming its `type` and `version`).
 */
function frameOf(
  part: ToolPart,
  context: {
    binding: AiSdkBinding;
    createdAt: number;
    turnText: string;
    textOf: WidgetTextOf;
    known: KnownWidgetData | undefined;
  },
): AiSdkWidgetFrame | undefined {
  const bound = bindCall(context.binding, part.toolName, part.input);
  if (!bound) return undefined;

  const status = statusOf(part.state);
  // Held back until there is something to render: a call still streaming its coordinates, or one
  // whose input has not started (the AI SDK opens a part with `input: undefined` before the first
  // delta). A streaming payload is never validated (ADR 0019), so an `undefined` one would reach
  // the component as-is and crash it into the render fallback.
  if (
    status === 'streaming' &&
    (bound.type === undefined || bound.version === undefined || bound.payload === undefined)
  ) {
    return undefined;
  }

  // A complete call with no coordinates is still a widget call; letting it through as `''`
  // produces `unknown-widget` (ADR 0013), which says what went wrong, rather than nothing.
  const type = bound.type ?? '';
  const version = bound.version ?? '';

  const envelope: NereyWidgetEnvelope = {
    type,
    version,
    payload: bound.payload,
    correlationId: part.toolCallId,
  };
  const knownState = ownValue(context.known?.state, part.toolCallId);
  if (knownState !== undefined) envelope.state = knownState;
  const knownExpiry = ownValue(context.known?.expiry, part.toolCallId);
  if (knownExpiry !== undefined) {
    envelope.expiry = knownExpiry;
  } else if (isAnswered(part.state)) {
    const expiry: LifecycleRecord = { expiredAt: context.createdAt, reason: { on: 'interact' } };
    envelope.expiry = expiry;
  }

  return {
    message: {
      id: part.toolCallId,
      role: 'assistant',
      text: context.textOf({ type, version, turnText: context.turnText }),
      createdAt: context.createdAt,
      widget: envelope,
    },
    status,
  };
}

function framesFor(
  message: AiSdkMessageLike,
  options: ToWidgetFramesOptions,
  createdAt: number,
): AiSdkWidgetFrame[] {
  const context = {
    binding: options.binding,
    createdAt,
    turnText: turnTextOf(message),
    textOf: options.textOf ?? defaultTextOf,
    known: options.known,
  };
  const frames: AiSdkWidgetFrame[] = [];
  for (const raw of message.parts) {
    const part = readToolPart(raw);
    if (!part) continue;
    const frame = frameOf(part, context);
    if (frame) frames.push(frame);
  }
  return frames;
}

/**
 * The widget frames of one `UIMessage`, one per widget tool part, in part order. Pure: the same
 * message always gives an equal result, and a missing time is an error rather than `Date.now()`.
 */
export function toWidgetFrames(
  message: AiSdkMessageLike,
  options: ToWidgetFramesOptions,
): AiSdkWidgetFrame[] {
  const createdAt = createdAtFromMetadata(message.metadata) ?? options.createdAt;
  if (createdAt === undefined) {
    throw new TypeError(
      `UIMessage ${JSON.stringify(message.id)} has no metadata.createdAt and no createdAt option was ` +
        'given; a widget needs a fixed creation time for its timeout rules (ADR 0046). Attach ' +
        '`createdAt` in `messageMetadata` on the server, or use createWidgetFrameMapper.',
    );
  }
  return framesFor(message, options, createdAt);
}

export type WidgetFrameMapperOptions = Omit<ToWidgetFramesOptions, 'createdAt'> & {
  /** The clock used for a message's first-seen time when it has no `metadata.createdAt`. */
  now?: () => number;
};

export type WidgetFrameMapper = {
  /**
   * The widget frames of every message, in transcript order. `known` replaces the option given at
   * creation for this call, for a host whose stored state arrives after the mapper was made.
   */
  frames: (messages: readonly AiSdkMessageLike[], known?: KnownWidgetData) => AiSdkWidgetFrame[];
};

type CachedFrame = { key: string; frame: AiSdkWidgetFrame };

function frameKey(frame: AiSdkWidgetFrame): string {
  const envelope = frame.message.widget;
  return JSON.stringify([
    frame.status,
    frame.message.text,
    envelope?.type,
    envelope?.version,
    envelope?.payload,
    envelope?.state,
    envelope?.expiry,
  ]);
}

/**
 * A stateful mapper for a live chat. It keeps two things `toWidgetFrames` cannot:
 *
 * - a first-seen time per message id, used when the message has no `metadata.createdAt`, so the
 *   anchor of every `timeout` rule is fixed from the first chunk (ADR 0046);
 * - the previous frame object for a tool call whose content has not changed, so a re-render with an
 *   identical part does not validate the payload again (ADR 0019).
 */
export function createWidgetFrameMapper(options: WidgetFrameMapperOptions): WidgetFrameMapper {
  const now = options.now ?? Date.now;
  const firstSeen = new Map<string, number>();
  let previous = new Map<string, CachedFrame>();

  return {
    frames: (messages, known) => {
      const effective = known === undefined ? options : { ...options, known };
      const next = new Map<string, CachedFrame>();
      const out: AiSdkWidgetFrame[] = [];
      for (const message of messages) {
        let createdAt = createdAtFromMetadata(message.metadata) ?? firstSeen.get(message.id);
        if (createdAt === undefined) {
          createdAt = now();
          firstSeen.set(message.id, createdAt);
        }
        for (const frame of framesFor(message, effective, createdAt)) {
          const id = String(frame.message.id);
          const key = frameKey(frame);
          const cached = previous.get(id);
          const kept = cached?.key === key ? cached.frame : frame;
          next.set(id, { key, frame: kept });
          out.push(kept);
        }
      }
      previous = next;
      return out;
    },
  };
}
