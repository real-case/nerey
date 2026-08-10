import type { NereyMessage, NereyWidgetEnvelope } from '../types';
import { CONFIRMATION_TYPE, CONFIRMATION_VERSION } from '../widgets/confirmation';

/**
 * FR-37 — fixtures are the other half of what makes a backend unnecessary. Building a
 * `NereyMessage` by hand is four nested fields deep and easy to get subtly wrong; the two failures
 * that actually bite are an empty `text` (the last line of the degradation chain, ADR 0012) and a
 * `version` that does not match the registered entry (ADR 0009). Both are defaulted here.
 */

/** Matches the built-ins and what a first widget is almost always registered as. */
const DEFAULT_VERSION = '1.0.0';

/**
 * Ids only have to be *unique* — they key React reconciliation, lifecycle bookkeeping and the
 * persistence record. They are deliberately not stable across runs of different tests: a counter
 * shared by a whole file means the id a fixture gets depends on how many fixtures ran before it,
 * so any assertion on an id must pass `id` explicitly rather than predict one.
 */
let sequence = 0;

function autoId(type: string): string {
  sequence += 1;
  return `mock-${type}-${sequence}`;
}

/** Keys a generated payload plausibly carries its own prose under, best first. */
const TEXT_LIKE_KEYS = ['text', 'title', 'content', 'label'] as const;

/**
 * `NereyMessage.text` is required and load-bearing: it is what the transcript shows when the widget
 * cannot render. A fixture that left it empty would make every degradation path in a story render
 * as a blank line, which reads as a bug in the chain rather than in the fixture.
 *
 * Borrowing the payload's own prose beats a generic placeholder because it is what a real producer
 * writes — the plain-text rendering of a confirmation *is* its title.
 */
function synthesiseText(type: string, payload: unknown): string {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    for (const key of TEXT_LIKE_KEYS) {
      const value = record[key];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
  }
  return `[${type} widget]`;
}

export type WidgetMessageInput = {
  id?: string | number;
  type: string;
  version?: string;
  payload: unknown;
  state?: unknown;
  text?: string;
};

/** Build a `NereyMessage` carrying a widget, with sensible defaults. */
export function widgetMessage(input: WidgetMessageInput): NereyMessage {
  const version = input.version ?? DEFAULT_VERSION;

  const widget: NereyWidgetEnvelope = { type: input.type, version, payload: input.payload };
  // The key is omitted rather than set to `undefined` when no state was asked for, so a fixture
  // round-trips through `JSON.stringify` unchanged — which is what a persisted transcript does.
  if (input.state !== undefined) widget.state = input.state;

  return {
    id: input.id ?? autoId(input.type),
    // A widget is something the assistant produced. A user message carrying one would have to come
    // from somewhere, and nothing in the contract produces it.
    role: 'assistant',
    text: input.text ?? synthesiseText(input.type, input.payload),
    widget,
  };
}

export type TextMessageInput = {
  id?: string | number;
  text: string;
  role?: NereyMessage['role'];
};

/** Build a plain text message. */
export function textMessage(input: TextMessageInput): NereyMessage {
  // No `widget` key at all, not `widget: null`. Both are absences (`resolveEnvelope` collapses
  // them), and the shorter one is what a consumer's own adapter produces.
  return { id: input.id ?? autoId('text'), role: input.role ?? 'assistant', text: input.text };
}

/**
 * A short scripted conversation used by docs and stories.
 *
 * Ids are literals rather than generated: this array is built at module load, so auto-ids would
 * depend on import order and change the moment another fixture is added above it — and these ids
 * are exactly the ones a story or a persistence seed refers to by name.
 *
 * The confirmation carries no `state`, so it renders live and answerable. Seeding it with a
 * decision would demonstrate the `afterExpiry: 'snapshot'` replay (ADR 0018) but would leave the
 * default story with nothing to click, which is the one thing a demo transcript has to offer.
 */
export const sampleConversation: readonly NereyMessage[] = Object.freeze([
  textMessage({ id: 'sample-1', role: 'user', text: 'Archive the Q3 incident report.' }),
  textMessage({
    id: 'sample-2',
    text: 'I found one report matching "Q3 incident". Archiving keeps it restorable for 30 days.',
  }),
  widgetMessage({
    id: 'sample-3',
    type: CONFIRMATION_TYPE,
    version: CONFIRMATION_VERSION,
    payload: {
      title: 'Archive "Q3 incident report"?',
      description: 'It leaves the active list and stays restorable for 30 days.',
      confirmLabel: 'Archive',
      cancelLabel: 'Keep it',
      tone: 'danger',
    },
    text: 'Archive "Q3 incident report"? Reply Archive to confirm, or Keep it to cancel.',
  }),
  textMessage({ id: 'sample-4', role: 'user', text: 'Archive' }),
  textMessage({
    id: 'sample-5',
    text: 'Archived. You can restore it from Reports → Archived for the next 30 days.',
  }),
]);
