---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0034. Claude Code hooks for edit-time enforcement

## Context and Problem Statement

Nerey's invariants are enforced by the gate scripts in `scripts/` (ADR 0033), which run through `npm run check:all` and in CI. That trigger point is correct for authority but wrong for feedback latency: the violation is reported minutes to hours after the edit that caused it, at which point more work has been built on top of the mistake.

The cost curve is steep for this repository specifically, because most edits are made in agentic sessions. When a session writes a `.module.css` rule using an undeclared `--nerey-*` token, or adds an export to `packages/core/src/index.ts` without a matching `exports` subpath, or imports a stylesheet into `@nerey/core`, the error is trivially fixable in the next tool call and expensive to unwind twenty tool calls later — by then the wrong pattern has been repeated across sibling files, and unwinding it costs more context than the whole task. Worse, a session that runs `check:all` only at the end may run out of budget before reaching it, and hand back work that has never been checked at all.

Claude Code exposes hooks configured in `.claude/settings.json` that fire around tool calls; a `PostToolUse` hook that exits with code 2 and writes to stderr feeds that output back to the model as a correction rather than merely logging it. The repository already has an empty `scripts/hooks/` directory reserved for this. The question is whether to use that mechanism, and if so, whether hooks carry their own rules or reuse the existing gates.

## Decision Drivers

* Feedback latency dominates the cost of a violation in an agentic session; the same defect costs one tool call or one hour depending only on when it is reported.
* There must be exactly one implementation of each rule. Two enforcement engines drift, and the one that drifts is always the one that fires less often.
* A hook runs on the critical path of every edit, so its runtime budget is on the order of a second, not a minute.
* Hooks must not be load-bearing for correctness: they run locally and can be disabled, so CI must remain the authority.
* A hook that rewrites files desynchronises the model's view of what it just wrote, which produces confused follow-up edits.
* Accepted ADRs are immutable (ADR 0001), and immutability is easier to hold at write time than to detect afterwards.

## Considered Options

* `PostToolUse` hooks in `.claude/settings.json` dispatching by path to the existing gate binaries
* Git pre-commit hooks only (`husky` plus `lint-staged`), leaving edit time unguarded
* CI-only enforcement, with `npm run check:all` as the sole trigger
* Instructions in `CLAUDE.md` directing the agent to run the relevant gate after editing

## Decision Outcome

Chosen option: "`PostToolUse` hooks in `.claude/settings.json` dispatching by path to the existing gate binaries", because it is the only option that reports a violation while the edit is still the subject of the session, and because dispatching to the existing binaries means it adds a trigger rather than a rule set.

The design:

* A single dispatcher, `scripts/hooks/post-edit.mjs`, is registered as a `PostToolUse` hook matching `Write` and `Edit`. It receives the edited path and maps it, by glob, to zero or more of the **same** `scripts/check-*.mjs` binaries that `check:all` invokes. There is no hook-specific rule logic anywhere; if the dispatcher's mapping is empty for a path, nothing runs.
* The current mapping: `packages/core/src/**` runs `check:core-purity`; `packages/theme/src/**/*.module.css` runs `check:tokens`; any `packages/*/package.json` runs `check:exports`; `packages/*/src/**/*.stories.tsx` runs `check:stories`; `docs/decisions/**/*.md` runs `check:citations`.
* **Budget: the dispatcher must return within about two seconds.** Anything slower stays out of the hook and remains a `check:all` and CI gate — that excludes `tsc --build`, Vitest, the Storybook build, `depcruise` over all packages, and `check:public-api`, which needs the published snapshot. A gate too slow to hook is not thereby exempt from CI; it is only exempt from edit time.
* Violations exit 2 with a message naming the file and the rule, which Claude Code surfaces to the model. Clean runs exit 0 silently, because a hook that reports success on every edit trains the reader to skip its output.
* A `PreToolUse` hook on `Write|Edit` refuses edits to `docs/decisions/NNNN-*.md` files whose frontmatter status is `accepted`, allowing only the frontmatter line itself to change. This enforces the immutability rule in ADR 0001 at the moment it would be broken, where it is unambiguous, rather than in review where "it was only a wording fix" is a debate.
* **Hooks never mutate files.** No format-on-write, no autofix. Rewriting a file the model has just written leaves its in-context copy stale and causes the next `Edit` to fail on a string match or, worse, to succeed against the wrong content. Formatting stays `npm run format` and `npm run format:check`.
* Hooks are not a security boundary. They execute local scripts from a checked-in, reviewable `.claude/settings.json`, and nothing in the mechanism runs code that arrives from tool output or from the network.
* Git hooks are not eliminated by this decision; they keep exactly one job, the commit-message contract in ADR 0036, which has no edit-time equivalent because there is no message until commit time.

### Consequences

* Good, because the common violations are corrected within one tool call of being introduced, before the pattern is replicated across sibling files.
* Good, because sessions that never reach a final `check:all` still produce work that passed the fast gates, so the floor on unverified output rises.
* Good, because there is one implementation per rule. A rule change lands in one file and both triggers pick it up on the next run, with no possibility of the hook enforcing last month's version.
* Good, because ADR 0001's immutability rule becomes mechanically enforced instead of being a convention that survives only as long as everyone remembers it.
* Bad, because hooks add latency to every matching edit, and a slow or hung gate stalls the session with no obvious cause. The dispatcher applies a hard timeout and exits 0 on timeout — failing open, since CI still holds the line.
* Bad, because they only fire in Claude Code. A human editing in an editor gets nothing until `check:all`, so the enforcement floor is uneven across contributors, and the gates must never be tuned on the assumption that the hook already ran.
* Bad, because a hook firing on a deliberate work-in-progress edit is noise, and repeated noise trains a session to work around the hook rather than with it. This is the main risk and the reason the dispatch mapping is deliberately narrow.
* Neutral, because `.claude/settings.json` becomes a reviewed configuration file whose contents affect developer experience, and it will accumulate opinions unrelated to this record.

