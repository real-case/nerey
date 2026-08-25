#!/usr/bin/env node
// scripts/check-api-signatures.mjs
//
// ADR 0038 — the *shape* of a published export is versioned API, and `check:public-api` cannot
// see it. That gate snapshots names and a type-only flag, which is enough to catch a deletion and
// nothing else. Both of these pass it unchanged, and both break every consumer:
//
//   -export function sendUserMessage(text: string): void;
//   +export function sendUserMessage(text: string, meta: Meta): void;
//
//   -export type ExpiryRule = { on: 'timeout'; ms: number } | { on: 'message' };
//   +export type ExpiryRule = { on: 'timeout'; ms: number };
//
// So this gate renders every exported symbol of every barrel (ADR 0028) into a signature string
// and diffs it against `docs/design-system/api-signatures.json`. The break then shows up in the
// PR as a changed line in a committed file, which is the same argument `check:public-api` makes
// for names.
//
// Rules:
//
//   signature-changed  a symbol's rendering differs from the baseline. FAILS — but NOT as a
//                      verdict of "breaking". An added optional field is additive; a narrowed
//                      parameter is not, and both render as one changed line. Classifying them is
//                      a judgement the gate cannot make, so it prints both shapes and stops.
//   signature-added    a symbol the baseline does not carry. Reported, does not fail — a new
//                      export is a MINOR bump.
//   signature-removed  a symbol the baseline carries and the barrel no longer exports. Reported,
//                      does not fail: names are `check:public-api`'s surface and it already fails
//                      on a removal. Two gates blocking on one fact would mean two baselines to
//                      re-bless for one deliberate deletion.
//
// HOW A SIGNATURE IS RENDERED, and why neither obvious answer works (ADR 0038):
//
//   Expanded structural type  — `checker.typeToString` over everything. Produces a 1.4 MB
//     baseline: a themed component's props expand every DOM attribute React declares. Measured,
//     not guessed.
//   Declaration source text   — `node.getText()`. Embeds comments and line breaks, so rewording
//     a doc comment reads as an API change. A gate that fires on prose is a gate people re-bless
//     without reading.
//
// What is rendered instead, per symbol kind:
//
//   type/interface/enum  the declaration, printed through the TypeScript printer with
//                        `removeComments` — the declared form, free of trivia.
//   class                construct signatures plus instance members, expanded through the
//                        checker, so a refactor inside a method body cannot move the baseline.
//   everything else      the checker's type string, which is formatting-independent.
//
// Every `import("/abs/path").T` the checker emits is rewritten to `T` (or `pkg.T` for a type from
// node_modules). An absolute path in a committed baseline is a phantom diff on the next machine.
//
// A parameter RENAME does move the signature, deliberately: the name is part of the declared form
// a consumer reads in their editor, and API Extractor's `.api.md` records it for the same reason.
//
// Usage:
//   node scripts/check-api-signatures.mjs
//   node scripts/check-api-signatures.mjs --update-baseline   bless the surface, print the diff
//   node scripts/check-api-signatures.mjs --self-test         plant a violator per rule

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const BASELINE = resolve(repoRoot, 'docs/design-system/api-signatures.json');
const TSCONFIG = resolve(repoRoot, 'tsconfig.json');

/** The published entry points of ADR 0028, in the order a consumer meets them. */
const BARRELS = [
  { key: '@nerey/core', file: 'packages/core/src/index.ts' },
  { key: '@nerey/core/mock', file: 'packages/core/src/mock/index.ts' },
  { key: '@nerey/core/testing', file: 'packages/core/src/testing/index.ts' },
  { key: '@nerey/theme', file: 'packages/theme/src/index.ts' },
];

/** Only a changed signature blocks. See the rule table above for why the other two do not. */
const FATAL = new Set(['signature-changed']);

const TYPE_FLAGS = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseSingleQuotesForStringLiteralType;

/** Symbol kinds whose declared form is the signature, rather than their expanded structure. */
const DECLARED_KINDS = ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Enum;

const IMPORTED_TYPE_RE = /import\("([^"]+)"\)\./g;

function relOf(absPath) {
  return relative(repoRoot, absPath).split(sep).join('/');
}

