import { describe, expect, it } from 'vitest';

import type { NereyErrorCode } from './types';

import {
  NereyError,
  invalidPayloadError,
  invalidStateError,
  isNereyError,
  persistenceError,
  unknownWidgetError,
  widgetRenderError,
} from './errors';

const COORDS = { messageId: 'msg-7', widgetType: 'confirmation', widgetVersion: '1.0.0' };

const ISSUES = [
  { path: 'title', message: '`title` is required.' },
  { path: 'items[0].qty', message: 'Expected a number.' },
];

describe('NereyError', () => {
  it('is a real Error with its own name', () => {
    const error = new NereyError({ code: 'persistence', message: 'boom' });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(NereyError);
    expect(error.name).toBe('NereyError');
    expect(error.message).toBe('boom');
  });

  it('carries every coordinate it was given', () => {
    const error = new NereyError({ code: 'invalid-payload', message: 'nope', ...COORDS, issues: ISSUES });

    expect(error.code).toBe('invalid-payload');
    expect(error.widgetType).toBe('confirmation');
    expect(error.widgetVersion).toBe('1.0.0');
    expect(error.messageId).toBe('msg-7');
    expect(error.issues).toBe(ISSUES);
  });

  it('leaves omitted coordinates undefined rather than inventing them', () => {
    const error = new NereyError({ code: 'widget-render', message: 'nope' });

    expect(error.widgetType).toBeUndefined();
    expect(error.widgetVersion).toBeUndefined();
    expect(error.messageId).toBeUndefined();
    expect(error.issues).toBeUndefined();
  });

  it('accepts a numeric messageId, because a transcript may key on one', () => {
    expect(new NereyError({ code: 'persistence', message: 'x', messageId: 42 }).messageId).toBe(42);
  });

  it('routes `cause` through ErrorOptions so it lands on the native property', () => {
    const cause = new Error('socket closed');
    const error = new NereyError({ code: 'persistence', message: 'nope', cause });

    expect(error.cause).toBe(cause);
    // Redeclaring `cause` as a class field would shadow the one Error already owns and break
    // cause walking; reading it back by identity is what pins that down.
    expect(Object.hasOwn(error, 'cause')).toBe(true);
  });

  it('accepts a non-Error cause', () => {
    const error = new NereyError({ code: 'widget-render', message: 'nope', cause: 'a string' });

    expect(error.cause).toBe('a string');
  });

  it('sets no cause at all when none was supplied', () => {
    const error = new NereyError({ code: 'widget-render', message: 'nope' });

    expect(error.cause).toBeUndefined();
    expect(Object.hasOwn(error, 'cause')).toBe(false);
  });

  it('is throwable and catchable as an Error', () => {
    expect(() => {
      throw new NereyError({ code: 'unknown-widget', message: 'thrown' });
    }).toThrow(/thrown/);
  });
});

describe('unknownWidgetError', () => {
  it('names the widget it could not resolve', () => {
    const error = unknownWidgetError('chart', '2.0.0');

    expect(error.code).toBe('unknown-widget');
    expect(error.message).toContain('`chart@2.0.0`');
    expect(error.widgetType).toBe('chart');
    expect(error.widgetVersion).toBe('2.0.0');
  });

  it('points at the version-mismatch trap instead of stopping at "not registered"', () => {
    // This is the single most useful diagnostic in the library: resolution is an exact match
    // (ADR 0009), so the overwhelmingly likely cause of an unknown widget is a version string
    // that reads as equivalent to a human and is not. The message has to say so.
    const message = unknownWidgetError('chart', '1.0').message;

    expect(message).toMatch(/exact match/);
    expect(message).toMatch(/version mismatch/);
    expect(message).toMatch(/"1\.0" against "1\.0\.0"/);
    expect(message).toMatch(/ADR 0009/);
  });

  it('carries the messageId when the caller knows it', () => {
    expect(unknownWidgetError('chart', '2.0.0', 'msg-7').messageId).toBe('msg-7');
    expect(unknownWidgetError('chart', '2.0.0', 0).messageId).toBe(0);
  });

  it('omits the messageId when the caller does not', () => {
    expect(unknownWidgetError('chart', '2.0.0').messageId).toBeUndefined();
  });
});

