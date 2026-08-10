import type { StandardSchemaV1 } from '@standard-schema/spec';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { flattenIssues, formatIssuePath, validateOptional, validateSync } from './validate';

const userSchema = z.object({
  name: z.string(),
  tags: z.array(z.string()),
});

/**
 * A Standard Schema that answers with a Promise. Zod can be coaxed into this with an async
 * refinement, but hand-rolling it keeps the test about the *spec* rather than about one
 * vendor's async detection, and lets the vendor name be something unmistakable in the
 * assertion below.
 */
function asyncSchema(vendor: string): StandardSchemaV1<unknown, string> {
  return {
    '~standard': {
      version: 1,
      vendor,
      validate: (value) => Promise.resolve({ value: String(value) }),
    },
  };
}

/** A synchronous schema with no vendor machinery, for issue shapes Zod cannot be made to emit. */
function alwaysFails(issues: readonly StandardSchemaV1.Issue[]): StandardSchemaV1<unknown, never> {
  return {
    '~standard': {
      version: 1,
      vendor: 'handmade',
      validate: () => ({ issues }),
    },
  };
}

/** Cases are typed explicitly: the path column is deliberately heterogeneous. */
type PathCase = [label: string, path: readonly unknown[] | undefined, expected: string];

const SHAPE_CASES: PathCase[] = [
  ['an absent path', undefined, ''],
  ['an empty path', [], ''],
  ['a single string segment', ['title'], 'title'],
  ['nested string segments', ['user', 'name'], 'user.name'],
  ['a numeric segment', ['tags', 1], 'tags[1]'],
  ['the spec example', ['user', 'tags', 1], 'user.tags[1]'],
  ['consecutive indices', ['grid', 0, 2], 'grid[0][2]'],
  ['a leading index', [0, 'name'], '[0].name'],
  ['a key after an index', ['rows', 3, 'cells', 0], 'rows[3].cells[0]'],
];

const KEY_OBJECT_CASES: PathCase[] = [
  ['a string key', [{ key: 'user' }, { key: 'name' }], 'user.name'],
  ['a numeric key', [{ key: 'tags' }, { key: 1 }], 'tags[1]'],
  ['a symbol key', [{ key: Symbol('id') }], 'id'],
  ['keys mixed with raw segments', ['user', { key: 'tags' }, 1], 'user.tags[1]'],
];

const DEGRADED_CASES: PathCase[] = [
  ['a boolean', [true], 'true'],
  ['null', [null], 'null'],
  ['undefined', [undefined], 'undefined'],
  ['an object carrying no key', [{ nope: 1 }], '[object Object]'],
];

describe('formatIssuePath', () => {
  it.each(SHAPE_CASES)('formats %s', (_label, path, expected) => {
    expect(formatIssuePath(path)).toBe(expected);
  });

  it('brackets a string segment that happens to be all digits', () => {
    // The check is on the rendered segment, not on the original type, so a numeric object key
    // reads as an index. That is the honest rendering: `a.2024` and `a[2024]` address the same
    // property in JavaScript.
    expect(formatIssuePath(['byYear', '2024'])).toBe('byYear[2024]');
  });

  it('reads a symbol segment through its description', () => {
    expect(formatIssuePath([Symbol('secret')])).toBe('secret');
  });

  it('falls back to the string form of a symbol with no description', () => {
    expect(formatIssuePath([Symbol()])).toBe('Symbol()');
  });

  it.each(KEY_OBJECT_CASES)(
    'unwraps the { key } object form Valibot emits — %s',
    (_label, path, expected) => {
      expect(formatIssuePath(path)).toBe(expected);
    },
  );

  it('ignores the vendor extras riding along with a { key } segment', () => {
    const segment = { type: 'object', origin: 'value', input: {}, key: 'name', value: 1 };

    expect(formatIssuePath([segment])).toBe('name');
  });

  it.each(DEGRADED_CASES)(
    'degrades an unrecognised segment (%s) to its string form',
    (_label, path, expected) => {
      // An error path is the worst possible place to throw: it runs only once something has
      // already gone wrong, and throwing would replace a useful diagnostic with a useless one.
      expect(formatIssuePath(path)).toBe(expected);
    },
  );
});

describe('flattenIssues', () => {
  it('maps every issue to a formatted path and its message', () => {
    const issues: StandardSchemaV1.Issue[] = [
      { message: 'Expected string', path: ['user', 'tags', 1] },
      { message: 'Required', path: ['user', 'name'] },
    ];

    expect(flattenIssues(issues)).toEqual([
      { path: 'user.tags[1]', message: 'Expected string' },
      { path: 'user.name', message: 'Required' },
    ]);
  });

  it('renders a root-level issue with an empty path', () => {
    expect(flattenIssues([{ message: 'Expected object' }])).toEqual([
      { path: '', message: 'Expected object' },
    ]);
  });

  it('returns an empty list for no issues', () => {
    expect(flattenIssues([])).toEqual([]);
  });

  it('drops the vendor-specific extras an issue carries', () => {
    const issue = { message: 'nope', path: ['a'], code: 'custom', fatal: true };

    expect(flattenIssues([issue])).toEqual([{ path: 'a', message: 'nope' }]);
  });
});

