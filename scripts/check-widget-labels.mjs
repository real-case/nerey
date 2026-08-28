#!/usr/bin/env node
// scripts/check-widget-labels.mjs
//
// ADR 0041 — a widget renders its chrome strings from the labels context, never from the constant
// behind them. The record named this gap in its own Consequences:
//
//   "nothing prevents a future widget from importing a constant directly and bypassing the
//    context. Catching that needs a source-scanning gate, which is not written; the tests pin the
//    eleven that exist today and a twelfth could regress silently."
//
// This is that gate. A bypass is invisible in review — the component compiles, renders, passes its
// stories and passes axe, because an English string in an English default IS the right output. It
// only shows up in a deployment that overrode the label and got the built-in anyway, which is the
// deployment least able to diagnose it.
//
// The vocabulary is DERIVED, not listed. `packages/theme/src/labels/labels.tsx` assembles
// `defaultNereyLabels` by importing the constants, so what it imports IS the set of chrome
// strings — by construction, and permanently. Adding a string to the record extends the ban with
// no edit here, which is the same reasoning the commit gate uses for computing scopes from
// `workspaces` (ADR 0036): the hand-maintained list is the part that rots.
//
// Rules:
//
//   bypassed-labels   a widget component imports a chrome constant from its own schema module
//                     instead of reading it from `useNereyLabels()`.
//   empty-vocabulary  nothing was derived from the labels module. A gate whose vocabulary silently
//                     emptied would pass every component by having nothing to object to — the same
//                     failure a glob matching zero files produces.
//
// Type-only imports are ignored: a component importing `PollPayload` is importing a type, and a
// type cannot be rendered.
//
// What this deliberately does NOT check: a string literal written inline in a component. Catching
// that means judging every quoted string in JSX, and the false-positive rate over class names, data
// attributes and test ids would make the gate unreadable. ADR 0041 claims the derived-import rule
// and nothing wider.
//
// Usage:
//   node scripts/check-widget-labels.mjs
//   node scripts/check-widget-labels.mjs --self-test   plant a violator per rule, assert each fires

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const LABELS = resolve(repoRoot, 'packages/theme/src/labels/labels.tsx');
const WIDGETS = resolve(repoRoot, 'packages/theme/src/widgets');

/** `import { a, b } from '…'` — value imports only; `import type` is skipped by the caller. */
const IMPORT_RE = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function namesIn(clause) {
  return (
    clause
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      // `a as b` imports `a`; the local alias is irrelevant to what was reached for.
      .map((part) =>
        part
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name))
  );
}

/**
 * Every constant the labels module pulls out of a widget schema. Pure over the source so the
 * self-test can hand it a fixture.
 */
export function chromeVocabulary(labelsSource) {
  const vocabulary = new Set();
  for (const match of labelsSource.matchAll(IMPORT_RE)) {
    const [, typeOnly, clause, specifier] = match;
    if (typeOnly) continue;
    if (!/\/widgets\/[^/]+\/schema$/.test(specifier)) continue;
    for (const name of namesIn(clause)) vocabulary.add(name);
  }
  return vocabulary;
}

