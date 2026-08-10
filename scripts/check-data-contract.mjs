#!/usr/bin/env node
// scripts/check-data-contract.mjs
//
// ADR 0020 / 0029 — the `data-*` attribute surface is @nerey/core's PUBLIC STYLING API. A
// consumer styles Nerey entirely from their own CSS by selecting on these attributes, so
// renaming one, adding a `data-state` value, or inventing a `data-nerey-*` name is a MAJOR
// release — as expensive as changing an exported function signature, and far easier to do by
// accident because nothing in TypeScript objects to a string in JSX.
//
// Three rules:
//
//   contract-drift        `NEREY_ATTR` / `NEREY_STATES` differ from the committed baseline at
//                         docs/design-system/data-contract.json. This is the MAJOR-bump alarm.
//   unknown-state-value   a `data-state="…"` literal under packages/*/src whose value is not in
//                         `NEREY_STATES` — a widget inventing its own state vocabulary, which is
//                         how a styling contract rots one widget at a time.
//   unprefixed-attribute  a `data-nerey-*` attribute used under packages/*/src that no one
//                         declared.
//
// `data-attrs.ts` is READ, never imported: it is TypeScript, and a gate that needs a transpiler
// is a gate that breaks the first time the build config moves. The parse fails loudly if either
// declaration stops matching, because "the regex found nothing" and "the contract is clean" must
// never produce the same exit code (ADR 0033).
//
// Usage:
//   node scripts/check-data-contract.mjs
//   node scripts/check-data-contract.mjs --update-baseline   rewrite the baseline, deliberately
//   node scripts/check-data-contract.mjs --self-test         plant a violator per rule

import { readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const SOURCE = resolve(repoRoot, 'packages/core/src/data-attrs.ts');
const BASELINE = resolve(repoRoot, 'docs/design-system/data-contract.json');
const PACKAGES = resolve(repoRoot, 'packages');
const BASELINE_REL = relative(repoRoot, BASELINE).split(sep).join('/');

/**
 * `data-nerey-*` names that belong to the contract but are not spelled in `NEREY_ATTR`.
 *
 * ADR 0017 introduced the placement pair after ADR 0020's vocabulary was written, and
 * `packages/core/src/slots/placement.ts` declares them locally so the contract module keeps a
 * single owner. They are enumerated here rather than pattern-matched away: adding a name to this
 * constant is a deliberate, reviewable act, exactly like adding one to `NEREY_ATTR`. A wildcard
 * escape hatch would turn this rule off without anyone editing it.
 */
const EXTERNALLY_DECLARED_ATTRS = new Set(['data-nerey-scope', 'data-nerey-position']);

// Which attributes have an OPEN value set, and why only `data-state` gets a value rule below:
//
//   part      OPEN — part names are widget/theme-defined; inventing one is the intended usage.
//   widget    OPEN — the value is the consumer's registry `type`.
//   version   OPEN — a semver string.
//   theme     OPEN — `light` / `dark` today, but a consumer may pin their own (ADR 0027).
//   slot      closed, but its values come from the `Placement` union — tsc already rejects an
//   status    invention at the only place these are written, and a regex here would duplicate
//   fallback  that check worse than the type system does it.
//   state     closed AND routinely hand-written as a bare string in JSX and in CSS selectors,
//             where no type is looking. That gap is exactly what `unknown-state-value` covers.

const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.css'];

/**
 * Test files are excluded on purpose. `packages/core/src/testing/conformance.test.tsx` plants
 * `data-state="wobbly"` and `data-state="humming"` deliberately, to prove the conformance kit
 * rejects them — firing on a negative fixture would teach people to delete the fixture, which
 * costs more than the rule buys.
 */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', '__fixtures__', '__mocks__', '__snapshots__']);

/**
 * A `data-state` written as a markup attribute or a CSS attribute selector.
 *
 * The optional operator group catches `[data-state^="loc"]` and friends: a substring matcher is
 * not a claim about the whole value, so it is skipped rather than reported as an unknown state.
 * The unquoted alternative is honoured only in CSS — in TypeScript the right-hand side of
 * `data-state=` is an expression (`data-state={state}`), not a literal.
 */
const STATE_ATTRIBUTE_RE = /(?<![\w-])data-state\s*([~^$*|]?)=\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z][\w-]*))/g;

