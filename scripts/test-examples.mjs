#!/usr/bin/env node
// scripts/test-examples.mjs
//
// Production-ready plan, phase 5 (steps 5.2 and 5.4) — build an example application against the
// packages AS PUBLISHED, then run its smoke test.
//
// Inside the workspace every `@nerey/*` import resolves through a symlink to the package
// directory, so a file missing from `files`, a wrong `exports` target or a `'use client'` banner on
// the wrong entry is invisible: the source is right there. A consumer gets a tarball. So this script
// gives the example a tarball too:
//
//   1. `npm pack` every `@nerey/*` package the example depends on, from its built `dist`;
//   2. copy the example OUT of the repository, into a temporary directory, so no workspace,
//      symlink, tsconfig path or hoisted dependency of this repo can reach it;
//   3. point each `@nerey/*` dependency at its tarball and `npm install`;
//   4. assert each `@nerey/*` package arrived as a real directory with no `src/`;
//   5. `next build`, then the example's Playwright smoke against `next start`.
//
// It is not a `check:*` gate: it needs a build, the network for the example's own dependencies and
// a browser, so it runs as its own CI job (`examples`) rather than in `check:all`.
//
// Usage:
//   npm run build && node scripts/test-examples.mjs [--example next-rsc] [--keep] [--skip-smoke]

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const at = argv.indexOf(name);
  return at !== -1 && argv[at + 1] ? argv[at + 1] : fallback;
};

const exampleName = option('--example', 'next-rsc');
const exampleDir = join(repoRoot, 'examples', exampleName);
/** Never copied: build output, installed modules and test artefacts of a local run. */
const SKIP = new Set(['node_modules', '.next', 'test-results', 'playwright-report', 'next-env.d.ts']);

/** Thrown rather than exiting, so the `finally` below still removes the work directory. */
class ExampleFailure extends Error {}

function fail(message) {
  throw new ExampleFailure(message);
}

function run(command, args, cwd, extraEnv = {}) {
  console.log(`\n$ ${command} ${args.join(' ')}   (in ${cwd})`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...extraEnv },
  });
  if (result.status !== 0)
    fail(`\`${command} ${args.join(' ')}\` exited with ${result.status ?? result.signal}`);
}

/** `@nerey/core` → its workspace directory, by reading each package's manifest. */
function workspacePackages() {
  const map = new Map();
  for (const entry of readdirSync(join(repoRoot, 'packages')).sort()) {
    const manifestPath = join(repoRoot, 'packages', entry, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    map.set(manifest.name, { dir: join(repoRoot, 'packages', entry), manifest });
  }
  return map;
}

if (!existsSync(join(exampleDir, 'package.json'))) {
  console.error(`✗ examples: no example at examples/${exampleName}`);
  process.exit(1);
}

const exampleManifest = JSON.parse(readFileSync(join(exampleDir, 'package.json'), 'utf8'));
const packages = workspacePackages();
const wanted = Object.keys(exampleManifest.dependencies ?? {}).filter((name) => name.startsWith('@nerey/'));
if (wanted.length === 0) {
  console.error(`✗ examples: examples/${exampleName} depends on no @nerey/* package — nothing to test`);
  process.exit(1);
}

// The work directory lives outside the repository on purpose: npm walks up from the install
// directory looking for a workspace root, and finding this one would link the packages again.
const work = mkdtempSync(join(tmpdir(), `nerey-example-${exampleName}-`));
const tarballs = join(work, 'tarballs');
const app = join(work, exampleName);
mkdirSync(tarballs);

try {
  // 1. Pack from dist. `npm pack` runs no build: a missing dist is a missing build, said plainly.
  const specs = {};
  for (const name of wanted) {
    const pkg = packages.get(name);
    if (!pkg) fail(`examples/${exampleName} depends on ${name}, which is not a package under packages/`);
    if (!existsSync(join(pkg.dir, 'dist'))) fail(`${name} has no dist/ — run \`npm run build\` first`);
    const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', tarballs], {
      cwd: pkg.dir,
      encoding: 'utf8',
    });
    if (packed.status !== 0) fail(`npm pack failed for ${name}:\n${packed.stderr}`);
    const [{ filename }] = JSON.parse(packed.stdout);
    specs[name] = `file:${join(tarballs, filename)}`;
    console.log(`  packed ${name} → ${filename}`);
  }

  // 2 + 3. Copy the example, rewire its @nerey/* dependencies to the tarballs, install.
  cpSync(exampleDir, app, { recursive: true, filter: (src) => !SKIP.has(src.split(/[\\/]/).pop()) });
  const manifest = { ...exampleManifest, dependencies: { ...exampleManifest.dependencies, ...specs } };
  writeFileSync(join(app, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  // The workspace copy maps `@nerey/*` to source in `paths`, so lint and the editor work before a
  // build. A consumer has no such mapping, and leaving it in would type-check against the source
  // instead of the shipped declarations — the exact thing this script exists to avoid.
  const tsconfigPath = join(app, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
    delete tsconfig.compilerOptions?.paths;
    writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`, 'utf8');
  }
  run('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock'], app);

  // 4. What landed must be the tarball, not a link back into the repository.
  for (const name of wanted) {
    const installed = join(app, 'node_modules', ...name.split('/'));
    if (!existsSync(installed)) fail(`${name} is not installed in the example`);
    if (lstatSync(installed).isSymbolicLink())
      fail(`${name} was installed as a symlink, not from its tarball`);
    if (existsSync(join(installed, 'src')))
      fail(`${name} was installed with its src/ — that is not the tarball`);
  }
  console.log(`\n✓ ${wanted.join(', ')} installed from tarballs`);

  // 5. Build as a consumer would, then the smoke.
  run('npx', ['next', 'build'], app);
  if (!flag('--skip-smoke')) run('npx', ['playwright', 'test'], app, { CI: process.env.CI ?? '1' });

  console.log(`\n✓ examples: ${exampleName} builds and passes its smoke from packed tarballs`);
} catch (error) {
  if (!(error instanceof ExampleFailure)) throw error;
  console.error(`✗ examples: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (flag('--keep')) console.log(`  kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
