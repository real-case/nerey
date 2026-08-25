import { composeStories } from '@storybook/react-vite';
import { render } from '@testing-library/react';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import '../tokens.css';

/**
 * ADR 0042 — one reference image per story module, per colour scheme.
 *
 * The set is COMPUTED from the story files rather than listed here, for the same reason the commit
 * gate computes its scope vocabulary from `workspaces` (ADR 0036): a hand-maintained list is the
 * part that rots, because adding a component does not touch it. A new component arrives with no
 * reference image and the gate goes red until somebody produces one, which is the correct default
 * — the alternative is a component nothing has ever looked at.
 *
 * The FIRST story of each module is the one captured. Story order in a CSF file is authored order,
 * and the first export is by convention the canonical rendering; capturing all 352 would multiply
 * the reference set by six and catch very little more, since the later stories mostly vary state
 * that the interaction tests already assert (ADR 0031).
 */
const storyModules: Record<string, unknown> = import.meta.glob(
  ['../components/*/*.stories.tsx', '../widgets/*/*.stories.tsx'],
  { eager: true },
);

const THEMES = ['light', 'dark'] as const;

/**
 * `data-nerey-theme` on the root is the whole theming mechanism (ADR 0027) — not a class, not a
 * context — so setting the attribute is exercising the real contract rather than a test-only path.
 */
function setTheme(theme: (typeof THEMES)[number]): void {
  document.documentElement.setAttribute('data-nerey-theme', theme);
}

/**
 * Transitions and animations are the one source of genuine flake here: a screenshot taken while a
 * popup is 40% through its fade differs from the same screenshot taken at 60%. Killing them makes
 * the capture a function of the DOM and the stylesheet, which is what is being versioned.
 */
const FREEZE_MOTION = `
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`;

function frameStyle(): Record<string, string> {
  // The same canvas the workbench paints (see .storybook/preview.tsx). Without it every component
  // is judged against the browser's white, and a dark-mode regression is invisible.
  return {
    background: 'var(--nerey-surface-canvas, #fff)',
    color: 'var(--nerey-text-primary, #151d24)',
    fontFamily: 'var(--nerey-font-sans, system-ui, sans-serif)',
    fontSize: 'var(--nerey-font-size-md, 0.875rem)',
    lineHeight: 'var(--nerey-line-height-normal, 1.5)',
    padding: 'var(--nerey-space-6, 1.5rem)',
    width: '40rem',
  };
}

/**
 * `../components/button/button.stories.tsx` → `components-button`;
 * `../components/input/textarea.stories.tsx` → `components-input-textarea`.
 *
 * The file basename is part of the name, not just the directory, because a directory can hold more
 * than one story module — `components/input` has `input` and `textarea`, `components/field` has
 * `field` and `form`. Naming by directory alone made two pairs collide, and a collision here is
 * silent in the worst way: one module overwrites the other's reference and the overwritten
 * component is never actually compared against anything.
 */
function nameOf(modulePath: string): string {
  const match = modulePath.match(/\.\.\/(components|widgets)\/([^/]+)\/([^/]+)\.stories\.tsx$/);
  if (!match) return modulePath.replace(/[^a-z0-9]+/gi, '-');
  const [, group, directory, file] = match;
  return file === directory ? `${group}-${directory}` : `${group}-${directory}-${file}`;
}

const cases = Object.entries(storyModules)
  .map(([modulePath, module]) => {
    const composed = composeStories(module as Parameters<typeof composeStories>[0]);
    const [first] = Object.entries(composed);
    return first ? { name: nameOf(modulePath), Story: first[1] } : null;
  })
  .filter((entry): entry is { name: string; Story: React.ComponentType } => entry !== null)
  // Sorted: the reference set must not depend on the order the glob happened to resolve in
  // (ADR 0033).
  .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

afterEach(() => {
  document.documentElement.removeAttribute('data-nerey-theme');
});

describe('the theme renders as it did last time', () => {
  it('has a story module to capture', () => {
    // A glob that silently matched nothing would make every assertion below vacuous, and the suite
    // would pass by describing zero components.
    expect(cases.length).toBeGreaterThan(20);
  });

  it('gives every capture a distinct name', () => {
    // Two modules resolving to one name is silent: the second overwrites the first's reference, and
    // whichever component lost is compared against a picture of the other one. This caught exactly
    // that when the name was the directory alone.
    const names = cases.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const { name, Story } of cases) {
    for (const theme of THEMES) {
      it(`${name} — ${theme}`, async () => {
        setTheme(theme);

        const style = document.createElement('style');
        style.textContent = FREEZE_MOTION;
        document.head.append(style);

        const { container } = render(
          <div data-visual-frame style={frameStyle()}>
            <Story />
          </div>,
        );

        const frame = container.querySelector('[data-visual-frame]');
        expect(frame).not.toBeNull();

        await expect.element(page.elementLocator(frame as HTMLElement)).toMatchScreenshot(`${name}-${theme}`);

        style.remove();
      });
    }
  }
});
