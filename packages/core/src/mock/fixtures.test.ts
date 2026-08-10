import { resolveEnvelope } from '../adapter';
import { validateSync } from '../validate';
import { confirmationPayloadSchema } from '../widgets/confirmation';
import { sampleConversation, textMessage, widgetMessage } from './fixtures';

describe('widgetMessage', () => {
  it('defaults version, role and id, and wraps the payload in an envelope', () => {
    const message = widgetMessage({ type: 'confirmation', payload: { title: 'Ship it?' } });

    expect(message.role).toBe('assistant');
    expect(message.widget).toEqual({
      type: 'confirmation',
      version: '1.0.0',
      payload: { title: 'Ship it?' },
    });
    expect(String(message.id)).toMatch(/^mock-confirmation-\d+$/);
  });

  it('gives every generated message a distinct id', () => {
    const ids = [
      widgetMessage({ type: 'confirmation', payload: {} }).id,
      widgetMessage({ type: 'confirmation', payload: {} }).id,
      textMessage({ text: 'a' }).id,
    ];

    expect(new Set(ids).size).toBe(3);
  });

  it('honours an explicit id and version', () => {
    const message = widgetMessage({ id: 7, type: 'poll', version: '2.1.0', payload: {} });

    expect(message.id).toBe(7);
    expect(message.widget?.version).toBe('2.1.0');
  });

  it('omits state entirely when none was asked for', () => {
    const message = widgetMessage({ type: 'confirmation', payload: { title: 'x' } });

    // Not `state: undefined`: a persisted transcript round-trips through JSON, which drops the key.
    expect(message.widget).not.toHaveProperty('state');
  });

  it('carries state when supplied, including a falsy one', () => {
    const message = widgetMessage({ type: 'confirmation', payload: {}, state: null });

    expect(message.widget?.state).toBeNull();
  });

  it('borrows the payload prose for the fallback text', () => {
    expect(widgetMessage({ type: 'confirmation', payload: { title: 'Archive it?' } }).text).toBe(
      'Archive it?',
    );
    expect(widgetMessage({ type: 'text', payload: { content: 'hello' } }).text).toBe('hello');
  });

  it('prefers explicit text over anything derived from the payload', () => {
    const message = widgetMessage({
      type: 'confirmation',
      payload: { title: 'Archive it?' },
      text: 'The assistant asked you to confirm.',
    });

    expect(message.text).toBe('The assistant asked you to confirm.');
  });

  it.each([
    ['a payload with no prose', { count: 3 }],
    ['a blank title', { title: '   ' }],
    ['a non-string title', { title: 42 }],
    ['an array payload', ['nope']],
    ['a null payload', null],
  ])('names the widget type when the text cannot be derived from %s', (_case, payload) => {
    // `text` is required and load-bearing (ADR 0012); an empty one renders as a blank transcript
    // line and looks like a broken degradation chain rather than a thin fixture.
    expect(widgetMessage({ type: 'poll', payload }).text).toBe('[poll widget]');
  });
});

describe('textMessage', () => {
  it('defaults to an assistant message with no widget', () => {
    const message = textMessage({ text: 'plain prose' });

    expect(message.role).toBe('assistant');
    expect(message.text).toBe('plain prose');
    expect(message).not.toHaveProperty('widget');
  });

  it('takes a role and an id', () => {
    const message = textMessage({ id: 'u1', role: 'user', text: 'Archive it' });

    expect(message).toEqual({ id: 'u1', role: 'user', text: 'Archive it' });
  });

  it('resolves through the synthesised text envelope, like any real plain message', () => {
    const envelope = resolveEnvelope(textMessage({ text: 'plain prose' }));

    expect(envelope).toEqual({
      type: 'text',
      version: '1.0.0',
      payload: { content: 'plain prose' },
      state: {},
    });
  });
});

describe('sampleConversation', () => {
  it('is frozen, so a story cannot mutate the fixture other stories share', () => {
    expect(Object.isFrozen(sampleConversation)).toBe(true);
  });

  it('gives every message a stable, unique id and non-empty text', () => {
    const ids = sampleConversation.map((message) => message.id);

    expect(ids).toEqual(['sample-1', 'sample-2', 'sample-3', 'sample-4', 'sample-5']);
    for (const message of sampleConversation) {
      expect(message.text.trim()).not.toBe('');
    }
  });

  it('carries exactly one widget, and its payload satisfies the registered schema', () => {
    const widgets = sampleConversation.filter((message) => message.widget);
    expect(widgets).toHaveLength(1);

    const envelope = widgets[0]?.widget;
    expect(envelope?.type).toBe('confirmation');
    expect(envelope?.version).toBe('1.0.0');

    // A fixture whose payload fails its own widget's schema would demo the fallback, not the widget.
    const outcome = validateSync(confirmationPayloadSchema, envelope?.payload);
    expect(outcome.ok).toBe(true);
  });

  it('leaves the confirmation unanswered so the default story has something to click', () => {
    expect(sampleConversation[2]?.widget).not.toHaveProperty('state');
  });
});
