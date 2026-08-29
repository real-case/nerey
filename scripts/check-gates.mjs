#!/usr/bin/env node
// scripts/check-gates.mjs
//
// ADR 0033 — the harness that guards the guards.
//
// Every other gate in this repository is a custom script that nobody upstream tests, and such a
// script has a failure mode an ordinary test does not: it can pass for the wrong reason and look
// identical to passing for the right one. A glob that matches nothing iterates zero files and
// exits 0. A regex that stopped matching after a refactor finds nothing and exits 0. A throw
// swallowed by a bare `catch {}` exits 0. CI stays green, the badge stays green, and the rule has
// not been enforced since whenever it quietly broke — which is worse than having no gate, because
// the gate's existence is what stopped anyone from checking the invariant by hand.
//
// What this file asserts:
//
//   1. Registration   every `scripts/check-*.mjs` and `scripts/gen-*.mjs` on disk appears in the
//                     GATES manifest below, and every manifest entry points at a file that
//                     exists. The disk → manifest direction is the whole reason this is a harness
//                     and not a list: a gate nobody registered is a gate nobody proves.
//   2. Self-test      `node <gate> --self-test` exits 0. Each gate already knows how to plant its
//                     own violators; re-implementing that knowledge here would duplicate it and
//                     then drift from it, which is exactly the trap ADR 0034 describes for the
//                     edit hook.
//   3. Blind probe    the same self-test, re-run with the gate's ability to READ the workspace
//                     taken away, must FAIL. See BLIND_SHIM for why this is the load-bearing step.
//   4. Meta-fixture   two throwaway gates with byte-identical output — one honest, one a rubber
//                     stamp — are pushed through steps 2 and 3 on every run. The honest one must
//                     be accepted and the rubber stamp must be caught, so this harness's own
//                     failure path executes on every run rather than on the day something breaks.
//   5. Hooks          every command in `.claude/settings.json` resolves to a file that exists
//                     (ADR 0034). A hook pointing at a renamed script fails OPEN: the rule simply
//                     stops being enforced, and nothing says so.
//   6. Dispatcher     every gate registered as cheap and file-scoped is reachable from the
//                     DISPATCH table in `scripts/hooks/post-edit.mjs`. WARNING, not a failure —
//                     some gates are legitimately too slow or too repo-wide for an edit hook.
//   7. npm wiring     every discovered gate is invoked by some npm script, and every script that
//                     names a `scripts/*.mjs` names one that exists.
//
// Failures: unregistered-gate, missing-gate, self-test-failed, rubber-stamp, meta-fixture-escaped,
// meta-fixture-honest-rejected, unreadable-settings, missing-hook-command, missing-dispatcher,
// unreadable-dispatch, dispatch-missing-gate, unreadable-manifest, missing-npm-script,
// broken-npm-script, missing-check-all. Warnings: unverifiable-hook-command, dispatch-coverage,
// check-all-coverage, check-all-order.
//
// Gates are verified SEQUENTIALLY even though ADR 0033 imagined concurrent fixtures. These gates
// plant their violators inside the live workspace rather than in a sandbox — check-core-purity
// rewrites `packages/core/package.json` for the duration of one assertion, gen-tokens corrupts a
// generated artifact and restores it — so two gates running at once would read each other's
// planted violators and fail for reasons that depend on scheduling. Determinism outranks the
// three seconds concurrency would save.
//
// Usage:
//   node scripts/check-gates.mjs
//   node scripts/check-gates.mjs --self-test   plant a violator per rule, assert each fires

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const SELF_REL = 'scripts/check-gates.mjs';
// Read once, so a failure can cite the manifest LINE that registers the offending gate rather
// than pointing at line 1 of a 700-line file.
const SELF_SOURCE = readFileSync(fileURLToPath(import.meta.url), 'utf8');

const SETTINGS = resolve(repoRoot, '.claude/settings.json');
const SETTINGS_REL = '.claude/settings.json';
const DISPATCHER = resolve(repoRoot, 'scripts/hooks/post-edit.mjs');
const DISPATCHER_REL = 'scripts/hooks/post-edit.mjs';
const PACKAGE_JSON = resolve(repoRoot, 'package.json');
const PACKAGE_REL = 'package.json';

/**
 * The gate manifest. `hook: 'dispatch'` means the gate is cheap and file-scoped enough to belong
 * in the PostToolUse dispatcher (ADR 0034); `hook: 'ci-only'` must say why it is not, because
 * "too slow for a hook" is a claim that should be written down rather than inferred from absence.
 */
