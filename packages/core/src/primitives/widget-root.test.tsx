import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

import type { NereyState } from '../data-attrs';
import type { WidgetStatus } from '../types';
import { WidgetRoot } from './widget-root';

function mount(ui: ReactElement): HTMLElement {
  const { container } = render(ui);
  const node = container.firstElementChild;
  if (!(node instanceof HTMLElement)) throw new Error('WidgetRoot rendered no element');
  return node;
}

const BASE = { type: 'poll', version: '1.0.0', slot: 'message', status: 'ready' } as const;

describe('WidgetRoot attributes', () => {
  it('emits exactly the identity and status attributes when nothing else is set', () => {
    const node = mount(<WidgetRoot {...BASE} />);

    expect(node.tagName).toBe('DIV');
    expect(node.getAttributeNames().sort()).toEqual([
      'data-nerey-slot',
      'data-nerey-status',
      'data-nerey-version',
      'data-nerey-widget',
    ]);
    expect(node).toHaveAttribute('data-nerey-widget', 'poll');
    expect(node).toHaveAttribute('data-nerey-version', '1.0.0');
    expect(node).toHaveAttribute('data-nerey-slot', 'message');
    expect(node).toHaveAttribute('data-nerey-status', 'ready');
  });

  it('carries the type only, so a version bump does not break a consumer selector', () => {
    const node = mount(<WidgetRoot {...BASE} version="2.0.0" />);

    expect(node).toHaveAttribute('data-nerey-widget', 'poll');
    expect(node).toHaveAttribute('data-nerey-version', '2.0.0');
  });

  it.each(['message', 'input', 'overlay'] as const)('reflects the %s slot', (slot) => {
    expect(mount(<WidgetRoot {...BASE} slot={slot} />)).toHaveAttribute('data-nerey-slot', slot);
  });

  it.each(['streaming', 'ready', 'error'] satisfies WidgetStatus[])('reflects the %s status', (status) => {
    expect(mount(<WidgetRoot {...BASE} status={status} />)).toHaveAttribute('data-nerey-status', status);
  });

  it.each(['idle', 'selected', 'submitting', 'locked', 'expired', 'error'] satisfies NereyState[])(
    'reflects the %s state',
    (state) => {
      expect(mount(<WidgetRoot {...BASE} state={state} />)).toHaveAttribute('data-state', state);
    },
  );

  it('omits data-state entirely when no state is supplied', () => {
    expect(mount(<WidgetRoot {...BASE} />)).not.toHaveAttribute('data-state');
  });

  it('writes data-readonly as a valueless attribute so `[data-readonly]` is the selector', () => {
    const node = mount(<WidgetRoot {...BASE} readonly />);

    expect(node).toHaveAttribute('data-readonly', '');
    expect(node.getAttribute('data-readonly')).toBe('');
  });

  it.each([
    ['false', false],
    ['undefined', undefined],
  ] as const)('omits data-readonly when readonly is %s', (_label, readonly) => {
    expect(mount(<WidgetRoot {...BASE} readonly={readonly} />)).not.toHaveAttribute('data-readonly');
  });
});

describe('WidgetRoot content and styling hooks', () => {
  it('renders its children', () => {
    mount(
      <WidgetRoot {...BASE}>
        <span data-testid="child">yes</span>
      </WidgetRoot>,
    );

    expect(screen.getByTestId('child')).toHaveTextContent('yes');
  });

  it('adds a consumer className alongside the contract attributes rather than instead of them', () => {
    const node = mount(<WidgetRoot {...BASE} state="locked" readonly className="card card--wide" />);

    expect(node.getAttribute('class')).toBe('card card--wide');
    expect(node.getAttributeNames().sort()).toEqual([
      'class',
      'data-nerey-slot',
      'data-nerey-status',
      'data-nerey-version',
      'data-nerey-widget',
      'data-readonly',
      'data-state',
    ]);
  });

  it('leaves no class or style attribute when neither prop is given', () => {
    const node = mount(<WidgetRoot {...BASE} />);

    expect(node).not.toHaveAttribute('class');
    expect(node).not.toHaveAttribute('style');
  });

  it('applies an inline style', () => {
    const node = mount(<WidgetRoot {...BASE} style={{ marginTop: '8px' }} />);

    expect(node.style.marginTop).toBe('8px');
  });
});

describe('WidgetRoot render prop', () => {
  it('substitutes the element while keeping every attribute and the children', () => {
    const node = mount(
      <WidgetRoot {...BASE} state="expired" readonly render={<section aria-label="poll" />}>
        <span data-testid="child">yes</span>
      </WidgetRoot>,
    );

    expect(node.tagName).toBe('SECTION');
    expect(node).toHaveAttribute('data-nerey-widget', 'poll');
    expect(node).toHaveAttribute('data-nerey-version', '1.0.0');
    expect(node).toHaveAttribute('data-nerey-slot', 'message');
    expect(node).toHaveAttribute('data-nerey-status', 'ready');
    expect(node).toHaveAttribute('data-state', 'expired');
    expect(node).toHaveAttribute('data-readonly', '');
    expect(node).toHaveAttribute('aria-label', 'poll');
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('merges the consumer className on the substituted element', () => {
    const node = mount(<WidgetRoot {...BASE} className="nerey" render={<article className="theirs" />} />);

    expect(node.tagName).toBe('ARTICLE');
    expect(node.getAttribute('class')).toBe('nerey theirs');
  });

  it('gives a render function the full attribute bag', () => {
    const seen: Record<string, unknown>[] = [];

    render(
      <WidgetRoot
        {...BASE}
        state="submitting"
        readonly
        className="nerey"
        render={(props) => {
          seen.push(props);
          return <aside {...props} />;
        }}
      >
        text
      </WidgetRoot>,
    );

    expect(seen).toEqual([
      {
        'data-nerey-widget': 'poll',
        'data-nerey-version': '1.0.0',
        'data-nerey-slot': 'message',
        'data-nerey-status': 'ready',
        'data-state': 'submitting',
        'data-readonly': '',
        className: 'nerey',
        children: 'text',
      },
    ]);
  });

  it('omits className and style keys from the bag when they were never set', () => {
    // A render function spreads this bag onto a foreign component; an undefined-valued key there
    // overwrites that component's own default instead of leaving it alone.
    const seen: Record<string, unknown>[] = [];

    render(
      <WidgetRoot
        {...BASE}
        render={(props) => {
          seen.push(props);
          return <div />;
        }}
      />,
    );

    expect(seen[0]).not.toHaveProperty('className');
    expect(seen[0]).not.toHaveProperty('style');
  });
});
