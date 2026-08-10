import * as React from 'react';

import type { Decorator, Preview } from '@storybook/react-vite';

// ADR 0031 — the workbench loads ONLY the token layer and the theme's own stylesheet. No
// host design system, no utility framework, no reset borrowed from an application. That is
// what makes a green story a truthful claim about the published package rather than about
// this repo's cascade.
import '../packages/theme/src/tokens.css';

type Theme = 'light' | 'dark';

/**
 * Writes the active theme to `data-nerey-theme` on the root (ADR 0027). The attribute — not a
 * class, and not a React context — is the whole theming mechanism, so exercising it here is
 * exercising the real contract.
 *
 * The cleanup restores the previous value rather than blindly removing the attribute, so a
 * dark story cannot leak into the next one during the browser-mode test run.
 *
 * The hook lives in a real component rather than directly in the decorator, and it is REACT's
 * `useEffect`, not the one from `storybook/preview-api`. Storybook's hooks are only valid when
 * called from a decorator or story function itself; called from a nested component they throw
 * "Storybook preview hooks can only be called inside decorators and story functions". Since
 * `ThemeFrame` is a genuine React component — which is what makes the rules-of-hooks lint happy
 * in the first place — React's own hook is the correct one.
 */
function ThemeFrame({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  React.useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-nerey-theme');
    root.setAttribute('data-nerey-theme', theme);
    return () => {
      if (previous === null) root.removeAttribute('data-nerey-theme');
      else root.setAttribute('data-nerey-theme', previous);
    };
  }, [theme]);

  return <>{children}</>;
}

const withTheme: Decorator = (Story, context) => (
  <ThemeFrame theme={(context.globals.theme ?? 'light') as Theme}>
    <Story />
  </ThemeFrame>
);

/**
 * A surface that paints the canvas token, so a story is judged against the background it will
 * actually sit on. Without it every story renders on Storybook's own white and dark-mode
 * contrast bugs stay invisible.
 */
const withCanvas: Decorator = (Story) => (
  <div
    style={{
      background: 'var(--nerey-surface-canvas, #fff)',
      color: 'var(--nerey-text-primary, #151d24)',
      fontFamily: 'var(--nerey-font-sans, system-ui, sans-serif)',
      fontSize: 'var(--nerey-font-size-md, 0.875rem)',
      lineHeight: 'var(--nerey-line-height-normal, 1.5)',
      padding: 'var(--nerey-space-6, 1.5rem)',
      minWidth: '20rem',
    }}
  >
    <Story />
  </div>
);

const preview: Preview = {
  decorators: [withCanvas, withTheme],
  tags: ['autodocs'],

  parameters: {
    layout: 'centered',
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/ } },

    // ADR 0032. The addon ships `test: 'todo'` (a warning); 'error' is opt-in and makes an
    // axe violation fail `vitest --project=storybook` and therefore CI.
    a11y: {
      test: 'error',
      options: {
        runOnly: {
          type: 'tag',
          // There is no `wcag22a` tag — WCAG 2.2 added AA and AAA criteria only.
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        },
        resultTypes: ['violations'],
      },
    },

    docs: { codePanel: true },
  },

  // `globalTypes[x].defaultValue` was removed in Storybook 9 — a toolbar global's default
  // lives here now.
  initialGlobals: {
    theme: 'light' satisfies Theme,
    a11y: { manual: false },
  },

  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'Sets data-nerey-theme on the document root (ADR 0027)',
      toolbar: {
        title: 'Theme',
        icon: 'contrast',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },
};

export default preview;
