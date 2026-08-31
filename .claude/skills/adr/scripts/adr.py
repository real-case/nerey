#!/usr/bin/env python3
"""ADR helper — the mechanical, error-prone parts of keeping a set of ADRs healthy.

Numbering, the index, cross-reference integrity, the accept gate and the
supersede link-flip are deterministic and easy to get subtly wrong by hand, so
they live here rather than in prose instructions. Every command reads the real
files on disk, so it can never drift from reality; the mutating commands
(`accept`, `supersede`, `index`) are idempotent.

    python adr.py next      [--dir docs/decisions]
    python adr.py index     [--dir docs/decisions] [--title "Architecture Decision Records"]
    python adr.py lint      [--dir docs/decisions]
    python adr.py accept    NNNN [--dir docs/decisions] [--date YYYY-MM-DD]
    python adr.py supersede --old NNNN --new MMMM [--dir docs/decisions] [--force]

Standard library only — no third-party dependencies, runs on any Python 3.8+.
"""
from __future__ import annotations

import argparse
import datetime
import re
import sys
from pathlib import Path

# ADR files are named NNNN-some-kebab-title.md. The README/index never matches this,
# so it is automatically excluded from scans.
ADR_FILE_RE = re.compile(r"^(\d{4})-.*\.md$")

# The legal status vocabulary. A raw status of "superseded by ADR 0007" is a
# well-formed "superseded" (see status_kind).
STATUS_VOCAB = {"proposed", "accepted", "rejected", "deprecated", "superseded"}

# The MADR sections this project treats as required (full template).
REQUIRED_SECTIONS = (
    "## Context and Problem Statement",
    "## Considered Options",
    "## Decision Outcome",
)

# How ADRs point at one another across the corpus. Each pattern yields a 4-digit
# number. Kept narrow on purpose so prose like "Node 24" never reads as a ref.
ADR_REF_RES = (
    re.compile(r"\*\*(\d{4})\*\*"),            # bold inline ref:  **0002**
    re.compile(r"\bADR-(\d{4})\b"),            # ADR-0002 — read, never written:
    #   ADR 0001 fixes the citation form as a bare `ADR NNNN` so one grep finds every
    #   reference, and `check:citations` fails the hyphenated spelling. This tool used to
    #   WRITE it into a superseded record's status, which the generated index then rendered
    #   into a table cell — so the first real supersede failed that gate. The pattern stays
    #   so any record already carrying the old form still resolves.
    re.compile(r"\]\((\d{4})-[^)]*\.md\)"),    # markdown link:    [..](0002-….md)
    re.compile(r"supersed(?:es|ed by)\b[^\n]*?(\d{4})", re.IGNORECASE),
)
CON_REF_RE = re.compile(r"\bCON-(\d{3})\b")
CON_BACKLINK_RE = re.compile(r"\]\((\d{4})-[^)]*\.md\)")  # ADR links inside a CON row
SUPERSEDED_BY_RE = re.compile(r"superseded by\b[^\n]*?(\d{4})", re.IGNORECASE)
# A leftover MADR template placeholder still carries the ellipsis, e.g. "{…}" or
# "{title of option 1}". Real code like "{ locale }" has no ellipsis, so this is safe.
TEMPLATE_PLACEHOLDER_RE = re.compile(r"\{[^}]*…[^}]*\}")


def find_adrs(directory: Path):
    """Return [(number, path), …] for ADR files in *directory*, sorted by number."""
    if not directory.exists():
        return []
    adrs = []
    for path in directory.iterdir():
        match = ADR_FILE_RE.match(path.name)
        if path.is_file() and match:
            adrs.append((int(match.group(1)), path))
    return sorted(adrs, key=lambda item: item[0])


def next_number(directory: Path) -> str:
    """Highest existing number + 1, zero-padded to four digits (so '0001', '0042')."""
    highest = max((number for number, _ in find_adrs(directory)), default=0)
    return f"{highest + 1:04d}"


def parse_frontmatter(text: str) -> dict:
    """Parse a leading '--- … ---' block into a flat {key: value} dict.

    Deliberately small — enough for the simple `key: value` lines MADR uses, without
    pulling in a YAML dependency.
    """
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    data = {}
    for line in text[3:end].splitlines():
        line = line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, _, value = line.partition(":")
        data[key.strip()] = value.strip().strip('"').strip("'")
    return data