/**
 * Strip the `import("…").` qualifier the checker puts in front of every non-local type.
 *
 * A repo-local type keeps its bare name; a type from node_modules keeps its package name, so
 * `@types/react.ReactElement` still says where it came from without saying where it lives on
 * this disk. Whitespace collapses so a rendering is one line regardless of how the printer wrapped
 * it — the baseline is diffed, and a re-wrapped line is not a change.
 */
function normalise(text) {
  return text
    .replace(IMPORTED_TYPE_RE, (_match, path) => {
      const at = path.lastIndexOf('node_modules/');
      if (at === -1) return '';
      const parts = path.slice(at + 'node_modules/'.length).split('/');
      return `${parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]}.`;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A program over the given roots, using the repository's own compiler options.
 *
 * `tsconfig.json` is read rather than reconstructed because it carries the `paths` mapping that
 * resolves `@nerey/core` to SOURCE. Without it, rendering `@nerey/theme` would need `dist` to
 * exist, and a gate that requires a prior build is the failure mode ADR 0028 and the CI record
 * both warn about.
 */
function createProgram(roots) {
  const raw = ts.readConfigFile(TSCONFIG, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(raw.config ?? {}, ts.sys, repoRoot, undefined, TSCONFIG);
  return ts.createProgram(roots, { ...parsed.options, noEmit: true, skipLibCheck: true });
}

function classSignature(checker, symbol, location) {
  const instance = checker.getDeclaredTypeOfSymbol(symbol);
  const constructors = checker
    .getTypeOfSymbolAtLocation(symbol, location)
    .getConstructSignatures()
    .map((signature) => `new ${checker.signatureToString(signature, location, TYPE_FLAGS)}`);
  const members = checker
    .getPropertiesOfType(instance)
    .map((property) => {
      const type = checker.getTypeOfSymbolAtLocation(property, location);
      return `${property.name}: ${checker.typeToString(type, location, TYPE_FLAGS)}`;
    })
    // Sorted: declaration order is not API, and a member moved for readability is not a change.
    .sort();
  return `class ${symbol.name} { ${[...constructors, ...members].join('; ')} }`;
}

/** Render one exported symbol. See the header for why the three branches differ. */
function renderSymbol(checker, printer, exported, location) {
  const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;

  if (symbol.flags & DECLARED_KINDS) {
    const declaration = symbol.declarations?.[0];
    if (!declaration) return `type ${symbol.name}`;
    const source = declaration.getSourceFile();
    return normalise(printer.printNode(ts.EmitHint.Unspecified, declaration, source));
  }

  if (symbol.flags & ts.SymbolFlags.Class) {
    return normalise(classSignature(checker, symbol, location));
  }

  const type = checker.getTypeOfSymbolAtLocation(symbol, location);
  return normalise(checker.typeToString(type, location, TYPE_FLAGS));
}

/**
 * Render every export of one module into `{ name: signature }`.
 *
 * Returns `null` when the module cannot be read at all, which the caller distinguishes from an
 * empty surface: a barrel that vanished is a different fact from a barrel that exports nothing.
 */
function renderModule(program, checker, printer, absPath) {
  const source = program.getSourceFile(absPath);
  if (!source) return null;
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) return {};

  const entry = {};
  const exports = checker.getExportsOfModule(moduleSymbol);
  // Plain comparison rather than `localeCompare`: collation depends on ICU and locale, and a
  // baseline that reorders itself on someone else's machine is a permanent phantom diff.
  for (const exported of [...exports].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    entry[exported.name] = renderSymbol(checker, printer, exported, source);
  }
  return entry;
}

/** Compare one barrel's rendering against its baseline entry. Pure — the self-test relies on it. */
function diffEntry(key, baselineEntry, currentEntry) {
  const problems = [];
  const baseline = baselineEntry ?? {};
  const current = currentEntry ?? {};

  for (const [name, signature] of Object.entries(baseline)) {
    if (!(name in current)) {
      problems.push({
        key,
        rule: 'signature-removed',
        message:
          `${key} no longer exports \`${name}\`. \`check:public-api\` owns that verdict and fails ` +
          `on it; re-run this gate with --update-baseline once the removal is deliberate.`,
      });
      continue;
    }
    if (current[name] !== signature) {
      problems.push({
        key,
        rule: 'signature-changed',
        message: `\`${name}\` changed shape in ${key}.\n      was: ${signature}\n      now: ${current[name]}`,
      });
    }
  }

  for (const name of Object.keys(current)) {
    if (name in baseline) continue;
    problems.push({
      key,
      rule: 'signature-added',
      message:
        `${key} gains \`${name}\` — a MINOR bump under ADR 0038. Run ` +
        `\`npm run check:api-signatures -- --update-baseline\` and mention it in the release notes.`,
    });
  }

  return problems;
}

function loadBaseline({ required }) {
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8'));
  } catch {
    if (!required) return {};
    console.error(
      `✗ ${relOf(BASELINE)} is missing — there is nothing to compare the signatures against.\n` +
        `  Create it with \`npm run check:api-signatures -- --update-baseline\` and commit it (ADR 0038).`,
    );
    process.exit(1);
  }
}

function run(baseline) {
  const roots = BARRELS.map((barrel) => resolve(repoRoot, barrel.file));
  const program = createProgram(roots);
  const checker = program.getTypeChecker();
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

  const problems = [];
  const snapshot = {};
  let symbolCount = 0;

  for (const { key, file } of BARRELS) {
    const entry = renderModule(program, checker, printer, resolve(repoRoot, file));
    if (entry === null) {
      // Every symbol the baseline remembers is a removal, reported through the same rule so the
      // message stays one sentence rather than a special case nobody has seen fire.
      problems.push(...diffEntry(key, baseline[key], {}));
      continue;
    }
    snapshot[key] = entry;
    symbolCount += Object.keys(entry).length;
    problems.push(...diffEntry(key, baseline[key], entry));
  }

  // A baseline key with no barrel registered above would be silently dropped by
  // --update-baseline, taking its change detection with it.
  for (const key of Object.keys(baseline).sort()) {
    if (BARRELS.some((barrel) => barrel.key === key)) continue;
    problems.push({
      key,
      rule: 'signature-removed',
      message:
        `the baseline records \`${key}\`, which is not a barrel this gate knows about. Add it to ` +
        `BARRELS in ${relOf(fileURLToPath(import.meta.url))} or drop the entry deliberately.`,
    });
  }

  return { problems, snapshot, symbolCount };
}

function serialize(snapshot) {
  const sorted = {};
  for (const key of Object.keys(snapshot).sort()) sorted[key] = snapshot[key];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  // ADR 0033 — every rule rejects its own planted violator, and the non-failing rules are asserted
  // to stay non-failing. Two fixture modules are rendered in ONE program: `plain.ts` and
  // `adorned.ts` declare the same surface, but the second is drowned in doc comments and wrapped
  // at absurd places. Their renderings must be identical — that is the property the whole choice
  // of rendering rests on, so it is asserted rather than assumed.
  const fixtureDir = mkdtempSync(join(tmpdir(), 'nerey-api-signatures-'));
  const plainFile = join(fixtureDir, 'plain.ts');
  const adornedFile = join(fixtureDir, 'adorned.ts');
  const outcomes = [];

  const PLAIN = `export type Rule = { on: 'timeout'; ms: number } | { on: 'message' };
export function send(text: string): void {}
export class Boom extends Error {
  code = 'boom';
}
`;

  const ADORNED = `/**
 * A doc comment nobody should have to re-bless a baseline for.
 */
export type Rule =
  // an inline note
  | { on: 'timeout'; ms: number }
  | { on: 'message' };

/** Sends. */
export function send(
  text: string,
): void {
  // a body the signature must not see
  void text;
}

/** Booms. */
export class Boom extends Error {
  code = 'boom';
}
`;

  const fatal = (problems) => problems.filter((p) => FATAL.has(p.rule));

  // Torn down BEFORE any exit — `process.exit()` skips `finally` (ADR 0033, and the gen-tokens
  // incident recorded in docs/verification.md).
  try {
    writeFileSync(plainFile, PLAIN, 'utf8');
    writeFileSync(adornedFile, ADORNED, 'utf8');

    const program = createProgram([plainFile, adornedFile]);
    const checker = program.getTypeChecker();
    const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
    const plain = renderModule(program, checker, printer, plainFile);
    const adorned = renderModule(program, checker, printer, adornedFile);

    outcomes.push([
      'allows comments and reformatting',
      plain !== null && adorned !== null && JSON.stringify(plain) === JSON.stringify(adorned),
      `plain=${JSON.stringify(plain)} adorned=${JSON.stringify(adorned)}`,
    ]);

    outcomes.push([
      'signature-changed',
      fatal(diffEntry('@nerey/fixture', { ...plain, send: '(text: string, extra: number) => void' }, plain))
        .length === 1,
    ]);

    outcomes.push([
      'signature-changed (type widened)',
      fatal(
        diffEntry('@nerey/fixture', { ...plain, Rule: "type Rule = { on: 'timeout'; ms: number; };" }, plain),
      ).length === 1,
    ]);

    const removed = diffEntry('@nerey/fixture', { ...plain, ghost: '() => void' }, plain);
    outcomes.push([
      'signature-removed',
      removed.some((p) => p.rule === 'signature-removed') && fatal(removed).length === 0,
    ]);

    const withoutSend = Object.fromEntries(Object.entries(plain ?? {}).filter(([name]) => name !== 'send'));
    const added = diffEntry('@nerey/fixture', withoutSend, plain);
    outcomes.push([
      'signature-added',
      added.some((p) => p.rule === 'signature-added') && fatal(added).length === 0,
    ]);

    const unchanged = diffEntry('@nerey/fixture', plain, plain);
    outcomes.push([
      'allows an unchanged surface',
      unchanged.length === 0,
      unchanged.map((p) => p.rule).join(', '),
    ]);

    // A class body is implementation. If this ever fires, the class branch has started rendering
    // member bodies and every refactor becomes a baseline update.
    outcomes.push([
      'renders a class structurally',
      typeof plain?.Boom === 'string' && plain.Boom.startsWith('class Boom {') && !plain.Boom.includes('='),
      plain?.Boom,
    ]);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [rule, ok, detail] of outcomes) {
    const positive = !rule.startsWith('allows ') && !rule.startsWith('renders ');
    if (ok) {
      console.log(`  ✓ check-api-signatures/${rule} — ${positive ? 'rejected its violator' : 'holds'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-api-signatures/${rule} — did NOT reject its violator (gate is broken)`
          : `  ✗ check-api-signatures/${rule} — failed on legal input [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

if (argv.includes('--update-baseline')) {
  const firstRun = !existsSync(BASELINE);
  const previous = loadBaseline({ required: false });
  const { snapshot, problems, symbolCount } = run(previous);
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, serialize(snapshot), 'utf8');

  // Print what was just blessed. A baseline update that silently swallows a signature change is
  // how a MAJOR reaches npm labelled as a patch. On the first write everything is an addition by
  // definition, so the per-symbol list is noise rather than review material.
  console.log(`✓ baseline written: ${relOf(BASELINE)} — ${symbolCount} signature(s)`);
  if (!firstRun && problems.length) {
    console.log(`  ${problems.length} change(s) blessed — check the bump against ADR 0038:`);
    for (const problem of problems) console.log(`    [${problem.rule}] ${problem.message}`);
  }
  process.exit(0);
}

const baseline = loadBaseline({ required: true });
const { problems, symbolCount } = run(baseline);
const blocking = problems.filter((p) => FATAL.has(p.rule));

for (const note of problems.filter((p) => !FATAL.has(p.rule))) {
  console.log(`  [${note.rule}] ${note.message}`);
}

if (blocking.length) {
  console.error(`\n✗ API signatures: ${blocking.length} shape change(s) against ${relOf(BASELINE)}\n`);
  for (const problem of blocking) console.error(`  [${problem.rule}] ${problem.message}`);
  console.error(
    `\n  Classify each one before re-blessing: an added optional field is additive (MINOR, PATCH ` +
      `on 0.x), a removed member or a narrowed parameter is breaking. A break is allowed — it is ` +
      `not allowed to be quiet, so declare it with a \`!\` commit (ADR 0036). Then re-run with ` +
      `\`--update-baseline\` and commit the snapshot in the same commit as the bump (ADR 0038).`,
  );
  process.exit(1);
}

console.log(
  `✓ API signatures: ${symbolCount} signature(s) across ${BARRELS.length} barrel(s) match the baseline`,
);
