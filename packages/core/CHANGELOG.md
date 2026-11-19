# @nerey/core

All notable changes to this package. The format follows the commit range it was
generated from (ADR 0050), and the version numbers follow ADR 0038.

## 0.1.0 — 2026-11-19

### Features

- extend the conformance kit to the port and the result schema (eeaeeb5)
- declare the placement attributes in NEREY_ATTR (e5dbb3b)
- **BREAKING** add a validated result and a correlated respond to the reply channel (59555ec)
- move pending widget-state writes into a host-owned queue (5fb48f6)
- **BREAKING** anchor lifecycle time on createdAt and persist the expiry marker (b445ef0)
- derive the model-facing catalogue from the registry (2d480ef)

### Bug Fixes

- name the widget in every error message (f377c77)

### Refactoring

- **BREAKING** remove the registry entry fields nothing reads (163d224)

### Breaking changes

- add a validated result and a correlated respond to the reply channel (59555ec)
- anchor lifecycle time on createdAt and persist the expiry marker (b445ef0)
- remove the registry entry fields nothing reads (163d224)
