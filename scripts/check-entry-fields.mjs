#!/usr/bin/env node
// scripts/check-entry-fields.mjs
//
// ADR 0049 — a registry entry declares only fields the runtime reads.
//
// `WidgetRegistryEntry` once carried `reducer`, `updateStrategy` and `cancellable`, and nothing in
// core ever read them. Every other gate passed, because every other gate checks shape: the fields
// were declared, exported, documented and snapshotted, and a widget author who set
// `updateStrategy: 'pessimistic'` got optimistic writes. This gate checks the other direction —
// that a declared field is consulted somewhere — which is the class of defect D-8 belongs to too.
//
// The field list is read through the TypeScript checker, not parsed out of the file, so a field
// added through an intersection or a mapped type is seen the same way a literal one is.
//
// Rules:
//
//   unread-field   a property of `WidgetRegistryEntry` that no non-test module under
//                  packages/core/src reads. A read is a property access, an element access with a
//                  string literal, or a destructuring binding whose source is typed as an entry.
//                  The comparison is by declaration, so a read through `AnyWidgetRegistryEntry`
//                  (the erased alias) counts, and an unrelated `.type` on some other object does
//                  not.
//   empty-surface  the type was not found or had no properties. A gate whose input silently
//                  emptied passes everything by having nothing to compare.
//
// A read in a `*.test.*` or `*.stories.*` file does not count: a test asserting that a field is
// undefined is exactly what the removed fields had, and it is not a use.
//
// Usage:
//   node scripts/check-entry-fields.mjs
//   node scripts/check-entry-fields.mjs --self-test   plant a violator per rule, assert each fires

import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const TSCONFIG = resolve(repoRoot, 'tsconfig.json');
const CORE_SRC = resolve(repoRoot, 'packages/core/src');
const TYPES_FILE = resolve(CORE_SRC, 'types.ts');
const TYPE_NAME = 'WidgetRegistryEntry';

const NOT_A_USE = /\.(test|stories)\.(ts|tsx)$/;

function relOf(absPath) {
  return relative(repoRoot, absPath).split(sep).join('/');
}

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...sourceFiles(abs));
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') && !NOT_A_USE.test(name)) out.push(abs);
  }
  return out;
}

function createProgram(roots) {
  const raw = ts.readConfigFile(TSCONFIG, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config ?? {}, ts.sys, repoRoot, undefined, TSCONFIG);
  return ts.createProgram(roots, { ...parsed.options, noEmit: true, skipLibCheck: true });
}

/** The declaration nodes of `typeName`'s properties, keyed by property name. */
function declaredFields(program, checker, typesFile, typeName) {
  const source = program.getSourceFile(typesFile);
  if (!source) return new Map();
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) return new Map();
  const symbol = checker.getExportsOfModule(moduleSymbol).find((s) => s.name === typeName);
  if (!symbol) return new Map();
  const fields = new Map();
  for (const property of checker.getPropertiesOfType(checker.getDeclaredTypeOfSymbol(symbol))) {
    fields.set(property.name, new Set(property.declarations ?? []));
  }
  return fields;
}

/** True when `symbol` is one of the property declarations we are looking for. */
function matches(symbol, declarations) {
  if (!symbol) return false;
  return (symbol.declarations ?? []).some((d) => declarations.has(d));
}

/**
 * Every field of `typeName` that no file in `files` reads. Pure over its inputs so the self-test
 * can run it against a fixture with exactly the same code path as the real run.
 */
export function analyse({ roots, files, typesFile, typeName }) {
  const program = createProgram(roots);
  const checker = program.getTypeChecker();
  const fields = declaredFields(program, checker, typesFile, typeName);
  if (fields.size === 0) return { fields, unread: [], empty: true };

  const read = new Set();
  const note = (name, symbol) => {
    const declarations = fields.get(name);
    if (declarations && matches(symbol, declarations)) read.add(name);
  };

  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node)) {
        note(node.name.text, checker.getSymbolAtLocation(node.name));
      } else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
        const name = node.argumentExpression.text;
        const type = checker.getTypeAtLocation(node.expression);
        note(name, checker.getPropertyOfType(type, name));
      } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const key = node.propertyName ?? node.name;
        if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) {
          const type = checker.getTypeAtLocation(node.parent);
          note(key.text, checker.getPropertyOfType(type, key.text));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  const unread = [...fields.keys()].filter((name) => !read.has(name)).sort();
  return { fields, unread, empty: false };
}

