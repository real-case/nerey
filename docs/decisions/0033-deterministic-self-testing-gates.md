---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0033. Deterministic gates that self-test by rejecting a planted violator

## Context and Problem Statement

Most of Nerey's architectural commitments are enforced by custom scripts rather than by the type system, because the things being protected are not expressible as types: that `@nerey/core` contains no `.css` file and no transitive dependency on a markdown renderer, that every `var(--nerey-*)` declaration carries an inline fallback, that the `data-nerey-*` attribute surface has not silently changed, that no module reaches past a declared `exports` subpath. `package.json` already declares eight such gates — `check:tokens`, `check:core-purity`, `check:exports`, `check:data-contract`, `check:stories`, `check:public-api`, `check:citations`, `check:boundaries` — and the ADR corpus commits to more, because ADR 0001 requires every record to name a machine-checkable fitness function.

A custom gate has a failure mode that a test does not: it can pass for the wrong reason and look identical to passing for the right one. A glob that matches nothing iterates zero files and exits 0. A regex that stopped matching after a refactor finds zero violations and exits 0. A script that throws inside a `try` block and swallows the error exits 0. A gate that sets `process.exitCode` but is invoked in a way that discards it exits 0. A gate pointed at `dist/` after a build-output change scans generated code that no longer resembles the source and exits 0. In every one of these cases CI is green, the badge is green, and the rule has not been enforced for however many months it has been broken.

This is worse than having no gate, because the gate's existence is what stops anyone from checking the invariant by hand. `docs/requirements.md` already anticipates the problem at one specific point — AC-22 requires the widget conformance kit to fail "on a deliberately seeded violation of each rule it checks". The question this record settles is whether that discipline applies to that one kit or to every gate in the repository.

## Decision Drivers

* A green gate must be evidence that the rule holds, not evidence that the gate ran.
* Gates protect properties that are invisible to types and tests. If a gate silently stops working there is no second line of defence.
* Gates run on every merge and, per ADR 0034, on many individual edits. Anything nondeterministic — network, clock, filesystem iteration order — turns into flakes that get muted, which is how a gate becomes advisory in practice while still claiming to block.
* Failure output is read by contributors and by agents mid-session. A gate that fails without naming the offending file and the rule costs more than it saves.
* Adding a gate must stay cheap enough that records keep naming real fitness functions instead of retreating to "manual review".

## Considered Options

* A meta-harness (`scripts/check-gates.mjs`) that runs every gate against a planted violator and requires a non-zero exit
* Vitest unit tests over each gate's internal predicate, with a mocked filesystem
* Rely on review of `scripts/` plus the fact that gates run in CI, with no verification that they can fail

## Decision Outcome

Chosen option: "A meta-harness (`scripts/check-gates.mjs`) that runs every gate against a planted violator and requires a non-zero exit", because it is the only option that exercises the artifact CI actually consumes — the gate's real entry point and its real process exit code — and therefore the only one that can catch the failure modes above, all of which live outside the predicate and inside the plumbing.

The harness contract:

* Every executable matching `scripts/check-*.mjs` must be registered in the fixture manifest. An unregistered gate is a harness failure, so a new gate cannot be added without also declaring how it fails.
* Each registration supplies one or more **violator fixtures**: a minimal file tree, written to a temporary directory, containing exactly one deliberate breach of that gate's rule, plus the arguments to invoke the gate against that tree.
* The harness runs each gate twice per fixture. Against the clean tree it must exit 0. Against the violated tree it must exit non-zero **and** its output must mention the violating path and the documented rule message. Exiting non-zero for an unrelated reason — a crash, a missing file — does not count as a pass; the message assertion is what distinguishes "rejected the violator" from "fell over".
* Gates must be deterministic: no network access, no registry lookups, no wall-clock or timezone dependence, sorted traversal so results do not depend on filesystem iteration order, and a fixed exit code per outcome. A gate that cannot meet this is not a merge gate.
* The harness carries a **meta-fixture**: a deliberately broken gate that always exits 0 against everything. The harness must reject it. This is the harness proving it can fail, and it is the reason `check:gates` is not itself an unverified gate.
* `scripts/check-gates.mjs` additionally asserts that every hook command string in `.claude/settings.json` resolves to a file that exists on disk, so the edit-time wiring in ADR 0034 cannot rot into silently-absent hooks.

### Consequences

* Good, because the "green because broken" mode is closed for every custom gate at once, rather than being remembered for the conformance kit and forgotten everywhere else.
* Good, because the violator fixtures are executable documentation of what each rule forbids. AC-8's "fails lint with the documented message" and AC-22's seeded violations become fixtures rather than prose, and the documented message is asserted rather than aspirational.
* Good, because the determinism requirement is enforced structurally: a gate that consults the network or the clock cannot produce a stable clean-run result across the harness's two invocations of it.
* Good, because refactoring a gate is now safe. Rewriting a regex or swapping a parser is verified by the fixtures rather than by hoping the rewrite still matches anything.
* Bad, because a gate is now two artifacts and the second is not optional — the harness refuses an unregistered `scripts/check-*.mjs`. This is a real tax on adding a rule, and it is the intended one.
* Bad, because harness runtime grows linearly with fixture count, and each fixture is a subprocess plus a temp tree. Fixtures are run concurrently and kept to the smallest tree that can express the violation; if the harness exceeds roughly 30 seconds it moves out of `check:all` and into CI only.
* Neutral, because gates that delegate to third-party tools (`depcruise`, `cspell`, `eslint`) are fixture-covered only for the configuration this repository owns. A fixture proves our `depcruise` rules reject a forbidden edge; it does not prove `dependency-cruiser` itself is correct, and it should not try to.
* Neutral, because unit tests over a gate's parsing internals remain welcome where the parsing is intricate. The harness does not forbid them; it makes them insufficient on their own.

