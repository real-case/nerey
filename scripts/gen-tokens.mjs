#!/usr/bin/env node
// scripts/gen-tokens.mjs
//
// ADR 0024 — single-source token codegen. `packages/theme/src/tokens.css` is the only
// place a token is declared; everything downstream is generated from it:
//
//   packages/theme/src/tokens.generated.ts   the `NereyToken` union + a runtime list
//   packages/theme/src/tokens.allowlist.json the flat list the token gate lints against
//   docs/design-system/tokens.agent-rules.md the agent-facing reference
//
// The point of generating rather than hand-listing is that a prose list of tokens drifts
// silently the first time someone adds one. `--check` re-runs the generation in memory and
// exits non-zero if any artifact on disk differs, which is what CI runs.
//
// Usage:
//   node scripts/gen-tokens.mjs             write the artifacts
//   node scripts/gen-tokens.mjs --check     fail on drift, write nothing
//   node scripts/gen-tokens.mjs --self-test prove the drift check rejects a planted edit

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const SOURCE = resolve(repoRoot, 'packages/theme/src/tokens.css');
const OUT_TS = resolve(repoRoot, 'packages/theme/src/tokens.generated.ts');
const OUT_JSON = resolve(repoRoot, 'packages/theme/src/tokens.allowlist.json');
const OUT_MD = resolve(repoRoot, 'docs/design-system/tokens.agent-rules.md');

/**
 * Tokens are grouped by the segment after the `--nerey-` prefix. The order here is the
 * order they appear in the reference, and it is deliberately semantic-first: an author
 * reaching for a colour should meet the semantic layer before the primitive ramps.
 */
const GROUP_ORDER = [
  ['surface', 'Surfaces', 'Background fills. Semantic — pick by role, not by shade.'],
  ['text', 'Text', 'Foreground colours, including the on-accent pairings.'],
  ['border', 'Borders', 'Stroke colours, including the focus ring.'],
  ['shadow', 'Shadows', 'Elevation. Never hand-roll a box-shadow.'],
  ['space', 'Space', 'Padding, margin and gap. 4px base.'],
  ['radius', 'Radius', 'Corner rounding.'],
  ['font', 'Typography — families, sizes, weights', ''],
  ['line', 'Typography — line height', ''],
  ['letter', 'Typography — tracking', ''],
  ['duration', 'Motion — duration', ''],
  ['ease', 'Motion — easing', ''],
  ['z', 'Layering', 'Stacking contexts for portalled surfaces.'],
  ['control', 'Control sizing', ''],
  ['opacity', 'Opacity', 'Dimming for expired and disabled widgets (ADR 0018).'],
  [
    'color',
    'Primitive ramps',
    'RAW VALUES. A component stylesheet must NOT read these — they exist so the semantic layer above has something to point at (ADR 0024).',
  ],
];

/** Everything in the `--nerey-color-*` namespace is a primitive and off-limits to components. */
const PRIMITIVE_PREFIX = '--nerey-color-';

function parseTokens(css) {
  // Only the `:root` block declares the canonical set. The `[data-nerey-theme]` blocks
  // re-declare a subset with different values (ADR 0027) and must not introduce a token
  // that :root does not have — `--check` enforces exactly that below.
  const rootMatch = css.match(/(^|\n):root\s*\{([\s\S]*?)\n\}/);
  if (!rootMatch) {
    throw new Error('tokens.css: no `:root { … }` block found — it is the canonical token set.');
  }
  const body = rootMatch[2];

  const tokens = [];
  const seen = new Set();
  const re = /(--nerey-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    const value = m[2].trim().replace(/\s+/g, ' ');
    if (seen.has(name)) {
      throw new Error(`tokens.css: \`${name}\` is declared twice inside :root.`);
    }
    seen.add(name);
    tokens.push({ name, value, primitive: name.startsWith(PRIMITIVE_PREFIX) });
  }

  if (tokens.length === 0) {
    throw new Error('tokens.css: :root declares no --nerey-* custom properties.');
  }

  // Every token re-declared in a theme override must exist in :root, or a consumer who
  // pins light gets a property that simply does not resolve.
  const overrideBlocks = css.matchAll(/\[data-nerey-theme='(light|dark)'\]\s*\{([\s\S]*?)\n\}/g);
  for (const block of overrideBlocks) {
    const inner = /(--nerey-[a-z0-9-]+)\s*:/g;
    let o;
    while ((o = inner.exec(block[2])) !== null) {
      if (!seen.has(o[1])) {
        throw new Error(
          `tokens.css: \`${o[1]}\` is declared in the [data-nerey-theme='${block[1]}'] override but ` +
            `never in :root. Every override must shadow a canonical token (ADR 0027).`,
        );
      }
    }
  }

  return tokens;
}

function groupOf(name) {
  const rest = name.slice('--nerey-'.length);
  const head = rest.split('-')[0];
  return GROUP_ORDER.some(([key]) => key === head) ? head : 'other';
}

function renderTs(tokens) {
  const names = tokens.map((t) => t.name);
  const semantic = tokens.filter((t) => !t.primitive).map((t) => t.name);
  return `// GENERATED by scripts/gen-tokens.mjs from packages/theme/src/tokens.css — do not edit.
// Run \`npm run gen:tokens\` after changing a token. CI drift-checks this file (ADR 0024).

/** Every \`--nerey-*\` custom property declared by the theme. */
export type NereyToken =
${names.map((n) => `  | '${n}'`).join('\n')};

/**
 * The subset a component stylesheet may read. Primitive ramps (\`--nerey-color-*\`) are
 * excluded on purpose: components read the semantic layer so a re-theme is a value swap
 * rather than a find-and-replace (ADR 0024).
 */
export type NereySemanticToken =
${semantic.map((n) => `  | '${n}'`).join('\n')};

export const NEREY_TOKENS: readonly NereyToken[] = [
${names.map((n) => `  '${n}',`).join('\n')}
] as const;

export const NEREY_SEMANTIC_TOKENS: readonly NereySemanticToken[] = [
${semantic.map((n) => `  '${n}',`).join('\n')}
] as const;
`;
}