def first_heading(text: str) -> str:
    """The ADR title — the first level-1 markdown heading in the body."""
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def display(value: str, fallback: str = "—") -> str:
    """Render a frontmatter value, blanking out unfilled MADR placeholders like {…}."""
    if not value or value.startswith("{"):
        return fallback
    return value


def status_kind(raw: str) -> str:
    """Map a raw status value to its vocabulary term ('superseded by ADR 0007' -> 'superseded')."""
    s = (raw or "").strip().strip('"').strip("'").lower()
    return "superseded" if s.startswith("superseded") else s


def set_frontmatter_field(text: str, key: str, value: str) -> str:
    """Return *text* with frontmatter `key:` set to `value` (line replaced, else appended).

    `value` is written verbatim, so the caller owns quoting — pass '"accepted"' to get
    a quoted status, or a bare date to leave it unquoted, matching the corpus style.
    """
    if not text.startswith("---"):
        raise ValueError("record has no frontmatter block")
    end = text.find("\n---", 3)
    if end == -1:
        raise ValueError("unterminated frontmatter block")
    head, fm, rest = text[:3], text[3:end], text[end:]
    line = f"{key}: {value}"
    pattern = re.compile(rf"(?m)^{re.escape(key)}:.*$")
    if pattern.search(fm):
        fm = pattern.sub(line, fm, count=1)
    else:
        fm = fm.rstrip("\n") + "\n" + line
    return head + fm + rest


def build_index(directory: Path, title: str) -> str:
    rows = []
    for number, path in find_adrs(directory):
        text = path.read_text(encoding="utf-8")
        meta = parse_frontmatter(text)
        heading = first_heading(text) or path.stem
        rows.append(
            f"| [{number:04d}]({path.name}) | {heading} | "
            f"{display(meta.get('status', ''))} | {display(meta.get('date', ''))} |"
        )

    lines = [
        f"# {title}",
        "",
        "Architecture Decision Records for this project, in "
        "[MADR](https://adr.github.io/madr/) format. "
        "Each record captures one decision and the reasoning behind it.",
        "",
    ]
    if rows:
        lines += ["| ADR | Title | Status | Date |", "| --- | --- | --- | --- |", *rows]
    else:
        lines.append("_No decision records yet._")
    lines.append("")
    return "\n".join(lines)