/** A `data-state` written as an object key, e.g. `{ 'data-state': 'locked' }`. */
const STATE_PROPERTY_RE = /(['"])data-state\1\s*:\s*(?:'([^']*)'|"([^"]*)")/g;

/** Any `data-nerey-*` name. Interpolated names (`data-nerey-${k}`) cannot match, and should not. */
const NEREY_ATTRIBUTE_RE = /data-nerey-[a-z0-9]+(?:-[a-z0-9]+)*/g;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function toPosix(absPath) {
  return relative(repoRoot, absPath).split(sep).join('/');
}

// ---------------------------------------------------------------------------------------------
// Reading the live contract
// ---------------------------------------------------------------------------------------------

/**
 * Pull `NEREY_ATTR` and `NEREY_STATES` out of `data-attrs.ts` textually.
 *
 * Every failure path throws. An empty result must never be reported as an intact contract: that
 * is the "the gate scanned nothing and exited 0" mode ADR 0033 exists to close.
 */
function parseContract(source) {
  const attrBlock = source.match(/export\s+const\s+NEREY_ATTR\s*=\s*\{([\s\S]*?)\}\s*as\s+const\s*;/);
  if (!attrBlock) {
    throw new Error(
      'could not find `export const NEREY_ATTR = { … } as const;` in packages/core/src/data-attrs.ts. ' +
        'If the declaration moved or changed shape, this gate must be updated with it — it cannot ' +
        'protect a contract it can no longer read.',
    );
  }

  const attributes = {};
  for (const m of attrBlock[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*['"]([^'"]+)['"]/g)) {
    attributes[m[1]] = m[2];
  }
  if (Object.keys(attributes).length === 0) {
    throw new Error('`NEREY_ATTR` parsed to zero entries — the contract cannot be empty.');
  }

  const stateBlock = source.match(/export\s+const\s+NEREY_STATES\s*=\s*\[([\s\S]*?)\]\s*as\s+const\s*;/);
  if (!stateBlock) {
    throw new Error(
      'could not find `export const NEREY_STATES = [ … ] as const;` in packages/core/src/data-attrs.ts.',
    );
  }
  const states = [...stateBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  if (states.length === 0) {
    throw new Error('`NEREY_STATES` parsed to zero entries — the state vocabulary cannot be empty.');
  }

  return { attributes, states };
}

/**
 * Declaration order is preserved rather than sorted, so the committed baseline reads like the
 * source it mirrors. Order is NOT part of the contract — the comparison below is set-based,
 * because reordering an enumeration breaks nobody's stylesheet and must not be announced as a
 * major bump.
 */
function serialiseContract(contract) {
  return `${JSON.stringify({ attributes: contract.attributes, states: contract.states }, null, 2)}\n`;
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return null;
  const parsed = JSON.parse(readFileSync(BASELINE, 'utf8'));
  if (!parsed || typeof parsed.attributes !== 'object' || !Array.isArray(parsed.states)) {
    throw new Error(
      `${BASELINE_REL} is not a data contract — it must be ` +
        `{ "attributes": { "<key>": "data-nerey-…" }, "states": ["idle", …] }.`,
    );
  }
  return { attributes: parsed.attributes, states: parsed.states };
}

// ---------------------------------------------------------------------------------------------
// Rule 1 — contract-drift
// ---------------------------------------------------------------------------------------------

function diffContract(live, baseline) {
  const liveKeys = Object.keys(live.attributes).sort();
  const baseKeys = Object.keys(baseline.attributes).sort();
  const liveStates = [...live.states].sort();
  const baseStates = [...baseline.states].sort();

  return {
    addedAttributes: liveKeys.filter((k) => !(k in baseline.attributes)),
    removedAttributes: baseKeys.filter((k) => !(k in live.attributes)),
    changedAttributes: liveKeys.filter(
      (k) => k in baseline.attributes && live.attributes[k] !== baseline.attributes[k],
    ),
    addedStates: liveStates.filter((s) => !baseStates.includes(s)),
    removedStates: baseStates.filter((s) => !liveStates.includes(s)),
  };
}

function isDrifted(diff) {
  return Object.values(diff).some((entries) => entries.length > 0);
}

/**
 * The wording matters as much as the detection. Whoever hits this failure is one flag away from
 * "making it pass", and the flag is the correct fix for exactly one of the two reasons they can
 * be here — so the message has to distinguish them before it names the flag.
 */
function driftProblems(live, baseline) {
  if (!baseline) {
    return [
      {
        rel: BASELINE_REL,
        line: 1,
        rule: 'contract-drift',
        message:
          'the committed baseline is missing, so nothing is protecting the public styling ' +
          'surface (ADR 0020).\n      Run `node scripts/check-data-contract.mjs --update-baseline` ' +
          'and commit the result.',
      },
    ];
  }

  const diff = diffContract(live, baseline);
  if (!isDrifted(diff)) return [];

  const lines = [];
  for (const key of diff.addedAttributes) lines.push(`+ attribute  ${key} = "${live.attributes[key]}"`);
  for (const key of diff.removedAttributes) {
    lines.push(`- attribute  ${key} = "${baseline.attributes[key]}"`);
  }
  for (const key of diff.changedAttributes) {
    lines.push(`~ attribute  ${key}: "${baseline.attributes[key]}" → "${live.attributes[key]}"`);
  }
  for (const state of diff.addedStates) lines.push(`+ state      "${state}"`);
  for (const state of diff.removedStates) lines.push(`- state      "${state}"`);

  return [
    {
      rel: BASELINE_REL,
      line: 1,
      rule: 'contract-drift',
      message:
        'the live data-* surface no longer matches the committed baseline.\n\n' +
        lines.map((l) => `      ${l}`).join('\n') +
        "\n\n      This surface is @nerey/core's PUBLIC styling API (ADR 0020). Changing it is a " +
        'BREAKING\n      CHANGE that requires a MAJOR version bump (ADR 0029): every consumer ' +
        'stylesheet that\n      selects on the old attribute silently stops matching the day this ' +
        'ships.\n\n      If the change is NOT intended, revert packages/core/src/data-attrs.ts.\n' +
        '      If it IS intended, run `node scripts/check-data-contract.mjs --update-baseline` and ' +
        'commit\n      the new baseline in the SAME commit as the major version bump and the ' +
        'changelog entry.\n      Updating the baseline on its own does not make the change safe — ' +
        'it only makes it quiet,\n      which is the failure this gate exists to prevent.',
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Rules 2 and 3 — scanning source
// ---------------------------------------------------------------------------------------------

/** CSS has no line comments, so a `//` inside a `url()` must not eat the rest of the line. */
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
}

/**
 * Advance past a delimited run (string, template literal or regex literal) WITHOUT touching the
 * output. Only comments get blanked; string contents stay scannable, because a `data-nerey-*`
 * name written in a string is a name in use.
 */
function skipDelimited(text, start, delimiter) {
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (delimiter === '/' && ch === '[') {
      // A regex character class may hold an unescaped `/`, which would otherwise close it early.
      while (i < text.length && text[i] !== ']') {
        if (text[i] === '\\') i++;
        i++;
      }
      continue;
    }
    // An unterminated "regex" was a division sign; give up and let the caller re-read one char.
    if (delimiter === '/' && ch === '\n') return start + 1;
    if (ch === delimiter) return i + 1;
  }
  return text.length;
}

/** After one of these, a `/` opens a regex literal rather than dividing. */
const REGEX_MAY_FOLLOW = new Set(['', '=', '(', ',', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '~']);

/**
 * Blank out comments so a name MENTIONED in prose does not read as one USED in markup — several
 * files legitimately discuss attributes they do not emit.
 *
 * Characters become spaces rather than disappearing, so every reported line number still matches
 * the file on disk. Strings, template literals and regex literals are skipped rather than parsed:
 * a regex such as `/['"]/` would otherwise open a phantom string and desynchronise the scanner
 * for the rest of the file.
 */
function stripJsComments(text) {
  const out = [...text];
  let previous = '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; i < stop; i++) if (out[i] !== '\n') out[i] = ' ';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipDelimited(text, i, ch);
      previous = ch;
      continue;
    }
    if (ch === '/' && REGEX_MAY_FOLLOW.has(previous)) {
      i = skipDelimited(text, i, '/');
      previous = '/';
      continue;
    }
    if (!/\s/.test(ch)) previous = ch;
    i++;
  }

  return out.join('');
}

function checkFile(absPath, contract) {
  const rel = toPosix(absPath);
  const raw = readFileSync(absPath, 'utf8');
  const isCss = absPath.endsWith('.css');
  // Same length as `raw`, so every match index maps straight back to a real line number.
  const text = isCss ? stripCssComments(raw) : stripJsComments(raw);

  const problems = [];
  const add = (index, rule, message) => problems.push({ rel, line: lineOf(raw, index), rule, message });

  const states = new Set(contract.states);
  const declared = new Set(
    Object.values(contract.attributes).filter((value) => value.startsWith('data-nerey-')),
  );

  const reportState = (index, value) => {
    // `${…}` is a runtime value, not a literal; asserting on the source text would be theatre.
    if (value.includes('${') || states.has(value)) return;
    add(
      index,
      'unknown-state-value',
      `\`data-state="${value}"\` is not in NEREY_STATES {${contract.states.join(', ')}} — a widget ` +
        `may not invent its own state vocabulary (ADR 0020). Either use an existing value, or add ` +
        `one to packages/core/src/data-attrs.ts and take the MAJOR bump (ADR 0029).`,
    );
  };

  for (const m of text.matchAll(STATE_ATTRIBUTE_RE)) {
    if (m[1]) continue; // `^=`, `*=`, `|=` … — a substring matcher says nothing about the value.
    const value = m[2] ?? m[3] ?? (isCss ? m[4] : undefined);
    if (value !== undefined) reportState(m.index, value);
  }
  for (const m of text.matchAll(STATE_PROPERTY_RE)) {
    reportState(m.index, m[2] ?? m[3]);
  }

  for (const m of text.matchAll(NEREY_ATTRIBUTE_RE)) {
    const name = m[0];
    if (declared.has(name) || EXTERNALLY_DECLARED_ATTRS.has(name)) continue;
    add(
      m.index,
      'unprefixed-attribute',
      `\`${name}\` is not declared in NEREY_ATTR (packages/core/src/data-attrs.ts). The ` +
        `\`data-nerey-*\` namespace is a closed, versioned surface (ADR 0020): use ` +
        `\`data-nerey-part="…"\`, whose VALUES are open by design, or declare the attribute and ` +
        `take the MAJOR bump (ADR 0029).`,
    );
  }

  return problems;
}

/** Sorted at every level, so the reported order never depends on filesystem iteration order. */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.') || SKIPPED_DIRECTORIES.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (entry.endsWith('.d.ts') || TEST_FILE.test(entry)) continue;
    if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) out.push(full);
  }
  return out;
}

