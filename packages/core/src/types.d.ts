import type { ComponentType, ReactNode } from 'react';
import type { StandardSchemaV1 } from '@standard-schema/spec';
/**
 * The widget envelope a model produces. `type` and `version` together select a registry
 * entry (ADR 0009 — exact match, never a semver range unless an entry opts in).
 *
 * `payload` is what the model generated; `state` is what the user has done to the widget
 * since. Keeping them separate is what makes a widget replayable: re-rendering a persisted
 * message never re-derives user intent from model output.
 */
export type NereyWidgetEnvelope = {
  type: string;
  version: string;
  payload: unknown;
  state?: unknown;
};
/**
 * The minimal message shape Nerey understands. A consumer's own message type is adapted
 * into this at the host boundary (ADR 0002) — Nerey never imports an application schema.
 */
export type NereyMessage = {
  id: string | number;
  role: 'user' | 'assistant' | 'system';
  /**
   * The plain-text rendering of this message. It is the last line of the degradation
   * chain (ADR 0012) and must always be present, even for a widget message: a widget that
   * cannot render must still leave the transcript readable.
   */
  text: string;
  widget?: NereyWidgetEnvelope | null;
};
export type Placement =
  | {
      slot: 'message';
    }
  | {
      slot: 'input';
      position?: 'above' | 'below' | 'replace';
    }
  | {
      slot: 'overlay';
      scope: 'chat' | 'page';
      dismissible?: boolean;
    };
export type SlotName = Placement['slot'];
/**
 * When a widget stops being interactive. Rules are OR-ed: the first one to fire expires
 * the widget.
 *
 * - `interact`         — any interaction expires it; with `action`, only that action does.
 * - `timeout`          — `ms` after the widget first mounted.
 * - `message`          — a later message arrived in the conversation.
 * - `navigate`         — the conversation was left.
 * - `event`            — a host-dispatched named event.
 */
export type ExpiryRule =
  | {
      on: 'interact';
      action?: string;
    }
  | {
      on: 'timeout';
      ms: number;
    }
  | {
      on: 'message';
    }
  | {
      on: 'navigate';
    }
  | {
      on: 'event';
      name: string;
    };
/**
 * What the widget becomes once expired.
 *
 * - `snapshot` — keep rendering, read-only, showing the terminal state. The default for
 *   anything the user acted on: an acted-upon widget is disabled, not removed, so the
 *   transcript stays legible on reload (ADR 0018).
 * - `fallback` — replace with the message's plain text.
 * - `hide`     — render nothing.
 */
export type AfterExpiry = 'snapshot' | 'fallback' | 'hide';
export type Lifecycle = {
  persist: 'forever' | 'ephemeral';
  expiry: readonly ExpiryRule[];
  afterExpiry: AfterExpiry;
};
/**
 * Mapped from the tool-part state machine the AI SDK standardised
 * (`input-streaming` → `input-available` → `output-available` → `output-error`).
 *
 * While `streaming`, the payload is partial and is **never validated** — a partial object
 * fails a complete schema by definition, so validating it would turn every stream into a
 * fallback.
 */
export type WidgetStatus = 'streaming' | 'ready' | 'error';
/**
 * What a widget hands back to the host. `text` is the message that will be sent to the
 * agent; `meta` is structured context the host may forward or log.
 *
 * `text` is required and typed as `string` on purpose, and a `@ts-expect-error` assertion
 * in the contract test locks it there — loosening it to `unknown` breaks the build rather
 * than silently allowing a widget to send a number.
 */
export type WidgetInteractionPayload = {
  text: string;
  meta?: Record<string, unknown>;
};
export type WidgetInteractionHandler = (action: string, data: WidgetInteractionPayload) => void;
export type WidgetComponentProps<Payload = unknown, State = unknown> = {
  /** Identifies this widget instance. Persistence and lifecycle are keyed on it. */
  messageId: string | number;
  payload: Payload;
  state: State;
  /**
   * The widget has expired or the host mounted it read-only. A read-only widget renders its
   * terminal appearance and fires no effects (ADR 0018).
   */
  readonly: boolean;
  status: WidgetStatus;
  onInteraction: WidgetInteractionHandler;
};
export type WidgetComponent<Payload = unknown, State = unknown> = ComponentType<
  WidgetComponentProps<Payload, State>
>;
/**
 * Converts a payload persisted under an older version into this entry's shape. Returning
 * `undefined` means "I cannot read that version" and the degradation chain takes over.
 *
 * Migration on read is Nerey's answer to a gap no surveyed standard fills: a persisted
 * transcript outlives the schema that produced it (ADR 0030).
 */
