import { z } from 'zod';

import type { Placement } from '@nerey/core';

/**
 * ADR 0011 — core depends on the Standard Schema *spec* and may never import a validator, so its
 * two built-ins hand-roll theirs. The theme is under no such constraint: it already ships Base UI,
 * its widgets exist to be read and copied, and Zod 4 implements Standard Schema v1 — so the entry
 * still registers through the same `payloadSchema` seam a consumer would fill with Valibot.
 *
 * The field vocabulary is deliberately FLAT and primitive, and that is the load-bearing decision
 * in this file. This is the widget the MCP `elicitation` pattern maps onto, and elicitation asks
 * for a handful of scalar answers. A nested field language would be a second UI framework
 * smuggled in through a payload, and a model gets six flat kinds right far more often than it
 * gets an arbitrary tree right — which matters more here than expressiveness, because a payload
 * the model malforms renders as plain text and the exchange is lost (ADR 0012).
 */

export const FORM_TYPE = 'form';
export const FORM_VERSION = '1.0.0';
export const FORM_PLACEMENT: Placement = { slot: 'message' };

/** Exported so a host translates them once rather than at every call site. */
export const DEFAULT_SUBMIT_LABEL = 'Submit';
export const DEFAULT_SELECT_PLACEHOLDER = 'Choose one';

/**
 * What a form with nothing in it sends.
 *
 * `text` is required and is what the agent reads as user input (ADR 0014), so an all-optional
 * form that the user submits untouched must still say something a person could have typed. An
 * empty string would reach the model as a blank turn.
 */
export const EMPTY_SUBMISSION_TEXT = 'I submitted the form without filling anything in.';

/* ── Payload ───────────────────────────────────────────────────────────────────────────── */

const optionSchema = z.object({
  value: z.string().min(1, 'An option needs a `value`.'),
  label: z.string().min(1, 'An option needs a `label` — it is what the user reads.'),
});

export type FormFieldOption = z.infer<typeof optionSchema>;

/**
 * Every field carries the same five things, so the union below differs only where the *control*
 * differs. Spreading a shared shape rather than composing with `.extend()` keeps each member a
 * plain object literal, which is what `z.discriminatedUnion` needs to read `kind` at build time.
 */
const commonFieldShape = {
  /** Identifies the answer. Also the `Field.Root` name, so `Form`'s `errors` key on it. */
  name: z.string().min(1, 'A field needs a `name`.'),
  label: z.string().min(1, 'A field needs a `label` — it is the control’s accessible name.'),
  required: z.boolean().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
};

export const formFieldSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), ...commonFieldShape, multiline: z.boolean().optional() }),
  z.object({
    kind: z.literal('number'),
    ...commonFieldShape,
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive('`step` must be positive.').optional(),
  }),
  z.object({ kind: z.literal('boolean'), ...commonFieldShape }),
  z.object({
    kind: z.literal('select'),
    ...commonFieldShape,
    options: z.array(optionSchema).min(1, 'A select needs at least one option.'),
  }),
  z.object({
    kind: z.literal('multiselect'),
    ...commonFieldShape,
    options: z.array(optionSchema).min(1, 'A multiselect needs at least one option.'),
  }),
  z.object({ kind: z.literal('date'), ...commonFieldShape }),
]);

export type FormField = z.infer<typeof formFieldSchema>;
export type FormFieldKind = FormField['kind'];

function namesAreUnique(fields: readonly FormField[]): boolean {
  return new Set(fields.map((field) => field.name)).size === fields.length;
}

export const formPayloadSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  fields: z
    .array(formFieldSchema)
    .min(1, 'A form needs at least one field.')
    // Not pedantry. Answers are stored by `name`, so two fields sharing one would overwrite each
    // other on every keystroke and submit a value neither control is showing — a defect that
    // looks like a rendering bug and is a payload bug.
    .refine(namesAreUnique, 'Every field `name` must be unique within a form.'),
  submitLabel: z.string().min(1).optional(),
});

export type FormPayload = z.infer<typeof formPayloadSchema>;

/* ── State ─────────────────────────────────────────────────────────────────────────────── */

