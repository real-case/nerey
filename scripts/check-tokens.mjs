#!/usr/bin/env node
// scripts/check-tokens.mjs
//
// ADR 0024 — the token-usage gate. Every `*.module.css` in the workspace is checked for:
//
//   1. Tailwind at-rules (`@apply` / `@tailwind` / `@reference`). CSS Modules are bundled
//      separately and cannot see a utility framework's theme, so these fail at build time
//      for custom utilities and silently half-work for core ones — the worst kind of trap.
//   2. Raw colour literals — hex, `rgb()`, `hsl()`, `oklch()`, `color-mix()`.
//   3. Raw size literals in tokenizable properties (padding, margin, gap, radius, font-size,
//      line-height). `0`, `1px` hairlines and `100%`-family values are allowed.
//   4. `var(--nerey-…)` references to a token that does not exist in the generated allowlist.
//   5. `var(--nerey-color-…)` — a primitive ramp read directly from a component, which
//      defeats re-theming.
//   6. A `var(--nerey-…)` with no fallback. A consumer who loads `theme.css` without
//      `tokens.css` must still get a legible component (ADR 0024, AC-16).
//
// Usage:
//   node scripts/check-tokens.mjs
//   node scripts/check-tokens.mjs --self-test   plant a violator per rule, assert each fires

import { readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const ALLOWLIST = resolve(repoRoot, 'packages/theme/src/tokens.allowlist.json');

const SIZED_PROPERTIES =
  'padding|padding-block|padding-inline|padding-top|padding-right|padding-bottom|padding-left|' +
  'margin|margin-block|margin-inline|margin-top|margin-right|margin-bottom|margin-left|' +
  'gap|row-gap|column-gap|border-radius|font-size|line-height|letter-spacing';

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.module.css')) out.push(full);
  }
  return out;
}

function loadAllowlist() {
  try {
    const parsed = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
    return { all: new Set(parsed.all), semantic: new Set(parsed.semantic) };
  } catch {
    console.error(
      `✗ ${relative(repoRoot, ALLOWLIST)} is missing. Run \`npm run gen:tokens\` first (ADR 0024).`,
    );
    process.exit(1);
  }
}

/** Strip comments and, for value scanning, string literals such as font stacks. */
function strip(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^']*'|"[^"]*"/g, "''");
}

/**
 * Blank out the FALLBACK argument of every `var()`, keeping the custom-property name.
 *
 * ADR 0024 requires `var(--nerey-surface-raised, #ffffff)` — the fallback is the whole point,
 * because a consumer who loads theme.css without tokens.css must still get a legible
 * component. Those fallbacks are, by construction, raw literals. Scanning the file without
 * this step makes the raw-value rules fire on exactly the pattern the ADR mandates, so the
 * gate would be unsatisfiable.
 *
 * Characters are replaced with spaces rather than removed so every reported line number still
 * matches the file on disk. Nesting is handled by paren counting: a fallback may itself
 * contain `var()`, and a regex cannot see the matching close paren.
 */
