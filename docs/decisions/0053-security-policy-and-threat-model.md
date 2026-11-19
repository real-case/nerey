---
status: "proposed"
date: 2026-11-19
decision-makers: Yurii Anichkin
---

# 0053. A security policy and a written threat model ship before the first release

## Context and Problem Statement

Nerey sits between a language model and a user's browser. Everything it renders starts as model
output, and everything a widget sends back is read by the model as the user's own words. Several
records already defend parts of that path: the model parameterises pre-declared widgets and never
emits executable UI (ADR 0008), payloads are validated (ADR 0011), widgets perform no I/O (ADR 0015),
the CI supply chain is pinned (ADR 0043) and releases carry provenance (ADR 0039).

What does not exist is the document that says what Nerey treats as a vulnerability, and the channel
through which someone reports one. There is no `SECURITY.md`, so the first person to find a problem
has no private way to say so, and GitHub shows the repository as having no policy. There is no threat
model, so each of those records defends its own piece and nothing states which attacks the pieces add
up to defending, and which they do not.

One risk in particular is not named anywhere. A widget composes its reply `text` (ADR 0014, 0048), the
host sends it, and the agent reads it as something the user typed. When that text is built from the
model's own payload (a poll option label, say), the model can put words in the user's mouth. That is a
prompt-injection path that runs through Nerey by design, and a consumer cannot defend against what
the library does not tell them exists.

## Decision Drivers

- A reporter needs a private channel before the package is on npm, not after the first report.
- The policy must be honest for a project with one maintainer: no response time it cannot keep.
- What counts as a vulnerability in Nerey, and what is the consumer's responsibility, must be written
  down, because the boundary is not obvious from the code.
- The supported-versions table must not drift from the packages actually published.
- The threat model must cite the records that implement each defence, so a defence that is weakened
  shows up as a broken citation or a changed record.

## Considered Options

- `SECURITY.md` plus `docs/security/threat-model.md`, with a gate on the policy
- `SECURITY.md` only
- Nothing until the first report

## Decision Outcome

Chosen option: "`SECURITY.md` plus `docs/security/threat-model.md`, with a gate on the policy", because
a reporting channel without a definition of what to report produces reports nobody can triage, and a
threat model without a gate goes stale the first time a package is added.

**`SECURITY.md`** at the repository root:

- Reporting goes through GitHub Private Vulnerability Reporting on this repository. No email address
  is published.
- The response commitment is stated as what one maintainer can keep: acknowledgement and a first
  assessment as best effort, with the expected range stated plainly rather than as an SLA.
- A supported-versions table lists every published package under `packages/*` and which release line
  of each receives fixes.
- It links to the threat model.

**`docs/security/threat-model.md`** names the assets, the trust boundaries and, per threat, the record
that defends it and what is left to the consumer:

- **Model payload is untrusted input.** Defended by pre-declared widgets with no executable UI
  (ADR 0008), exact `type@version` lookup (ADR 0009), validation (ADR 0011) and the degradation chain
  (ADR 0012). Left to the consumer: what their own widgets do with validated strings.
- **The fallback renderer.** `renderFallback` is injected (ADR 0012). Sanitising markdown or HTML in it
  is the consumer's job, and the document says so in those words.
- **`meta` is untrusted.** Core never reads it (ADR 0014, 0048). A host that forwards it must treat it
  as data from the model.
- **Reply text is the user's voice.** A widget's `text` reaches the agent as the user's own words, and
  text derived from the payload lets the model author a "user" message. The document names this
  prompt-injection path, says Nerey does not prevent it, and gives widget authors and hosts the
  mitigation: compose reply text from fixed templates and the user's own input, not from model
  strings, or mark it as widget-originated on the host side.
- **Widgets perform no I/O.** Enforced by `@nerey/eslint-config` (ADR 0015, 0045).
- **Supply chain.** Pinned actions and container image (ADR 0043), trusted publishing with provenance
  (ADR 0039), the core dependency allowlist and the telemetry ban (ADR 0051).

### Consequences

- Good, because a reporter has a private channel and knows what is in scope.
- Good, because the reply-text injection path is named, which is the precondition for anyone
  defending against it.
- Good, because each threat points at the record that defends it, so `check:citations` catches a
  threat model that cites a record which no longer exists.
- Bad, because the document can still go stale in substance: a citation can resolve while the defence
  behind it weakens. The gate checks structure, not truth.
- Bad, because a public threat model tells an attacker where the consumer's responsibility starts.
  That information is already in the code; writing it down helps defenders more than attackers.

### Confirmation

- `npm run check:security-policy` (`scripts/check-security-policy.mjs`, new), in `check:all`:
  `SECURITY.md` exists; it names GitHub Private Vulnerability Reporting; its supported-versions table
  has a row for every non-private workspace package under `packages/*`; and it links to
  `docs/security/threat-model.md`, which exists.
- Its `--self-test` plants a policy missing one package and one with no reporting channel, and requires
  both to fail; it is registered in `check:gates` (ADR 0033).
- `npm run check:citations` resolves every ADR number in both documents, and `check:spelling` covers
  them, as for every `*.md`.

## Pros and Cons of the Options

### `SECURITY.md` plus `docs/security/threat-model.md`, with a gate on the policy

- Good, because it covers both the channel and the scope.
- Good, because the gate keeps the version table in step with the packages.
- Bad, because the threat model is prose that must be kept true by care, not by a check.

### `SECURITY.md` only

- Good, because it is one short file and satisfies GitHub's policy check.
- Bad, because a reporter has no way to tell a vulnerability from a consumer misconfiguration, and
  neither does the maintainer triaging the report.
- Bad, because the reply-text injection path stays unnamed.

### Nothing until the first report

- Good, because it costs nothing now.
- Bad, because the first report arrives in a public issue, which is the one place it should not.

## More Information

Related: ADR 0008, 0009, 0011, 0012, 0014, 0015, 0039, 0043, 0045, 0048 and 0051, each cited above for
the defence it provides. The reply-text path is the security reading of the rule that a widget's
message "must read like something a human typed": the rule protects the conversation's tone, and this
record adds that it is also an injection surface.
