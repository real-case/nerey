#!/usr/bin/env node
// scripts/check-stories.mjs
//
// ADR 0031 — the story gate. Storybook is not a gallery in this repository: every story is a
// browser-mode Vitest case and an axe subject (ADR 0032), so an unstoried component is a
// component nothing ever renders, and a CSF 2 story is one no gate can read.
//
// Coverage (packages/theme/src/components/** and packages/theme/src/widgets/**):
//
//   missing-stories          a directory that exports a React component but has no colocated
//                            `*.stories.tsx`.
//
// Conformance (every `*.stories.ts(x)` and `*.mdx` under packages/*/src):
//
//   csf2-forbidden           `Template.bind({})` or `storiesOf(`.
//   mdx-defines-story        an `<Story>` in MDX carrying `play`, `render` or inline children.
//   missing-default-export   a stories module with no `meta`.
//   missing-title            a `meta` with no explicit `title`.
//   wrong-test-import        `@storybook/test` instead of `storybook/test`.
//
// Advisory:
//
//   interactive-without-play a stories file under a control-shaped directory with no `play:`
//                            in any story. WARNING, not an error — see the summary text below.
//
// "Exports a React component" is decided structurally, not by types: a `.tsx` that is neither
// a test nor a story and that exports a `function` or `const` whose name starts uppercase.
// SCREAMING_SNAKE_CASE is excluded because a lookup table is not a component, and treating one
// as a component would demand a story for every constants module — the fastest way to get a
// gate switched off.
//
// Usage:
//   node scripts/check-stories.mjs
//   node scripts/check-stories.mjs --root <dir>   scan a fixture tree instead of the repo
//   node scripts/check-stories.mjs --self-test    plant a violator per rule, assert each fires

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, relative, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

/** Roots whose sub-directories owe a colocated story file. Missing roots are simply skipped. */
const COVERAGE_ROOTS = ['packages/theme/src/components', 'packages/theme/src/widgets'];

/**
 * Path segments that mark a component as interactive. This is a heuristic on purpose: it is
 * cheap, needs no registry lookup, and its false positives cost a warning rather than a build.
 */
const INTERACTIVE_SEGMENTS = new Set([
  'button',
  'input',
  'select',
  'menu',
  'dialog',
  'toggle',
  'checkbox',
  'radio',
  'switch',
  'slider',
  'combobox',
  'tabs',
  'accordion',
  'collapsible',
  'widgets',
]);

const COMPONENT_EXPORT_RE =
  /\bexport\s+(?:default\s+)?function\s+([A-Z][\w$]*)|\bexport\s+(?:const|let|var)\s+([A-Z][\w$]*)/g;

const STORY_FILE_RE = /\.stories\.tsx?$/;
const NON_COMPONENT_TSX_RE = /\.(?:test|spec|stories)\.tsx$/;
const TEST_IMPORT_RE = /(['"])@storybook\/test(?:\/[^'"]*)?\1/g;

const posix = (p) => p.split(sep).join('/');
const relTo = (base, abs) => posix(relative(base, abs));
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * Blank out the CONTENT of comments and, optionally, of string and template literals,
 * replacing each character with a space so that every offset — and therefore every reported
 * line number — still matches the file on disk.
 *
 * Two variants are needed. Rules about *code* (`storiesOf(`, brace depth inside `meta`) must
 * not fire on a sentence in a docblock or on an example inside a string, so they read the
 * fully masked text. `wrong-test-import` is the opposite case: the evidence IS a string
 * literal, so it reads the comment-only mask and still ignores a commented-out import.
 *
 * Regular-expression literals are not tracked. A `/` followed by `/` inside one would be read
 * as a line comment; stories files do not contain regex literals, and the failure mode is a
 * missed report rather than a false one.
 */
function mask(source, blankStrings) {
  const out = [...source];
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === '/' && next === '/') {
      const stop = source.indexOf('\n', i);
      const end = stop === -1 ? source.length : stop;
      blank(i, end);
      i = end;
      continue;
    }

    if (ch === '/' && next === '*') {
      const stop = source.indexOf('*/', i + 2);
      const end = stop === -1 ? source.length : stop + 2;
      blank(i, end);
      i = end;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === ch) break;
        j++;
      }
      if (blankStrings) blank(i + 1, Math.min(j, source.length));
      i = Math.min(j + 1, source.length);
      continue;
    }

    i++;
  }

  return out.join('');
}

