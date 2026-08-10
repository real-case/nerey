import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import {
  TEXT_WIDGET_TYPE,
  WidgetRenderer,
  asAnyWidget,
  builtInWidgets,
  composeRegistries,
} from '@nerey/core';
import type { FallbackRenderer, NereyMessage, WidgetStatus } from '@nerey/core';
import { MockWidgetHost, textMessage, widgetMessage } from '@nerey/core/mock';

import { textWidget } from './index';

/**
 * ADR 0035 — the composition this widget exists for. Core's `text@1.0.0` is registered first and
 * the theme's is registered over it, which is what `{ override: true }` is for: same key, one
 * winner, no fork. Without the override this throws on a duplicate registration, which is the
 * intended failure — replacing a built-in should be a decision, not an accident of array order.
 *
 * Built once at module scope. A registry rebuilt per render would hand `MockWidgetHost` a new
 * identity every pass and re-render every widget in the transcript for nothing.
 */
const registry = composeRegistries({ override: true }, builtInWidgets, [asAnyWidget(textWidget)]);

/**
 * A stand-in for the markdown pipeline the HOST injects (ADR 0012 / 0037). The theme ships none —
 * that is the whole point of the widget — so a story that wants to show prose has to play the
 * consumer's part and supply one.
 *
 * Block-level only, and deliberately crude: paragraphs, one heading level, dash lists and fenced
 * code. It exists to prove the stylesheet dresses arbitrary consumer markup, not to be a markdown
 * implementation anybody should copy.
 */
function renderProse(text: string, context: { messageId: string | number }): ReactNode {
  if (text === '') return null;

  return text.split(/\n{2,}/).map((block, index) => {
    const key = `${context.messageId}-${index}`;
    const lines = block.split('\n');

    if (block.startsWith('## ')) return <h2 key={key}>{block.slice(3)}</h2>;

    if (block.startsWith('```')) {
      return (
        <pre key={key}>
          <code>{lines.slice(1, -1).join('\n')}</code>
        </pre>
      );
    }

    if (lines.every((line) => line.startsWith('- '))) {
      return (
        <ul key={key}>
          {lines.map((line, item) => (
            <li key={`${key}-${item}`}>{line.slice(2)}</li>
          ))}
        </ul>
      );
    }

    return <p key={key}>{block}</p>;
  });
}

type StoryArgs = {
  message: NereyMessage;
  status?: WidgetStatus;
  readonly?: boolean;
  /** Left unset for the identity renderer core defaults to — plain text, always readable. */
  renderFallback?: FallbackRenderer;
};

/**
 * No `component` on the meta. A widget is not rendered by calling its component — it is resolved
 * out of a registry and rendered through `WidgetRenderer` (ADR 0009 / 0012), and that whole chain
 * is what these stories have to prove. Naming the component here would additionally fold its
 * props into the args type, which is not what a story of this shape controls.
 */
const meta = {
  title: 'Widgets/Text',
  parameters: { layout: 'padded' },
  // A transcript column, not a full-width page. Prose measured across a 1600px viewport reads
  // badly and, more to the point, would never overflow — so the wrapping story below would pass
  // while proving nothing.
  decorators: [
    (Story) => (
      <div style={{ maxInlineSize: '30rem' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    message: textMessage({
      id: 'text-default',
      text: 'Archived. You can restore it from Reports → Archived for the next 30 days.',
    }),
  },
  render: (args) => (
    <MockWidgetHost registry={registry} conversationId="story" renderFallback={args.renderFallback}>
      <WidgetRenderer message={args.message} status={args.status} readonly={args.readonly} />
    </MockWidgetHost>
  ),
} satisfies Meta<StoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A message with no widget envelope at all. `resolveEnvelope` synthesises `text@1.0.0` for it
 * (ADR 0008), so every ordinary assistant turn in the transcript arrives through this widget —
 * which is why the override has to keep the built-in's exact coordinates.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector('[data-nerey-widget="text"]');
    await expect(root).not.toBeNull();
    await expect(root).toHaveAttribute('data-nerey-version', '1.0.0');
    await expect(root).toHaveAttribute('data-nerey-status', 'ready');
    // No `data-state`: this widget has no state machine, and claiming `idle` would promise a
    // transition that never arrives.
    await expect(root).not.toHaveAttribute('data-state');
  },
};

/**
 * The stylesheet doing its actual job: heading, list and code block emitted by the host's
 * renderer and dressed by the theme, with no class name shared between the two.
 */
export const Prose: Story = {
  args: {
    renderFallback: renderProse,
    message: textMessage({
      id: 'text-prose',
      text: [
        '## What I changed',
        'Two files, both under `packages/theme`. Nothing in core moved.',
        '- Registered the styled `text` entry over the built-in\n- Left the payload shape untouched',
        '```\ncomposeRegistries({ override: true }, builtInWidgets, themeWidgets)\n```',
      ].join('\n\n'),
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'What I changed' })).toBeVisible();
    await expect(canvas.getAllByRole('listitem')).toHaveLength(2);
  },
};

/**
 * The regression this widget's CSS exists for. A pasted URL is one unbreakable word, and
 * `overflow-wrap: anywhere` is what keeps it from widening the whole transcript — `break-word`
 * only relents after the line has already overflowed.
 */
export const LongUnbrokenString: Story = {
  args: {
    message: textMessage({
      id: 'text-url',
      text: 'https://example.com/reports/2026/q3-incident-review?share=aH1kZXBsb3ltZW50LXJvbGxiYWNrLXBvc3QtbW9ydGVt&expires=1799999999&signature=6f4c1b9e2d7a05c3',
    }),
  },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector<HTMLElement>('[data-nerey-widget="text"]');
    await expect(root).not.toBeNull();
    if (!root) return;
    // The honest assertion is about layout rather than about a declaration: the URL must not
    // extend past the box it was given, however that is achieved.
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  },
};

/**
 * ADR 0019 — mid-stream the payload is partial and never validated, so `content` can be missing
 * entirely. The widget renders the empty string rather than handing `undefined` to consumer code.
 */
export const Streaming: Story = {
  args: {
    status: 'streaming',
    message: widgetMessage({
      id: 'text-streaming',
      type: TEXT_WIDGET_TYPE,
      payload: {},
      text: 'Looking that up…',
    }),
  },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector('[data-nerey-widget="text"]');
    await expect(root).toHaveAttribute('data-nerey-status', 'streaming');
    await expect(root).toBeEmptyDOMElement();
  },
};

/** A legitimately empty assistant turn. It validates, and it must not become an error. */
export const Empty: Story = {
  args: { message: textMessage({ id: 'text-empty', text: '' }) },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector('[data-nerey-widget="text"]');
    await expect(root).not.toBeNull();
    // Not a fallback: an empty message is valid, so nothing in the chain degraded.
    await expect(canvasElement.querySelector('[data-nerey-fallback]')).toBeNull();
  },
};

/**
 * A replayed or disabled transcript. Text has no interactivity to withdraw, so `readonly` is
 * carried on the root as information for a consumer's CSS and nothing else (ADR 0020).
 */
export const ReadOnly: Story = {
  args: { readonly: true },
  play: async ({ canvasElement }) => {
    const root = canvasElement.querySelector('[data-nerey-widget="text"]');
    await expect(root).toHaveAttribute('data-readonly', '');
  },
};