function renderJson(tokens) {
  return `${JSON.stringify(
    {
      $comment: 'GENERATED by scripts/gen-tokens.mjs — do not edit. Source: packages/theme/src/tokens.css',
      all: tokens.map((t) => t.name),
      semantic: tokens.filter((t) => !t.primitive).map((t) => t.name),
      primitive: tokens.filter((t) => t.primitive).map((t) => t.name),
    },
    null,
    2,
  )}\n`;
}

function renderMd(tokens) {
  const byGroup = new Map();
  for (const t of tokens) {
    const g = groupOf(t.name);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(t);
  }

  const sections = [];
  for (const [key, heading, blurb] of GROUP_ORDER) {
    const rows = byGroup.get(key);
    if (!rows || rows.length === 0) continue;
    sections.push(
      `### ${heading}\n${blurb ? `\n${blurb}\n` : ''}\n| Token | Value |\n| --- | --- |\n` +
        rows.map((t) => `| \`${t.name}\` | \`${t.value}\` |`).join('\n'),
    );
  }
  const other = byGroup.get('other');
  if (other && other.length) {
    sections.push(
      `### Ungrouped\n\n| Token | Value |\n| --- | --- |\n` +
        other.map((t) => `| \`${t.name}\` | \`${t.value}\` |`).join('\n'),
    );
  }

  return `<!-- GENERATED by scripts/gen-tokens.mjs from packages/theme/src/tokens.css — do not edit. -->

# Token reference

Generated from \`packages/theme/src/tokens.css\`, which is the single source of truth
(ADR 0024). Never re-list tokens in prose anywhere else — this file is the list.

## Rules

1. In a tokenizable CSS property, only \`var(--nerey-*, <fallback>)\` is allowed. A raw hex,
   \`rgb()\`, \`px\` or \`rem\` literal in a colour / space / radius / font-size / line-height
   property is a gate failure (\`npm run check:tokens\`).
2. **Always supply the fallback.** \`var(--nerey-surface-raised, #fff)\` — a consumer who
   imports \`theme.css\` without \`tokens.css\` must get a plain but correct component, never
   an invisible one (ADR 0024).
3. Components read the **semantic** layer. The primitive ramps (\`--nerey-color-*\`) exist so
   the semantic layer has something to point at; reading one from a component defeats
   re-theming and fails the gate.
4. A missing token is added to \`tokens.css\` first, then \`npm run gen:tokens\`. Never
   hand-edit a generated artifact.
5. Light/dark is a value override on the same token names (ADR 0027). A component never
   branches on theme.

## Tokens

${sections.join('\n\n')}
`;
}

function build() {
  const css = readFileSync(SOURCE, 'utf8');
  const tokens = parseTokens(css);
  return {
    tokens,
    artifacts: [
      { path: OUT_TS, content: renderTs(tokens) },
      { path: OUT_JSON, content: renderJson(tokens) },
      { path: OUT_MD, content: renderMd(tokens) },
    ],
  };
}

function write(artifacts) {
  for (const a of artifacts) {
    mkdirSync(dirname(a.path), { recursive: true });
    writeFileSync(a.path, a.content, 'utf8');
  }
}

function check(artifacts) {
  const drifted = [];
  for (const a of artifacts) {
    let current = null;
    try {
      current = readFileSync(a.path, 'utf8');
    } catch {
      drifted.push(`${a.path} — missing`);
      continue;
    }
    if (current !== a.content) drifted.push(`${a.path} — stale`);
  }
  return drifted;
}

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  // ADR 0033: prove the drift check actually rejects a violator. Corrupt one artifact in
  // memory-equivalent terms (on disk, then restore) and assert --check notices.
  const { artifacts } = build();
  const victim = artifacts[1];
  const original = readFileSync(victim.path, 'utf8');
  let drifted;
  // `process.exit()` terminates the process immediately and does NOT run `finally`, so the
  // restore has to happen before any exit — never inside a try/finally around one.
  try {
    writeFileSync(victim.path, `${original}\n/* planted drift */\n`, 'utf8');
    drifted = check(build().artifacts);
  } finally {
    writeFileSync(victim.path, original, 'utf8');
  }
  if (!drifted || drifted.length === 0) {
    console.error('✗ gen-tokens --check did NOT reject a planted drift (the gate is broken)');
    process.exit(1);
  }
  console.log('  ✓ gen-tokens --check — rejected its violator');
  process.exit(0);
}

let built;
try {
  built = build();
} catch (err) {
  console.error(`✗ gen-tokens: ${err.message}`);
  process.exit(1);
}

if (argv.includes('--check')) {
  const drifted = check(built.artifacts);
  if (drifted.length) {
    console.error('✗ Generated token artifacts are out of date:');
    for (const d of drifted) console.error(`    ${d}`);
    console.error('  Run `npm run gen:tokens` and commit the result.');
    process.exit(1);
  }
  console.log(`✓ token artifacts up to date (${built.tokens.length} tokens)`);
  process.exit(0);
}

write(built.artifacts);
const semantic = built.tokens.filter((t) => !t.primitive).length;
console.log(
  `✓ generated 3 artifacts from ${built.tokens.length} tokens (${semantic} semantic, ` +
    `${built.tokens.length - semantic} primitive)`,
);
