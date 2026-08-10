---
status: "accepted"
date: 2026-08-09
decision-makers: Yurii Anichkin
---

# 0017. Widget placement model: message, input and overlay slots

## Context and Problem Statement

A registry entry declares where its widget appears (ADR 0008). The extraction source declares the
placement union already — `{ slot: 'message' }` | `{ slot: 'input'; position?: 'above' | 'below' |
'replace' }` | `{ slot: 'overlay'; scope: 'chat' | 'page'; dismissible?: boolean }` — but only
`MessageSlotHost` does anything. `InputSlotHost` is a passthrough that renders its children and
ignores the widget; `OverlaySlotHost` is `return null`. Inside an application that is a to-do; inside
a published package it is a type signature that promises a rendering path which does not exist, and
the consumer discovers it only when a widget silently fails to appear.

The decision covers three things at once: which slot variants `Placement` admits, what each slot host
must actually do, and how a slot interacts with the lifecycle runtime (ADR 0018) when a widget
occupies a surface the user also needs — most acutely `position: 'replace'`, which takes the composer
away.

## Decision Drivers

* A published type must be inhabited by a working implementation; a stub host is a lie the compiler
  cannot catch.
* Placement is model-facing. The registry doubles as the prompt-side catalog (ADR 0008), and "where
  will this appear" has to be a closed, describable set, not free text.
* Placement is style-facing. `data-nerey-slot` is part of the public attribute contract (ADR 0020),
  and a contract snapshot can only lock a closed enum.
* Overlay behaviour is expensive and easy to get wrong: focus trap, scroll lock, escape handling,
  focus restore, `aria-modal`.
* Core owns no application chrome. It does not know the consumer's portal roots, stacking contexts or
  router (ADR 0037).
* A widget must never be able to strand the user — taking the composer away is reversible only if
  something guarantees it comes back.

## Considered Options

* Three closed slots, all three hosts implemented
* Ship only the message slot in v1 and widen the union later
* An open, consumer-registered slot map keyed by string

## Decision Outcome

Chosen option: "Three closed slots, all three hosts implemented", because the union is already the
shape the shipped widgets were authored against, all three slots are analysable by the degradation
chain and the attribute contract, and the alternative that would also be honest — narrowing the union
to `message` — costs a breaking change to `WidgetRegistryEntry` and to every persisted registration
the moment the input slot is needed, which is now.

Concretely:

* **`{ slot: 'message' }`** renders inline in the transcript at the position of its message, in
  message order. Default for every built-in (ADR 0035). `data-nerey-slot="message"`.
* **`{ slot: 'input'; position?: 'above' | 'below' | 'replace' }`** renders adjacent to the composer;
  `position` defaults to `'above'`. `'replace'` hides the composer for as long as the widget is live.
  Core owns the swap and core is therefore responsible for restoring the composer: a `replace` widget
  is required to reach a terminal state through the lifecycle runtime (ADR 0018), and the composer is
  restored on expiry for every `afterExpiry` treatment, including `'hide'`. `data-nerey-slot="input"`
  plus `data-nerey-position`.
* **`{ slot: 'overlay'; scope: 'chat' | 'page'; dismissible?: boolean }`** renders as a modal dialog
  with focus trap, scroll lock, escape-to-dismiss, focus restore and `aria-modal`, built on the
  wrapped Base UI dialog (ADR 0022) and never re-exporting it. `dismissible` defaults to `true`;
  `dismissible: false` removes only the *user-initiated* dismissal paths and therefore obliges the
  entry to declare at least one expiry rule, so that some path out of the dialog always exists.
  `data-nerey-slot="overlay"` plus `data-nerey-scope`.
* **Contention** is resolved, not ignored. At most one `input: 'replace'` widget and at most one
  overlay are live at a time; the most recent message wins, and the displaced widget is expired
  through the lifecycle runtime (ADR 0018) rather than unmounted behind the user's back — so a
  displaced widget still leaves a legible terminal state in the transcript.