function collectFiles() {
  if (!existsSync(PACKAGES)) return [];
  return readdirSync(PACKAGES)
    .sort()
    .flatMap((name) => walk(join(PACKAGES, name, 'src')));
}

function run() {
  const live = parseContract(readFileSync(SOURCE, 'utf8'));
  const baseline = loadBaseline();
  const files = collectFiles();
  const problems = [...driftProblems(live, baseline), ...files.flatMap((file) => checkFile(file, live))];
  return { live, files, problems };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const argv = process.argv.slice(2);

if (argv.includes('--self-test')) {
  // ADR 0033 — every rule rejects its own violator, and stays silent on legal input.
  const live = parseContract(readFileSync(SOURCE, 'utf8'));

  // The drift rule is exercised in memory. Corrupting the real baseline on disk would leave the
  // repository broken if anything between the write and the restore threw.
  const DRIFT_CASES = [
    ['renamed attribute', (c) => ({ ...c, attributes: { ...c.attributes, widget: 'data-nerey-thing' } })],
    ['added attribute', (c) => ({ ...c, attributes: { ...c.attributes, invented: 'data-nerey-invented' } })],
    ['removed attribute', (c) => ({ ...c, attributes: omit(c.attributes, 'slot') })],
    ['added state', (c) => ({ ...c, states: [...c.states, 'hovering'] })],
    ['removed state', (c) => ({ ...c, states: c.states.filter((s) => s !== 'locked') })],
    ['missing baseline', () => null],
  ];

  const DRIFT_ALLOWED = [
    ['an identical contract', (c) => structuredClone(c)],
    // Order is presentation, not contract — announcing a reorder as a major bump would be a lie.
    ['a reordered state list', (c) => ({ ...c, states: [...c.states].reverse() })],
  ];

  const FIXTURE_DIR = resolve(repoRoot, 'packages/core/src/__datacontract__');
  const CASES = [
    ['unknown-state-value', 'planted.tsx', '<span data-nerey-part="body" data-state="wobbly" />;'],
    ['unknown-state-value', 'planted.tsx', "const a = { 'data-state': 'humming' };"],
    ['unknown-state-value', 'planted.css', '[data-state=hovering] { color: red; }'],
    ['unprefixed-attribute', 'planted.tsx', '<span data-nerey-invented="x" />;'],
    ['unprefixed-attribute', 'planted.css', '[data-nerey-invented] { color: red; }'],
  ];

  /**
   * A gate that fires on everything is as broken as one that fires on nothing. The hazards here
   * are prose (files discuss attributes they never emit), open value sets (`data-nerey-part`),
   * and runtime expressions that only look like literals.
   */
  const ALLOWED = [
    [
      'a legal state on an invented part',
      'planted.tsx',
      '<b data-nerey-part="anything" data-state="locked" />;',
    ],
    [
      'every declared state',
      'planted.tsx',
      `const s = ${JSON.stringify(live.states)};\n<b data-state="${live.states[0]}" />;`,
    ],
    ['an expression-valued data-state', 'planted.tsx', '<b data-state={state} />;'],
    ['an object value that is not a literal', 'planted.tsx', "const a = { 'data-state': state };"],
    ['a type annotation', 'planted.tsx', "type T = { 'data-state'?: NereyState };"],
    ['an interpolated selector', 'planted.tsx', 'const sel = `[data-state="${s}"]`;'],
    ['a line comment', 'planted.tsx', '// data-nerey-invented and data-state="wobbly" are prose here'],
    ['a block comment', 'planted.tsx', '/**\n * data-nerey-invented, data-state="wobbly"\n */'],
    // Directly exercises the regex-literal branch of the comment stripper: get this wrong and the
    // phantom string swallows the comment, which then reads as code.
    ['a regex literal before a comment', 'planted.tsx', 'const RE = /[\'"]/; // data-nerey-invented'],
    ['a substring selector', 'planted.css', '[data-state^="loc"] { color: red; }'],
    ['a declared selector', 'planted.css', "[data-nerey-part='option'][data-state='locked'] { color: red; }"],
    [
      'the ADR 0017 placement pair',
      'planted.tsx',
      "const p = 'data-nerey-position', s = 'data-nerey-scope';",
    ],
  ];

  /**
   * The parse is the single point where this gate can go quietly dead: rename the constant, wrap
   * it in a helper, and a regex-based reader finds nothing, compares nothing, and exits 0 with a
   * confident summary. Each of these must THROW rather than return an empty contract (ADR 0033).
   */
  const PARSE_CASES = [
    ['a renamed NEREY_ATTR', readFileSync(SOURCE, 'utf8').replace('NEREY_ATTR', 'NEREY_ATTRIBUTES')],
    ['a renamed NEREY_STATES', readFileSync(SOURCE, 'utf8').replace('NEREY_STATES', 'NEREY_STATE_LIST')],
    [
      'an empty NEREY_ATTR',
      'export const NEREY_ATTR = {} as const;\nexport const NEREY_STATES = [] as const;',
    ],
  ];

  const outcomes = [];

  for (const [label, source] of PARSE_CASES) {
    let threw = false;
    try {
      parseContract(source);
    } catch {
      threw = true;
    }
    outcomes.push([`unreadable-contract/${label}`, threw]);
  }

  for (const [label, mutate] of DRIFT_CASES) {
    const problems = driftProblems(live, mutate(live));
    outcomes.push([`contract-drift/${label}`, problems.some((p) => p.rule === 'contract-drift')]);
  }
  for (const [label, mutate] of DRIFT_ALLOWED) {
    const problems = driftProblems(live, mutate(live));
    outcomes.push([`allows ${label}`, problems.length === 0, problems.map((p) => p.rule).join(', ')]);
  }

  // The fixture is torn down BEFORE any exit — `process.exit()` skips `finally`.
  try {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    for (const [rule, name, code] of CASES) {
      const fixture = join(FIXTURE_DIR, name);
      writeFileSync(fixture, code, 'utf8');
      outcomes.push([`${rule} (${name})`, checkFile(fixture, live).some((p) => p.rule === rule)]);
      rmSync(fixture, { force: true });
    }
    for (const [label, name, code] of ALLOWED) {
      const fixture = join(FIXTURE_DIR, name);
      writeFileSync(fixture, code, 'utf8');
      const found = checkFile(fixture, live);
      outcomes.push([`allows ${label}`, found.length === 0, found.map((p) => p.rule).join(', ')]);
      rmSync(fixture, { force: true });
    }
  } finally {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [label, ok, detail] of outcomes) {
    const positive = !label.startsWith('allows ');
    if (ok) {
      console.log(
        `  ✓ check-data-contract/${label} — ${positive ? 'rejected its violator' : 'stayed silent'}`,
      );
    } else {
      console.error(
        positive
          ? `  ✗ check-data-contract/${label} — did NOT reject its violator (gate is broken)`
          : `  ✗ check-data-contract/${label} — fired on legal input [${detail}] (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

/** Object rest in a loop body reads worse than a named helper for one self-test case. */
function omit(object, key) {
  const copy = { ...object };
  delete copy[key];
  return copy;
}

if (argv.includes('--update-baseline')) {
  let live;
  try {
    live = parseContract(readFileSync(SOURCE, 'utf8'));
  } catch (error) {
    console.error(`✗ data contract: ${error.message}`);
    process.exit(1);
  }

  const previous = existsSync(BASELINE) ? loadBaseline() : null;
  mkdirSync(dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, serialiseContract(live), 'utf8');

  console.log(
    `✓ wrote ${BASELINE_REL} — ${Object.keys(live.attributes).length} attribute(s), ` +
      `${live.states.length} state(s)`,
  );
  if (previous && isDrifted(diffContract(live, previous))) {
    console.log(
      '  The public styling surface moved. Commit this file together with the MAJOR version bump ' +
        'and\n  the changelog entry it requires (ADR 0029) — on its own it records a break rather ' +
        'than announcing one.',
    );
  }
  process.exit(0);
}

let result;
try {
  result = run();
} catch (error) {
  console.error(`✗ data contract: ${error.message}`);
  process.exit(1);
}

const { live, files, problems } = result;

if (problems.length) {
  console.error(`✗ data contract: ${problems.length} violation(s) across ${files.length} file(s)\n`);
  for (const p of problems) console.error(`  ${p.rel}:${p.line}  [${p.rule}] ${p.message}\n`);
  console.error('  Reference: docs/decisions/0020-data-attribute-styling-contract.md');
  process.exit(1);
}

console.log(
  `✓ data contract: ${Object.keys(live.attributes).length} attribute(s) and ${live.states.length} ` +
    `state(s) match the baseline; ${files.length} source file(s) clean`,
);