function walkFiles(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  // Sorted: ADR 0033 forbids output that depends on filesystem iteration order.
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function walkDirs(dir, out = []) {
  if (!existsSync(dir)) return out;
  out.push(dir);
  for (const entry of readdirSync(dir).sort()) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkDirs(full, out);
  }
  return out;
}

function directFiles(dir) {
  return readdirSync(dir)
    .sort()
    .map((name) => join(dir, name))
    .filter((full) => statSync(full).isFile());
}

/** Every `packages/<name>/src` that exists, sorted. A new package is picked up with no edit here. */
function packageSrcRoots(base) {
  const packagesDir = join(base, 'packages');
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir)
    .sort()
    .filter((name) => !name.startsWith('.') && name !== 'node_modules')
    .map((name) => join(packagesDir, name, 'src'))
    .filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
}

function componentExports(masked) {
  const found = [];
  for (const m of masked.matchAll(COMPONENT_EXPORT_RE)) {
    const name = m[1] ?? m[2];
    // `MAX_ROWS` / `VARIANT_CLASS` are tables, not components.
    if (name.includes('_') || (name.length > 1 && name === name.toUpperCase())) continue;
    found.push({ name, index: m.index });
  }
  return found;
}

/** The interactive segment that matched, so the warning can name it. `submit-button` counts. */
function interactiveSegment(dirRel) {
  for (const segment of dirRel.split('/')) {
    const lower = segment.toLowerCase();
    if (INTERACTIVE_SEGMENTS.has(lower)) return lower;
    for (const part of lower.split(/[-_.]/)) if (INTERACTIVE_SEGMENTS.has(part)) return part;
  }
  return null;
}

