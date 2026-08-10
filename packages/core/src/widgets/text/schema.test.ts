import { validateSync } from '../../validate';
import { textPayloadSchema } from './schema';

function run(value: unknown) {
  return textPayloadSchema['~standard'].validate(value);
}

describe('textPayloadSchema `~standard` shape', () => {
  it('declares spec version 1 and a vendor a reader can go and look at', () => {
    expect(textPayloadSchema['~standard'].version).toBe(1);
    expect(textPayloadSchema['~standard'].vendor).toBe('nerey');
  });

  it('validates synchronously, so Nerey can run it inside render', () => {
    // The async escape hatch is legal per the spec and unusable here (ADR 0011): a schema that
    // returns a Promise makes `validateSync` throw rather than validate.
    expect(run({ content: 'hi' })).not.toBeInstanceOf(Promise);
    expect(() => validateSync(textPayloadSchema, { content: 'hi' })).not.toThrow();
  });
});

describe('textPayloadSchema accepts', () => {
  it('an object carrying a content string', () => {
    expect(validateSync(textPayloadSchema, { content: 'Hello there.' })).toEqual({
      ok: true,
      value: { content: 'Hello there.' },
    });
  });

  it('an empty content string, because blank prose is a rendering question not a validity one', () => {
    expect(validateSync(textPayloadSchema, { content: '' })).toEqual({ ok: true, value: { content: '' } });
  });

  it.each([
    ['markdown source', '# Heading\n\n- one\n- two'],
    ['whitespace only', '   \n\t '],
    ['an unpaired surrogate', '\ud83d'],
  ])('%s', (_label, content) => {
    expect(validateSync(textPayloadSchema, { content })).toEqual({ ok: true, value: { content } });
  });

  it('drops keys the schema does not declare rather than rejecting them', () => {
    const outcome = validateSync(textPayloadSchema, { content: 'hi', tone: 'warm', citations: [1, 2] });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(Object.keys(outcome.value)).toEqual(['content']);
    expect(outcome.value).toEqual({ content: 'hi' });
  });
});

describe('textPayloadSchema rejects', () => {
  it('a missing content key, pointing the issue at the key that is absent', () => {
    const outcome = validateSync(textPayloadSchema, {});

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues).toEqual([{ path: 'content', message: 'Expected a string, received undefined.' }]);
  });

  it.each([
    ['a number', 42, 'number'],
    ['a boolean', false, 'boolean'],
    ['null', null, 'null'],
    ['an array', ['hi'], 'an array'],
    ['a nested object', { text: 'hi' }, 'object'],
  ])('content that is %s', (_label, content, received) => {
    const outcome = validateSync(textPayloadSchema, { content });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.issues).toEqual([
      { path: 'content', message: `Expected a string, received ${received}.` },
    ]);
  });

  it.each([
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['a bare string', 'Hello there.', 'string'],
    ['a number', 7, 'number'],
    ['an array of payloads', [{ content: 'hi' }], 'an array'],
  ])('a payload that is %s', (_label, payload, received) => {
    const outcome = validateSync(textPayloadSchema, payload);

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // Empty path, not `content`: the failure is the payload itself, and naming a key the
    // producer never wrote sends whoever reads the error to the wrong place (ADR 0013).
    expect(outcome.issues).toEqual([
      { path: '', message: `Expected an object with a \`content\` string, received ${received}.` },
    ]);
  });
});