const GATES = [
  { script: 'scripts/check-tokens.mjs', hook: 'dispatch' },
  { script: 'scripts/check-core-purity.mjs', hook: 'dispatch' },
  { script: 'scripts/check-data-contract.mjs', hook: 'dispatch' },
  { script: 'scripts/check-public-api.mjs', hook: 'dispatch' },
  { script: 'scripts/check-stories.mjs', hook: 'dispatch' },
  { script: 'scripts/check-widget-labels.mjs', hook: 'dispatch' },
  {
    script: 'scripts/check-a11y-waivers.mjs',
    hook: 'dispatch',
    why: 'reads only story files and is sub-second; an undocumented a11y opt-out is cheapest to catch in the edit that added it (ADR 0032)',
  },
  {
    script: 'scripts/check-adr-citations.mjs',
    hook: 'dispatch',
    why: 'repo-wide but sub-second; a citation typo is cheapest to fix in the edit that made it',
  },
  {
    script: 'scripts/check-api-signatures.mjs',
    hook: 'ci-only',
    why: 'builds a TypeScript program over four barrels — ~1.1s, well past the ~2s the whole hook gets, and `check-public-api` already covers the same files at edit time (ADR 0038)',
  },
  {
    script: 'scripts/check-exports.mjs',
    hook: 'ci-only',
    why: 'packs a tarball and shells out to publint and attw — seconds, not the ~2s the whole hook gets',
  },
  {
    script: 'scripts/check-ci-pins.mjs',
    hook: 'ci-only',
    why: 'reads the workflow directory and package.json rather than the edited file, so a PostToolUse hook has nothing to scope it to (ADR 0043)',
  },
  {
    script: 'scripts/check-published-site.mjs',
    hook: 'ci-only',
    why: 'fetches a deployed site, so it is the one gate here that is neither hermetic nor offline-runnable; it runs in the deploy job after publishing (ADR 0044)',
  },
  {
    script: 'scripts/check-eslint-rules.mjs',
    hook: 'ci-only',
    why: 'imports the shipped config and diffs a committed baseline; it is scoped to one package rather than to the edited file, and a rule surface changes far less often than an edit hook fires (ADR 0045)',
  },
  {
    script: 'scripts/check-commits.mjs',
    hook: 'ci-only',
    why: 'reads git history, not the edited file, so a PostToolUse hook has nothing to scope it to',
  },
  {
    script: 'scripts/gen-tokens.mjs',
    hook: 'ci-only',
    why: 'a generator writes files; the hook surfaces a drift reminder as context instead (ADR 0034)',
  },
  {
    script: 'scripts/gen-release.mjs',
    hook: 'ci-only',
    why: 'prepares a release — it reads git history and writes a manifest and a changelog, which is neither file-scoped nor something an edit should ever trigger (ADR 0039)',
  },
  {
    script: 'scripts/gen-css-types.mjs',
    hook: 'ci-only',
    why: 'a generator writes files; the hook surfaces a drift reminder as context instead (ADR 0034)',
  },
  {
    script: 'scripts/check-gates.mjs',
    hook: 'ci-only',
    why: 'runs every other gate twice; `--self-test` is hermetic and does not re-enter the main run',
  },
];

/** `check:*` scripts deliberately outside `check:all`, each with the reason it is exempt. */
const CHECK_ALL_EXEMPT = new Map([
  ['check:exports', 'needs a build first — CI runs it after `npm run build`'],
  [
    'check:published-site',
    'needs a deployed site and the network — it runs in the deploy job, after publishing',
  ],
]);

/**
 * The blind probe — why the meta-fixture is a real check and not a tautology.
 *
 * Step 2 on its own cannot catch a rubber stamp. A gate whose `--self-test` prints a flawless
 * success report and exits 0 is indistinguishable, by exit code, from a gate that genuinely
 * planted a violator and watched its rule fire. Asserting on the OUTPUT does not rescue it
 * either: anything a real gate prints, a fake one can print, and RUBBER_STAMP_FIXTURE below
 * forges a byte-identical report to make that concrete. Any assertion over stdout is an assertion
 * the fixture's author gets to satisfy by writing a different string, which is the definition of
 * a tautology.
 *
 * So the probe is behavioural. It asks whether the gate's verdict is A FUNCTION OF ITS INPUTS:
 * re-run the same self-test with every data read taken away and demand a different answer. An
 * honest self-test cannot survive that — it plants a violator, reads it back, and asserts a rule
 * fired, so a read that throws turns the assertion false (or crashes the process; both are
 * non-zero and both are the correct signal, because both prove the verdict depended on the read).
 * A gate that never consulted the workspace is unaffected and still exits 0. That difference,
 * unlike anything printed, cannot be forged by a fixture that does no work.
 *
 * Module source is exempted because the ESM loader reads it through this same API. Blinding that
 * too would stop every gate from loading at all — including the rubber stamp — so the probe would
 * "catch" everyone equally and prove nothing.
 *
 * What the probe does NOT prove: that a gate's assertions are the RIGHT assertions. A self-test
 * can read its fixture, assert something narrower than the invariant, and pass both steps. ADR
 * 0033 puts that on review at the moment the fixture is written, which is why fixtures live in
 * the gate rather than here.
 */
