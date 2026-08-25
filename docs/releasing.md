# Releasing

How a version of one package reaches npm. The decision behind this is ADR 0039; this file is the
operation, which changes with the registry rather than with the architecture.

The shape in one line: **you prepare and tag locally, CI publishes.** Nothing on a developer
machine ever runs `npm publish`, and no publish credential exists anywhere in the repository.

---

## One-time setup, before the first release

These are npm account actions. Nothing in this repository can perform or verify them, and the
first release fails loudly if they are wrong — which is the correct failure, because the
alternative is a publish that succeeded through a credential that should not have worked.

1. **Own the `@nerey` scope** on the npm account that will hold the packages. Until then every
   `npm publish` returns 404 regardless of how the workflow authenticates.

2. **Configure a trusted publisher for each of the three packages**, pointing at this repository
   and this workflow file:

   ```bash
   npm trust github @nerey/core --repo real-case/nerey --file release.yml --allow-publish
   npm trust github @nerey/theme --repo real-case/nerey --file release.yml --allow-publish
   npm trust github @nerey/eslint-config --repo real-case/nerey --file release.yml --allow-publish
   ```

   The workflow filename must be exactly `release.yml` — npm matches on the filename, not on the
   workflow's `name:`. Verify with `npm trust list @nerey/core`.

   npm does **not** validate a trusted-publisher configuration when it is saved, so a mistake here
   is invisible until a publish is attempted.

3. **If npm refuses to configure a trusted publisher for a package that does not exist yet**,
   publish `0.1.0` once with a granular automation token — locally, or by temporarily adding
   `NODE_AUTH_TOKEN` to the workflow — then configure the trusted publisher and **revoke the
   token**. A token that exists after it is needed is the artifact ADR 0039 rejected the
   token-based option to avoid.

After this, `.github/workflows/release.yml` needs no secrets: `id-token: write` is the whole
credential, and provenance attestations are generated automatically.

---

## Releasing a package

### 1. Prepare

From a clean `main`:

```bash
npm run gen:release -- --package @nerey/core --dry-run
```

It prints the computed bump, the range it read, and the changelog entry it would write. Nothing is
written under `--dry-run`.

It derives the number from the commit range since that package's last tag, using the commit
**scope** as the attribution — `fix(core): …` belongs to `@nerey/core` whether or not it touched a
file under `packages/core/`. That is deliberate (ADR 0036): a change to a core type breaks theme
consumers while touching no file in the theme.

It **refuses** rather than warns, on four things:

| refusal            | what it means                                                                 |
| ------------------ | ----------------------------------------------------------------------------- |
| `dirty-tree`       | uncommitted changes — a tag would name a build nobody can reproduce           |
| `no-commits`       | nothing releasable in scope — the tag would republish an identical artifact   |
| `version-behind`   | a tag already exists at or above the manifest version                         |
| `undeclared-break` | a contract baseline lost a symbol or changed a signature with no `!` in range |

`undeclared-break` is the two-signal check of ADR 0039. It means the gates and the commit history
disagree about whether this release is breaking. Resolve it, do not work around it:

- If the change **is** breaking, the commit that made it should have carried `!`. It is already
  merged, so declare it on the release commit instead and say so in the body.
- If it is **not** breaking, a baseline was re-blessed too eagerly. Find out which change moved it
  and whether that change was intended.

Then run it for real:

```bash
npm run gen:release -- --package @nerey/core
```

It writes `packages/core/package.json` and `packages/core/CHANGELOG.md` and prints the exact
commit, tag and push commands. It does not commit, does not tag, and never touches the network.

### 2. Read what it wrote

The generated changelog entry is the last point at which a person sees the release before it is
public. Read it against ADR 0038's limitation: **no gate here can judge a behavioural break.**
Reordering the degradation chain, changing when a lifecycle rule fires, or altering the debounce
window in `useWidgetState` breaks a consumer with an identical surface and passes every check in
this repository. If the range contains one, the bump the tool computed is a floor, not the answer.

### 3. Tag and push

Run the commands the tool printed. They look like:

```bash
git commit -m 'chore(core): release 0.1.1' -m 'Refs: ADR 0039' packages/core/package.json packages/core/CHANGELOG.md
git tag @nerey/core@0.1.1
git push origin main @nerey/core@0.1.1
```

The tag is what publishes. Pushing the commit alone does nothing.

### 4. Watch the workflow

`release.yml` runs the whole battery on a clean checkout — typecheck, lint, format, `gen:check`,
`check:all`, the full test suite with coverage, the build, `check:exports` against a packed
tarball — asserts the tag agrees with the manifest, and only then publishes.

```bash
gh run watch
```

A failure here is a release that did not happen, which is recoverable. Delete the tag
(`git push --delete origin @nerey/core@0.1.1`), fix, and tag again.

---

## After the release

Check that provenance actually attached — it is the property the whole arrangement exists for:

```bash
npm view @nerey/core dist.attestations
```

An empty result means the publish fell back to some other credential path. Find out which one
before releasing again.

---

## What this does not cover

- **Pre-releases and dist-tags.** Everything here publishes to `latest`. A `next` channel needs its
  own decision about how the version is derived and is not designed.
- **Deprecating or unpublishing.** Both are npm account actions with a 72-hour window and neither
  is automated on purpose.
- **A coordinated multi-package release.** Each package is tagged separately, by design (ADR 0002).
  Releasing `@nerey/core` and `@nerey/theme` together is two tags, and the theme's peer range on
  core must be widened in a normal commit before either is cut.