describe('invalidPayloadError', () => {
  it('summarises the issues in the message and keeps them structured', () => {
    const error = invalidPayloadError(COORDS, ISSUES);

    expect(error.code).toBe('invalid-payload');
    expect(error.message).toContain('title: `title` is required.');
    expect(error.message).toContain('items[0].qty: Expected a number.');
    expect(error.message).toContain(';');
    expect(error.issues).toBe(ISSUES);
  });

  it('omits the empty path of a root-level issue', () => {
    const error = invalidPayloadError({}, [{ path: '', message: 'Expected an object.' }]);

    expect(error.message).toContain('Expected an object.');
    expect(error.message).not.toContain(': Expected');
  });

  it('says so when the schema supplied no detail', () => {
    expect(invalidPayloadError({}, []).message).toContain('no issue detail supplied by the schema');
  });

  it('identifies the widget through its coordinates, not through the prose', () => {
    // The message describes the failure; `widgetType`/`widgetVersion`/`messageId` say which
    // widget it happened to. A host formatting `onWidgetError` output has to read both.
    const error = invalidPayloadError(COORDS, ISSUES);

    expect(error.widgetType).toBe('confirmation');
    expect(error.widgetVersion).toBe('1.0.0');
    expect(error.messageId).toBe('msg-7');
  });
});

describe('invalidStateError', () => {
  it('distinguishes persisted state from model payload in both code and message', () => {
    const error = invalidStateError(COORDS, ISSUES);

    expect(error.code).toBe('invalid-state');
    expect(error.message).toMatch(/^Persisted widget state failed validation/);
    expect(error.message).toContain('title: `title` is required.');
    expect(error.issues).toBe(ISSUES);
    expect(error.widgetType).toBe('confirmation');
  });

  it('says so when the schema supplied no detail', () => {
    expect(invalidStateError({}, []).message).toContain('no issue detail supplied by the schema');
  });
});

describe('widgetRenderError', () => {
  it('quotes the thrown error message and keeps the original as the cause', () => {
    const cause = new TypeError('cannot read properties of undefined');
    const error = widgetRenderError(COORDS, cause);

    expect(error.code).toBe('widget-render');
    expect(error.message).toContain('cannot read properties of undefined');
    expect(error.cause).toBe(cause);
    expect(error.widgetType).toBe('confirmation');
    expect(error.messageId).toBe('msg-7');
  });

  it.each<[string, unknown, string]>([
    ['a string', 'plain string throw', 'plain string throw'],
    ['a number', 500, '500'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['an object', { toString: () => 'weird' }, 'weird'],
  ])('stringifies a non-Error throw (%s)', (_label, cause, expected) => {
    // React boundaries hand back whatever the component threw, and a component can throw
    // anything at all. Losing it to "[object Object]" would cost the only clue there is.
    const error = widgetRenderError({}, cause);

    expect(error.message).toContain(expected);
    expect(error.cause).toBe(cause);
  });
});

describe('persistenceError', () => {
  it('explains why the widget must not re-enable itself', () => {
    const cause = new Error('offline');
    const error = persistenceError(COORDS, cause);

    expect(error.code).toBe('persistence');
    expect(error.message).toContain('offline');
    expect(error.message).toMatch(/must not re-enable/);
    expect(error.message).toMatch(/already in the transcript/);
    expect(error.message).toMatch(/ADR 0016/);
    expect(error.cause).toBe(cause);
    expect(error.widgetType).toBe('confirmation');
  });

  it('stringifies a non-Error cause', () => {
    expect(persistenceError({}, 'quota exceeded').message).toContain('quota exceeded');
  });
});

describe('the taxonomy is closed', () => {
  it('produces exactly the five declared codes', () => {
    const codes: NereyErrorCode[] = [
      unknownWidgetError('a', '1.0.0').code,
      invalidPayloadError({}, []).code,
      invalidStateError({}, []).code,
      widgetRenderError({}, new Error('x')).code,
      persistenceError({}, new Error('x')).code,
    ];

    expect(codes).toEqual([
      'unknown-widget',
      'invalid-payload',
      'invalid-state',
      'widget-render',
      'persistence',
    ]);
  });
});

describe('isNereyError', () => {
  it('is true for anything the taxonomy produced', () => {
    expect(isNereyError(new NereyError({ code: 'persistence', message: 'x' }))).toBe(true);
    expect(isNereyError(unknownWidgetError('a', '1.0.0'))).toBe(true);
    expect(isNereyError(widgetRenderError({}, new Error('x')))).toBe(true);
  });

  it.each<[string, unknown]>([
    ['a plain Error', new Error('boom')],
    ['a TypeError', new TypeError('boom')],
    ['a structurally identical plain object', { code: 'persistence', message: 'x', name: 'NereyError' }],
    ['a string', 'unknown-widget'],
    ['null', null],
    ['undefined', undefined],
  ])('is false for %s', (_label, value) => {
    expect(isNereyError(value)).toBe(false);
  });

  it('narrows the value for the caller', () => {
    const thrown: unknown = invalidPayloadError(COORDS, ISSUES);

    if (!isNereyError(thrown)) throw new Error('expected a NereyError');
    // Reaching `.code` and `.issues` without a cast is the whole point of the guard.
    expect(thrown.code).toBe('invalid-payload');
    expect(thrown.issues).toHaveLength(2);
  });
});