### Confirmation

Machine-checkable, through the ADR 0033 harness rather than through a gate of its own:

* `scripts/hooks/post-edit.mjs` is registered in the fixture manifest. For each entry in its dispatch mapping, a fixture plants a violating file at a path matching that glob and asserts the dispatcher exits 2 with the gate's documented message. A mapping entry with no fixture fails `npm run check:gates`.
* The same manifest asserts the inverse direction: every `scripts/check-*.mjs` marked hook-eligible must be reachable from at least one dispatch glob. A hook-eligible gate that no path can trigger is a wiring bug and fails the harness.
* `scripts/check-gates.mjs` verifies that every hook command string in `.claude/settings.json` resolves to a file that exists, so a renamed or deleted dispatcher cannot degrade into a silently absent hook.
* A fixture asserts the `PreToolUse` ADR guard: an edit to a record whose status is `accepted` is refused, and the same edit against a `proposed` record is allowed.
* The two-second budget is asserted in the same fixtures — the harness records dispatcher wall time per fixture and fails above the threshold.

What cannot be automated is whether the hook output actually changes agent behaviour: whether a given message is phrased well enough that the next tool call fixes the problem instead of working around it. That is observed across sessions and acted on by rewording the gate's message, and it is the one part of this record reviewed by reading transcripts rather than by running a script.

## Pros and Cons of the Options

### `PostToolUse` hooks dispatching by path to the existing gate binaries

One dispatcher, a glob-to-gate mapping, the same binaries CI runs.

* Good, because the feedback arrives while the edit is still in context, which is the only moment when the fix is a one-line correction.
* Good, because reusing the gate binaries makes drift between edit-time and merge-time enforcement structurally impossible.
* Good, because path scoping keeps the cost proportional: editing a README runs nothing.
* Good, because exit code 2 with stderr is a correction channel, not a log, so the mechanism actually closes the loop rather than recording that it was open.
* Neutral, because it is Claude Code specific. That matches how this repository is actually developed, but it is a coupling to a tool rather than to the language ecosystem.
* Bad, because it protects only one class of contributor, so the guarantee is uneven and must not be relied on.
* Bad, because a misconfigured or slow hook degrades the editing experience in a way that is hard to attribute, and the natural workaround is to disable hooks wholesale.

### Git pre-commit hooks only (`husky` plus `lint-staged`)

The conventional answer: run the gates over staged files at commit time.

* Good, because it is tool-agnostic and protects every contributor equally, including humans in any editor.
* Good, because `lint-staged` already solves the path-scoping problem, and the ecosystem is mature.
* Good, because it guards the boundary that matters for shared history — nothing enters a commit unchecked.
* Neutral, because it requires an install step (`prepare` script) and a dependency, which is minor but not free.
* Bad, because in an agentic session the commit may be dozens of tool calls after the violating edit, or may never happen inside the session at all. The feedback latency this record exists to fix is unchanged.
* Bad, because a pre-commit failure arrives at the worst moment psychologically — the work is "done" — which is what drives `--no-verify` habits.
* Bad, because it cannot enforce the accepted-ADR immutability rule usefully. By commit time the file has already been rewritten and the original content must be recovered rather than simply not lost.

### CI-only enforcement

`npm run check:all` in the pipeline, nothing local.

* Good, because it is the one trigger that cannot be bypassed, and it is the authority regardless of what else is decided.
* Good, because it has no runtime budget, so it can run the full matrix — typecheck, tests, coverage, `depcruise`, packaging checks.
* Neutral, because it is required in every option here; the question is only whether it is the sole trigger.
* Bad, because the loop is minutes to hours long, which is orders of magnitude worse than the moment of the edit.
* Bad, because the failure lands on a branch containing many changes, so attributing it costs a bisect or a careful read rather than being self-evident.

### Instructions in `CLAUDE.md` telling the agent to run the gates

Documented convention: after editing files under X, run gate Y.

* Good, because it costs nothing to write and requires no mechanism at all.
* Good, because it also informs human contributors, who read `CLAUDE.md` and do not get hooks.
* Neutral, because it is worth doing anyway as documentation, independently of whether it is the enforcement mechanism.
* Bad, because compliance is probabilistic. Instructions compete for attention with the task, and the ones that get dropped first are exactly the housekeeping steps at the end of a long session.
* Bad, because it consumes context budget on every session to describe rules that a hook applies for free and only when relevant.
* Bad, because it provides no signal when it is not followed, so a session that skipped the gates is indistinguishable from one that ran them clean.

## More Information

`scripts/hooks/` is reserved in the repository layout for the dispatcher and its helpers; `scripts/lib/` holds the shared traversal and reporting code that both the gates and the dispatcher use, so hook invocation and `check:all` invocation share a code path down to the reporter.

This record depends on ADR 0033 for its own verification — the dispatcher is a gate like any other and is fixture-covered — and on ADR 0001 for the immutability rule the `PreToolUse` guard enforces. ADR 0036 keeps the commit-message contract in a git hook, which is the one enforcement point edit-time hooks cannot cover.

Revisit if the dispatch mapping grows past roughly ten entries, at which point per-edit hook latency and false-positive noise both start to matter more than the latency saved, or if a second regular human contributor makes the uneven enforcement floor a practical problem rather than a theoretical one.
