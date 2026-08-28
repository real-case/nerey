---
status: 'proposed'
date: 2026-08-26
decision-makers: Yurii Anichkin
---

# 0045. The eslint-config rule surface is snapshotted, and both directions of change fail

## Context and Problem Statement

ADR 0029 named three published surfaces and promised a snapshot for each. Two exist:
`check:public-api` and `check:api-signatures` cover the export surface, `check:data-contract`
covers the `data-*` attributes, and the token names are covered by `check:tokens` and the generated
artifacts. The third has never had one. ADR 0038 said so in as many words when it declined to
inherit the promise:

> There is **no snapshot of `@nerey/eslint-config`'s rule ids and messages**. Its surface is
> covered by its own tests only. A snapshot is worth having and is not written yet; it needs its
> own record rather than an aspirational line in this one.

This is that record.

`@nerey/eslint-config` is the odd package. Its public API is not its exports — those are four
functions and a `configs` object that nothing would notice changing shape. What a consumer
actually depends on is the **resolved configuration**: which config objects exist, which files each
one applies to, which rules each enables, and which import specifiers and globals each forbids.
None of that is visible to a gate that reads export names, which is why `check-public-api.mjs`
excludes this package by name.

Both directions of change are consequential, and they are consequential in *opposite* ways.

**A ban that appears breaks builds.** ADR 0029 already recorded the consequence and called it bad:

> `@nerey/eslint-config` can effectively never tighten a rule in a minor release, so useful new
> restrictions queue up behind major versions or ship as opt-in entry points that most consumers
> will not enable.

Adding a pattern to `IO_PATTERNS` fails a consumer's lint on code that passed yesterday. That is a
MAJOR under 0029, and nothing currently makes it visible as one.

**A ban that disappears breaks nothing, which is worse.** Delete a group from `CORE_PATTERNS` and
every build stays green — while the invariant it enforced stops being enforced. ADR 0015 calls the
no-I/O rule "the single most load-bearing invariant in Nerey, and the one that does NOT survive
extraction". A rule that silently stops firing is the exact failure the whole ADR 0033 harness
exists to prevent, and this package is the one place that harness cannot reach: `check:gates` proves
a *gate* rejects its violator, not that a shipped lint config still contains a pattern.

## Decision Drivers

- Both directions must be caught. One breaks consumers loudly, the other stops protecting them
  quietly, and neither is legible in a diff of a 168-line file that composes three factories.
- What is compared must be the **resolved** configuration, not the source. `recommended` is built
  by calling three functions with default options; a changed default glob or a reordering shows up
  in the resolved output and is easy to miss in the source.
- The baseline must be reviewable. A hash proves something changed; the point is to see what.
- No new dependency. ESLint itself is already here, but nothing in this check needs it — the config
  is a plain data structure.
- It must classify, not merely report. The two directions have different release consequences and
  the message should say which one this is.

## Considered Options

- A flattened snapshot of the resolved configuration, with both directions failing
- Behavioural fixtures: lint a file that should fail and one that should pass, per rule
- Leave it to the package's own tests
- Snapshot the source file's hash

## Decision Outcome

Chosen option: "A flattened snapshot of the resolved configuration, with both directions failing",
because it is the only option that sees a removed pattern at all, and because flattening makes the
diff a list of one-line facts rather than a nested object nobody reads.

`npm run check:eslint-rules` resolves `recommended`, `widgets()`, `core()` and `theme()` with their
default options and flattens each into sorted, stable lines:

```
recommended[0] name=nerey/core-stays-headless
recommended[0] files=**/packages/core/src/**/*.{ts,tsx}
recommended[0] rule no-restricted-imports severity=error
recommended[0] no-restricted-imports group=zod,zod/*,valibot,arktype,yup,joi
widgets[0] no-restricted-globals name=fetch
```

The baseline is that list, plus the failure messages keyed separately. Three rules:

- **`boundary-removed`** — a line in the baseline that is gone. **Fails.** The boundary stopped
  being enforced and every consumer's build stayed green.
- **`boundary-added`** — a line that is new. **Fails.** A tightening breaks a consumer's lint on
  code that passed yesterday: MAJOR under ADR 0029, MINOR while the package is `0.x`.
- **`message-changed`** — the prose a developer reads when blocked. **Reported, does not fail.**
  Rewording an explanation is not an API change, and making it one would discourage improving the
  explanations, which are half of what this package is for.