function matchBrace(masked, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i++) {
    if (masked[i] === '{') depth++;
    else if (masked[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Locate the object literal that becomes `meta`, in either CSF 3 shape: `const meta = {…}
 * satisfies Meta<…>; export default meta;` or a direct `export default {…}`.
 *
 * Returning null when neither shape is recognised is deliberate. `missing-title` would
 * otherwise fire on any hand-rolled meta it cannot parse, and a gate that over-fires on
 * unusual-but-legal code is the one people start passing `--no-verify` around.
 */
function findMetaRange(masked) {
  const starts = [];

  const named = masked.match(/\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;/);
  if (named) {
    const ident = named[1].replace(/\$/g, '\\$');
    const decl = masked.match(new RegExp(`\\b(?:const|let|var)\\s+${ident}\\b[^=\\n]*=\\s*\\{`));
    if (decl) starts.push(decl.index + decl[0].length - 1);
  }

  const inline = masked.match(/\bexport\s+default\s*\{/);
  if (inline) starts.push(inline.index + inline[0].length - 1);

  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const end = matchBrace(masked, start);
  return end === -1 ? null : { start, end };
}

/**
 * Depth is counted on the masked text (so a brace inside a string cannot unbalance it) while
 * the key itself is matched against the original, which keeps a quoted `'title':` visible.
 */
function hasTopLevelKey(source, masked, start, end, key) {
  const keyRe = new RegExp(`^['"]?${key}['"]?\\s*:`);
  let depth = 0;
  for (let i = start; i <= end; i++) {
    const ch = masked[i];
    if (ch === '{' || ch === '[' || ch === '(') {
      depth++;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      continue;
    }
    if (depth !== 1) continue;
    if (/[\w$]/.test(source[i - 1] ?? '')) continue;
    if (keyRe.test(source.slice(i, i + key.length + 4))) return true;
  }
  return false;
}

/** Read a JSX opening tag starting at `<Name`, tolerating `>` inside `{…}` expressions. */
function readJsxTag(source, tagStart, tagName) {
  const attrsFrom = tagStart + tagName.length + 1;
  let depth = 0;
  for (let i = attrsFrom; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) {
      const selfClosing = source[i - 1] === '/';
      const attrs = source.slice(attrsFrom, selfClosing ? i - 1 : i);
      const close = source.indexOf(`</${tagName}>`, i + 1);
      const children = selfClosing || close === -1 ? '' : source.slice(i + 1, close);
      return { attrs, selfClosing, children };
    }
  }
  return null;
}

function checkStoryFile(abs, base) {
  const rel = relTo(base, abs);
  const source = readFileSync(abs, 'utf8');
  const code = mask(source, false);
  const masked = mask(source, true);

  const problems = [];
  const warnings = [];
  const add = (index, rule, message) => problems.push({ rel, line: lineOf(source, index), rule, message });

  for (const m of masked.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*bind\s*\(\s*\{\s*\}\s*\)/g)) {
    add(
      m.index,
      'csf2-forbidden',
      `\`${m[1]}.bind({})\` is CSF 2 (ADR 0031). Export a story object literal instead, or a plain ` +
        `factory that returns one — a bound template is opaque to every static check in this repo.`,
    );
  }

  for (const m of masked.matchAll(/\bstoriesOf\s*\(/g)) {
    add(
      m.index,
      'csf2-forbidden',
      '`storiesOf(` is CSF 2 and no longer exists in Storybook 10 (ADR 0031). Use a default-exported ' +
        '`meta` plus one named export per story.',
    );
  }

  for (const m of code.matchAll(TEST_IMPORT_RE)) {
    add(
      m.index,
      'wrong-test-import',
      'imports from `@storybook/test`; it moved to `storybook/test` in Storybook 9. The old ' +
        'specifier resolves to nothing useful in 10, so `expect` and `userEvent` fail at run time ' +
        'rather than at type-check time.',
    );
  }

  if (!/\bexport\s+default\b/.test(masked)) {
    add(
      0,
      'missing-default-export',
      'no `export default` — a CSF 3 module’s default export is its `meta`, and without one ' +
        'Storybook indexes zero stories from this file (ADR 0031).',
    );
  }

  const metaRange = findMetaRange(masked);
  if (metaRange && !hasTopLevelKey(source, masked, metaRange.start, metaRange.end, 'title')) {
    add(
      metaRange.start,
      'missing-title',
      "`meta` declares no `title` — add one (e.g. `title: 'theme/Button'`). Without it the sidebar " +
        'position is derived from the file path, so moving a file silently reorganises the ' +
        'workbench (ADR 0031).',
    );
  }

  const hasPlay = /\bplay\s*:/.test(masked);
  const segment = interactiveSegment(dirname(rel));
  if (segment && !hasPlay) {
    warnings.push({
      rel,
      line: 1,
      rule: 'interactive-without-play',
      message:
        `sits under \`${segment}/\` but no story declares \`play:\`. Stories are the browser tests ` +
        `(ADR 0031) — an interactive component with no play function is an untested component ` +
        `wearing a test’s clothes.`,
    });
  }

  return { problems, warnings, hasPlay };
}

function checkMdxFile(abs, base) {
  const rel = relTo(base, abs);
  // MDX is prose: masking string literals here would swallow an apostrophe-to-apostrophe span
  // of ordinary English along with any tag inside it, so this rule reads the raw text.
  const source = readFileSync(abs, 'utf8');
  const problems = [];
  const add = (index, rule, message) => problems.push({ rel, line: lineOf(source, index), rule, message });

  for (const m of source.matchAll(/<Story\b/g)) {
    const tag = readJsxTag(source, m.index, 'Story');
    if (!tag) continue;

    const reasons = [];
    if (/\bplay\s*=/.test(tag.attrs)) reasons.push('a `play` prop');
    if (/\brender\s*=/.test(tag.attrs)) reasons.push('a `render` prop');
    if (!tag.selfClosing && tag.children.trim()) reasons.push('inline children');
    if (reasons.length === 0) continue;

    add(
      m.index,
      'mdx-defines-story',
      `<Story> carries ${reasons.join(' and ')}, which defines a story in MDX. MDX is autodocs ` +
        `prose only: define the story in the colocated \`*.stories.tsx\` and embed it here with ` +
        `\`<Story of={Primary} />\`. A story defined in MDX reaches neither the Vitest runner nor ` +
        `this gate (ADR 0031).`,
    );
  }

  for (const m of source.matchAll(TEST_IMPORT_RE)) {
    add(
      m.index,
      'wrong-test-import',
      'imports from `@storybook/test`; it moved to `storybook/test` in Storybook 9.',
    );
  }

  return problems;
}

/**
 * One entry per component DIRECTORY, because the rule is colocation: the story has to sit
 * beside the component, and a directory with three component files needs one story file per
 * component, keyed to the directory it lives in.
 */
function collectComponents(base) {
  const components = [];

  for (const root of COVERAGE_ROOTS) {
    for (const dir of walkDirs(join(base, root))) {
      const files = directFiles(dir);
      const stories = files.filter((f) => STORY_FILE_RE.test(f));

      for (const file of files) {
        if (!file.endsWith('.tsx') || NON_COMPONENT_TSX_RE.test(file)) continue;
        const source = readFileSync(file, 'utf8');
        const exported = componentExports(mask(source, true));
        if (exported.length === 0) continue;

        components.push({
          dir,
          dirRel: relTo(base, dir),
          rel: relTo(base, file),
          line: lineOf(source, exported[0].index),
          name: exported[0].name,
          expected: `${relTo(base, file)
            .split('/')
            .pop()
            .replace(/\.tsx$/, '')}.stories.tsx`,
          stories,
        });
      }
    }
  }

  return components;
}

function scanTree(base) {
  const srcRoots = packageSrcRoots(base);
  const storyFiles = srcRoots.flatMap((root) => walkFiles(root, (f) => STORY_FILE_RE.test(f)));
  const mdxFiles = srcRoots.flatMap((root) => walkFiles(root, (f) => f.endsWith('.mdx')));

  const problems = [];
  const warnings = [];
  const storyResults = new Map();

  for (const abs of storyFiles) {
    const result = checkStoryFile(abs, base);
    storyResults.set(abs, result);
    problems.push(...result.problems);
    warnings.push(...result.warnings);
  }

  for (const abs of mdxFiles) problems.push(...checkMdxFile(abs, base));

  const components = collectComponents(base);
  for (const component of components) {
    if (component.stories.length > 0) continue;
    problems.push({
      rel: component.rel,
      line: component.line,
      rule: 'missing-stories',
      message:
        `\`${component.name}\` is exported here but \`${component.dirRel}/\` has no colocated story ` +
        `file. Add \`${component.expected}\` (CSF 3: a default-exported \`meta\` with an explicit ` +
        `\`title\`, plus one named export per state). ADR 0031 makes every story a browser-mode ` +
        `test, so a component with no story is a component nothing ever renders.`,
    });
  }

  const withStories = components.filter((c) => c.stories.length > 0).length;
  const withPlay = components.filter((c) => c.stories.some((s) => storyResults.get(s)?.hasPlay)).length;

  return {
    problems,
    warnings,
    storyFiles,
    stats: { components: components.length, withStories, withPlay },
  };
}

function printWarnings(warnings) {
  if (warnings.length === 0) return;
  console.error(`\n⚠ ${warnings.length} warning(s) — not failing the build:\n`);
  for (const w of warnings) console.error(`  ${w.rel}:${w.line}  [${w.rule}] ${w.message}`);
  console.error(
    '\n  Advisory because the trigger is the directory NAME: a genuinely presentational component ' +
      '\n  can legitimately live under one of those paths, and blocking on that would train people ' +
      '\n  to add an empty `play` to silence the gate. Add a real play function or ignore this line.',
  );
}

// ---------------------------------------------------------------------------------------------

if (process.argv.includes('--self-test')) {
  // ADR 0033 — every rule must reject its own violator, and stay silent on legal input.
  const COMPONENT = 'export function Card() {\n  return null;\n}\n';
  const BUTTON = 'export function Button() {\n  return null;\n}\n';
  const WIDGET = 'export function Confirmation() {\n  return null;\n}\n';

  const stories = (body) =>
    [
      "import type { Meta, StoryObj } from '@storybook/react-vite';",
      '',
      "import { Card } from './card';",
      '',
      'const meta = {',
      "  title: 'theme/Card',",
      '  component: Card,',
      '} satisfies Meta<typeof Card>;',
      'export default meta;',
      '',
      body,
    ].join('\n');

  const PLAIN_STORY = stories('export const Primary: StoryObj<typeof meta> = { args: {} };');
  const PLAY_STORY = stories(
    [
      "import { expect, userEvent } from 'storybook/test';",
      '',
      'export const Primary: StoryObj<typeof meta> = {',
      '  args: {},',
      '  play: async ({ canvas }) => {',
      '    await userEvent.click(canvas.getByRole("button"));',
      '    await expect(canvas.getByRole("button")).toBeEnabled();',
      '  },',
      '};',
    ].join('\n'),
  );

  const CASES = [
    ['missing-stories', { 'packages/theme/src/components/card/card.tsx': COMPONENT }],
    // A second coverage case: the widgets root is a separate path, and a typo there is exactly
    // the "scanned zero files, exited 0" mode ADR 0033 exists to close.
    ['missing-stories', { 'packages/theme/src/widgets/confirmation/confirmation.tsx': WIDGET }],
    [
      'csf2-forbidden',
      {
        'packages/theme/src/components/card/card.tsx': COMPONENT,
        'packages/theme/src/components/card/card.stories.tsx': stories(
          'const Template = (args) => <Card {...args} />;\nexport const Primary = Template.bind({});',
        ),
      },
    ],
    [
      'csf2-forbidden',
      {
        'packages/theme/src/components/card/card.tsx': COMPONENT,
        'packages/theme/src/components/card/card.stories.tsx': stories(
          "storiesOf('Card', module).add('primary', () => <Card />);",
        ),
      },
    ],
    [
      'mdx-defines-story',
      {
        'packages/theme/src/components/card/card.tsx': COMPONENT,
        'packages/theme/src/components/card/card.stories.tsx': PLAIN_STORY,
        'packages/theme/src/components/card/card.mdx':
          '<Meta of={CardStories} />\n\n<Story name="Inline" play={async () => {}} />\n',
      },
    ],
    // The rule has three triggers and one name; a fixture per trigger is what stops a rewrite
    // from quietly narrowing it to whichever one the single fixture happened to use.
    [
      'mdx-defines-story',
      {
        'packages/theme/src/components/card/card.tsx': COMPONENT,
        'packages/theme/src/components/card/card.stories.tsx': PLAIN_STORY,
        'packages/theme/src/components/card/card.mdx':
          '<Meta of={CardStories} />\n\n<Story name="Inline" render={() => <Card />} />\n',
      },
    ],
    [
      'mdx-defines-story',
      {
        'packages/theme/src/components/card/card.tsx': COMPONENT,
        'packages/theme/src/components/card/card.stories.tsx': PLAIN_STORY,
        'packages/theme/src/components/card/card.mdx':
          '<Meta of={CardStories} />\n\n<Story name="Inline">\n  <Card />\n</Story>\n',
      },
    ],
    [
      'missing-default-export',
      {
        'packages/theme/src/components/card/card.tsx': COMPONENT,
        'packages/theme/src/components/card/card.stories.tsx':
          "import { Card } from './card';\n\nexport const Primary = { args: {} };\n",
      },
    ],
    [
      'missing-title',
      {
        'packages/theme/src/components/card/card.tsx': COMPONENT,
        'packages/theme/src/components/card/card.stories.tsx':
          "import { Card } from './card';\n\nconst meta = {\n  component: Card,\n} satisfies Meta<typeof Card>;\nexport default meta;\n\nexport const Primary = { args: {} };\n",
      },
    ],
    [
      'wrong-test-import',
      {
        'packages/theme/src/components/card/card.tsx': COMPONENT,
        'packages/theme/src/components/card/card.stories.tsx': stories(
          "import { expect } from '@storybook/test';\n\nexport const Primary = { args: {} };",
        ),
      },
    ],
  ];

  /** Advisory rules: must surface AND must leave the exit code alone. */
  const WARNING_CASES = [
    [
      'interactive-without-play',
      {
        'packages/theme/src/components/button/button.tsx': BUTTON,
        'packages/theme/src/components/button/button.stories.tsx': PLAIN_STORY,
      },
    ],
    [
      'interactive-without-play',
      {
        'packages/theme/src/widgets/confirmation/confirmation.tsx': WIDGET,
        'packages/theme/src/widgets/confirmation/confirmation.stories.tsx': PLAIN_STORY,
      },
    ],
  ];

  /**
   * A gate that fires on everything is as broken as one that fires on nothing. These trees are
   * legal and must produce neither a problem nor a warning.
   */
  const ALLOWED = [
    [
      'interactive component with a play function',
      {
        'packages/theme/src/components/button/button.tsx': BUTTON,
        'packages/theme/src/components/button/button.stories.tsx': PLAY_STORY,
      },
    ],
    [
      'presentational component with a play-free story',
      {
        'packages/theme/src/components/card/card.tsx': COMPONENT,
        'packages/theme/src/components/card/card.stories.tsx': PLAIN_STORY,
      },
    ],
    [
      'widget with a play function',
      {
        'packages/theme/src/widgets/confirmation/confirmation.tsx': WIDGET,
        'packages/theme/src/widgets/confirmation/confirmation.stories.tsx': PLAY_STORY,
      },
    ],
    [
      'mdx embedding an existing story',
      {
        'packages/theme/src/components/card/card.tsx': COMPONENT,
        'packages/theme/src/components/card/card.stories.tsx': PLAIN_STORY,
        'packages/theme/src/components/card/card.mdx':
          "<Meta of={CardStories} />\n\nThe card doesn't need a play function.\n\n<Story of={Primary} />\n",
      },
    ],
    [
      'module exporting only hooks, types and constant tables',
      {
        'packages/theme/src/components/field/use-field.tsx':
          "export type FieldState = 'idle' | 'busy';\nexport const DEFAULT_LABELS = { idle: '' };\nexport const useField = () => DEFAULT_LABELS;\n",
      },
    ],
    [
      'barrel re-export beside a stored component',
      {
        'packages/theme/src/components/index.tsx': "export * from './card/card';\n",
        'packages/theme/src/components/card/card.tsx': COMPONENT,
        'packages/theme/src/components/card/card.stories.tsx': PLAIN_STORY,
      },
    ],
    [
      'test-only helper exporting an uppercase harness',
      {
        'packages/theme/src/components/card/card.test.tsx':
          'export function Harness() {\n  return null;\n}\n',
      },
    ],
  ];

  const writeTree = (base, files) => {
    for (const [rel, contents] of Object.entries(files)) {
      const abs = join(base, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, contents, 'utf8');
    }
  };

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'nerey-check-stories-'));
  const outcomes = [];
  // Teardown happens BEFORE any process.exit() — exit skips `finally`.
  try {
    for (const [rule, files] of CASES) {
      const tree = join(fixtureRoot, `case-${outcomes.length}`);
      writeTree(tree, files);
      const { problems } = scanTree(tree);
      outcomes.push({
        label: rule,
        expectation: 'rejected its violator',
        ok: problems.some((p) => p.rule === rule),
        detail: problems.map((p) => p.rule).join(', ') || 'nothing reported',
      });
    }

    for (const [rule, files] of WARNING_CASES) {
      const tree = join(fixtureRoot, `warn-${outcomes.length}`);
      writeTree(tree, files);
      const { problems, warnings } = scanTree(tree);
      outcomes.push({
        label: `warns ${rule}`,
        expectation: 'warned without failing the build',
        ok: warnings.some((w) => w.rule === rule) && problems.length === 0,
        detail: `warnings [${warnings.map((w) => w.rule).join(', ')}] errors [${problems
          .map((p) => p.rule)
          .join(', ')}]`,
      });
    }

    for (const [name, files] of ALLOWED) {
      const tree = join(fixtureRoot, `legal-${outcomes.length}`);
      writeTree(tree, files);
      const { problems, warnings } = scanTree(tree);
      outcomes.push({
        label: `allows ${name}`,
        expectation: 'stayed silent',
        ok: problems.length === 0 && warnings.length === 0,
        detail: [...problems, ...warnings].map((p) => `${p.rule} @ ${p.rel}`).join(', '),
      });
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  let failures = 0;
  for (const outcome of outcomes) {
    if (outcome.ok) {
      console.log(`  ✓ check-stories/${outcome.label} — ${outcome.expectation}`);
    } else {
      console.error(
        `  ✗ check-stories/${outcome.label} — did NOT ${outcome.expectation} [${outcome.detail}] ` +
          `(gate is broken)`,
      );
      failures++;
    }
  }

  console.log(
    failures === 0
      ? `✓ check-stories self-test: ${outcomes.length} case(s) behaved as documented`
      : `✗ check-stories self-test: ${failures} of ${outcomes.length} case(s) failed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? repoRoot : resolve(process.argv[rootFlag + 1] ?? '.');

const { problems, warnings, storyFiles, stats } = scanTree(root);
const coverage =
  `${stats.components} components, ${stats.withStories} with stories, ` +
  `${stats.withPlay} with play functions`;

if (problems.length) {
  console.error(
    `✗ story gate: ${problems.length} violation(s) across ${storyFiles.length} stories file(s)\n`,
  );
  for (const p of problems) console.error(`  ${p.rel}:${p.line}  [${p.rule}] ${p.message}`);
  printWarnings(warnings);
  console.error(`\n  ${coverage}.`);
  console.error('  Reference: docs/decisions/0031-storybook-component-workbench.md.');
  process.exit(1);
}

printWarnings(warnings);
console.log(`✓ story gate: ${storyFiles.length} stories file(s) conform — ${coverage}`);
