---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0001. Record architecture decisions as MADR ADRs

## Context and Problem Statement

Nerey extracts a working generative-UI kernel out of `osint-chat-client/src/shared/generative-ui/` and republishes it as three npm packages. The extraction is governed by 39 functional requirements and 23 acceptance criteria, and a large share of them are positions that look arbitrary from the outside and invite "cleanup" by the next contributor: exact `type@version` resolution with no semver range, a core package that deliberately ships no markdown renderer, themed components that deliberately refuse `className`, a theme that re-declares `box-sizing` on its own elements instead of trusting the host reset.

Each of those was chosen against a plausible alternative, and in at least one case (`poll@1.0` registered as `poll@1.0.0`, resolving to nothing and silently falling back to text) the alternative was tried first and cost real debugging time. `docs/requirements.md` states the resulting positions but not the roads not taken; it is a specification, not an argument. Once a position is published under semantic versioning (ADR 0029) the cost of an uninformed reversal is a MAJOR bump plus a consumer migration, so the reasoning has to outlive both the conversation that produced it and the person who had it.

The scope of this record is the decision-capture mechanism for the whole repository: format, location, numbering, lifecycle, tooling, and how records are cross-referenced and validated.

## Decision Drivers

* The rationale, not just the rule, has to survive. A rule without its rejected alternative gets re-litigated or silently reverted.
* Most contributions to this repository are made in agentic sessions with a bounded context window. Decisions must be greppable, individually addressable, and small enough to load selectively.
* Corpus integrity must be machine-checkable. A decision log that has drifted from reality is worse than none, because it is trusted.
* Records must be citable from commit bodies (ADR 0036) and from CI failure messages, which requires a stable, permanent identifier per decision.
* Decisions must be reversible in a way that preserves the earlier belief, since "we thought X, learned Y" is frequently more useful than either position alone.
* Authoring cost must stay low enough that decisions actually get recorded during the work rather than reconstructed afterwards.

## Considered Options

* MADR full template under `docs/decisions/`, numbered, with `adr.py` tooling and a `proposed` to `accepted` lifecycle
* MADR minimal template (context, decision, consequences only), same numbering and location
* A single living `ARCHITECTURE.md` describing the current design, revised in place as the design changes

## Decision Outcome

Chosen option: "MADR full template under `docs/decisions/`, numbered, with `adr.py` tooling and a `proposed` to `accepted` lifecycle", because it is the only option whose required sections force the two things that actually decay — the alternatives and the fitness function — and the only one whose structure is regular enough to lint mechanically.

Concretely:

* Records live at `docs/decisions/NNNN-kebab-title.md`. `NNNN` is a permanent identifier, assigned by `npm run adr -- next` and never reused or renumbered, including after supersession.
* Every record carries the full template sections in fixed order: Context and Problem Statement, Decision Drivers, Considered Options, Decision Outcome (with Consequences and Confirmation), Pros and Cons of the Options, More Information. `adr.py` treats the first, third and fourth as hard requirements and fails acceptance without them.
* Frontmatter is `status`, `date`, `decision-makers`. The status vocabulary is closed: `proposed`, `accepted`, `rejected`, `deprecated`, `superseded by ADR-NNNN`.
* `## Considered Options` lists at least two real candidates. The rejected option must be one a competent engineer would actually reach for; a record whose alternative exists only to lose has recorded nothing.
* `### Confirmation` names a machine-checkable fitness function wherever one exists — a named npm script, an ESLint rule, a test file, or a gate under `scripts/`. "Manual review" is permitted only with a stated reason why automation is impossible.
* Cross-references are written bare as `ADR 0029`, without a link, so that `scripts/check-adr-citations.mjs` can resolve every citation against the corpus without parsing markdown link syntax.
* Lifecycle is `proposed` then `accepted`. Promotion goes through `npm run adr -- accept NNNN`, which is fail-closed: it refuses when required sections are missing, when unfilled template placeholders remain, when the status is not `proposed`, or when the record cites a number that does not exist.
* **Accepted records are never edited in place.** Reversing an accepted decision means writing a new record and running `npm run adr -- supersede --old NNNN --new MMMM`, which flips the old record's status and writes the reciprocal `supersedes` link. Typo and formatting fixes are the only in-place edits allowed on an accepted record.
* `docs/decisions/README.md` is generated, never hand-edited, by `npm run adr -- index`.

The bootstrap corpus — every record numbered 0001 through 0037 — was written as a single body of work and accepted in bulk by the repository owner on 2026-08-09, before the packages contain code. This is deliberate: the records are the specification the implementation is written against, not a retrospective narration of it. It also means the corpus has no `proposed` history to inspect, and the `proposed` to `accepted` transition first exercises for real on record 0038.

### Consequences

* Good, because each decision is a separate file with a permanent number, so a session can load the three records relevant to the file it is editing instead of an entire architecture document.
* Good, because the full template's per-option pros and cons make the reasoning auditable. A reader can check whether the rejected option was weighed honestly, which is precisely the check a minimal record makes impossible.
* Good, because the mandatory Confirmation section converts most decisions into an executable gate. Roughly half the custom gates in `package.json` exist because a record had to name one.
* Good, because immutability plus supersession keeps the corpus an accurate history of belief rather than a snapshot that quietly forgets its own mistakes.
* Bad, because the full template is heavy. A small decision costs a page of prose, which creates pressure to skip recording rather than to record briefly. Mitigated by the "significant or costly to reverse" threshold in the skill: no record for choices that are cheap to undo.
* Bad, because 37 bootstrap records accepted on one day were not battle-tested by implementation. Some Confirmation sections name gates that do not exist yet, and each is a commitment the implementation must honour or supersede.
* Neutral, because the corpus needs pruning discipline over time. Superseded records stay in the directory and in the index, so the directory listing grows monotonically and readers must check status before trusting a record.