const BLIND_SHIM = `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const real = fs.readFileSync;
fs.readFileSync = function (path, ...rest) {
  const target = typeof path === 'string' ? path : (path && path.href) || '';
  if (/\\.(?:mjs|cjs|js)$/.test(target)) return real.call(fs, path, ...rest);
  throw new Error('check-gates blind probe: this gate may not read the workspace');
};
`;

/** Shared by both fixtures so the only difference between them is whether the verdict is earned. */
const FIXTURE_DETECTOR = `import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function detect(text) {
  return text.includes('FORBIDDEN') ? [{ rule: 'no-forbidden' }] : [];
}
`;

/** Reads its planted violator back and reports what it actually found. Must be ACCEPTED. */
const HONEST_FIXTURE = `${FIXTURE_DETECTOR}
if (process.argv.includes('--self-test')) {
  const dir = mkdtempSync(join(tmpdir(), 'nerey-fixture-'));
  const file = join(dir, 'planted.txt');
  let fired = false;
  let silent = false;
  try {
    writeFileSync(file, 'FORBIDDEN\\n', 'utf8');
    fired = detect(readFileSync(file, 'utf8')).length === 1;
    writeFileSync(file, 'legal\\n', 'utf8');
    silent = detect(readFileSync(file, 'utf8')).length === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log('  \\u2713 fixture-gate/no-forbidden — rejected its violator');
  process.exit(fired && silent ? 0 : 1);
}
process.exit(0);
`;

/** Prints the same line without consulting `detect`. Must be CAUGHT by the blind probe. */
const RUBBER_STAMP_FIXTURE = `${FIXTURE_DETECTOR}
if (process.argv.includes('--self-test')) {
  console.log('  \\u2713 fixture-gate/no-forbidden — rejected its violator');
  process.exit(0);
}
process.exit(0);
`;

/** Fails its own self-test outright — the loud failure mode, checked so step 2 stays honest too. */
const BROKEN_FIXTURE = `if (process.argv.includes('--self-test')) {
  console.error('  \\u2717 fixture-gate/no-forbidden — did NOT reject its violator');
  process.exit(1);
}
process.exit(0);
`;

const problem = (rel, line, rule, message) => ({ rel, line, rule, message, warning: false });
const warning = (rel, line, rule, message) => ({ rel, line, rule, message, warning: true });

function lineOfNeedle(text, needle) {
  const at = text.indexOf(needle);
  return at === -1 ? 1 : text.slice(0, at).split('\n').length;
}

