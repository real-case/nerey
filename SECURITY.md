# Security policy

## Reporting a vulnerability

Report a vulnerability through **GitHub Private Vulnerability Reporting** on this repository: open
the **Security** tab and choose **Report a vulnerability**. The report stays private between you and
the maintainer until a fix is published. Please do not open a public issue or pull request for a
vulnerability, and do not include exploit details in one.

No email address is published for reports. The private report form is the only channel (ADR 0053).

What counts as a vulnerability in Nerey, and what is the consuming application's responsibility, is
set out in the [threat model](docs/security/threat-model.md). Read it before reporting: a report
about something the threat model assigns to the consumer is still welcome, but it will most likely
become a documentation change rather than a fix.

## What to expect

Nerey has one maintainer, so the commitment below is what one person can keep, not a service level.

- **Acknowledgement:** best effort, usually within a week.
- **First assessment:** whether the report is in scope and how severe it is, usually within two
  weeks of acknowledgement.
- **Fix and disclosure:** coordinated with you. The advisory is published on this repository when a
  fixed version is on npm, and credits you unless you ask otherwise.

## Supported versions

Every package is pre-1.0. Only the latest published minor line of each package receives security
fixes, and a fix ships as a new patch release on that line.

| Package                | Supported        |
| ---------------------- | ---------------- |
| `@nerey/core`          | latest 0.x minor |
| `@nerey/theme`         | latest 0.x minor |
| `@nerey/eslint-config` | latest 0.x minor |

Examples under `examples/*` are private and never published. They are not supported, though a
vulnerability in one that shows a pattern consumers would copy is worth reporting.
