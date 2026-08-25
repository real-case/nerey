import { useCallback, useId, useMemo } from 'react';
import type { ReactElement } from 'react';
import { WidgetPart, WidgetRoot, useWidgetState } from '@nerey/core';
import type { NereyState, WidgetComponentProps } from '@nerey/core';

import { Badge } from '../../components/badge/badge';
import { Button } from '../../components/button/button';
import { Checkbox, CheckboxGroup } from '../../components/checkbox/checkbox';
import { Field } from '../../components/field/field';
import { Form } from '../../components/field/form';
import { Input } from '../../components/input/input';
import { NumberField } from '../../components/number-field/number-field';
import { Select } from '../../components/select/select';
import { Stack } from '../../components/stack/stack';
import { Surface } from '../../components/surface/surface';
import { Switch } from '../../components/switch/switch';
import { Text } from '../../components/text/text';
import { Textarea } from '../../components/input/textarea';
import { VisuallyHidden } from '../../components/visually-hidden/visually-hidden';
import { useNereyLabels } from '../../labels/labels';
import styles from './form.module.css';
import {
  FORM_PLACEMENT,
  FORM_TYPE,
  FORM_VERSION,
  defaultValueFor,
  fieldIssue,
  summarise,
  valuesFor,
} from './schema';
import type { FormField, FormPayload, FormState, FormValue } from './schema';

export type FormWidgetProps = WidgetComponentProps<FormPayload, FormState>;

/**
 * Shared and frozen, so an untouched form does not hand `useWidgetState` a new `initial` identity
 * on every render, and so a widget that mutates its own state object fails loudly here rather than
 * quietly diverging from what the persistence port stored.
 */
const EMPTY_STATE: FormState = Object.freeze({});

/** The label a submitted form wears, exported so a host translates it once. */
export const SUBMITTED_BADGE_LABEL = 'Submitted';

type FieldRowProps = {
  field: FormField;
  value: FormValue;
  disabled: boolean;
  onChange: (value: FormValue) => void;
};

/**
 * Whether this kind's control can legally carry `aria-required`.
 *
 * It is a per-ROLE question, not a per-control preference. A multiselect is a `role="group"` and a
 * date input maps to no role at all, and neither declares support for `aria-required` — axe's
 * `aria-allowed-attr` rejects both, so writing it there trades a real failure for an imagined
 * benefit (ADR 0032). Those two announce the requirement as hidden text inside their label, which
 * lands in the accessible name and says the same thing where it is actually allowed to be said.
 */
function supportsAriaRequired(field: FormField): boolean {
  return field.kind !== 'multiselect' && field.kind !== 'date';
}

/**
 * The control for one field.
 *
 * Every branch is a theme component driven by the answer this widget holds, and none of them sets
 * `required` natively. That is deliberate: Base UI skips a field's custom validator whenever the
 * native `validationMessage` is non-empty, so a native `required` would replace this widget's
 * carefully worded message with the browser's ("Please fill out this field") and would do it in
 * whatever language the browser is in rather than the one the payload is written in. The Zod
 * schema is the single rule set; `aria-required` carries the fact to assistive technology.
 */