/** Sorted, so the report never depends on filesystem iteration order (ADR 0033). */
function discoverGates(root) {
  const dir = resolve(root, 'scripts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .filter((name) => /^(?:check|gen)-[a-z0-9-]+\.mjs$/.test(name))
    .map((name) => `scripts/${name}`);
}

function checkRegistration(discovered, manifest, root) {
  const problems = [];
  const registered = new Set(manifest.map((gate) => gate.script));

  for (const script of discovered) {
    if (registered.has(script)) continue;
    problems.push(
      problem(
        script,
        1,
        'unregistered-gate',
        `is a gate on disk that the GATES manifest in ${SELF_REL} does not list, so nothing ever ` +
          `proves it can fail. Add \`{ script: '${script}', hook: 'dispatch' | 'ci-only' }\` to ` +
          `GATES (ADR 0033).`,
      ),
    );
  }

  for (const gate of manifest) {
    if (existsSync(resolve(root, gate.script))) continue;
    problems.push(
      problem(
        SELF_REL,
        lineOfNeedle(SELF_SOURCE, gate.script),
        'missing-gate',
        `GATES registers \`${gate.script}\`, which does not exist. It was renamed or deleted ` +
          `without updating the manifest — remove the entry, or restore the gate.`,
      ),
    );
  }

  return problems;
}

/** Tokens that look like a script path, quoted or bare. */
function scriptPathsIn(command) {
  return command.match(/[^\s"']*\.(?:mjs|cjs|js|sh|py)\b/g) ?? [];
}

function resolveHookPath(token, root) {
  const expanded = token.replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, root);
  return isAbsolute(expanded) ? expanded : resolve(root, expanded);
}

function hookCommands(settings) {
  const out = [];
  const events = Object.entries(settings?.hooks ?? {}).sort(([a], [b]) => a.localeCompare(b));
  for (const [event, matchers] of events) {
    for (const matcher of Array.isArray(matchers) ? matchers : []) {
      for (const hook of matcher?.hooks ?? []) {
        if (hook?.type === 'command' && typeof hook.command === 'string') {
          out.push({ event, command: hook.command });
        }
      }
    }
  }
  return out;
}

function checkHooks(raw, root, rel) {
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (error) {
    return [
      problem(
        rel,
        1,
        'unreadable-settings',
        `is not valid JSON (${error.message}). Claude Code runs NO hooks at all when it cannot ` +
          `parse this file, and says so nowhere — every edit-time rule in ADR 0034 is off until ` +
          `it is fixed.`,
      ),
    ];
  }

  const problems = [];
  for (const { event, command } of hookCommands(settings)) {
    const line = lineOfNeedle(raw, command);
    const tokens = scriptPathsIn(command);

    if (tokens.length === 0) {
      problems.push(
        warning(
          rel,
          line,
          'unverifiable-hook-command',
          `${event} hook \`${command}\` names no script file, so this harness cannot prove it ` +
            `resolves to anything.`,
        ),
      );
      continue;
    }

    for (const token of tokens) {
      if (existsSync(resolveHookPath(token, root))) continue;
      problems.push(
        problem(
          rel,
          line,
          'missing-hook-command',
          `${event} hook runs \`${token}\`, which does not exist. A hook whose command is missing ` +
            `fails OPEN — the rule stops being enforced and the session looks normal (ADR 0034).`,
        ),
      );
    }
  }

  return problems;
}

function dispatchGates(source) {
  return [...new Set([...source.matchAll(/gate:\s*'([^']+)'/g)].map((match) => match[1]))].sort();
}

function checkDispatch(source, manifest, root, rel) {
  if (source === null) {
    return [
      problem(
        rel,
        1,
        'missing-dispatcher',
        `does not exist, but .claude/settings.json or the manifest still expects it. The ` +
          `edit-time half of the gate layer is off (ADR 0034).`,
      ),
    ];
  }

  const gates = dispatchGates(source);
  if (gates.length === 0) {
    return [
      problem(
        rel,
        1,
        'unreadable-dispatch',
        `no \`gate: '…'\` entry could be parsed out of the DISPATCH table. Either the table is ` +
          `empty or its shape changed — and "the table matched nothing" must never produce the ` +
          `same verdict as "the table is fine" (ADR 0033).`,
      ),
    ];
  }

  const problems = [];
  for (const gate of gates) {
    if (existsSync(resolve(root, gate))) continue;
    problems.push(
      problem(
        rel,
        lineOfNeedle(source, gate),
        'dispatch-missing-gate',
        `DISPATCH points at \`${gate}\`, which does not exist. The hook swallows the failure and ` +
          `every edit it was supposed to guard now passes unchecked (ADR 0034).`,
      ),
    );
  }

  const dispatched = new Set(gates);
  for (const gate of manifest) {
    if (gate.hook !== 'dispatch' || dispatched.has(gate.script)) continue;
    problems.push(
      warning(
        rel,
        1,
        'dispatch-coverage',
        `\`${gate.script}\` is registered as cheap and file-scoped, but no DISPATCH entry reaches ` +
          `it, so it only runs in CI. Add \`{ match: '<glob>', gate: '${gate.script}' }\` to ` +
          `DISPATCH, or change its GATES entry to \`hook: 'ci-only'\` with a \`why\` (ADR 0034).`,
      ),
    );
  }

  return problems;
}

function checkNpmScripts(raw, discovered, root, rel) {
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    return [problem(rel, 1, 'unreadable-manifest', `is not valid JSON (${error.message}).`)];
  }

  const problems = [];
  const scripts = Object.entries(manifest.scripts ?? {}).sort(([a], [b]) => a.localeCompare(b));

  for (const gate of discovered) {
    if (scripts.some(([, command]) => command.includes(gate))) continue;
    problems.push(
      problem(
        rel,
        1,
        'missing-npm-script',
        `no npm script runs \`${gate}\`, so it is a gate that only exists on disk. Add one — a ` +
          `rule CI never invokes is a rule that does not hold.`,
      ),
    );
  }

  for (const [name, command] of scripts) {
    for (const token of command.match(/scripts\/[\w./-]+\.mjs/g) ?? []) {
      if (existsSync(resolve(root, token))) continue;
      problems.push(
        problem(
          rel,
          lineOfNeedle(raw, `"${name}"`),
          'broken-npm-script',
          `\`${name}\` runs \`${token}\`, which does not exist. npm reports the missing file as a ` +
            `plain non-zero exit, which is easy to read as "the gate failed".`,
        ),
      );
    }
  }

  const checkAll = manifest.scripts?.['check:all'];
  if (typeof checkAll !== 'string') {
    problems.push(
      problem(
        rel,
        1,
        'missing-check-all',
        `declares no \`check:all\` script, so no single command runs the gates.`,
      ),
    );
    return problems;
  }

  const referenced = [...checkAll.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1]);
  const reachable = new Set(referenced);
  for (const [name] of scripts) {
    if (!name.startsWith('check:') || name === 'check:all' || CHECK_ALL_EXEMPT.has(name)) continue;
    if (reachable.has(name)) continue;
    problems.push(
      warning(
        rel,
        lineOfNeedle(raw, `"${name}"`),
        'check-all-coverage',
        `\`${name}\` is not reached by \`check:all\`, so it runs only if someone remembers it. ` +
          `Add it to the chain, or record it in CHECK_ALL_EXEMPT in ${SELF_REL} with a reason.`,
      ),
    );
  }

  if (referenced.at(-1) !== 'check:gates') {
    problems.push(
      warning(
        rel,
        lineOfNeedle(raw, '"check:all"'),
        'check-all-order',
        `\`check:all\` ends with \`${referenced.at(-1) ?? 'nothing'}\`. It should end with ` +
          `\`check:gates\`: the harness verifies the gates that just ran, so it reads as the ` +
          `summary of the run rather than a preamble to it.`,
      ),
    );
  }

  return problems;
}

function runSelfTest(scriptAbs, blindShimUrl) {
  const args = blindShimUrl
    ? ['--import', blindShimUrl, scriptAbs, '--self-test']
    : [scriptAbs, '--self-test'];
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error) return { code: 1, output: `could not spawn: ${result.error.message}` };
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd() };
}