* **`scope: 'page'` does not portal to `document.body`.** The consumer supplies
  `overlayContainer?: HTMLElement | (() => HTMLElement)` on the host value (ADR 0016 establishes the
  pattern of injecting host-owned capabilities); with no container supplied, `scope: 'page'` degrades
  to `scope: 'chat'` positioning. Core sets no `z-index` at any point — layering belongs to whoever
  owns the stacking context.

### Consequences

* Good, because every member of the union is inhabited: a widget author reads the type and gets the
  behaviour the type describes, and the "widget registered but nothing renders" failure disappears.
* Good, because the closed enum is snapshot-testable end to end — the union in the public API, the
  `data-nerey-slot` values in the DOM, and the catalog text handed to the model all move together.
* Good, because overlay accessibility is implemented once in core rather than re-derived per widget,
  and is exercised by the accessibility gate (ADR 0032).
* Good, because the `replace`/composer interaction is a stated invariant with a test, instead of an
  emergent property of whichever widget happens to be mounted.
* Bad, because core grows real chrome: a portal, a dialog, a composer swap. That is more surface than
  a purely inline renderer and more to keep accessible.
* Bad, because `scope: 'page'` ships knowingly incomplete (see the open problem below); a consumer
  wanting a true page-level overlay must hand core a container, and we cannot yet tell them what the
  right container is in a Next.js app that also runs its own dialog stack.
* Neutral, because adding a fourth slot later is a minor version on `@nerey/core` (ADR 0029) and a
  new `data-nerey-slot` value — additive for consumers, but a change every theme must notice.

### Confirmation

* `packages/core/src/hosts/__tests__/slot-hosts.test.tsx` is table-driven over every member of the
  union and asserts that each host renders the widget's own DOM. A passthrough host or a `return null`
  host fails the table, which is exactly the regression this ADR exists to prevent. The table also
  asserts that `position: 'replace'` unmounts the composer and that expiry remounts it, for all three
  `afterExpiry` treatments (ADR 0018).
* `npm run check:public-api` (`scripts/check-public-api.mjs`) snapshots the exported `Placement`
  union, so a slot variant cannot be added, renamed or removed without an explicit API diff and the
  matching semver decision (ADR 0029).
* `npm run check:data-contract` (`scripts/check-data-contract.mjs`) locks `data-nerey-slot`,
  `data-nerey-position` and `data-nerey-scope` to their closed value sets under the attribute contract
  (ADR 0020).
* The widget conformance kit rejects `{ slot: 'overlay', dismissible: false }` on an entry whose
  `lifecycle.expiry` is empty — a modal with no user dismissal and no expiry rule is unreachable-exit
  by construction.
* Storybook play functions (ADR 0031) drive escape, outside-click and focus restore per slot, and
  those stories run under the axe gate at WCAG 2.2 AA (ADR 0032), where dialog semantics are a
  failing check rather than an advisory one.
* Each of the above is itself verified by the planted-violator gate (ADR 0033): restoring
  `OverlaySlotHost` to `return null` must make `slot-hosts.test.tsx` red.

## Pros and Cons of the Options

### Three closed slots, all three hosts implemented

The union from the extraction source, kept verbatim, with `InputSlotHost` and `OverlaySlotHost`
written for real.

* Good, because the type and the runtime agree, which is the entire reason to publish a type.
* Good, because a closed set can be described to the model, snapshotted in the public API, enumerated
  in `data-nerey-slot`, and reasoned about by the degradation chain (ADR 0012) — every one of those
  needs to know the full list.
* Good, because widgets already authored against this union in the extraction source migrate with no
  edits (ADR 0030 covers the payload side of that continuity).
* Neutral, because it commits core to owning a dialog implementation, which is bounded work but real
  work — mitigated by wrapping Base UI (ADR 0022) rather than hand-rolling focus management.
* Bad, because `scope: 'page'` is standardised nowhere and ships with a consumer-supplied-container
  compromise instead of an answer.