export type WidgetMigration = (fromVersion: string, payload: unknown) => unknown;
export type WidgetRegistryEntry<Payload = unknown, State = unknown, Event = unknown> = {
  type: string;
  version: string;
  component: WidgetComponent<Payload, State>;
  placement: Placement;
  lifecycle: Lifecycle;
  /**
   * Validated at the boundary and, in a well-built system, handed to the model as the
   * generation constraint. Any Standard Schema v1 implementation works — Zod 4, Valibot,
   * ArkType — because Nerey depends on the spec, not on a validator (ADR 0011).
   */
  payloadSchema?: StandardSchemaV1<unknown, Payload>;
  stateSchema?: StandardSchemaV1<unknown, State>;
  /** Applied to `state` when the host dispatches a widget event. */
  reducer?: (previous: State, event: Event) => State;
  updateStrategy?: 'optimistic' | 'pessimistic';
  cancellable?: boolean;
  migrate?: WidgetMigration;
  /**
   * Opt-in only (ADR 0009). When present, the registry will accept a payload whose version
   * differs from `version` if this predicate says so. Absent, resolution is exact — which
   * is the default precisely because an implicit range fails silently and looks like a
   * missing widget.
   */
  acceptsVersion?: (requested: string) => boolean;
};
/**
 * Erases the per-entry generics so heterogeneous entries can live in one collection.
 *
 * This is the one sanctioned `any` in the package, and it is contained to this single alias.
 * A registry holds entries whose `Payload` and `State` types are mutually incompatible, which
 * no single generic parameter can express. Both obvious alternatives fail:
 *
 *   - `unknown` — props are contravariant, so `WidgetComponent<{ a: string }>` is not
 *     assignable to `WidgetComponent<unknown>`.
 *   - `never` — variance works for a bare function, but `ComponentType` is a union including
 *     `ComponentClass`, whose `defaultProps?: Partial<P>` puts `P` in a covariant position and
 *     breaks the assignment. It also fails on `payloadSchema`, where the output type would have
 *     to be assignable to `never`.
 *
 * The types are reasserted at the consumer end by the widget's own typed component, so nothing
 * downstream is actually untyped. `asAnyWidget` exists to make the erasure explicit at a call
 * site when a reader would otherwise wonder where the types went.
 */
export type AnyWidgetRegistryEntry = WidgetRegistryEntry<any, any, any>;
export type WidgetStateRecord = Record<string, unknown>;
/**
 * The port through which widget state reaches durable storage. Nerey ships an in-memory
 * implementation; a consumer supplies the real one (TanStack Query, SWR, plain fetch).
 * Core performs no I/O of its own — that is the whole point of the port.
 */
export type MessagePersistence = {
  getWidgetState(conversationId: string, messageId: string | number): Promise<WidgetStateRecord | undefined>;
  updateWidgetState(
    conversationId: string,
    messageId: string | number,
    state: WidgetStateRecord,
    options?: {
      signal?: AbortSignal;
    },
  ): Promise<void>;
};
export type FallbackRenderer = (
  text: string,
  context: {
    messageId: string | number;
  },
) => ReactNode;
export type WidgetRegistry = {
  get(type: string, version: string): AnyWidgetRegistryEntry | undefined;
  /** Every registered entry, in registration order. Used by the conformance kit and devtools. */
  entries(): readonly AnyWidgetRegistryEntry[];
  has(type: string, version: string): boolean;
};
export type WidgetHostValue = {
  registry: WidgetRegistry;
  conversationId: string;
  /**
   * The single outbound channel (ADR 0014). The widget formulates the message; the host owns
   * sending it, optimistic insertion, the thinking indicator and error handling.
   */
  sendUserMessage: (text: string, meta?: Record<string, unknown>) => void;
  persistence: MessagePersistence;
  renderFallback: FallbackRenderer;
  onWidgetError?: (error: NereyErrorLike) => void;
  /**
   * Dispatched lifecycle events, e.g. `{ on: 'event', name: 'checkout-complete' }`. The host
   * bumps this set; the lifecycle runtime reads it.
   */
  firedEvents?: ReadonlySet<string>;
  /** Monotonic count of messages in the conversation, for `{ on: 'message' }` expiry. */
  messageCount?: number;
};
export type NereyErrorCode =
  'unknown-widget' | 'invalid-payload' | 'invalid-state' | 'widget-render' | 'persistence';
export type NereyErrorLike = {
  code: NereyErrorCode;
  message: string;
  widgetType?: string;
  widgetVersion?: string;
  messageId?: string | number;
  cause?: unknown;
  /** Populated for validation failures: the Standard Schema issue list, flattened. */
  issues?: readonly {
    path: string;
    message: string;
  }[];
};
//# sourceMappingURL=types.d.ts.map
