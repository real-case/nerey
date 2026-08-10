---
name: adr
description: >-
  Create an Architecture Decision Record (ADR) in MADR full-template format under
  docs/decisions/, with automatic sequential numbering (0001, 0002, …) and an
  auto-maintained index. Use this skill whenever the user wants to document, record,
  or capture a technical or architectural decision — for example "write an ADR",
  "create a decision record", "document why we chose Postgres", "record this
  decision", "add an ADR for the auth approach", or any mention of MADR or ADRs. Also
  reach for it when a significant design choice has just been settled in the
  conversation and ought to be persisted, even if the user never says the word "ADR".
---

# Architecture Decision Records (MADR, full template)

Capture an architectural decision as a numbered Markdown file in `docs/decisions/`,
using the full [MADR](https://adr.github.io/madr/) template. An ADR records _one_
significant decision: the problem, the options weighed, the option chosen, and the
consequences. The test of a good ADR is that someone reading it months later
understands not just _what_ was decided but _why_ — including the roads not taken.

## When to write one

Write an ADR for decisions that are costly to reverse or that future contributors will
wonder about: choosing a datastore, an auth strategy, an API style, a deployment
target, a major dependency, a data format, a service boundary. Skip it for routine,
easily-reversible choices — an ADR per variable name is just noise that buries the
decisions that matter.

## Workflow

### 1. Gather the substance before writing anything

An ADR is only worth keeping if it captures real reasoning, so first make sure you
actually have:

- **The decision**, in one line — this becomes the title.
- **Context / problem** — what forced the decision; the constraints and forces in play.
- **Considered options** — at least two. A decision with one option isn't a decision,
  and recording the alternatives is what makes the choice defensible later.
- **The chosen option and its justification** — why this one beat the others.
- **Consequences** — what gets better, what gets worse, what you're now committed to.

Pull as much as you can from the conversation and the codebase. If something material
is missing — especially the alternatives or the justification — ask the user a brief
question rather than inventing it. A fabricated rationale is worse than an honest gap,
because it will mislead the next reader. If the decision is still forming, that's fine:
mark it `proposed` and leave a section thin.

### 2. Pick the next number and a slug

From the project root:

```bash
python .claude/skills/adr/scripts/adr.py next
```

This scans `docs/decisions/` for the highest `NNNN-…` file and prints the next number,
zero-padded to four digits (e.g. `0007`). These numbers are **permanent IDs** — they
never change, even when an ADR is later superseded. That stability is exactly what lets
other ADRs, commit messages, and PRs refer to "ADR-0007" and have it mean one thing
forever.

Name the file `NNNN-<short-kebab-title>.md`, e.g.
`0007-use-stripe-webhooks-for-payment-events.md`. Keep the slug short but specific
enough to recognise in a file list.

### 3. Fill in the full template

Start from the bundled template, which is the verbatim MADR full template (the
`mkdir -p` makes the very first ADR in a fresh project just work):

```bash
mkdir -p docs/decisions
cp .claude/skills/adr/assets/adr-template.md docs/decisions/NNNN-<slug>.md
```

Then edit it into a real record:

- **Frontmatter** — set `status` (`proposed` if not yet ratified, otherwise
  `accepted`), `date` to today (get it with `date +%F`), and `decision-makers` if you
  know them. Delete the `consulted` / `informed` lines if you can't fill them rather
  than leaving the `{…}` placeholder text behind.
- **Replace every `{…}` placeholder** with concrete prose, and **delete the
  `<!-- … optional … -->` HTML comments** — those are authoring notes, not part of the
  finished record.
- Because this is the _full_ template (not minimal), keep and actually populate the
  richer sections: **Decision Drivers**, **Considered Options**, **Pros and Cons of the
  Options** (per option), **Confirmation**, and **More Information**. The per-option
  pros and cons are the whole reason to use the full template over the minimal one —
  they make the reasoning auditable. Only drop an optional section if it would be
  genuinely empty, and prefer a one-line "N/A because …" over silently removing it.

### 4. Regenerate the index

```bash
python .claude/skills/adr/scripts/adr.py index
```

This rewrites `docs/decisions/README.md` as a table of every ADR (number, title,
status, date), read straight from each file's frontmatter and heading. Run it after
every create and after any status change, so the index never drifts from the actual
records.

### 5. Report back

Tell the user the path and number of the new ADR, and explicitly surface anything you
had to assume or leave thin — those are exactly the spots they'll want to correct.

## Reversing a decision: supersede, don't edit

ADRs are an immutable trail, not living documents. To overturn a past decision, write a
**new** ADR and set the old one's `status` to `superseded by ADR-NNNN`, then rerun the
index. Don't delete or rewrite the original — the record of "we believed X, then
learned Y and changed course" is often more valuable than either decision alone.

## Template shape (reference)

`assets/adr-template.md` is the canonical source. Its structure:

- Frontmatter: `status`, `date`, `decision-makers`, `consulted`, `informed`
- Title — the decision in a few words
- Context and Problem Statement
- Decision Drivers
- Considered Options
- Decision Outcome → Consequences → Confirmation
- Pros and Cons of the Options (one subsection per option)
- More Information