### Ship only the message slot in v1 and widen the union later

Narrow `Placement` to `{ slot: 'message' }`, delete the stubs, and add `input` and `overlay` once
their semantics are settled. The honest-minimum option, and the one a competent engineer reaches for
on seeing two stub hosts.

* Good, because it removes the lie immediately and at zero implementation cost.
* Good, because it defers the unresolved `scope: 'page'` portalling question entirely rather than
  shipping a compromise.
* Good, because a v1 with one slot has a much smaller accessibility surface to defend.
* Neutral, because widening a discriminated union is additive for consumers reading it, though every
  exhaustive `switch` over `Placement` in consumer code becomes non-exhaustive on upgrade.
* Bad, because the composer-attached case is needed now, not later: a confirmation widget that must be
  answered before the conversation continues (ADR 0035) is an `input`-slot widget, and modelling it as
  a message-slot widget means re-implementing the composer swap in the consumer.
* Bad, because placement values are persisted with registrations and referenced by the model-facing
  catalog; a union that grows after adoption forces every consumer to re-check their catalog copy and
  their slot-specific CSS at exactly the moment they are least expecting it.

### An open, consumer-registered slot map keyed by string

`placement: { slot: string }` resolved against a consumer-supplied `slots: Record<string, SlotHost>`
on the host value — placement as an extension point instead of an enumeration.

* Good, because it makes core agnostic: any surface the consumer has — a sidebar, a toast rail, a
  canvas — becomes a placement target with no change to the library.
* Good, because it sidesteps the `scope: 'page'` problem by construction; portalling is the
  consumer's host component, and so is z-index.
* Neutral, because it is straightforwardly implementable and roughly the design a "just give me a
  hook" instinct produces.
* Bad, because nothing in core can then reason about placement. The degradation chain (ADR 0012) has
  no defined behaviour for a widget whose slot key has no registered host, and "renders nowhere,
  silently" is the exact failure the stub hosts already caused.
* Bad, because the accessibility contract is per-slot: a modal needs a focus trap and an inline widget
  must not have one. With an opaque string key, core cannot know which to apply, so it applies none,
  and every consumer re-implements dialog semantics — badly, in the usual way.
* Bad, because `data-nerey-slot` stops being a closed enum and the attribute snapshot (ADR 0020)
  degrades from a contract into documentation.
* Bad, because the model-facing catalog loses a describable placement vocabulary; "this widget appears
  in slot `foo`" is not a constraint a prompt can carry.

## More Information

Implements FR-22. The slot-host stubs it replaces are `hosts/InputSlotHost` and `hosts/OverlaySlotHost`
in `osint-chat-client/src/shared/generative-ui/`.

**Open problem, recorded rather than resolved.** `{ slot: 'overlay', scope: 'page' }` implies that
Nerey portals content outside the conversation subtree, into DOM the consumer owns. That collides with
the consumer's own portal roots and z-index layering, and the survey behind the requirements found no
precedent to copy: MCP Apps has no placement concept beyond an inline `ui://` resource; the Vercel AI
SDK renders tool parts inline in the message list and stops there; Google A2UI's catalog is
component-level, not placement-level; and the OpenAI Apps SDK's inline / fullscreen / pip display
modes are host-owned surfaces the app cannot portal into. The v1 position — a consumer-supplied
container, a documented degradation to `scope: 'chat'` when none is given, and no `z-index` written by
core — is a mitigation, not a design. Revisit once a real consumer has run a page-scope overlay
alongside their own dialog stack; the likely successor decision is either to drop `scope: 'page'` from
the union or to require the container rather than accept its absence.

Related: ADR 0018 (the runtime that terminates a `replace` or overlay widget and restores the surface),
ADR 0022 (Base UI wrapped, never re-exported), ADR 0020 (`data-*` as the styling API), ADR 0032
(accessibility gate), ADR 0009 (exact `type@version` resolution, which determines whether a placement
is ever read at all).