function selfTest() {
  // ADR 0033 — each rule rejects a planted violator, and legal reads stay silent.
  const dir = mkdtempSync(join(tmpdir(), 'nerey-entry-fields-'));
  const outcomes = [];
  try {
    const types = join(dir, 'types.ts');
    const reader = join(dir, 'reader.ts');
    const spec = join(dir, 'reader.test.ts');
    writeFileSync(
      types,
      `export type WidgetRegistryEntry<P = unknown> = {
  type: string;
  version: string;
  payload?: P;
  migrate?: (p: unknown) => unknown;
  dead?: boolean;
  testedOnly?: boolean;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyEntry = WidgetRegistryEntry<any>;
export type Unrelated = { dead: boolean };
`,
      'utf8',
    );
    writeFileSync(
      reader,
      `import type { AnyEntry, Unrelated, WidgetRegistryEntry } from './types';
export function key(entry: AnyEntry): string {
  return entry.type + entry['version'];
}
export function run(entry: WidgetRegistryEntry<string>): unknown {
  const { payload, migrate: m } = entry;
  return m?.(payload);
}
// Same name on a different type: must NOT count as a read of the entry's \`dead\`.
export function other(u: Unrelated): boolean {
  return u.dead;
}
`,
      'utf8',
    );
    writeFileSync(
      spec,
      `import type { WidgetRegistryEntry } from './types';
export const probe = (e: WidgetRegistryEntry) => e.testedOnly;
`,
      'utf8',
    );

    const result = analyse({
      roots: [types, reader, spec],
      files: [types, reader].filter((f) => !NOT_A_USE.test(f)),
      typesFile: types,
      typeName: 'WidgetRegistryEntry',
    });
    outcomes.push(['unread-field', result.unread.includes('dead'), result.unread.join(', ')]);
    outcomes.push([
      'unread-field (read only in a test)',
      result.unread.includes('testedOnly'),
      result.unread.join(', '),
    ]);
    outcomes.push([
      'allows property, element and destructured reads',
      ['type', 'version', 'payload', 'migrate'].every((f) => !result.unread.includes(f)),
      result.unread.join(', '),
    ]);

    const missing = analyse({ roots: [types], files: [types], typesFile: types, typeName: 'NoSuchType' });
    outcomes.push(['empty-surface', missing.empty === true, String(missing.empty)]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive = !rule.startsWith('allows ');
    if (ok) {
      console.log(`  ✓ check-entry-fields/${rule} — ${positive ? 'rejected its violator' : 'stayed silent'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-entry-fields/${rule} — did NOT reject its violator (gate is broken) [${detail}]`
          : `  ✗ check-entry-fields/${rule} — failed on legal input [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();

const files = sourceFiles(CORE_SRC);
const { fields, unread, empty } = analyse({
  roots: files,
  files,
  typesFile: TYPES_FILE,
  typeName: TYPE_NAME,
});

if (empty) {
  console.error(
    `✗ entry fields: found no properties on \`${TYPE_NAME}\` in ${relOf(TYPES_FILE)}. The type was ` +
      `renamed or moved; point this gate at it rather than letting it pass on nothing (ADR 0049).`,
  );
  process.exit(1);
}

if (unread.length) {
  console.error(
    `✗ entry fields: ${unread.length} field(s) of \`${TYPE_NAME}\` are declared and never read\n`,
  );
  for (const name of unread) {
    console.error(
      `  [unread-field] \`${name}\` — no non-test module under ${relOf(CORE_SRC)} reads it. A field ` +
        `on the entry is a promise to every widget author; implement it, or remove it (ADR 0049).`,
    );
  }
  process.exit(1);
}

console.log(`✓ entry fields: all ${fields.size} field(s) of \`${TYPE_NAME}\` are read by core`);
