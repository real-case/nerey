#!/usr/bin/env node
// scripts/check-published-site.mjs
//
// ADR 0044 named this gap in its own Confirmation:
//
//   "nothing checks that the published site WORKS. The build succeeding proves it was produced,
//    not that its story index loads or its assets resolve."
//
// This closes it. It fetches the deployed workbench and asserts the story index is served AND
// carries the number of stories THIS run built — which catches the empty index, the half-uploaded
// artifact, and the stale deployment where Pages went on serving a previous version.
//
// It is unlike every other gate here in one important way, and the difference is deliberate rather
// than overlooked: it depends on the NETWORK and on an external system, so it is neither hermetic
// nor deterministic in the sense ADR 0033 means. That is why it lives in the deploy job, after the
// publish, rather than in `check:all` — it can only be true of a site that exists. Its parsing and
// its assertions are pure and self-tested; only the fetch is not.
//
// Rules:
//
//   unreachable      the URL did not answer 200 within the retry budget. Pages propagation lags a
//                    little after `deploy-pages` returns, so this retries before it concludes.
//   not-storybook    the root answered, but with something that is not the workbench.
//   no-story-index   `index.json` is missing or unparseable — the site is up and the index a
//                    reader needs is not.
//   story-count      the published index carries a different number of stories than this run
//                    built. An exact comparison rather than a floor: a floor passes a stale
//                    deployment, which is the failure most likely to go unnoticed.
//
// Usage:
//   node scripts/check-published-site.mjs --url https://…/ --expect-stories 352
//   node scripts/check-published-site.mjs --self-test

import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ATTEMPTS = 6;
const DELAY_MS = 10_000;

/** Pure: does this look like the workbench rather than a 404 page or an empty shell? */
export function looksLikeStorybook(html) {
  return /<title>[^<]*storybook/i.test(html) || /id="storybook-root"/.test(html);
}

/**
 * Pure: the story count in a Storybook index. `entries` holds stories AND docs pages, so the count
 * filters on type — comparing the raw entry count would drift the moment autodocs changed.
 */
export function countStories(indexJson) {
  const entries = indexJson?.entries;
  if (!entries || typeof entries !== 'object') return null;
  return Object.values(entries).filter((entry) => entry?.type === 'story').length;
}

/** Pure: the whole verdict, given what was fetched. Everything above the network lives here. */
export function judge({ html, index, expected }) {
  const problems = [];

  if (typeof html !== 'string' || !looksLikeStorybook(html)) {
    problems.push({
      rule: 'not-storybook',
      message:
        'the root answered, but with something that is not the workbench. A deployment can succeed ' +
        'and serve a 404 page — GitHub Pages does exactly that when the artifact uploaded is not ' +
        'what the workflow meant to upload.',
    });
  }

  const published = countStories(index);
  if (published === null) {
    problems.push({
      rule: 'no-story-index',
      message:
        '`index.json` is missing or has no `entries`. The site is up and the index a reader needs ' +
        'to navigate it is not — which is exactly the state a green build cannot distinguish from ' +
        'a healthy one (ADR 0044).',
    });
    return problems;
  }

  if (expected !== null && published !== expected) {
    problems.push({
      rule: 'story-count',
      message:
        `the published index carries ${published} stories; this run built ${expected}. An exact ` +
        `comparison rather than a floor, because a floor passes a stale deployment — Pages serving ` +
        `a previous version is the failure most likely to go unnoticed.`,
    });
  }

  return problems;
}

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