describe('validateSync — success', () => {
  it('returns the parsed value for a valid input', () => {
    const result = validateSync(userSchema, { name: 'Ada', tags: ['x'] });

    expect(result).toEqual({ ok: true, value: { name: 'Ada', tags: ['x'] } });
  });

  it("returns the schema's output rather than its input when the schema transforms", () => {
    const trimmed = z.string().transform((value) => value.trim());

    expect(validateSync(trimmed, '  spaced  ')).toEqual({ ok: true, value: 'spaced' });
  });

  it('accepts a null value the schema allows', () => {
    expect(validateSync(z.null(), null)).toEqual({ ok: true, value: null });
  });
});

describe('validateSync — failure', () => {
  it('reports issues rather than throwing', () => {
    const result = validateSync(userSchema, { name: 42, tags: ['x'] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toBe('name');
    expect(result.issues[0]?.message).toBeTruthy();
  });

  it('brackets an array index in the reported path', () => {
    const result = validateSync(userSchema, { name: 'Ada', tags: ['x', 7] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe('tags[1]');
  });

  it('reports a root-level failure with an empty path', () => {
    const result = validateSync(userSchema, 'not an object');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe('');
  });

  it('reports every issue, not just the first', () => {
    const result = validateSync(userSchema, { name: 42, tags: 'nope' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path).sort()).toEqual(['name', 'tags']);
  });

  it("passes a vendor's own issue shapes through the same flattening", () => {
    const result = validateSync(alwaysFails([{ message: 'bad', path: [{ key: 'a' }, 0] }]), 1);

    expect(result).toEqual({ ok: false, issues: [{ path: 'a[0]', message: 'bad' }] });
  });
});

describe('validateSync — an async schema is a wiring error, not a validation failure', () => {
  it('throws a TypeError naming the vendor', () => {
    // The dangerous alternative is silence: a Promise is truthy and has no `issues`, so a naive
    // check reports `ok: true` with a pending Promise as the value and the widget renders
    // garbage. ADR 0011 makes this loud instead.
    expect(() => validateSync(asyncSchema('valibot-async'), 'x')).toThrow(TypeError);
    expect(() => validateSync(asyncSchema('valibot-async'), 'x')).toThrow(/valibot-async/);
  });

  it('says what to do about it and cites the ADR', () => {
    let thrown: unknown;
    try {
      validateSync(asyncSchema('zod'), 'x');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    const message = (thrown as TypeError).message;
    expect(message).toMatch(/validated asynchronously/);
    expect(message).toMatch(/cannot await/);
    expect(message).toMatch(/ADR 0011/);
  });

  it('never reports the pending Promise as a successful value', () => {
    const outcome = ((): unknown => {
      try {
        return validateSync(asyncSchema('anon'), 'x');
      } catch {
        return 'threw';
      }
    })();

    expect(outcome).toBe('threw');
  });
});

describe('validateOptional', () => {
  it('passes the value straight through when no schema is supplied', () => {
    const value = { anything: true };

    expect(validateOptional(undefined, value)).toEqual({ ok: true, value });
  });

  it('passes the value through by identity, not by copy', () => {
    // An absent schema means "trust the producer" (ADR 0011). Copying here would hand every
    // schema-less widget a new prop identity per render and defeat memoisation downstream.
    const value = { nested: { deep: true } };
    const result = validateOptional(undefined, value);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(value);
  });

  it.each<[string, unknown]>([
    ['undefined', undefined],
    ['null', null],
    ['a number', 0],
    ['an empty string', ''],
  ])('passes %s through unvalidated', (_label, value) => {
    expect(validateOptional(undefined, value)).toEqual({ ok: true, value });
  });

  it('delegates to validateSync when a schema is present', () => {
    expect(validateOptional(userSchema, { name: 'Ada', tags: [] })).toEqual({
      ok: true,
      value: { name: 'Ada', tags: [] },
    });
  });

  it('reports issues from the supplied schema', () => {
    const result = validateOptional(userSchema, { name: 'Ada', tags: [1] });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe('tags[0]');
  });

  it('inherits the async guard', () => {
    expect(() => validateOptional(asyncSchema('arktype-async'), 'x')).toThrow(/arktype-async/);
  });

  it('does not reach for the schema when there is none', () => {
    const validate = vi.fn(() => ({ value: 'used' }));
    const spySchema: StandardSchemaV1<unknown, string> = {
      '~standard': { version: 1, vendor: 'spy', validate },
    };

    validateOptional(undefined, 'value');
    expect(validate).not.toHaveBeenCalled();

    validateOptional(spySchema, 'value');
    expect(validate).toHaveBeenCalledTimes(1);
  });
});
