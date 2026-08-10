import { invalidPayloadError, invalidStateError } from '../../errors';
import { validateSync } from '../../validate';
import {
  CONFIRMATION_PLACEMENT,
  CONFIRMATION_TYPE,
  CONFIRMATION_VERSION,
  confirmationPayloadSchema,
  confirmationStateSchema,
  DEFAULT_CANCEL_LABEL,
  DEFAULT_CONFIRM_LABEL,
  labelFor,
} from './schema';
import type { ConfirmationPayload } from './schema';

function parsePayload(value: unknown) {
  return validateSync(confirmationPayloadSchema, value);
}

function parseState(value: unknown) {
  return validateSync(confirmationStateSchema, value);
}

describe('confirmation payload schema', () => {
  it('accepts a payload with only a title and reports no optional keys', () => {
    const result = parsePayload({ title: 'Delete the project?' });

    expect(result).toEqual({ ok: true, value: { title: 'Delete the project?' } });
  });

  it('accepts every optional field', () => {
    const payload = {
      title: 'Delete the project?',
      description: 'This cannot be undone.',
      confirmLabel: 'Delete it',
      cancelLabel: 'Keep it',
      tone: 'danger',
    };

    expect(parsePayload(payload)).toEqual({ ok: true, value: payload });
  });

  it('strips keys the schema never described', () => {
    const result = parsePayload({
      title: 'Ship it?',
      onClick: 'alert(1)',
      dangerouslySetInnerHTML: { __html: '<script>' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value)).toEqual(['title']);
  });

  it.each([
    ['null', null],
    ['a string', 'confirm'],
    ['a number', 7],
    ['an array', [{ title: 'x' }]],
  ])('rejects %s at the root', (_label, value) => {
    const result = parsePayload(value);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe('');
    expect(result.issues[0]?.message).toMatch(/must be an object/);
  });

  it('rejects a missing title', () => {
    const result = parsePayload({ description: 'no title here' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { path: 'title', message: expect.stringContaining('`title` is required') },
    ]);
  });

  it.each(['', '   ', '\n\t'])('rejects a blank title (%j)', (title) => {
    const result = parsePayload({ title });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toMatch(/accessible name/);
  });

  it.each(['description', 'confirmLabel', 'cancelLabel'])('rejects a non-string %s', (key) => {
    const result = parsePayload({ title: 'ok', [key]: 42 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { path: key, message: `\`${key}\` must be a string, received a value of type number.` },
    ]);
  });

  it('treats an explicitly null optional field as absent', () => {
    const result = parsePayload({ title: 'ok', description: null, tone: null });

    expect(result).toEqual({ ok: true, value: { title: 'ok' } });
  });

  it('rejects a tone outside the union', () => {
    const result = parsePayload({ title: 'ok', tone: 'destructive' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { path: 'tone', message: expect.stringContaining('`tone` must be one of default | danger') },
    ]);
  });

  it('reports every problem at once rather than the first', () => {
    const result = parsePayload({ title: 5, description: 5, tone: 'loud' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path).sort()).toEqual(['description', 'title', 'tone']);
  });

  it('feeds the error taxonomy a readable message', () => {
    const result = parsePayload({ title: null });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const error = invalidPayloadError({ widgetType: CONFIRMATION_TYPE }, result.issues);

    expect(error.code).toBe('invalid-payload');
    expect(error.message).toContain('title:');
  });

  it('advertises itself as a synchronous Standard Schema v1 implementation', () => {
    const props = confirmationPayloadSchema['~standard'];

    expect(props.version).toBe(1);
    expect(props.vendor).toBe('nerey');
    expect(props.validate({ title: 'ok' })).not.toBeInstanceOf(Promise);
  });
});

describe('confirmation state schema', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty object', {}],
    ['an explicitly null decision', { decision: null }],
  ])('reads %s back as an undecided state', (_label, value) => {
    expect(parseState(value)).toEqual({ ok: true, value: {} });
  });

  it.each(['confirmed', 'cancelled'] as const)('accepts the %s decision', (decision) => {
    expect(parseState({ decision })).toEqual({ ok: true, value: { decision } });
  });

  it('strips unknown keys from a persisted record', () => {
    const result = parseState({ decision: 'confirmed', decidedBy: 'someone-else' });

    expect(result).toEqual({ ok: true, value: { decision: 'confirmed' } });
  });

  it('rejects a decision outside the union', () => {
    const result = parseState({ decision: 'maybe' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      { path: 'decision', message: expect.stringContaining('"confirmed" or "cancelled"') },
    ]);
    expect(invalidStateError({}, result.issues).code).toBe('invalid-state');
  });

  it('rejects a non-object record', () => {
    const result = parseState('confirmed');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toMatch(/must be an object/);
  });
});

describe('confirmation identity and labels', () => {
  it('registers under an exact type@version pair', () => {
    expect(CONFIRMATION_TYPE).toBe('confirmation');
    expect(CONFIRMATION_VERSION).toBe('1.0.0');
    expect(CONFIRMATION_PLACEMENT).toEqual({ slot: 'message' });
  });

  it('falls back to the default labels', () => {
    const payload: ConfirmationPayload = { title: 'ok' };

    expect(labelFor(payload, 'confirmed')).toBe(DEFAULT_CONFIRM_LABEL);
    expect(labelFor(payload, 'cancelled')).toBe(DEFAULT_CANCEL_LABEL);
  });

  it('prefers the authored labels', () => {
    const payload: ConfirmationPayload = { title: 'ok', confirmLabel: 'Send it', cancelLabel: 'Not now' };

    expect(labelFor(payload, 'confirmed')).toBe('Send it');
    expect(labelFor(payload, 'cancelled')).toBe('Not now');
  });
});