def con_registry(directory: Path):
    """Read constraints.md → (defined CON ids, {con_id: {adr numbers it links back to}}).

    Only table rows define constraints, and only markdown ADR links count as back-links,
    so the 'Recorded 2026-…' date column never reads as an ADR number.
    """
    path = directory / "constraints.md"
    if not path.exists():
        return set(), {}
    defined, backlinks = set(), {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.lstrip().startswith("|"):
            continue
        ids = CON_REF_RE.findall(line)
        if not ids:
            continue
        cid = ids[0]  # the row's own CON id is the first on the line
        defined.add(cid)
        backlinks.setdefault(cid, set()).update(CON_BACKLINK_RE.findall(line))
    return defined, backlinks


def adr_refs(text: str) -> set:
    """All 4-digit ADR numbers *text* points at, via any of the known reference forms."""
    refs = set()
    for rx in ADR_REF_RES:
        refs.update(rx.findall(text))
    return refs


# ── The acceptance policy ──────────────────────────────────────────────────────
# record_blockers() decides what MUST be true before a record can be accepted, and
# is the same per-record gate `lint` enforces across the corpus. This is the one
# genuinely judgment-laden spot in the script: tighten or relax it to match how
# strict the project wants its decision records to be.
def record_blockers(number: int, text: str, meta: dict, numset: set, con_defined: set) -> list:
    """Hard problems with a single record — each blocks acceptance and fails lint."""
    problems = []
    nnnn = f"{number:04d}"

    raw = meta.get("status", "")
    if not raw or raw.startswith("{"):
        problems.append("missing or placeholder status")
    elif status_kind(raw) not in STATUS_VOCAB:
        problems.append(f"invalid status '{raw}'")

    for section in REQUIRED_SECTIONS:
        if section not in text:
            problems.append(f"missing required section '{section}'")

    if TEMPLATE_PLACEHOLDER_RE.search(text):
        problems.append("unfilled '{…}' template placeholder(s) remain")

    for ref in sorted(adr_refs(text)):
        if ref != nnnn and ref not in numset:
            problems.append(f"references ADR {ref}, which does not exist")

    for cid in sorted(set(CON_REF_RE.findall(text))):
        if cid not in con_defined:
            problems.append(f"references CON-{cid}, not defined in constraints.md")

    return problems


def record_warnings(number: int, text: str, meta: dict, records: dict) -> list:
    """Soft problems with a record — reported, but not enough to block acceptance.

    Note the CON direction: an ADR may cite *many* constraints as drivers, but the
    registry deliberately back-links only the one *residual-choice* ADR per
    constraint, so a citation with no back-link is expected, not a defect. The
    registry's own links are validated the other way around, in lint().
    """
    warnings = []
    nnnn = f"{number:04d}"

    if status_kind(meta.get("status", "")) == "superseded":
        match = SUPERSEDED_BY_RE.search(meta.get("status", "")) or SUPERSEDED_BY_RE.search(text)
        if match:
            target = int(match.group(1))
            target_text = records.get(target, (None, ""))[1]
            if target_text and not re.search(rf"supersedes\b[^\n]*{nnnn}", target_text, re.I):
                warnings.append(f"superseded by {target:04d}, but {target:04d} has no matching "
                                f"'supersedes {nnnn}'")
    return warnings


def lint(directory: Path):
    """Scan the whole corpus. Return (errors, warnings) as lists of 'file: message'."""
    adrs = find_adrs(directory)
    errors, warnings = [], []
    numbers = [n for n, _ in adrs]
    numset = {f"{n:04d}" for n in numbers}
    con_defined, con_back = con_registry(directory)

    # Corpus-level: numbering must be unique and gap-free.
    seen = set()
    for n in numbers:
        if n in seen:
            errors.append(f"numbering: duplicate ADR number {n:04d}")
        seen.add(n)
    for missing in sorted(set(range(1, max(numbers, default=0) + 1)) - set(numbers)):
        errors.append(f"numbering: {missing:04d} is missing (gap in sequence)")

    records = {n: (p, p.read_text(encoding="utf-8")) for n, p in adrs}
    records_for_pairing = {n: (p, t, parse_frontmatter(t)) for n, (p, t) in records.items()}

    for n, (path, text) in records.items():
        meta = parse_frontmatter(text)
        for msg in record_blockers(n, text, meta, numset, con_defined):
            errors.append(f"{path.name}: {msg}")
        for msg in record_warnings(n, text, meta, records_for_pairing):
            warnings.append(f"{path.name}: {msg}")
        # A superseded-by link must resolve.
        if status_kind(meta.get("status", "")) == "superseded":
            match = SUPERSEDED_BY_RE.search(meta.get("status", "")) or SUPERSEDED_BY_RE.search(text)
            if not match:
                errors.append(f"{path.name}: status 'superseded' but no 'superseded by NNNN' link")
            elif f"{int(match.group(1)):04d}" not in numset:
                errors.append(f"{path.name}: superseded by {match.group(1)}, which does not exist")

    # Corpus-level: every back-link the CON registry declares must resolve, and the
    # linked ADR should cite that constraint back (registry -> ADR, the direction the
    # registry's contract actually promises).
    for cid, linked in sorted(con_back.items()):
        for num in sorted(linked):
            if num not in numset:
                errors.append(f"constraints.md: CON-{cid} links to ADR {num}, which does not exist")
            elif f"CON-{cid}" not in records[int(num)][1]:
                warnings.append(f"constraints.md: CON-{cid} links to {num}, "
                                f"but {num} does not cite CON-{cid}")

    # Corpus-level: the generated index must match what is on disk.
    readme = directory / "README.md"
    regenerated = build_index(directory, "Architecture Decision Records")
    if not readme.exists():
        errors.append("README.md: index missing (run: adr.py index)")
    elif readme.read_text(encoding="utf-8").strip() != regenerated.strip():
        errors.append("README.md: index is stale (run: adr.py index)")

    return errors, warnings


def do_index(directory: Path, title: str) -> int:
    directory.mkdir(parents=True, exist_ok=True)
    out_path = directory / "README.md"
    out_path.write_text(build_index(directory, title), encoding="utf-8")
    print(str(out_path))
    return 0


def do_accept(directory: Path, number: str, date: str) -> int:
    """Promote one proposed record to accepted. The human acceptance action."""
    n = int(number)
    adrs = dict(find_adrs(directory))
    if n not in adrs:
        print(f"error: ADR {n:04d} not found in {directory}", file=sys.stderr)
        return 1
    path = adrs[n]
    text = path.read_text(encoding="utf-8")
    meta = parse_frontmatter(text)
    current = status_kind(meta.get("status", ""))
    if current == "accepted":
        print(f"ADR {n:04d} is already accepted; nothing to do.")
        return 0
    if current != "proposed":
        print(f"error: ADR {n:04d} has status '{current}'; only 'proposed' can be accepted.",
              file=sys.stderr)
        return 2

    numset = {f"{m:04d}" for m in adrs}
    con_defined, _ = con_registry(directory)
    blockers = record_blockers(n, text, meta, numset, con_defined)
    if blockers:
        print(f"error: ADR {n:04d} is not ready for acceptance:", file=sys.stderr)
        for b in blockers:
            print(f"  - {b}", file=sys.stderr)
        return 2

    text = set_frontmatter_field(text, "status", '"accepted"')
    text = set_frontmatter_field(text, "date", date)
    path.write_text(text, encoding="utf-8")
    do_index(directory, "Architecture Decision Records")
    print(f"accepted: {path.name} (status=accepted, date={date}); index regenerated")
    return 0


def do_supersede(directory: Path, old: str, new: str, force: bool) -> int:
    """Wire paired supersede links and flip the old record to superseded."""
    o, m = int(old), int(new)
    adrs = dict(find_adrs(directory))
    for label, num in (("--old", o), ("--new", m)):
        if num not in adrs:
            print(f"error: {label} ADR {num:04d} not found in {directory}", file=sys.stderr)
            return 1
    if o == m:
        print("error: an ADR cannot supersede itself", file=sys.stderr)
        return 1

    new_path = adrs[m]
    new_text = new_path.read_text(encoding="utf-8")
    if status_kind(parse_frontmatter(new_text).get("status", "")) != "accepted" and not force:
        print(f"error: superseding record {m:04d} is not 'accepted' yet — accept it first, "
              f"or pass --force to override.", file=sys.stderr)
        return 2

    old_path = adrs[o]
    old_text = old_path.read_text(encoding="utf-8")
    old_path.write_text(
        set_frontmatter_field(old_text, "status", f'"superseded by ADR {m:04d}"'),
        encoding="utf-8",
    )
    if not re.search(rf"supersedes\b[^\n]*{o:04d}", new_text, re.IGNORECASE):
        new_path.write_text(
            set_frontmatter_field(new_text, "supersedes", f'"ADR {o:04d}"'),
            encoding="utf-8",
        )
    do_index(directory, "Architecture Decision Records")
    print(f"superseded: {old_path.name} -> 'superseded by ADR {m:04d}'; "
          f"{new_path.name} -> 'supersedes ADR {o:04d}'; index regenerated")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_next = sub.add_parser("next", help="Print the next zero-padded ADR number.")
    p_next.add_argument("--dir", default="docs/decisions")

    p_index = sub.add_parser("index", help="Regenerate the decisions index (README.md).")
    p_index.add_argument("--dir", default="docs/decisions")
    p_index.add_argument("--title", default="Architecture Decision Records")

    p_lint = sub.add_parser("lint", help="Check corpus integrity (refs, index, numbering).")
    p_lint.add_argument("--dir", default="docs/decisions")

    p_accept = sub.add_parser("accept", help="Promote a proposed ADR to accepted (human action).")
    p_accept.add_argument("number", help="ADR number to accept, e.g. 0027")
    p_accept.add_argument("--dir", default="docs/decisions")
    p_accept.add_argument("--date", default=datetime.date.today().isoformat(),
                          help="Acceptance date (default: today)")

    p_sup = sub.add_parser("supersede", help="Mark --old superseded by --new and wire links.")
    p_sup.add_argument("--old", required=True, help="ADR number being superseded")
    p_sup.add_argument("--new", required=True, help="ADR number that supersedes it")
    p_sup.add_argument("--dir", default="docs/decisions")
    p_sup.add_argument("--force", action="store_true",
                       help="Allow even if the new record is not yet accepted")

    args = parser.parse_args(argv)
    directory = Path(args.dir)

    if args.command == "next":
        print(next_number(directory))
        return 0
    if args.command == "index":
        return do_index(directory, args.title)
    if args.command == "lint":
        errors, warnings = lint(directory)
        for w in warnings:
            print(f"warn:  {w}")
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        total = len(find_adrs(directory))
        if errors:
            print(f"\n{len(errors)} error(s), {len(warnings)} warning(s) across {total} record(s).",
                  file=sys.stderr)
            return 1
        print(f"\nOK — {total} record(s), {len(warnings)} warning(s), no errors.")
        return 0
    if args.command == "accept":
        return do_accept(directory, args.number, args.date)
    if args.command == "supersede":
        return do_supersede(directory, args.old, args.new, args.force)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
