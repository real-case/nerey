#!/usr/bin/env node
// scripts/fix-dts-specifiers.mjs
//
// ADR 0028 — make the emitted declarations resolvable under Node's ESM resolver.
//
// The source is authored with `moduleResolution: 'bundler'`, so relative imports are
// extensionless (`from './types'`). `tsc` copies those specifiers verbatim into the `.d.ts`
// output, and extensionless relative specifiers are NOT resolvable under `node16`/`nodenext`.
// `@arethetypeswrong/cli` reports this as "Internal resolution error", and it is right: the
// declarations claim a module layout that Node cannot follow. It goes unnoticed because every
// bundler resolves it fine, so it only breaks for the consumer who type-checks with
// `moduleResolution: 'nodenext'` — and then it breaks completely.
//
// The alternative fix is to author every relative import with a `.js` extension, which is the
// "correct" thing and also means 200 imports that read wrong in a TS file for the benefit of a
// resolver the source never runs under. Rewriting at publish time keeps the source honest and
// the artifact correct.
//
// Runtime JS needs no equivalent step: Vite bundles it into real files with real extensions.
//
// Usage: node scripts/fix-dts-specifiers.mjs <packageDir> [--check]

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** `from '…'` / `import('…')` — the two forms a declaration file can carry a specifier in. */
const SPECIFIER_RE = /(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.[^'"]*)\2/g;

function resolveSpecifier(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  if (existsSync(`${base}.d.ts`)) return `${specifier}.js`;
  if (existsSync(join(base, 'index.d.ts'))) return `${specifier.replace(/\/$/, '')}/index.js`;
  // Already extensioned, or pointing at something this pass should not invent a path for.
  return null;
}

function rewrite(file) {
  const original = readFileSync(file, 'utf8');
  const updated = original.replace(SPECIFIER_RE, (match, lead, quote, specifier) => {
    if (/\.(js|json|css)$/.test(specifier)) return match;
    const fixed = resolveSpecifier(file, specifier);
    return fixed ? `${lead}${quote}${fixed}${quote}` : match;
  });
  return { original, updated };
}

const args = process.argv.slice(2);
const check = args.includes('--check');
// Resolved against the CALLER's cwd, not the repo root: npm runs a workspace's `build` script
// from inside that package, so `.` must mean "this package". Resolving against repoRoot instead
// silently pointed at the monorepo root, found no dist, and reported success.
const packageDir = resolve(process.cwd(), args.find((a) => !a.startsWith('--')) ?? '.');
const distDir = join(packageDir, 'dist');

if (!existsSync(distDir)) {
  console.log(`· ${relative(repoRoot, packageDir)}: no dist, nothing to fix`);
  process.exit(0);
}

const files = walk(distDir);
const changed = [];

for (const file of files) {
  const { original, updated } = rewrite(file);
  if (original === updated) continue;
  changed.push(relative(repoRoot, file));
  if (!check) writeFileSync(file, updated, 'utf8');
}

if (check && changed.length) {
  console.error(`✗ ${changed.length} declaration file(s) still carry extensionless specifiers:`);
  for (const c of changed) console.error(`    ${c}`);
  console.error('  Run the build again — `fix-dts-specifiers` is part of it.');
  process.exit(1);
}

console.log(
  `✓ ${relative(repoRoot, packageDir)}: ${files.length} declaration file(s), ` +
    `${changed.length} rewritten to explicit .js specifiers`,
);