function blankVarFallbacks(css) {
  const out = [...css];
  for (let i = 0; i < css.length; i++) {
    if (!css.startsWith('var(', i)) continue;

    let depth = 0;
    let commaAt = -1;
    let end = -1;
    for (let j = i + 3; j < css.length; j++) {
      const ch = css[j];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      } else if (ch === ',' && depth === 1 && commaAt === -1) {
        commaAt = j;
      }
    }

    if (end === -1 || commaAt === -1) continue;
    for (let k = commaAt + 1; k < end; k++) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  }
  return out.join('');
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function checkFile(absPath, allow) {
  const rel = relative(repoRoot, absPath).split(sep).join('/');
  const raw = readFileSync(absPath, 'utf8');
  const css = strip(raw);
  // Raw-value rules run against the fallback-free text; the token rules below run against
  // `css`, which still has the fallbacks and can therefore tell a missing one from a present one.
  const values = blankVarFallbacks(css);
  const problems = [];
  const add = (index, rule, message) => problems.push({ rel, line: lineOf(raw, index), rule, message });

  for (const m of css.matchAll(/@(apply|tailwind|reference)\b/g)) {
    add(m.index, 'no-tailwind', `\`@${m[1]}\` — CSS Modules cannot see a utility framework's theme.`);
  }

  for (const m of values.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    add(m.index, 'no-raw-color', `raw colour literal \`${m[0]}\` — read a semantic token instead.`);
  }

  for (const m of values.matchAll(/\b(rgba?|hsla?|oklch|oklab|color-mix)\s*\(/g)) {
    add(m.index, 'no-raw-color', `inline colour \`${m[1]}(\` — colour values live in tokens.css.`);
  }

  const sizedRe = new RegExp(`\\b(${SIZED_PROPERTIES})\\s*:\\s*([^;{}]+);`, 'g');
  for (const m of values.matchAll(sizedRe)) {
    const value = m[2];
    // A hairline border-width and a bare 0 are not worth a token.
    const literals = value.match(/(?<![\w-])\d*\.?\d+(px|rem|em)\b/g) ?? [];
    const offending = literals.filter((l) => l !== '1px' && l !== '0px');
    if (offending.length) {
      add(
        m.index,
        'no-raw-size',
        `\`${m[1]}: ${value.trim()}\` uses raw size literal(s) ${[...new Set(offending)].join(', ')} — ` +
          `use the space / radius / font-size scale.`,
      );
    }
  }

  for (const m of css.matchAll(/var\(\s*(--nerey-[a-z0-9-]+)\s*(,)?/g)) {
    const token = m[1];
    if (!allow.all.has(token)) {
      add(m.index, 'unknown-token', `\`${token}\` is not declared in tokens.css.`);
      continue;
    }
    if (!allow.semantic.has(token)) {
      add(
        m.index,
        'no-primitive-token',
        `\`${token}\` is a primitive ramp — components read the semantic layer so a re-theme is a ` +
          `value swap.`,
      );
    }
    if (!m[2]) {
      add(
        m.index,
        'require-fallback',
        `\`var(${token})\` has no fallback — a consumer loading theme.css without tokens.css must ` +
          `still get a legible component.`,
      );
    }
  }

  return problems;
}

function run() {
  const allow = loadAllowlist();
  const files = walk(resolve(repoRoot, 'packages'));
  const problems = files.flatMap((f) => checkFile(f, allow));
  return { files, problems };
}

if (process.argv.includes('--self-test')) {
  // ADR 0033 — every rule must reject its own violator, or the gate is decorative.
  const fixtureDir = resolve(repoRoot, 'packages/theme/src/__tokencheck__');
  const fixture = join(fixtureDir, 'planted.module.css');
  const CASES = [
    ['no-tailwind', '.a { @apply flex; }'],
    ['no-raw-color', '.a { color: #ff0000; }'],
    ['no-raw-color', '.a { color: rgb(1 2 3); }'],
    ['no-raw-size', '.a { padding: 12px; }'],
    ['unknown-token', '.a { color: var(--nerey-not-a-real-token, red); }'],
    ['no-primitive-token', '.a { color: var(--nerey-color-teal-500, #000); }'],
    ['require-fallback', '.a { color: var(--nerey-text-primary); }'],
  ];

  /**
   * A gate that fires on everything is as broken as one that fires on nothing, and this one
   * has a specific over-firing hazard: ADR 0024 REQUIRES an inline fallback, and every
   * fallback is a raw literal. These cases must stay silent.
   */
  const ALLOWED = [
    ['color fallback', '.a { color: var(--nerey-text-primary, #151d24); }'],
    ['size fallback', '.a { padding: var(--nerey-space-4, 1rem); }'],
    ['nested fallback', '.a { color: var(--nerey-text-accent, var(--nerey-text-primary, #151d24)); }'],
    ['keyword value', '.a { background: transparent; border-color: currentColor; }'],
    ['hairline border', '.a { border-radius: 0; }'],
  ];

  const allow = loadAllowlist();
  const outcomes = [];
  // The fixture is torn down BEFORE any exit — `process.exit()` skips `finally`.
  try {
    mkdirSync(fixtureDir, { recursive: true });
    for (const [rule, css] of CASES) {
      writeFileSync(fixture, css, 'utf8');
      outcomes.push([rule, checkFile(fixture, allow).some((p) => p.rule === rule)]);
    }
    for (const [name, css] of ALLOWED) {
      writeFileSync(fixture, css, 'utf8');
      const found = checkFile(fixture, allow);
      outcomes.push([`allows ${name}`, found.length === 0, found.map((p) => p.rule).join(', ')]);
    }
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive = !rule.startsWith('allows ');
    if (ok) {
      console.log(`  ✓ check-tokens/${rule} — ${positive ? 'rejected its violator' : 'stayed silent'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-tokens/${rule} — did NOT reject its violator (gate is broken)`
          : `  ✗ check-tokens/${rule} — fired on a LEGAL stylesheet [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

const { files, problems } = run();

if (problems.length) {
  console.error(`✗ token gate: ${problems.length} violation(s) across ${files.length} stylesheet(s)\n`);
  for (const p of problems) {
    console.error(`  ${p.rel}:${p.line}  [${p.rule}] ${p.message}`);
  }
  console.error('\n  Reference: docs/design-system/tokens.agent-rules.md (generated).');
  process.exit(1);
}

console.log(`✓ token gate: ${files.length} stylesheet(s) clean`);