async function fetchWithRetry(url, parse) {
  let last = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (response.ok) return await parse(response);
      last = `HTTP ${String(response.status)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (attempt < ATTEMPTS) {
      console.log(`  … ${url} not ready (${last}); retrying ${String(ATTEMPTS - attempt)} more time(s)`);
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
  }
  return { failed: last };
}

if (process.argv.includes('--self-test')) {
  // ADR 0033 — the network cannot be planted, but everything that decides the verdict can. The
  // fixtures go through disk so the blind probe has a read to take away.
  const dir = mkdtempSync(join(tmpdir(), 'nerey-published-site-'));
  const fixture = join(dir, 'index.json');
  const outcomes = [];

  const INDEX = { entries: { a: { type: 'story' }, b: { type: 'story' }, c: { type: 'docs' } } };
  const HTML = '<html><head><title>storybook - Storybook</title></head><body></body></html>';

  try {
    writeFileSync(fixture, JSON.stringify(INDEX), 'utf8');
    const index = JSON.parse(readFileSync(fixture, 'utf8'));

    outcomes.push(['counts stories and not docs pages', countStories(index) === 2]);
    outcomes.push([
      'not-storybook',
      judge({ html: '<html><body>404</body></html>', index, expected: 2 }).some(
        (p) => p.rule === 'not-storybook',
      ),
    ]);
    outcomes.push([
      'no-story-index',
      judge({ html: HTML, index: {}, expected: 2 }).some((p) => p.rule === 'no-story-index'),
    ]);
    outcomes.push([
      'story-count',
      judge({ html: HTML, index, expected: 3 }).some((p) => p.rule === 'story-count'),
    ]);
    outcomes.push(['allows a healthy site', judge({ html: HTML, index, expected: 2 }).length === 0]);
    outcomes.push([
      'allows an unknown expectation',
      judge({ html: HTML, index, expected: null }).length === 0,
    ]);
    outcomes.push([
      'recognises the root by its mount point',
      looksLikeStorybook('<div id="storybook-root">'),
    ]);
  } finally {
    // Torn down BEFORE any exit: `process.exit()` skips `finally` (ADR 0033).
    rmSync(dir, { recursive: true, force: true });
  }

  let failures = 0;
  for (const [rule, ok] of outcomes) {
    const positive =
      !rule.startsWith('allows ') && !rule.startsWith('counts ') && !rule.startsWith('recognises ');
    if (ok) {
      console.log(`  ✓ check-published-site/${rule} — ${positive ? 'rejected its violator' : 'holds'}`);
    } else {
      console.error(
        positive
          ? `  ✗ check-published-site/${rule} — did NOT reject its violator (gate is broken)`
          : `  ✗ check-published-site/${rule} — failed on legal input (gate over-fires)`,
      );
      failures++;
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

const url = arg('--url');
if (!url) {
  console.error('✗ usage: node scripts/check-published-site.mjs --url <site> [--expect-stories <n>]');
  process.exit(1);
}

const expectedRaw = arg('--expect-stories');
const expected = expectedRaw === null ? null : Number.parseInt(expectedRaw, 10);
const base = url.endsWith('/') ? url : `${url}/`;

const html = await fetchWithRetry(base, (response) => response.text());
if (typeof html === 'object' && html.failed) {
  console.error(`\n✗ published site: ${base} is unreachable — ${html.failed}\n`);
  console.error(
    `  [unreachable] The deployment reported success and the site does not answer. Pages ` +
      `propagation lags a little, so this already retried ${String(ATTEMPTS)} times over ` +
      `${String((ATTEMPTS * DELAY_MS) / 1000)}s (ADR 0044).`,
  );
  process.exit(1);
}

const index = await fetchWithRetry(`${base}index.json`, (response) => response.json());
const problems = judge({
  html,
  index: typeof index === 'object' && index?.failed ? null : index,
  expected: Number.isFinite(expected) ? expected : null,
});

if (problems.length > 0) {
  console.error(`\n✗ published site: ${problems.length} problem(s) at ${base}\n`);
  for (const problem of problems) console.error(`  [${problem.rule}] ${problem.message}`);
  process.exit(1);
}

console.log(
  `✓ published site: ${base} serves the workbench, and its index carries ` +
    `${String(countStories(index))} stories — the number this run built`,
);