### Confirmation

Four automated gates, all wired into `npm run check:all`:

1. `npm run adr -- lint` (`.claude/skills/adr/scripts/adr.py`) — validates the whole corpus: duplicate or missing numbers, statuses outside the closed vocabulary, missing required sections, leftover MADR placeholders, references to numbers that do not exist, an index that has drifted from the records, and supersede pairs whose back-link is missing.
2. `npm run check:citations` (`scripts/check-adr-citations.mjs`) — resolves every bare `ADR NNNN` citation appearing anywhere in the repository, including `CLAUDE.md` and commit-linked documentation, not just inside `docs/decisions/`. A citation of a nonexistent record fails the build.
3. `npm run check:spelling` (`cspell --no-progress "**/*.md"`) — the records are the primary prose surface of the repository and are read by contributors who did not write them.
4. `npm run check:gates` (`scripts/check-gates.mjs`) — per ADR 0033, the citation gate is itself registered with a planted violator, so a citation gate that stopped resolving anything cannot pass silently.

The one thing no gate checks is whether a record's stated rationale is true. That is manual review at acceptance time, by the decision-makers named in the frontmatter, and it is the reason `accept` is a human-run command rather than a step in CI.

## Pros and Cons of the Options

### MADR full template under `docs/decisions/`, numbered, with `adr.py` tooling and a `proposed` to `accepted` lifecycle

The upstream MADR full template, verbatim from `.claude/skills/adr/assets/adr-template.md`, plus a 444-line Python helper exposing `next`, `index`, `lint`, `accept` and `supersede`.

* Good, because the required sections force the alternatives and the fitness function to be written down, which are the two parts that a hurried author drops first and a future reader needs most.
* Good, because the fixed section names make the corpus mechanically lintable — `adr.py lint` is possible only because every record has the same shape.
* Good, because permanent four-digit identifiers give commit trailers, CI messages and other records a stable target, and supersession preserves them.
* Good, because MADR is an established format with published tooling and conventions, so the structure needs no defending and no in-house documentation.
* Neutral, because the tooling is Python in a Node repository. It is a single dependency-free script invoked through the `adr` npm script, so it adds no install step, but it does mean the repository assumes `python3` on `PATH`.
* Bad, because the template is verbose enough that a genuinely small decision looks disproportionate when written up in it.
* Bad, because the lifecycle adds a ratification step that has no value for a single-maintainer repository today, and only pays off once more than one person can propose a decision.

### MADR minimal template (context, decision, consequences only)

Same numbering, location and tooling, but records drop Decision Drivers, Considered Options, per-option pros and cons, and Confirmation.

* Good, because it is materially cheaper to write, so more decisions get recorded and fewer are lost.
* Good, because it still captures the decision and its number, which is enough for cross-referencing and for the index.
* Neutral, because `adr.py lint` would still work — its required-section list is already only three headings, all of which the minimal template keeps.
* Bad, because dropping Considered Options removes the single most valuable content. A record that states only the conclusion cannot stop a future contributor from reverting it, because it never says what was wrong with the obvious alternative.
* Bad, because dropping Confirmation removes the forcing function that produced this repository's gate scripts. Without a section demanding a fitness function, decisions stay aspirational and drift is discovered late.
* Bad, because "consequences" without weighed options tends to degrade into a restatement of benefits, which reads as advocacy rather than as a record.

### A single living `ARCHITECTURE.md` revised in place

One document describing the current design, updated whenever the design changes.

* Good, because it is the fastest thing to read for someone new — one file, current state, no status field to check.
* Good, because it has no numbering, no lifecycle and no tooling, so there is nothing to maintain beyond the prose itself.
* Neutral, because git history technically preserves prior versions, so the information is not destroyed, only made much harder to find.
* Bad, because in-place revision erases the rejected alternatives and the reasons. The document converges on describing what the code does, at which point it duplicates the code and starts to lag it.
* Bad, because there is no stable identifier to cite. A commit or a CI message cannot point at "the part of ARCHITECTURE.md about version resolution" in a way that survives the next edit.
* Bad, because it is a single merge-conflict surface, and in agentic sessions it is either loaded whole — spending context on 90% irrelevant material — or grepped, which is exactly what a per-decision file layout gives for free.

## More Information

The template is the verbatim MADR full template at `.claude/skills/adr/assets/adr-template.md`; the authoring workflow and the supersede-don't-edit rule are documented in `.claude/skills/adr/SKILL.md`. Upstream: <https://adr.github.io/madr/>.

Tooling lives at `.claude/skills/adr/scripts/adr.py`, exposed as `npm run adr`. The subcommands are `next` (allocate a number), `index` (regenerate `docs/decisions/README.md`), `lint` (validate the corpus), `accept` (promote `proposed` to `accepted`, fail-closed), and `supersede` (retire a record and wire both links).

Related records: ADR 0033 defines how the gates named in Confirmation sections prove they can fail; ADR 0034 runs a subset of those gates at edit time; ADR 0036 makes commits cite records by number; ADR 0029 is why an unrecorded reversal is expensive. ADR 0002 establishes the workspace layout these records are scoped to.

Revisit when a second regular contributor joins — the `proposed` lifecycle, currently ceremonial, becomes the review mechanism at that point — or if the corpus passes roughly 60 records, where a topic index over `docs/decisions/README.md` starts to be worth more than the flat chronological table.
