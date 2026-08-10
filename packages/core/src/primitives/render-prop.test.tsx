import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactElement } from 'react';

import { renderWith } from './render-prop';
import type { RenderProp } from './render-prop';

type Bag = Record<string, unknown>;

function fallback(props: Bag): ReactElement {
  return <div {...props} />;
}

/** Renders through `renderWith` and returns the node, whichever element ended up carrying it. */
function mount(renderProp: RenderProp<Bag> | undefined, props: Bag = {}): HTMLElement {
  render(renderWith(renderProp, { 'data-testid': 'node', ...props }, fallback));
  return screen.getByTestId('node');
}

/** A component that accepts anything, so props with no DOM meaning survive to be inspected. */
const probeProps: Bag[] = [];
function Probe(props: Bag): ReactElement {
  probeProps.push(props);
  return <div data-testid="node" />;
}

describe('renderWith without a render prop', () => {
  it('renders the fallback with the props untouched', () => {
    const node = mount(undefined, { 'data-nerey-part': 'label', title: 'ours' });

    expect(node.tagName).toBe('DIV');
    expect(node).toHaveAttribute('data-nerey-part', 'label');
    expect(node).toHaveAttribute('title', 'ours');
  });

  it('passes children through to the fallback', () => {
    const node = mount(undefined, { children: 'transcript text' });

    expect(node).toHaveTextContent('transcript text');
  });
});

describe('renderWith with a function', () => {
  it('hands the merged props to the call site rather than spreading them itself', () => {
    const seen: Bag[] = [];

    render(
      renderWith(
        (props) => {
          seen.push(props);
          // The call site decides what to spread — here, everything but the title.
          const { title: _title, ...rest } = props;
          return <section {...(rest as ComponentProps<'section'>)} />;
        },
        { 'data-testid': 'node', 'data-nerey-slot': 'message', title: 'dropped' },
        fallback,
      ),
    );
    const node = screen.getByTestId('node');

    expect(seen).toEqual([{ 'data-testid': 'node', 'data-nerey-slot': 'message', title: 'dropped' }]);
    expect(node.tagName).toBe('SECTION');
    expect(node).toHaveAttribute('data-nerey-slot', 'message');
    expect(node).not.toHaveAttribute('title');
  });

  it('does not call the fallback as well', () => {
    const fallbackSpy = vi.fn(fallback);

    render(renderWith(() => <span data-testid="node" />, { a: 1 }, fallbackSpy));

    expect(fallbackSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('node').tagName).toBe('SPAN');
  });
});

describe('renderWith with an element', () => {
  it('substitutes the element and keeps the contract attributes on it', () => {
    const node = mount(<section lang="en" />, {
      'data-nerey-widget': 'poll',
      'data-state': 'idle',
    });

    expect(node.tagName).toBe('SECTION');
    expect(node).toHaveAttribute('data-nerey-widget', 'poll');
    expect(node).toHaveAttribute('data-state', 'idle');
    expect(node).toHaveAttribute('lang', 'en');
  });

  it('works on an element carrying no props at all', () => {
    const node = mount(<span />, { 'data-nerey-part': 'label' });

    expect(node.tagName).toBe('SPAN');
    expect(node).toHaveAttribute('data-nerey-part', 'label');
  });

  it('concatenates className, ours first', () => {
    const node = mount(<div className="consumer" />, { className: 'nerey' });

    expect(node.getAttribute('class')).toBe('nerey consumer');
  });

  it.each([
    ['only ours', { className: 'nerey' }, <div key="a" />, 'nerey'],
    ['only theirs', {}, <div key="b" className="consumer" />, 'consumer'],
    ['theirs explicitly undefined', { className: 'nerey' }, <div key="c" className={undefined} />, 'nerey'],
  ] as const)('merges className when there is %s', (_label, ours, element, expected) => {
    const node = mount(element, ours);

    expect(node.getAttribute('class')).toBe(expected);
  });

  it('leaves no class attribute when neither side supplies one', () => {
    const node = mount(<div className="" />, {});

    expect(node).not.toHaveAttribute('class');
  });

  it('merges style per property, with the caller overriding only what they name', () => {
    const node = mount(<div style={{ color: 'rgb(0, 0, 255)' }} />, {
      style: { color: 'rgb(255, 0, 0)', marginTop: '4px' },
    });

    expect(node.style.color).toBe('rgb(0, 0, 255)');
    expect(node.style.marginTop).toBe('4px');
  });

  it.each([
    ['ours is absent', {}, { color: 'rgb(0, 0, 255)' }],
    ['theirs is absent', { color: 'rgb(0, 0, 255)' }, undefined],
  ] as const)('keeps the surviving style object when %s', (_label, ours, theirs) => {
    const node = mount(<div style={theirs} />, { style: ours });

    expect(node.style.color).toBe('rgb(0, 0, 255)');
  });

  it('runs both handlers, ours first', async () => {
    const order: string[] = [];
    const node = mount(<button type="button" onClick={() => order.push('theirs')} />, {
      onClick: () => order.push('ours'),
    });

    await userEvent.click(node);

    expect(order).toEqual(['ours', 'theirs']);
  });

  it('gives both handlers the same event', async () => {
    const ours = vi.fn();
    const theirs = vi.fn();
    const node = mount(<button type="button" onClick={theirs} />, { onClick: ours });

    await userEvent.click(node);

    expect(ours).toHaveBeenCalledTimes(1);
    expect(theirs).toHaveBeenCalledTimes(1);
    expect(ours.mock.calls[0]?.[0]).toBe(theirs.mock.calls[0]?.[0]);
  });

  it.each([
    ['only ours installed a handler', true, false],
    ['only theirs installed a handler', false, true],
  ] as const)('still fires when %s', async (_label, withOurs, withTheirs) => {
    const handler = vi.fn();
    const node = mount(
      <button type="button" onClick={withTheirs ? handler : undefined} />,
      withOurs ? { onClick: handler } : {},
    );

    await userEvent.click(node);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("lets the caller's explicit value win for everything that is not a class, style or handler", () => {
    const node = mount(<div title="theirs" id="theirs" />, { title: 'ours', id: 'ours' });

    expect(node).toHaveAttribute('title', 'theirs');
    expect(node.id).toBe('theirs');
  });

  it('does not treat an `on`-prefixed non-handler prop as a handler', () => {
    // `on` alone is not enough — a capital must follow. Ours is a function and theirs is not, so
    // handler treatment would keep ours; the ordinary rule keeps theirs, which is the correct one
    // for a prop that merely happens to start with `on`.
    render(renderWith(<Probe once="theirs" />, { once: () => undefined }, fallback));

    expect(probeProps.at(-1)?.['once']).toBe('theirs');
  });

  it('lets the caller replace the children they explicitly wrote', () => {
    const node = mount(<div>theirs</div>, { children: 'ours' });

    expect(node).toHaveTextContent('theirs');
  });

  it('passes our children into an element that declares none', () => {
    const node = mount(<section />, { children: 'ours' });

    expect(node).toHaveTextContent('ours');
  });

  it('preserves the element key so a substituted node stays reconcilable in a list', () => {
    const element = renderWith(<li key="k1" />, { 'data-nerey-part': 'option' }, fallback);

    expect(element.key).toBe('k1');
  });
});
