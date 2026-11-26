import { describe, expect, it } from 'vitest';

import { parsePartialJson } from './partial-json';

describe('parsePartialJson', () => {
  it('reads every prefix of a document without throwing, ending on the document itself', () => {
    const doc = {
      type: 'poll',
      version: '1.0.0',
      payload: { question: 'Pick "one"\n', options: [1, true, null] },
    };
    const text = JSON.stringify(doc);
    for (let end = 0; end <= text.length; end++) {
      expect(parsePartialJson(text.slice(0, end))).toBeDefined();
    }
    expect(parsePartialJson(text)?.value).toEqual(doc);
  });

  it('keeps a string cut mid-way and reports it incomplete', () => {
    const read = parsePartialJson('{"type":"poll","version":"1.');
    expect(read?.value).toEqual({ type: 'poll', version: '1.' });
    expect(read?.isComplete(['type'])).toBe(true);
    expect(read?.isComplete(['version'])).toBe(false);
  });

  it('drops a key whose value has not started', () => {
    expect(parsePartialJson('{"type":"poll","vers')?.value).toEqual({ type: 'poll' });
    expect(parsePartialJson('{"type":"poll","version":')?.value).toEqual({ type: 'poll' });
  });

  it('closes open arrays and nested objects', () => {
    expect(parsePartialJson('{"payload":{"options":[{"value":"a"},{"val')?.value).toEqual({
      payload: { options: [{ value: 'a' }, {}] },
    });
  });

  it('reports nothing yet for an empty or whitespace prefix, and for a half-written literal', () => {
    expect(parsePartialJson('')?.value).toBeUndefined();
    expect(parsePartialJson('   ')?.value).toBeUndefined();
    expect(parsePartialJson('{"a":tr')?.value).toEqual({});
  });

  it('decodes escapes, including a unicode escape, and waits on a cut one', () => {
    expect(parsePartialJson('"a\\u0041\\n"')?.value).toBe('aA\n');
    expect(parsePartialJson('"a\\u00')?.value).toBe('a');
  });

  it('rejects text that is not a prefix of any JSON document', () => {
    expect(parsePartialJson('not json')).toBeUndefined();
    expect(parsePartialJson('{"a":1} trailing')).toBeUndefined();
    expect(parsePartialJson('{a:1}')).toBeUndefined();
  });

  it('answers incomplete for a path that does not lead to a string', () => {
    const read = parsePartialJson('{"a":{"b":1}}');
    expect(read?.isComplete(['a'])).toBe(false);
    expect(read?.isComplete(['a', 'b'])).toBe(false);
    expect(read?.isComplete(['missing'])).toBe(false);
  });
});
