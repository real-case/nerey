---
status: "accepted"
date: 2026-11-19
decision-makers: Yurii Anichkin
---

# 0050. Conventional Commits as the commit contract, restated as implemented

## Context and Problem Statement

ADR 0036 made Conventional Commits the commit contract, with a scope vocabulary derived from the
workspace list, so that a release can compute which package moved and whether it broke from history
rather than from memory. The decision has held up: `gen:release` (ADR 0039) reads exactly that
history, and the two-signal check against the surface snapshots (ADR 0038) depends on the `!` marker
being there.

Its description of the implementation has not held up. Three deviations are open against it:

- **D-1.** The record says the gate wraps `commitlint` with `@commitlint/config-conventional`. It does
  not. `scripts/check-commits.mjs` implements the grammar directly with no dependency.
- **D-2.** The record lists ten types and three fixed scopes. The gate accepts eleven types (`style` is
  the addition) and five fixed scopes (`deps` and `adr` are the additions), and every addition is in
  use: Dependabot writes `deps`, corpus work writes `adr`.
- **D-3.** The record says `Refs:` footers are resolved by reusing `check-adr-citations.mjs`. The gate
  resolves them with its own copy of the corpus scan.

Two more places where the record describes something that does not run: it says the gate runs from a
`commit-msg` hook, and that CI validates the pull request title. The script supports a `--message`
mode for a hook, but the repository installs no hook, and CI validates the commit range only.

An accepted record is never edited (ADR 0001), so the fix is a superseding record that keeps the
decision and states the implementation truthfully.

## Decision Drivers

- The decision itself (format, derived scopes, `!` as the break marker, `Refs:` footers) is correct
  and must not move.
- A record's `Confirmation` must describe a gate that exists and runs (ADR 0001).
- No new dependency for a forty-line grammar that has to run inside an edit hook and in CI.
- One implementation of "does ADR NNNN exist", not two.
- Version arithmetic now lives in ADR 0038 and 0039, not in the superseded ADR 0029 this record's
  predecessor cited.

## Considered Options

- Supersede with the decision unchanged and the implementation described as it is
- Change the code to match ADR 0036 (add `commitlint`, drop `style`, `deps` and `adr`)
- Leave ADR 0036 and keep D-1 to D-3 open

## Decision Outcome

Chosen option: "Supersede with the decision unchanged and the implementation described as it is",
because the code is the better design on every point where they differ, and the record exists to
describe what the repository enforces.

**The contract.**

- Format is `type(scope)!?: description`, with optional body and footers, per Conventional Commits
  1.0.0.
- Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`, `style`.
- Scopes are **derived**: the unscoped names of the `workspaces` packages in the root `package.json`
  (today `core`, `theme`, `eslint-config`), plus five fixed scopes: `storybook`, `docs`, `repo`,
  `deps`, `adr`. Adding a package extends the vocabulary with no edit to the gate.
- The description is lowercase and has no trailing period. `deps` is exempt from the lowercase rule,
  because Dependabot writes `Bump X from A to B` with no setting to change it and `deps` commits never
  reach a changelog.
- A `!` after the scope marks a break, and a `BREAKING CHANGE:` footer requires the `!`. The two must
  agree.
- Version arithmetic per scope is ADR 0038's: `feat` is MINOR, `fix` and `perf` are PATCH, `!` is
  MAJOR (MINOR while `0.x`); the other types imply no bump. `gen:release` applies it (ADR 0039).
- A change that implements or deviates from a decision carries `Refs: ADR NNNN`, in the bare citation
  form of ADR 0001, and the number must resolve.
- History on `main` is linear. Whatever the merge method, every commit that lands must pass the gate;
  when a pull request is squash-merged, its title is the commit and must follow the same grammar.

**The implementation.** `scripts/check-commits.mjs` implements the grammar with no dependency.
Citation resolution moves to a resolver exported by `scripts/check-adr-citations.mjs` and imported by
the commit gate, so there is one definition of "ADR NNNN exists" (D-3, code). The `--message` mode is
the entry point for a local `commit-msg` hook; installing it is the contributor's choice, because CI
re-checks the whole range and a hook is only an earlier warning.

### Consequences

- Good, because D-1 and D-2 close, and D-3 has a recorded direction.
- Good, because the record's `Confirmation` now names only things that run.
- Good, because the version arithmetic cites the records that own it today.
- Bad, because the pull request title is still not machine-checked. A squash merge with a bad title
  lands a bad commit. The release gate would catch a wrong bump, not a malformed subject.
- Neutral, because a hand-written grammar is a small maintenance cost that `commitlint` would have
  absorbed. The self-test pins its behaviour.

### Confirmation

- `npm run check:commits` (`scripts/check-commits.mjs`) in `check:all` and in CI's `quality` job, over
  `origin/main..HEAD` with full history (`fetch-depth: 0`).
- Its `--self-test`, registered in `check:gates` (ADR 0033), plants a violator for each rule:
  `missing-type`, `unknown-type`, `unknown-scope`, `subject-style`, `breaking-marker` and
  `dangling-adr-ref`, and checks that legal edge cases (a `deps` subject with a capital, a `!` header
  with a footer) pass.
- D-3 closes when `check-commits.mjs` imports the resolver from `check-adr-citations.mjs` and its own
  corpus scan is deleted. `npm run check:citations` and `check:commits` then share one code path.

## Pros and Cons of the Options

### Supersede with the decision unchanged and the implementation described as it is

- Good, because it changes no behaviour and closes three deviations.
- Good, because the record becomes a reliable description of the gate again.
- Bad, because it is a long record that mostly restates another one.

### Change the code to match ADR 0036

- Good, because no record changes.
- Bad, because it adds `commitlint` and its config to every install for a grammar already enforced.
- Bad, because removing `deps` would fail every Dependabot commit, and removing `adr` would fail the
  corpus's own commits.

### Leave ADR 0036 and keep D-1 to D-3 open

- Good, because it costs nothing today.
- Bad, because an accepted record that misdescribes its gate is the drift `deviations.md` exists to
  surface, and leaving it open makes the file a list of things nobody intends to fix.

## More Information

Supersedes ADR 0036. Closes D-1 and D-2 in `docs/deviations.md`; sets the direction for D-3. Related:
ADR 0001 (citation form, immutability), ADR 0033 (self-testing gates), ADR 0034 (why a commit-message
check cannot run at edit time), ADR 0038 (version arithmetic and surface snapshots) and ADR 0039
(`gen:release`, which consumes this history).

Revisit if the pull request title needs a machine check (a squash merge with a malformed title is the
trigger), or if a fourth published package makes cross-package version propagation necessary. ADR 0036
named the second case, and it still applies.
