---
status: 'proposed'
date: 2026-08-25
decision-makers: Yurii Anichkin
---

# 0039. Releases are cut from a per-package tag and published from CI by trusted publishing

## Context and Problem Statement

ADR 0029 defined what a version number means here and ADR 0038 built the gates that hold the
surfaces to it. Neither says how a version actually reaches npm, and nothing in the repository
does: there is no publish workflow, no changelog, and none of the three manifests carries a
`repository`, `homepage` or `bugs` field. The state today is that `npm publish` would be typed by
hand, from a laptop, against whatever happened to be in `dist/`.

That is the exact shape of failure `docs/verification.md` already records twice. A green local run
is evidence about one machine: the first CI run failed on a test suite that silently required a
prior build, and on twenty-two `.d.ts` files that resolved locally and not on a clean checkout.
A hand-typed publish has the same property and worse consequences, because the artifact it
produces is immutable and public.

There is a second problem that only appears at the moment of publishing. ADR 0036 makes the
required bump derivable from the commit range, and ADR 0038's gates derive it from three
surfaces — but the two signals are never compared. A removal that lands with no `!` marker
re-blesses a baseline and publishes as a PATCH, and nothing objects. ADR 0038 named this as a gap
and deferred it to "a release runbook", on the grounds that there was no release runbook to defer
it to. This record is that runbook.

## Decision Drivers

- The published artifact must be built on a clean checkout, by the same job that ran the gates —
  not on the maintainer's machine, for the reason the verification record already gives twice.
- A consumer must be able to verify where a tarball came from. For a library whose security
  argument is "the model parameterises pre-declared widgets" (ADR 0008), an unverifiable supply
  chain undercuts the whole pitch.
- No long-lived publish credential should exist in the repository, its secrets, or a developer's
  shell history.
- Versions are per-package and independent (ADR 0002 / 0029), so the release unit is one package,
  not the repository.
- The number must be derived, not remembered, but the decision to release must stay human — a
  behavioural break passes every gate this repository has (ADR 0038), and only a person can catch
  it.
- Whatever is added must not introduce a second place where a bump is declared. ADR 0036 rejected
  Changesets on exactly that ground and that reasoning is unchanged.

## Considered Options

- A per-package tag, prepared locally, published from CI by npm trusted publishing (OIDC)
- The same, but authenticated with an `NPM_TOKEN` in repository secrets
- Fully automated release on merge to `main`, semantic-release style
- Manual `npm publish` from the maintainer's machine, with a checklist

## Decision Outcome

Chosen option: "A per-package tag, prepared locally, published from CI by npm trusted publishing
(OIDC)", because it is the only option that produces a provenance-attested artifact built on a
clean checkout while leaving no publishable credential anywhere in the repository — and it keeps
the release decision human, which the two records it serves both require.

The shape is three steps, and the split between them is the point:

1. **Prepare, locally.** `npm run gen:release -- --package @nerey/core` derives the bump from the
   commit range since that package's last tag (ADR 0036 scopes are the attribution, not file
   paths — a change to a core type breaks theme consumers while touching no file under
   `packages/theme/`), applies the pre-1.0 arithmetic of ADR 0029, writes the manifest version and
   a `CHANGELOG.md` entry, and prints the commit, tag and push commands. It writes files and
   nothing else: it does not commit, does not tag, and does not touch the network.
2. **Tag, deliberately.** The human reads the printed changelog, agrees with the number, and
   pushes `@nerey/core@0.2.0`. This is where the judgement ADR 0038 keeps manual actually happens.
3. **Publish, from CI.** `.github/workflows/release.yml` triggers on that tag, runs the full gate
   battery, the tests, the build and `check:exports` on a clean checkout, asserts the tag agrees
   with the manifest, and publishes with OIDC. No token: with `id-token: write` and npm ≥ 11.5.1,
   npm authenticates through the trusted-publisher relationship and generates the provenance
   attestation itself.

**The two-signal cross-check, which ADR 0038 deferred here, is implemented in step 1.** Before
writing anything, `gen:release` reads the contract baselines of ADR 0038 at the previous tag and
at `HEAD` and compares them. If a symbol was removed or a signature changed on a surface belonging
to the package being released, and no commit in the range carries a `!` marker for that scope, the
tool refuses:

> `@nerey/core`: `formatIssuePath` changed shape between `@nerey/core@0.1.0` and HEAD, but no
> commit in the range declares a break. Either the change is not breaking and the baseline was
> re-blessed too eagerly, or the commit that made it should have carried `!`.

That is the disagreement ADR 0029 wanted surfaced: the author declares the bump, the gate derives
it, and a mismatch blocks the release rather than resolving itself silently in whichever direction
happens to be quieter.

### Consequences

- Good, because the tarball on npm is built by the same job that proved the gates pass, on a
  checkout nobody has been working in.
- Good, because provenance is attested without anyone holding a publish token. The credential that
  cannot leak is the one that does not exist.
- Good, because the changelog is generated from the commit range, which is what ADR 0036 said
  commit discipline was for. Until now nothing consumed it.
- Good, because the two-signal check makes ADR 0038's largest remaining gap someone else's problem
  exactly once — at the moment a release is prepared, which is the only moment it matters.