Both structural rules fail rather than one of them, because the two are equally deliberate acts and
neither should reach a release without somebody saying so. `--update-baseline` re-blesses and prints
every line it accepted, so the classification happens where a person can see it.

### Consequences

- Good, because the third surface ADR 0029 promised finally has a snapshot, and ADR 0038's stated
  gap closes.
- Good, because a removed pattern — the silent direction — is now the loud one. That is the failure
  mode this repository has repeatedly found to be the expensive one.
- Good, because the flattened form makes the review a list of added and removed lines, which is what
  a reviewer can actually judge.
- Neutral, because messages are excluded from the failing comparison. That is a judgement: their
  wording should be free to improve, and a reviewer still sees the change reported.
- Bad, because the snapshot describes the configuration, not its behaviour. It proves the pattern
  `axios` is still banned; it does not prove ESLint still rejects an `axios` import — a change in
  `no-restricted-imports` semantics would pass this gate untouched.
- Bad, because it is a fourth baseline to re-bless deliberately, and a fourth thing somebody can be
  tempted to update to make a check pass. The `PreToolUse` guard covers it for the same reason it
  covers the other three.

### Confirmation

`npm run check:eslint-rules` (`scripts/check-eslint-rules.mjs`), registered in the ADR 0033 harness
and reached by `check:all`, diffing against `docs/design-system/eslint-rules.json`:

- `boundary-removed` and `boundary-added` fail, each naming the direction and its release
  consequence rather than reporting an undifferentiated "change".
- `message-changed` is reported and passes.
- `empty-surface` fails when nothing was resolved at all — a gate whose input silently emptied would
  pass by having nothing to compare, which is a failure this repository has already hit twice.
- `--self-test` plants a violator per rule per ADR 0033, and `--update-baseline` prints what it
  blessed.

`scripts/hooks/guard-protected-files.mjs` blocks hand edits to the new baseline, exactly as it does
for the other three (ADR 0038 / 0042).

What this does **not** confirm is behaviour: that ESLint, given this configuration, actually rejects
the imports it names. That is the "behavioural fixtures" option below, and it is not adopted.

## Pros and Cons of the Options

### A flattened snapshot of the resolved configuration, with both directions failing

- Good, because it catches a removal, which nothing else here can.
- Good, because the resolved form catches a changed default glob, which the source diff makes easy
  to overlook.
- Neutral, because it needs a normalisation convention — sorted, stable line forms — that a reader
  has to learn once.
- Bad, because it verifies the description of the boundary rather than the boundary, and a reader
  could mistake one for the other. The record says so; the gate's output says so too.

### Behavioural fixtures: lint a file that should fail and one that should pass, per rule

- Good, because it proves the thing that actually matters — the config rejects what it claims to.
- Good, because it would survive a change in ESLint's own semantics, which the snapshot would not.
- Bad, because it needs a fixture pair per pattern, and there are more than thirty patterns across
  three configs. That is a hand-maintained list, which is the artifact this repository's gates
  consistently refuse to depend on.
- Bad, because it is slow: a real ESLint run per fixture, against a config that must be constructed
  in isolation from the repository's own.
- Neutral, because the two are not exclusive. If a pattern's enforcement is ever doubted, a
  behavioural fixture for that pattern is the right addition, and the snapshot stays.

### Leave it to the package's own tests

- Good, because it costs nothing, and the package does have tests.
- Bad, because a test asserts what somebody thought to assert. The removal case is precisely the one
  nobody writes a test for, because the test would be "this pattern is still in the list", which
  reads as tautology right up until it is deleted along with the pattern.

### Snapshot the source file's hash

- Good, because it is five lines and catches every change with certainty.
- Bad, because it catches a comment edit as loudly as a deleted ban, so it fires constantly and gets
  re-blessed reflexively — the exact behaviour that makes a gate stop being read.
- Bad, because it says nothing about *what* changed, which is the whole reason the other three
  baselines are structured rather than hashed.

## More Information

Closes the gap ADR 0038 named and completes the third of ADR 0029's three surfaces. Related:
ADR 0015 (the invariant this package exists to ship), ADR 0022 and ADR 0011 (the other two
boundaries it enforces), ADR 0033 (why the gate self-tests), ADR 0034 (the guard that protects the
baseline).

The asymmetry worth remembering: for every other surface in this repository, removal is the
breaking direction. For this one, **addition** is what breaks a consumer's build and **removal** is
what quietly stops protecting them. That is why both fail here and why the messages name the
direction rather than leaving the reader to work it out.