/**
 * One answer. The union is exactly what the six controls produce, and `null` is a real member:
 * it is an EMPTY number, which is not the same fact as zero and cannot be spelled as one.
 */
export const formValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);

export type FormValue = z.infer<typeof formValueSchema>;

/**
 * Answers survive a reload, so a half-filled form is not lost to a refresh (ADR 0016), and
 * `submitted` is what makes the terminal render show the values instead of an empty form.
 *
 * Everything is optional and the whole object defaults, because `undefined` is what the renderer
 * hands a widget nobody has touched — a schema that rejected it would report every fresh form as
 * corrupt and drop it into the fallback (ADR 0012).
 */
export const formStateSchema = z
  .object({
    values: z.record(z.string(), formValueSchema).optional(),
    submitted: z.boolean().optional(),
  })
  .default({});

export type FormState = z.infer<typeof formStateSchema>;

/* ── Values ────────────────────────────────────────────────────────────────────────────── */

/**
 * The value a field starts at, so no control is ever handed `undefined` and the summary always
 * has something to render for a field the user never touched.
 */
export function defaultValueFor(field: FormField): FormValue {
  switch (field.kind) {
    case 'number':
      return null;
    case 'boolean':
      return false;
    case 'multiselect':
      return [];
    case 'text':
    case 'select':
    case 'date':
      return '';
    default: {
      // Adding a `kind` without teaching this function about it must break the build. The
      // alternative is a control rendered against `undefined`, which throws inside React rather
      // than reporting anything a reader can act on.
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

/**
 * Reads one persisted answer back, falling back to the field's default when the stored shape does
 * not fit the field's kind.
 *
 * `formStateSchema` validates that an entry is *a* value; it cannot validate that it is the right
 * one, because the schema is fixed at registration while the field list arrives in the payload.
 * So a `rating` that used to be text and is now a number replays a string into a NumberField —
 * a crash, not a wrong answer. The coercion happens once here rather than in six controls, which
 * is the same tolerant-reader posture migration takes (ADR 0030).
 */
export function readValue(field: FormField, stored: FormValue | undefined): FormValue {
  if (stored === undefined) return defaultValueFor(field);

  switch (field.kind) {
    case 'number':
      return typeof stored === 'number' || stored === null ? stored : null;
    case 'boolean':
      return typeof stored === 'boolean' ? stored : false;
    case 'multiselect':
      return Array.isArray(stored) ? stored : [];
    case 'text':
    case 'select':
    case 'date':
      return typeof stored === 'string' ? stored : '';
    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

/** Every field's current answer, defaulted and coerced — the shape the controls are driven from. */
export function valuesFor(
  fields: readonly FormField[],
  stored: Record<string, FormValue> | undefined,
): Record<string, FormValue> {
  const values: Record<string, FormValue> = {};
  for (const field of fields) values[field.name] = readValue(field, stored?.[field.name]);
  return values;
}

/* ── Validation ────────────────────────────────────────────────────────────────────────── */

/** `YYYY-MM-DD`. `<input type="date">` produces exactly this, and a persisted answer may not. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requiredMessage(field: FormField): string {
  // The label, spelled out, because a screen reader reaches the error through the control's
  // description and may never have read the surrounding text.
  return `${field.label} is required.`;
}

function rangeMessage(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return `Enter a number between ${min} and ${max}.`;
  if (min !== undefined) return `Enter ${min} or more.`;
  return `Enter ${String(max)} or less.`;
}

/**
 * The rule one answer must satisfy.
 *
 * The `required` check is the LAST refinement on every branch on purpose: an empty answer passes
 * the shape checks above it, so the first issue reported for a blank required field is "required"
 * rather than "choose one of the listed options", which is true but unhelpful.
 */
function valueSchemaFor(field: FormField): z.ZodType {
  switch (field.kind) {
    case 'text':
      return z.string().refine((value) => !field.required || value.trim() !== '', requiredMessage(field));

    case 'number': {
      let numeric = z.number();
      if (field.min !== undefined) numeric = numeric.min(field.min, rangeMessage(field.min, field.max));
      if (field.max !== undefined) numeric = numeric.max(field.max, rangeMessage(field.min, field.max));
      // `.nullable()` short-circuits on `null`, so an empty optional number never trips a range
      // rule it has no value to break.
      return numeric.nullable().refine((value) => !field.required || value !== null, requiredMessage(field));
    }

    case 'boolean':
      // A required switch means "must be on" — the consent case. A boolean that may be either way
      // is simply not required, so there is no third reading to pick between.
      return z.boolean().refine((value) => !field.required || value, requiredMessage(field));

    case 'select': {
      const allowed = new Set(field.options.map((option) => option.value));
      return z
        .string()
        .refine((value) => value === '' || allowed.has(value), 'Choose one of the listed options.')
        .refine((value) => !field.required || value !== '', requiredMessage(field));
    }

    case 'multiselect': {
      const allowed = new Set(field.options.map((option) => option.value));
      return z
        .array(z.string())
        .refine((value) => value.every((entry) => allowed.has(entry)), 'Choose from the listed options.')
        .refine((value) => !field.required || value.length > 0, requiredMessage(field));
    }

    case 'date':
      return (
        z
          .string()
          // Both halves are needed: the pattern rejects "14/09/2026", and `Date.parse` rejects
          // "2026-02-30", which is correctly shaped and is not a day.
          .refine(
            (value) => value === '' || (ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))),
            'Enter a date as YYYY-MM-DD.',
          )
          .refine((value) => !field.required || value !== '', requiredMessage(field))
      );

    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

/**
 * The whole form's answers, as one object schema derived from the field list.
 *
 * Built per call rather than cached: the field list belongs to the payload, so there is no
 * instance to hang a cache on, and the only caller runs on submit.
 */
export function formValuesSchema(fields: readonly FormField[]): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) shape[field.name] = valueSchemaFor(field);
  return z.object(shape);
}

/**
 * The message shown under one field, or `null` when the answer is good.
 *
 * Only the first issue is reported. A field displays one error at a time, and a list of three
 * complaints about a single text box is read aloud in full before the user can act on any of it.
 */
export function fieldIssue(field: FormField, value: FormValue): string | null {
  const result = valueSchemaFor(field).safeParse(value);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? `${field.label} is not valid.`;
}

/* ── The outbound message ──────────────────────────────────────────────────────────────── */

/** One answer, rendered the way the user sees it rather than the way it is stored. */
export function formatValue(field: FormField, value: FormValue): string {
  if (field.kind === 'boolean') return value === true ? 'Yes' : 'No';
  if (field.kind === 'number') return typeof value === 'number' ? String(value) : '';

  if (field.kind === 'select' || field.kind === 'multiselect') {
    const labels = new Map(field.options.map((option) => [option.value, option.label]));
    // The stored value is an option id; the agent is being read a sentence, so it gets the label.
    // An id with no matching option falls back to itself rather than vanishing — a payload that
    // changed its options under a persisted answer should be visible, not silently dropped.
    if (field.kind === 'select') {
      return typeof value === 'string' && value !== '' ? (labels.get(value) ?? value) : '';
    }
    return Array.isArray(value) ? value.map((entry) => labels.get(entry) ?? entry).join(', ') : '';
  }

  return typeof value === 'string' ? value : '';
}

/**
 * The message the form sends: one `label: value` per line.
 *
 * Not JSON, and not a serialisation of anything. The agent consumes this as user input (ADR 0014),
 * so it has to be what a person would have typed if they had answered in prose — which is also why
 * a blank optional field contributes no line at all. Nobody writes "Notes: (empty)".
 *
 * Booleans are the exception and are always printed: a switch is answered by existing, and
 * omitting "Window seat: No" would read as though the question had never been asked.
 */
export function summarise(fields: readonly FormField[], values: Record<string, FormValue>): string {
  const lines: string[] = [];

  for (const field of fields) {
    const rendered = formatValue(field, values[field.name] ?? defaultValueFor(field));
    if (field.kind !== 'boolean' && rendered.trim() === '') continue;
    lines.push(`${field.label}: ${rendered}`);
  }

  return lines.length > 0 ? lines.join('\n') : EMPTY_SUBMISSION_TEXT;
}