/** Chrome constants a component reached for directly. Pure, for the same reason. */
export function bypassesIn(componentSource, vocabulary) {
  const found = [];
  for (const match of componentSource.matchAll(IMPORT_RE)) {
    const [, typeOnly, clause, specifier] = match;
    // A type cannot be rendered, and a component may legitimately import one.
    if (typeOnly) continue;
    if (!/(^|\/)schema$/.test(specifier.replace(/^\.\//, ''))) continue;
    for (const name of namesIn(clause)) {
      if (vocabulary.has(name)) found.push({ name, line: lineOf(componentSource, match.index ?? 0) });
    }
  }
  return found;
}

function run() {
  const problems = [];

  if (!existsSync(LABELS)) {
    return {
      problems: [
        {
          rel: 'packages/theme/src/labels/labels.tsx',
          line: 1,
          rule: 'empty-vocabulary',
          message: 'the labels module is missing, so no chrome vocabulary could be derived.',
        },
      ],
      vocabulary: new Set(),
      checked: 0,
    };
  }

  const vocabulary = chromeVocabulary(readFileSync(LABELS, 'utf8'));
  if (vocabulary.size === 0) {
    problems.push({
      rel: 'packages/theme/src/labels/labels.tsx',
      line: 1,
      rule: 'empty-vocabulary',
      message:
        'no chrome constants were derived from this module, so every component below would pass by ' +
        'having nothing to object to. Either the imports moved, or this gate stopped reading them.',
    });
    return { problems, vocabulary, checked: 0 };
  }

  // Sorted: a gate whose report depends on filesystem iteration order is not a merge gate
  // (ADR 0033).
  const widgets = readdirSync(WIDGETS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let checked = 0;
  for (const widget of widgets) {
    const file = join(WIDGETS, widget, 'component.tsx');
    if (!existsSync(file)) continue;
    checked += 1;
    const rel = `packages/theme/src/widgets/${widget}/component.tsx`;
    for (const hit of bypassesIn(readFileSync(file, 'utf8'), vocabulary)) {
      problems.push({
        rel,
        line: hit.line,
        rule: 'bypassed-labels',
        message:
          `imports \`${hit.name}\` from its schema. That constant is one of the chrome strings ` +
          `\`defaultNereyLabels\` is built from, so reading it directly bypasses the labels context ` +
          `and the string stops being overridable (ADR 0041). Read it from \`useNereyLabels()\` — ` +
          `the constant stays exported for the record's default, not for a component to render.`,
      });
    }
  }

  return { problems, vocabulary, checked };
}

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  // ADR 0033 — every rule rejects its own planted violator, and the legal forms stay silent. The
  // fixtures go through disk so the blind probe in check-gates has a read to take away.
  const dir = mkdtempSync(join(tmpdir(), 'nerey-widget-labels-'));
  const fixture = join(dir, 'source.tsx');
  const outcomes = [];

  const LABELS_FIXTURE = `import { A_LABEL, B_NOTICE } from '../widgets/poll/schema';
import { C_TEXT } from '../widgets/form/schema';
import type { TaskStatus } from '../widgets/task-tree/schema';
import { unrelated } from '../components/button/button';
`;

  try {
    writeFileSync(fixture, LABELS_FIXTURE, 'utf8');
    const vocabulary = chromeVocabulary(readFileSync(fixture, 'utf8'));

    outcomes.push([
      'derives the vocabulary from the labels module',
      vocabulary.size === 3 && vocabulary.has('A_LABEL') && vocabulary.has('C_TEXT'),
      [...vocabulary].join(', '),
    ]);
    outcomes.push(['ignores a type-only import', !vocabulary.has('TaskStatus')]);
    outcomes.push(['ignores a non-schema import', !vocabulary.has('unrelated')]);

    const CASES = [
      ['bypassed-labels', "import { A_LABEL, POLL_TYPE } from './schema';\n"],
      ['bypassed-labels (aliased)', "import { B_NOTICE as notice } from './schema';\n"],
    ];
    for (const [rule, source] of CASES) {
      writeFileSync(fixture, source, 'utf8');
      outcomes.push([rule, bypassesIn(readFileSync(fixture, 'utf8'), vocabulary).length === 1]);
    }

    const ALLOWED = [
      [
        'a schema import of non-chrome names',
        "import { POLL_TYPE, POLL_VERSION, replyFor } from './schema';\n",
      ],
      ['a type-only import of a chrome name', "import type { A_LABEL } from './schema';\n"],
      ['the labels hook', "import { useNereyLabels } from '../../labels/labels';\n"],
      ['a component with no schema import', "import styles from './poll.module.css';\n"],
    ];
    for (const [name, source] of ALLOWED) {
      writeFileSync(fixture, source, 'utf8');
      const found = bypassesIn(readFileSync(fixture, 'utf8'), vocabulary);
      outcomes.push([`allows ${name}`, found.length === 0, found.map((hit) => hit.name).join(', ')]);
    }

    writeFileSync(fixture, "import { something } from './elsewhere';\n", 'utf8');
    outcomes.push(['empty-vocabulary', chromeVocabulary(readFileSync(fixture, 'utf8')).size === 0]);
  } finally {
    // Torn down BEFORE any exit: `process.exit()` skips `finally` (ADR 0033).
    rmSync(dir, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive =
      !rule.startsWith('allows ') && !rule.startsWith('ignores ') && !rule.startsWith('derives ');
    if (ok) {
      console.log(`  ✓ check-widget-labels/${rule} — ${positive ? 'rejected its violator' : 'holds'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-widget-labels/${rule} — did NOT reject its violator (gate is broken)`
          : `  ✗ check-widget-labels/${rule} — failed on legal input [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

const { problems, vocabulary, checked } = run();

if (problems.length > 0) {
  console.error(`\n✗ widget labels: ${problems.length} bypass(es)\n`);
  for (const problem of problems) {
    console.error(`  ${problem.rel}:${problem.line}  [${problem.rule}] ${problem.message}`);
  }
  process.exit(1);
}

console.log(
  `✓ widget labels: ${checked} widget component(s) read all ${vocabulary.size} chrome string(s) ` +
    `through the labels context`,
);
