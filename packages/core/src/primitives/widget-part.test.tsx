import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';

import type { NereyState } from '../data-attrs';
import { WidgetPart } from './widget-part';
import type { WidgetPartElement } from './widget-part';

function mount(ui: ReactElement): HTMLElement {
  const { container } = render(ui);
  const node = container.firstElementChild;
  if (!(node instanceof HTMLElement)) throw new Error('WidgetPart rendered no element');
  return node;
}

describe('WidgetPart attributes', () => {
  it('emits exactly data-nerey-part on a div by default', () => {
    const node = mount(<WidgetPart part="option" />);

    expect(node.tagName).toBe('DIV');
    expect(node.getAttributeNames()).toEqual(['data-nerey-part']);
    expect(node).toHaveAttribute('data-nerey-part', 'option');
  });

  it.each(['idle', 'selected', 'submitting', 'locked', 'expired', 'error'] satisfies NereyState[])(
    'adds data-state=%s alongside the part',
    (state) => {
      const node = mount(<WidgetPart part="option" state={state} />);

      expect(node.getAttributeNames().sort()).toEqual(['data-nerey-part', 'data-state']);
      expect(node).toHaveAttribute('data-state', state);
    },
  );

  it('omits data-state when the part has no state of its own', () => {
    expect(mount(<WidgetPart part="label" />)).not.toHaveAttribute('data-state');
  });

  it.each(['div', 'span', 'section', 'header', 'footer', 'ul', 'li', 'p'] satisfies WidgetPartElement[])(
    'renders as <%s> and still carries the part',
    (as) => {
      const node = mount(<WidgetPart part="option" as={as} state="selected" />);

      expect(node.tagName).toBe(as.toUpperCase());
      expect(node).toHaveAttribute('data-nerey-part', 'option');
      expect(node).toHaveAttribute('data-state', 'selected');
    },
  );
});

describe('WidgetPart content and styling hooks', () => {
  it('renders its children', () => {
    mount(
      <WidgetPart part="label">
        <span data-testid="child">yes</span>
      </WidgetPart>,
    );

    expect(screen.getByTestId('child')).toHaveTextContent('yes');
  });

  it('adds a consumer className without displacing the contract attributes', () => {
    const node = mount(<WidgetPart part="option" state="locked" className="row row--tight" />);

    expect(node.getAttribute('class')).toBe('row row--tight');
    expect(node.getAttributeNames().sort()).toEqual(['class', 'data-nerey-part', 'data-state']);
  });

  it('leaves no class or style attribute when neither prop is given', () => {
    const node = mount(<WidgetPart part="option" />);

    expect(node).not.toHaveAttribute('class');
    expect(node).not.toHaveAttribute('style');
  });

  it('applies an inline style', () => {
    const node = mount(<WidgetPart part="option" style={{ paddingLeft: '12px' }} />);

    expect(node.style.paddingLeft).toBe('12px');
  });
});

describe('WidgetPart render prop', () => {
  it('substitutes the element while keeping the attributes and the children', () => {
    const node = mount(
      <WidgetPart part="option" state="selected" as="li" render={<button type="button" />}>
        <span data-testid="child">Yes</span>
      </WidgetPart>,
    );

    expect(node.tagName).toBe('BUTTON');
    expect(node).toHaveAttribute('data-nerey-part', 'option');
    expect(node).toHaveAttribute('data-state', 'selected');
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it("keeps the caller's own handler working on the substituted element", async () => {
    const onClick = vi.fn();
    const node = mount(<WidgetPart part="option" render={<button type="button" onClick={onClick} />} />);

    await userEvent.click(node);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('merges the consumer className on the substituted element', () => {
    const node = mount(<WidgetPart part="option" className="nerey" render={<span className="theirs" />} />);

    expect(node.tagName).toBe('SPAN');
    expect(node.getAttribute('class')).toBe('nerey theirs');
  });

  it('gives a render function the attribute bag and ignores `as`', () => {
    const seen: Record<string, unknown>[] = [];

    render(
      <WidgetPart
        part="option"
        state="locked"
        as="li"
        className="nerey"
        render={(props) => {
          seen.push(props);
          return <section {...props} />;
        }}
      >
        text
      </WidgetPart>,
    );

    expect(seen).toEqual([
      {
        'data-nerey-part': 'option',
        'data-state': 'locked',
        className: 'nerey',
        children: 'text',
      },
    ]);
    expect(screen.getByText('text').tagName).toBe('SECTION');
  });

  it('omits className and style keys from the bag when they were never set', () => {
    const seen: Record<string, unknown>[] = [];

    render(
      <WidgetPart
        part="option"
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
