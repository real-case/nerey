import { z } from 'zod';

import type { Placement } from '@nerey/core';

/**
 * ADR 0011 — Zod 4 implements Standard Schema v1, so the theme's widgets validate through the
 * same seam a consumer would fill with Valibot or ArkType; only `@nerey/core` is forbidden a
 * validator.
 *
 * This widget exists to make one thing concrete: a widget does not have to live in the
 * transcript. Its placement is `{ slot: 'input', position: 'above' }`, so it renders attached to
 * the composer, and its whole output is a sentence the user then chooses to send. That is the
 * part of the placement model (ADR 0017) people do not expect, and the reason it is a reference
 * implementation rather than a paragraph in a document.
 */

export const FILTER_PANEL_TYPE = 'filter-panel';
export const FILTER_PANEL_VERSION = '1.0.0';
export const FILTER_PANEL_PLACEMENT: Placement = { slot: 'input', position: 'above' };

/** Exported so a host translates them once rather than at every call site. */
export const PANEL_LABEL = 'Filters';
export const DEFAULT_SEARCH_LABEL = 'Search';
export const DEFAULT_CLEAR_LABEL = 'Clear filters';
export const EMPTY_QUERY_HINT = 'Pick a filter to build a search.';
export const DEFAULT_FACET_PLACEHOLDER = 'Type to filter';
export const NO_MATCHES_TEXT = 'No matching options.';
export const QUERY_PREFIX = 'Show me the results where ';

/**
 * Above this many options a facet is rendered as a filtered Combobox instead of a row of chips.
 *
 * The number is a layout fact, not a taste: this widget sits on top of the composer, where
 * vertical space is borrowed from the conversation, and a wrapping chip row of thirty airlines
 * pushes the message the user is reading off screen. Five fits on one line at a typical composer
 * width and is also, not coincidentally, about where "scan the options" stops beating "type the
 * one you already have in mind".
 */
export const CHIP_LIMIT = 5;

/* ── Payload ───────────────────────────────────────────────────────────────────────────── */

const facetOptionSchema = z.object({
  value: z.string().min(1, 'An option needs a `value`.'),
  label: z.string().min(1, 'An option needs a `label` — it is what the user reads.'),
  /**
   * How many results this option would leave. Optional because the producer often does not know
   * it, and a count of zero is a legitimate answer that must not be confused with an absent one.
   */
  count: z.number().int().nonnegative().optional(),
});

export type FilterOption = z.infer<typeof facetOptionSchema>;

const facetSchema = z.object({
  name: z.string().min(1, 'A facet needs a `name`.'),
  label: z.string().min(1, 'A facet needs a `label` — it names the group of controls.'),
  options: z.array(facetOptionSchema).min(1, 'A facet needs at least one option.'),
});

export type Facet = z.infer<typeof facetSchema>;

function namesAreUnique(facets: readonly Facet[]): boolean {
  return new Set(facets.map((facet) => facet.name)).size === facets.length;
}

export const filterPanelPayloadSchema = z.object({
  facets: z
    .array(facetSchema)
    .min(1, 'A filter panel needs at least one facet.')
    // Selections are stored by facet `name`, so a duplicate would put two groups of controls on
    // the same key, each clearing the other's answer on every click.
    .refine(namesAreUnique, 'Every facet `name` must be unique within a panel.'),
});

export type FilterPanelPayload = z.infer<typeof filterPanelPayloadSchema>;

/* ── State ─────────────────────────────────────────────────────────────────────────────── */

/**
 * The chosen option values, keyed by facet name. Optional and defaulted for the same reason the
 * form's state is: `undefined` is what the renderer hands a widget nobody has touched, and a
 * schema that rejected it would report every fresh panel as corrupt (ADR 0012).
 */
export const filterPanelStateSchema = z
  .object({
    selected: z.record(z.string(), z.array(z.string())).optional(),
  })
  .default({});

export type FilterPanelState = z.infer<typeof filterPanelStateSchema>;

export type FilterSelection = Record<string, string[]>;

/**
 * Every facet's current selection, defaulted and filtered against the options the payload
 * actually offers.
 *
 * The filtering is the interesting half. A persisted selection outlives the payload that produced
 * it — the same tolerant-reader posture as migration (ADR 0030) — and a stale value would
 * otherwise sit in the composed query as a filter with no control to unset it: the user reads a
 * sentence mentioning a facet value nothing on screen is showing, and has no way to remove it.
 */
export function selectionFor(
  facets: readonly Facet[],
  stored: Record<string, string[]> | undefined,
): FilterSelection {
  const selection: FilterSelection = {};

  for (const facet of facets) {
    const allowed = new Set(facet.options.map((option) => option.value));
    const raw = stored?.[facet.name];
    selection[facet.name] = Array.isArray(raw) ? raw.filter((value) => allowed.has(value)) : [];
  }

  return selection;
}

export function hasSelection(selection: FilterSelection): boolean {
  return Object.values(selection).some((values) => values.length > 0);
}

/** A facet too long to scan becomes a filtered Combobox. See `CHIP_LIMIT`. */
export function usesCombobox(facet: Facet): boolean {
  return facet.options.length > CHIP_LIMIT;
}

/* ── The outbound message ──────────────────────────────────────────────────────────────── */

/** The values inside one facet: `["A"] → "A"`, `["A","B"] → "A or B"`, `["A","B","C"] → "A, B or C"`. */
function joinValues(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} or ${parts.at(-1) ?? ''}`;
}

/**
 * The facet clauses: `["X", "Y"] → "X, and Y"`.
 *
 * The comma before "and" is not a style preference. Each clause may already contain an "or", so
 * "Status is Open or In review and Priority is P0" invites exactly the wrong grouping; the comma
 * is what tells a reader — and the model — where one condition ends and the next begins.
 */
function joinClauses(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1) ?? ''}`;
}

/**
 * The sentence the panel composes, and the exact text it sends.
 *
 * Prose, not a query string. The agent reads this as user input (ADR 0014), so `status:open
 * team:platform` would be asking a language model to parse a syntax nobody taught it, while
 * "Status is Open or In review" is a sentence it already understands — and, just as importantly,
 * one the user can read back before pressing Search and recognise as what they meant.
 *
 * It doubles as the preview shown inside the panel, so what is displayed and what is sent are the
 * same string by construction rather than by two functions that agree today.
 */
export function composeQuery(facets: readonly Facet[], selection: FilterSelection): string {
  const clauses: string[] = [];

  for (const facet of facets) {
    const values = selection[facet.name] ?? [];
    if (values.length === 0) continue;

    const labels = new Map(facet.options.map((option) => [option.value, option.label]));
    // A value with no matching option falls back to itself. `selectionFor` has already dropped
    // those, so this only fires for a caller composing a query from a selection of its own.
    const chosen = values.map((value) => labels.get(value) ?? value);
    clauses.push(`${facet.label} is ${joinValues(chosen)}`);
  }

  if (clauses.length === 0) return '';
  return `${QUERY_PREFIX}${joinClauses(clauses)}.`;
}