/** The verification every registered gate and both meta-fixtures go through, unchanged. */
function verifyGate(scriptAbs, blindShimUrl) {
  const honest = runSelfTest(scriptAbs, null);
  if (honest.code !== 0) return { verdict: 'self-test-failed', output: honest.output };

  const blinded = runSelfTest(scriptAbs, blindShimUrl);
  if (blinded.code === 0) return { verdict: 'rubber-stamp', output: honest.output };

  return { verdict: 'ok', output: honest.output };
}

function readOrNull(absPath) {
  return existsSync(absPath) ? readFileSync(absPath, 'utf8') : null;
}

function run() {
  const discovered = discoverGates(repoRoot);
  const problems = [...checkRegistration(discovered, GATES, repoRoot)];

  const settingsRaw = readOrNull(SETTINGS);
  if (settingsRaw === null) {
    problems.push(
      warning(
        SETTINGS_REL,
        1,
        'unverifiable-hook-command',
        `does not exist, so no edit-time hooks are wired up.`,
      ),
    );
  } else {
    problems.push(...checkHooks(settingsRaw, repoRoot, SETTINGS_REL));
  }

  problems.push(...checkDispatch(readOrNull(DISPATCHER), GATES, repoRoot, DISPATCHER_REL));
  problems.push(...checkNpmScripts(readFileSync(PACKAGE_JSON, 'utf8'), discovered, repoRoot, PACKAGE_REL));

  const workdir = mkdtempSync(join(tmpdir(), 'nerey-gate-harness-'));
  const results = [];
  let meta;
  // Teardown happens BEFORE any exit — `process.exit()` skips `finally` (ADR 0033).
  try {
    const shimPath = join(workdir, 'blind.mjs');
    writeFileSync(shimPath, BLIND_SHIM, 'utf8');
    const shimUrl = pathToFileURL(shimPath).href;

    const honestPath = join(workdir, 'honest-fixture.mjs');
    const stampPath = join(workdir, 'rubber-stamp-fixture.mjs');
    writeFileSync(honestPath, HONEST_FIXTURE, 'utf8');
    writeFileSync(stampPath, RUBBER_STAMP_FIXTURE, 'utf8');

    // The meta-fixtures run FIRST. If the probe itself is broken, every verdict below it is
    // meaningless, and saying so before eleven gate reports is more useful than after.
    meta = { honest: verifyGate(honestPath, shimUrl), stamp: verifyGate(stampPath, shimUrl) };

    for (const gate of GATES) {
      const abs = resolve(repoRoot, gate.script);
      if (!existsSync(abs)) continue; // already reported as missing-gate
      results.push({ gate, ...verifyGate(abs, shimUrl) });
    }
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }

  if (meta.honest.verdict !== 'ok') {
    problems.push(
      problem(
        SELF_REL,
        lineOfNeedle(SELF_SOURCE, 'const HONEST_FIXTURE'),
        'meta-fixture-honest-rejected',
        `the honest meta-fixture — a minimal gate that really does read its planted violator — was ` +
          `rejected as \`${meta.honest.verdict}\`. The harness is over-firing, so every gate verdict ` +
          `in this run is suspect:\n${indent(meta.honest.output, 6)}`,
      ),
    );
  }

  if (meta.stamp.verdict !== 'rubber-stamp') {
    problems.push(
      problem(
        SELF_REL,
        lineOfNeedle(SELF_SOURCE, 'const RUBBER_STAMP_FIXTURE'),
        'meta-fixture-escaped',
        `the rubber-stamp meta-fixture — a gate that exits 0 without checking anything — was ` +
          `accepted as \`${meta.stamp.verdict}\`. The harness can no longer tell a working gate ` +
          `from a decorative one, which means nothing else it reported this run is evidence ` +
          `(ADR 0033).`,
      ),
    );
  }

  for (const result of results) {
    if (result.verdict === 'ok') continue;
    if (result.verdict === 'self-test-failed') {
      problems.push(
        problem(
          result.gate.script,
          1,
          'self-test-failed',
          `\`node ${result.gate.script} --self-test\` exited non-zero: a rule did not reject its own ` +
            `planted violator, or fired on legal input. Fix the gate before trusting anything it ` +
            `passed (ADR 0033).`,
        ),
      );
    } else {
      problems.push(
        problem(
          result.gate.script,
          1,
          'rubber-stamp',
          `its \`--self-test\` still exits 0 with every workspace read blinded, so its verdict does ` +
            `not depend on anything it read. That is a gate reporting success without checking — ` +
            `see the BLIND_SHIM comment in ${SELF_REL} (ADR 0033).`,
        ),
      );
    }
  }

  return { discovered, results, meta, problems };
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return (text || '(no output)')
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n');
}