- Neutral, because it requires one-time configuration on npm that only the package owner can do,
  and that configuration is invisible from this repository. The runbook names it; nothing here can
  verify it.
- Bad, because a release now depends on GitHub Actions being available. A registry outage or a
  broken runner image blocks publishing in a way a laptop would not.
- Bad, because the attribution of a commit to a package is its **scope**, so a commit scoped wrong
  lands in the wrong changelog and, worse, is missing from the right one. `check:commits` validates
  that a scope is in the vocabulary, not that it is the true one; no gate can.

### Confirmation

`npm run gen:release -- --package <name>` (`scripts/gen-release.mjs`) is the fitness function for
everything above that can be checked mechanically. It **refuses**, rather than warning, on:

- `no-commits` — nothing releasable in the range, so a tag would publish an identical artifact
  under a new number.
- `undeclared-break` — a baseline removal or signature change with no `!` in the range. The
  two-signal check above.
- `dirty-tree` — uncommitted changes, which would make the tag name a build nobody can reproduce.
- `version-behind` — the computed version is not greater than the published one.

It is registered in the ADR 0033 harness with a `--self-test` that plants a violator for each rule,
and it is discovered as a generator, so it stays outside `check:all` — preparing a release is not
something CI should do on every pull request.

The workflow carries the second half, and the ordering is deliberate: `check:all`, then the tests,
then the build, then `check:exports` against a packed tarball, and only then `npm publish`. A
`tag-version-mismatch` step between the build and the publish asserts that the tag being released
names the version in the manifest, because a tag is a human artifact and the manifest is the thing
npm reads.

What none of this confirms is the npm-side configuration: whether the `@nerey` scope exists, and
whether each package's trusted publisher points at `real-case/nerey` and `release.yml`. That is
account state, not repository state, and the first release will fail loudly if it is wrong — which
is the correct failure, since the alternative is publishing under a credential that should not
have worked.

## Pros and Cons of the Options

### A per-package tag, prepared locally, published from CI by npm trusted publishing (OIDC)

- Good, because no publish credential exists to leak, rotate, or scope incorrectly.
- Good, because provenance is automatic — with a trusted publisher configured, `npm publish` from
  Actions generates the attestation without `--provenance`.
- Good, because the tag is per package, so `@nerey/core@0.2.0` and `@nerey/theme@0.4.1` are
  independent events, which is what ADR 0002 promised and a lockstep scheme would quietly undo.
- Neutral, because it requires npm ≥ 11.5.1 and Node ≥ 22.14. Both are already below this
  repository's floor of Node 24 (ADR 0004).
- Bad, because trusted publishing must be configured per package before the first publish, and
  npm does not validate that configuration when it is saved — an error in it surfaces only at
  publish time.

### The same, but authenticated with an `NPM_TOKEN` in repository secrets

- Good, because it works with no npm-side configuration at all, which makes the first release
  simpler.
- Good, because it is the arrangement most maintainers already know, so a contributor debugging it
  is on familiar ground.
- Bad, because a granular automation token with publish rights sits in repository secrets
  indefinitely. It is exactly the artifact every recent registry supply-chain incident has turned
  on, and it must be rotated by a human who has no reminder to.
- Bad, because provenance then needs `--provenance` and `id-token: write` anyway, so the token
  buys nothing except a second credential path.

### Fully automated release on merge to `main`, semantic-release style

- Good, because it removes the step a maintainer forgets, and the version can never drift from the
  history it was derived from.
- Good, because releases become small and frequent, which is better for consumers than a quarterly
  batch.
- Bad, because ADR 0038 is explicit that the gates are a **floor** on the bump and cannot judge a
  behavioural break — reordering the degradation chain (ADR 0012) or changing debounce timing in
  `useWidgetState` breaks a consumer with an identical surface. Automating the release deletes the
  only step where a person was going to notice.
- Bad, because it makes every merge a publish, so a mistake is public before anyone reads it.

### Manual `npm publish` from the maintainer's machine, with a checklist

- Good, because it needs no infrastructure and cannot be broken by a runner image change.
- Good, because it is the fastest path to a first release, which matters when the packages are
  unpublished and the goal is to find out whether anyone wants them.
- Bad, because the tarball is built from a working tree, and this repository has already recorded
  two defects that existed only because a local run passed for a reason that did not survive a
  clean checkout.
- Bad, because provenance is unavailable, so consumers get no way to tie the tarball to a commit.

## More Information

Serves ADR 0029 and ADR 0038 (what a version means and which surfaces move it), ADR 0036 (where
the bump and the changelog come from), ADR 0002 (why the release unit is one package) and
ADR 0028 (what `check:exports` verifies about the tarball before it is published).

The runbook, including the one-time npm-side configuration and what to do if the first publish is
rejected, is `docs/releasing.md`. It is prose rather than a record because it describes operations
that change with the registry, not a decision.

npm trusted publishing: <https://docs.npmjs.com/trusted-publishers/>. It went generally available
in July 2025; `npm trust github <package> --repo <owner/repo> --file <workflow>` configures a
relationship from the CLI as of npm 11.