function FieldControl({ field, value, disabled, onChange }: FieldRowProps): ReactElement {
  const labels = useNereyLabels();
  const required = field.required === true && supportsAriaRequired(field) ? true : undefined;

  switch (field.kind) {
    case 'text':
      return field.multiline === true ? (
        <Textarea
          value={typeof value === 'string' ? value : ''}
          onValueChange={onChange}
          placeholder={field.placeholder}
          disabled={disabled}
          aria-required={required}
        />
      ) : (
        <Input
          value={typeof value === 'string' ? value : ''}
          onValueChange={onChange}
          placeholder={field.placeholder}
          disabled={disabled}
          aria-required={required}
        />
      );

    case 'number':
      return (
        <NumberField.Root
          value={typeof value === 'number' ? value : null}
          onValueChange={onChange}
          min={field.min}
          max={field.max}
          step={field.step}
          disabled={disabled}
          // Base UI clamps a typed number into range on commit unless this is on. Clamping
          // silently rewrites what the user entered; letting the value stand and explaining the
          // rule underneath is the difference between a form that argues and one that corrects.
          allowOutOfRange
        >
          <NumberField.Group>
            <NumberField.Decrement />
            <NumberField.Input placeholder={field.placeholder} aria-required={required} />
            <NumberField.Increment />
          </NumberField.Group>
        </NumberField.Root>
      );

    case 'boolean':
      return (
        <Switch.Root
          checked={value === true}
          onCheckedChange={onChange}
          disabled={disabled}
          aria-required={required}
        >
          <Switch.Thumb />
        </Switch.Root>
      );

    case 'select':
      return (
        <Select.Root
          items={field.options}
          value={typeof value === 'string' && value !== '' ? value : null}
          // `null` is Base UI's "nothing chosen"; this widget stores that as the empty string, so
          // one absence has one spelling everywhere downstream of here.
          onValueChange={(next) => {
            onChange(next ?? '');
          }}
          disabled={disabled}
        >
          <Select.Trigger label={field.label} aria-required={required}>
            <Select.Value placeholder={field.placeholder ?? labels.form.selectPlaceholder} />
            <Select.Icon />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner>
              <Select.Popup>
                {field.options.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    <Select.ItemText>{option.label}</Select.ItemText>
                    <Select.ItemIndicator />
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      );

    case 'multiselect':
      return (
        <CheckboxGroup value={Array.isArray(value) ? value : []} onValueChange={onChange} disabled={disabled}>
          {field.options.map((option) => (
            // `Field.Item` gives each box its own labelling scope. Without it every label in the
            // group associates with the group's first checkbox, which looks perfect and reads as
            // nonsense aloud.
            <Field.Item key={option.value}>
              <Field.Label>
                <Checkbox.Root value={option.value}>
                  <Checkbox.Indicator />
                </Checkbox.Root>
                {option.label}
              </Field.Label>
            </Field.Item>
          ))}
        </CheckboxGroup>
      );

    case 'date':
      return (
        <Input
          type="date"
          value={typeof value === 'string' ? value : ''}
          onValueChange={onChange}
          disabled={disabled}
        />
      );

    default: {
      const exhaustive: never = field;
      return exhaustive;
    }
  }
}

/**
 * One labelled row: label, control, optional description, and the error slot.
 *
 * `validate` closes over this row's current answer and ignores the value Base UI passes it. Base
 * UI reads that value from whichever control registered with the field, which for a checkbox group
 * is one representative box rather than the set — so asking the widget's own state is both simpler
 * and the only reading that is right for every kind.
 */
function FieldRow(props: FieldRowProps): ReactElement {
  const { field, value, disabled } = props;
  const labels = useNereyLabels();

  const label = (
    <>
      {field.label}
      {field.required === true && (
        <>
          {/* `aria-hidden`, because a screen reader that announced the glyph would say "star" in
              the middle of the control's name. The fact travels on `aria-required` instead — or,
              where the role forbids it, as the hidden phrase below. */}
          <span className={styles.required} aria-hidden="true">
            *
          </span>
          {!supportsAriaRequired(field) && <VisuallyHidden>{labels.form.requiredHint}</VisuallyHidden>}
        </>
      )}
    </>
  );

  return (
    <WidgetPart
      part="field"
      render={<Field.Root name={field.name} disabled={disabled} validate={() => fieldIssue(field, value)} />}
    >
      {field.kind === 'boolean' ? (
        // A switch is named by the text beside it, so the label wraps the control rather than
        // sitting above it — which is also what makes those words part of the pointer target.
        <Field.Label>
          <FieldControl {...props} />
          {label}
        </Field.Label>
      ) : (
        <>
          {/* A select's trigger is a button, and native label behaviour on a button produces
              pointer effects nobody asked for. Base UI's own guidance is to opt out and render
              something that is not a `<label>`. */}
          {field.kind === 'select' ? (
            <Field.Label nativeLabel={false} render={<span />}>
              {label}
            </Field.Label>
          ) : (
            <Field.Label>{label}</Field.Label>
          )}
          <FieldControl {...props} />
        </>
      )}

      {field.description !== undefined && <Field.Description>{field.description}</Field.Description>}

      {/* No children: the text is whatever `validate` returned for this field. Passing children
          here would override that with one message for every possible reason (ADR 0022). */}
      <Field.Error />
    </WidgetPart>
  );
}

/**
 * Structured input — the widget the MCP `elicitation` pattern maps onto.
 *
 * Three decisions are worth reading before changing anything here.
 *
 * **Validation runs on submit, never on keystroke.** Base UI's `validationMode` defaults to
 * `'onSubmit'` and flips to live re-validation only after the first submit attempt, which is
 * exactly the behaviour a form should have: a field that turns red while you are still typing its
 * first character is hostile, and one that stays red after you have fixed it is worse. Base UI
 * validates every field synchronously on submit, blocks the event when any of them fails, and
 * moves focus to the first invalid control — so this component never has to reimplement the one
 * part of form accessibility that is routinely missing.
 *
 * **Answers are the widget's state, not the DOM's.** Every control is driven from `useWidgetState`,
 * which is what makes a half-filled form survive a reload (ADR 0016) and what makes the submitted
 * snapshot render the values rather than an empty shell (ADR 0018).
 *
 * **ARIA is written by hand.** ADR 0022 reverses the origin codebase's "never author `aria-*`"
 * convention. Nothing else is going to name these controls: a consumer cannot reach inside this
 * component to add a labelling relationship, so what is not written here is not announced at all,
 * and the WCAG 2.2 AA gate would fail with no legitimate way to pass (ADR 0032).
 */
export function FormWidget(props: FormWidgetProps): ReactElement {
  const { messageId, payload, state, readonly, status, onInteraction } = props;
  const labels = useNereyLabels();

  // The default debounce, unlike the confirmation's `0`. A form IS the burst case — a sentence
  // typed into a text box is thirty writes — and coalescing them is what the window exists for.
  const { state: persisted, setState } = useWidgetState<FormState>(messageId, state ?? EMPTY_STATE);

  const values = useMemo(
    () => valuesFor(payload.fields, persisted.values),
    [payload.fields, persisted.values],
  );

  const submitted = persisted.submitted === true;

  /**
   * The lock is committed the moment the form is submitted and nothing takes it back. A failed
   * persist must not re-enable the controls: the summary is already in the transcript, so a second
   * submit would send the same answers twice and start a second model turn (FR-20, ADR 0016).
   */
  const locked = readonly || submitted;

  // A payload that is still streaming is not a form yet, and one that arrived as an error is not a
  // form at all (ADR 0019). Neither is answerable, and both stay worth rendering.
  const actionable = status === 'ready' && !locked;

  const rootState: NereyState = locked ? 'locked' : status === 'error' ? 'error' : 'idle';

  const scope = useId();
  const titleId = `${scope}title`;
  const descriptionId = `${scope}description`;

  const setValue = useCallback(
    (name: string, value: FormValue) => {
      setState((previous) => ({ ...previous, values: { ...previous.values, [name]: value } }));
    },
    [setState],
  );

  function handleSubmit(): void {
    // Re-checked rather than trusted to `disabled`. Base UI only reaches this handler when every
    // field validated, but a submit can also arrive from an Enter press in a text box, and the
    // cost of being wrong once is a duplicate reply in someone's transcript.
    if (!actionable) return;

    const text = summarise(payload.fields, values, { emptySubmission: labels.form.emptySubmission });

    // State first, reply second. If the host's handler throws, the form is already locked; a form
    // left enabled by someone else's exception invites the press that duplicates a reply the host
    // may well have sent before it threw.
    setState((previous) => ({ ...previous, submitted: true }));
    onInteraction('submit', { text, meta: { values } });
  }

  const submitLabel = payload.submitLabel ?? labels.form.submit;

  return (
    <WidgetRoot
      type={FORM_TYPE}
      version={FORM_VERSION}
      slot={FORM_PLACEMENT.slot}
      status={status}
      state={rootState}
      readonly={readonly}
      className={styles.root}
    >
      <Surface variant="raised" padding="md" radius="lg">
        {/* The ARIA lives on the `<form>` rather than on the widget root: the form IS the group,
            and naming it turns it into a landmark a screen-reader user can jump to. A payload with
            no title leaves it unnamed, which is correct — an unnamed form is simply not a landmark,
            whereas `aria-labelledby` pointing at nothing is a broken reference. */}
        <Form
          onFormSubmit={handleSubmit}
          aria-labelledby={payload.title === undefined ? undefined : titleId}
          aria-describedby={payload.description === undefined ? undefined : descriptionId}
        >
          <Stack gap={6}>
            {(payload.title !== undefined || payload.description !== undefined) && (
              <WidgetPart part="header" render={<Stack gap={1} />}>
                {payload.title !== undefined && (
                  <WidgetPart part="title" render={<Text as="h3" size="lg" weight="semibold" id={titleId} />}>
                    {payload.title}
                  </WidgetPart>
                )}
                {payload.description !== undefined && (
                  <WidgetPart
                    part="description"
                    render={<Text size="sm" tone="secondary" id={descriptionId} />}
                  >
                    {payload.description}
                  </WidgetPart>
                )}
              </WidgetPart>
            )}

            <WidgetPart part="fields" render={<Stack gap={4} />}>
              {payload.fields.map((field) => (
                <FieldRow
                  key={field.name}
                  field={field}
                  // `valuesFor` filled every name; the fallback satisfies
                  // `noUncheckedIndexedAccess` without inventing a value of the wrong shape.
                  value={values[field.name] ?? defaultValueFor(field)}
                  disabled={!actionable}
                  onChange={(value) => {
                    setValue(field.name, value);
                  }}
                />
              ))}
            </WidgetPart>

            <WidgetPart part="actions" className={styles.actions}>
              <Button type="submit" disabled={!actionable}>
                {submitLabel}
              </Button>
              {/* Only after a real submit. A form that expired unanswered is also locked, and
                  telling the user it was submitted would be a lie the transcript keeps. */}
              {submitted && (
                <Badge tone="success" variant="subtle">
                  {SUBMITTED_BADGE_LABEL}
                </Badge>
              )}
            </WidgetPart>
          </Stack>
        </Form>
      </Surface>
    </WidgetRoot>
  );
}