if (process.argv.includes('--self-test')) {
  // ADR 0033 — the harness proves its own rules the same way it demands of every other gate.
  // This branch never re-enters `run()`, which is why the manifest can register this file
  // alongside the gates it verifies without recursing.
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'nerey-gate-harness-selftest-'));
  const outcomes = [];
  const record = (name, ok, detail = '') => outcomes.push([name, ok, detail]);
  const fires = (problems, rule) => problems.some((p) => p.rule === rule);
  const rules = (problems) => problems.map((p) => p.rule).join(', ');

  try {
    mkdirSync(join(fixtureRoot, 'scripts/hooks'), { recursive: true });
    for (const stub of ['scripts/check-real.mjs', 'scripts/gen-real.mjs', 'scripts/hooks/present.mjs']) {
      writeFileSync(join(fixtureRoot, stub), '', 'utf8');
    }

    const MANIFEST = [
      { script: 'scripts/check-real.mjs', hook: 'dispatch' },
      { script: 'scripts/gen-real.mjs', hook: 'ci-only', why: 'a generator' },
    ];
    const DISCOVERED = ['scripts/check-real.mjs', 'scripts/gen-real.mjs'];
    const DISPATCH_SOURCE = "const DISPATCH = [{ match: 'a/**', gate: 'scripts/check-real.mjs' }];";
    const settings = (command) =>
      JSON.stringify(
        { hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command }] }] } },
        null,
        2,
      );
    const pkg = (scripts) => JSON.stringify({ scripts }, null, 2);
    const CLEAN_SCRIPTS = {
      'check:real': 'node scripts/check-real.mjs',
      'gen:check': 'node scripts/gen-real.mjs --check',
      'check:all': 'npm run check:real && npm run check:gates',
      'check:gates': 'node scripts/check-real.mjs',
    };

    record(
      'unregistered-gate',
      fires(
        checkRegistration([...DISCOVERED, 'scripts/check-ghost.mjs'], MANIFEST, fixtureRoot),
        'unregistered-gate',
      ),
    );
    record(
      'missing-gate',
      fires(
        checkRegistration(
          DISCOVERED,
          [...MANIFEST, { script: 'scripts/check-ghost.mjs', hook: 'ci-only' }],
          fixtureRoot,
        ),
        'missing-gate',
      ),
    );

    record(
      'unreadable-settings',
      fires(checkHooks('{ not json', fixtureRoot, SETTINGS_REL), 'unreadable-settings'),
    );
    record(
      'missing-hook-command',
      fires(
        checkHooks(
          settings('node "$CLAUDE_PROJECT_DIR/scripts/hooks/renamed.mjs"'),
          fixtureRoot,
          SETTINGS_REL,
        ),
        'missing-hook-command',
      ),
    );
    record(
      'unverifiable-hook-command',
      fires(
        checkHooks(settings('npx --yes prettier --check .'), fixtureRoot, SETTINGS_REL),
        'unverifiable-hook-command',
      ),
    );

    record(
      'unreadable-dispatch',
      fires(
        checkDispatch('const DISPATCH = [];', MANIFEST, fixtureRoot, DISPATCHER_REL),
        'unreadable-dispatch',
      ),
    );
    record(
      'missing-dispatcher',
      fires(checkDispatch(null, MANIFEST, fixtureRoot, DISPATCHER_REL), 'missing-dispatcher'),
    );
    record(
      'dispatch-missing-gate',
      fires(
        checkDispatch(
          "const DISPATCH = [{ gate: 'scripts/check-ghost.mjs' }];",
          MANIFEST,
          fixtureRoot,
          DISPATCHER_REL,
        ),
        'dispatch-missing-gate',
      ),
    );
    record(
      'dispatch-coverage',
      fires(
        checkDispatch(
          "const DISPATCH = [{ gate: 'scripts/gen-real.mjs' }];",
          MANIFEST,
          fixtureRoot,
          DISPATCHER_REL,
        ),
        'dispatch-coverage',
      ),
    );

    record(
      'missing-npm-script',
      fires(
        checkNpmScripts(
          pkg({ ...CLEAN_SCRIPTS, 'gen:check': 'echo nope' }),
          DISCOVERED,
          fixtureRoot,
          PACKAGE_REL,
        ),
        'missing-npm-script',
      ),
    );
    record(
      'broken-npm-script',
      fires(
        checkNpmScripts(
          pkg({ ...CLEAN_SCRIPTS, 'check:ghost': 'node scripts/check-ghost.mjs' }),
          DISCOVERED,
          fixtureRoot,
          PACKAGE_REL,
        ),
        'broken-npm-script',
      ),
    );
    record(
      'missing-check-all',
      fires(
        checkNpmScripts(
          pkg({ 'check:real': 'node scripts/check-real.mjs', 'gen:check': 'node scripts/gen-real.mjs' }),
          DISCOVERED,
          fixtureRoot,
          PACKAGE_REL,
        ),
        'missing-check-all',
      ),
    );
    record(
      'check-all-coverage',
      fires(
        checkNpmScripts(
          pkg({ ...CLEAN_SCRIPTS, 'check:orphan': 'node scripts/check-real.mjs' }),
          DISCOVERED,
          fixtureRoot,
          PACKAGE_REL,
        ),
        'check-all-coverage',
      ),
    );
    record(
      'check-all-order',
      fires(
        checkNpmScripts(
          pkg({ ...CLEAN_SCRIPTS, 'check:all': 'npm run check:gates && npm run check:real' }),
          DISCOVERED,
          fixtureRoot,
          PACKAGE_REL,
        ),
        'check-all-order',
      ),
    );

    // A gate that fires on everything is as broken as one that fires on nothing.
    const cleanRegistration = checkRegistration(DISCOVERED, MANIFEST, fixtureRoot);
    record(
      'allows a fully registered scripts/ directory',
      cleanRegistration.length === 0,
      rules(cleanRegistration),
    );
    const cleanHooks = checkHooks(
      settings('node "$CLAUDE_PROJECT_DIR/scripts/hooks/present.mjs"'),
      fixtureRoot,
      SETTINGS_REL,
    );
    record('allows a hook command that resolves', cleanHooks.length === 0, rules(cleanHooks));
    const cleanDispatch = checkDispatch(DISPATCH_SOURCE, MANIFEST, fixtureRoot, DISPATCHER_REL);
    record(
      'allows a dispatcher covering every file-scoped gate',
      cleanDispatch.length === 0,
      rules(cleanDispatch),
    );
    const cleanScripts = checkNpmScripts(pkg(CLEAN_SCRIPTS), DISCOVERED, fixtureRoot, PACKAGE_REL);
    record('allows a fully wired package.json', cleanScripts.length === 0, rules(cleanScripts));

    // The parsers must never mistake "matched nothing" for "nothing is wrong", so each one is
    // pointed at the live artifact it will meet in the real run.
    record(
      'parses the live .claude/settings.json',
      hookCommands(JSON.parse(readFileSync(SETTINGS, 'utf8'))).length > 0,
    );
    record('parses the live DISPATCH table', dispatchGates(readFileSync(DISPATCHER, 'utf8')).length > 0);
    record(
      'parses the live package.json scripts',
      Object.keys(JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).scripts ?? {}).length > 0,
    );
    record('discovers the live gates on disk', discoverGates(repoRoot).length > 0);

    // The verification itself, on the three fixtures — the same `verifyGate` the real run uses.
    const shimPath = join(fixtureRoot, 'blind.mjs');
    writeFileSync(shimPath, BLIND_SHIM, 'utf8');
    const shimUrl = pathToFileURL(shimPath).href;
    const fixture = (name, source) => {
      const path = join(fixtureRoot, name);
      writeFileSync(path, source, 'utf8');
      return path;
    };

    const stamp = verifyGate(fixture('rubber-stamp.mjs', RUBBER_STAMP_FIXTURE), shimUrl);
    record('rubber-stamp', stamp.verdict === 'rubber-stamp', stamp.verdict);
    const broken = verifyGate(fixture('broken.mjs', BROKEN_FIXTURE), shimUrl);
    record('self-test-failed', broken.verdict === 'self-test-failed', broken.verdict);
    const honest = verifyGate(fixture('honest.mjs', HONEST_FIXTURE), shimUrl);
    record('allows an honest gate', honest.verdict === 'ok', honest.verdict);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  const PASS = {
    violator: 'rejected its violator',
    silence: 'stayed silent',
    invariant: 'holds',
  };
  const FAIL = {
    violator: 'did NOT reject its violator (the harness is broken)',
    silence: 'fired on LEGAL input [DETAIL] (the harness over-fires)',
    invariant: 'does NOT hold — the parser matched nothing on the live artifact it will meet',
  };

  let failures = 0;
  for (const [name, ok, detail] of outcomes) {
    const kind = name.startsWith('allows ')
      ? 'silence'
      : name.startsWith('parses ') || name.startsWith('discovers ')
        ? 'invariant'
        : 'violator';
    if (ok) {
      console.log(`  ✓ check-gates/${name} — ${PASS[kind]}`);
    } else {
      failures++;
      console.error(`  ✗ check-gates/${name} — ${FAIL[kind].replace('DETAIL', detail)}`);
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

const { discovered, results, meta, problems } = run();
const errors = problems.filter((p) => !p.warning);
const warnings = problems.filter((p) => p.warning);
const passed = results.filter((r) => r.verdict === 'ok').length;

console.log(`gate harness (ADR 0033) — ${discovered.length} gate(s) on disk, ${GATES.length} registered\n`);
console.log(`▸ meta-fixture / honest twin    ${meta.honest.verdict === 'ok' ? 'accepted' : 'REJECTED'}`);
console.log(
  `▸ meta-fixture / rubber stamp   ${meta.stamp.verdict === 'rubber-stamp' ? 'caught' : 'ESCAPED'}\n`,
);

for (const result of results) {
  console.log(`▸ ${result.gate.script}`);
  console.log(indent(result.output, 4));
}

if (warnings.length) {
  console.log('');
  for (const w of warnings) console.log(`  ⚠ ${w.rel}:${w.line}  [${w.rule}] ${w.message}`);
}

const summary = `${GATES.length} gates registered, ${passed} self-tests passed, ${warnings.length} warning(s)`;

if (errors.length) {
  console.error(`\n✗ gate harness: ${errors.length} problem(s) — ${summary}\n`);
  for (const e of errors) console.error(`  ${e.rel}:${e.line}  [${e.rule}] ${e.message}`);
  console.error('\n  A gate that cannot fail is not evidence that the rule holds (ADR 0033).');
  process.exit(1);
}

console.log(`\n✓ gate harness: ${summary}`);