### Confirmation

`npm run check:gates` (`scripts/check-gates.mjs`), wired into `npm run check:all` and required in CI. It asserts, in order:

1. Every `scripts/check-*.mjs` appears in the fixture manifest, and every manifest entry points at a script that exists.
2. Every gate exits 0 against its clean fixture tree.
3. Every gate exits non-zero against each of its planted violators, with output naming the violating path and the rule.
4. The meta-fixture — a gate hard-coded to exit 0 — is rejected, proving the harness's own failure path executes on every run.
5. Every hook command in `.claude/settings.json` resolves to an existing file (ADR 0034).

The harness is self-verifying by construction at step 4, so it does not require a gate of its own. What it cannot check is whether a fixture actually expresses the rule the record intended — a fixture can drift into testing something narrower than the invariant, and still pass. That is manual review at the time the fixture is written, and it is why fixtures live beside the gate rather than in a separate directory.

## Pros and Cons of the Options

### A meta-harness that runs every gate against a planted violator

`scripts/check-gates.mjs` plus a per-gate fixture manifest; each gate is invoked as a subprocess against clean and violated temporary trees.

* Good, because it tests the deployed artifact end to end — argument parsing, traversal, matching, reporting and exit code — which is exactly the surface CI depends on and unit tests skip.
* Good, because it catches the empty-glob and swallowed-error classes of bug, which are the observed real-world causes of a silently dead gate.
* Good, because the message assertion turns documented error strings into a contract, so a gate cannot fail uselessly.
* Good, because the manifest makes gate coverage countable: the harness reports how many gates and fixtures exist, so a rule with no fixture is visible rather than assumed.
* Neutral, because the fixtures are synthetic trees, not the real repository. They verify the gate's logic, not that the gate is pointed at the right directories in `package.json` — that wiring is verified by the clean-tree run over the real repository in `check:all`.
* Bad, because subprocess-per-fixture is slow relative to in-process assertions, and the cost is paid on every `check:all`.
* Bad, because fixtures must be maintained alongside the rules. A rule change with a stale fixture produces a confusing failure in the harness rather than in the gate.

### Vitest unit tests over each gate's internal predicate

Export the matching function from each gate, mock the filesystem, and assert the predicate returns the expected verdict for hand-built inputs.

* Good, because it is fast, runs in the existing Vitest projects (ADR 0006), and gives line-level coverage that feeds the threshold in ADR 0007.
* Good, because it is the ergonomic way to cover intricate parsing — many inputs, no subprocess, precise assertions.
* Good, because failures point directly at the offending branch rather than at a process exit code.
* Neutral, because it requires each gate to be structured as an importable module with a thin CLI shell, which is good structure anyway.
* Bad, because it tests the predicate and not the gate. Every failure mode that motivated this record — glob matched nothing, error swallowed, exit code discarded, wrong directory scanned — lives in the shell the unit test replaces with mocks.
* Bad, because mocking the filesystem means the test asserts against an idealised tree, so a gate can be perfectly unit-tested and still enforce nothing on the real repository.

### Rely on review of `scripts/` and the fact that gates run in CI

No verification layer; gates are ordinary scripts, reviewed like other code.

* Good, because it is free, adds no runtime, and keeps `scripts/` to one file per rule.
* Good, because a gate that breaks loudly — throwing, exiting non-zero — is still caught immediately without any harness.
* Neutral, because review does catch some of this. A reviewer reading a new gate will often notice an unanchored glob.
* Bad, because it cannot catch the silent modes at all, and those are precisely the ones with no other signal. Nothing in a green CI run distinguishes "the rule holds" from "the gate has scanned zero files since March".
* Bad, because the detection latency is unbounded. A dead gate is discovered when the invariant it protected breaks in a consumer's build, which for the packaging and styling contracts means after publication.
* Bad, because it makes every gate's reliability a function of reviewer attention at one moment in time, on a repository where most edits are made by agents.

## More Information

The generalisation of AC-22 to every gate is the substance of this record: `docs/requirements.md` already required the widget conformance kit to fail on seeded violations, and there is no principled reason the conformance kit should be the only gate held to that standard.

Gates currently under the harness and the records that mandate them: `check:core-purity` (ADR 0037, and the no-CSS half of ADR 0002), `check:exports` (ADR 0028), `check:data-contract` (ADR 0020), `check:tokens` (ADR 0024), `check:stories` (ADR 0031), `check:public-api` (ADR 0029), `check:citations` (ADR 0001), `check:boundaries` via `dependency-cruiser`, and the widget conformance kit's own rules. The ESLint boundary in ADR 0015 is fixture-covered through its documented failure message.

ADR 0034 reuses these same binaries as edit-time hooks; the harness's check that every hook command resolves on disk is what keeps the two triggers pointed at one implementation. ADR 0007 is deliberately not part of this harness: a coverage threshold fails by arithmetic on a number the test runner produces, so there is no planted violator to construct and no silent-pass mode to close.

Revisit if harness wall-clock time becomes the dominant cost of `check:all`, in which case fixtures move to a CI-only job and the pre-merge run keeps only the clean-tree pass.
