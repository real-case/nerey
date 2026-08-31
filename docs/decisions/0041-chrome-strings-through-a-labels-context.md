---
status: "accepted"
date: 2026-08-31
decision-makers: Yurii Anichkin
---

# 0041. Chrome strings resolve through a labels context in @nerey/theme

## Context and Problem Statement

ADR 0037 states that Nerey ships no i18n layer, and that the chrome strings it emits itself "are
English literals and overridable through props". The first half is a decision and holds. The second
half is not true, and has never been true.

In `@nerey/core` it is half true: a confirmation's `confirmLabel` and `cancelLabel` travel in the
payload, so a producer can set them per message — but `DEFAULT_DISMISS_LABEL`, the accessible name
of the overlay's dismiss control, is a module constant with no way in at all. The source says so
outright: *"English and not overridable, which is a stated limitation rather than an oversight …
A `dismissLabel` prop is the intended fix when core grows an i18n seam."*

In `@nerey/theme` it is simply false. Thirty-nine chrome strings live as module constants across
eleven widgets, and **a widget cannot take a prop**: its props are fixed by `WidgetComponentProps`
(ADR 0008 / 0014), which carries payload, state, readonly, status and `onInteraction` and nothing
else. There is no seam. A consumer shipping a Russian-language assistant gets `Details`, `Answer
sent`, `No matching options.` and `Quick replies — choose any`, and can do nothing about it short
of forking the theme.

Two things make this worse than a cosmetic complaint.

**Several of these strings are accessible names.** `Choose one option`, `Choose one or more
options`, `Quick replies`, ` for {option}`, `(required)`, `{label}, {n} results` — these are what a
screen reader announces. The WCAG 2.2 AA gate (ADR 0032) cannot catch it, because axe checks that
an accessible name *exists*, never what language it is in. A non-English deployment passes every
check this repository has while announcing English to the users who depend on the announcement
most.

**Several are not display strings at all.** `POLL_NONE_REPLY` (`None of the above.`), `QUERY_PREFIX`
(`Show me the results where `) and `EMPTY_SUBMISSION_TEXT` are the **reply text a widget sends**,
which ADR 0014 requires to "read like something a human typed" because the agent consumes it as
user input. A Russian-speaking user answering a poll and having `None of the above.` arrive in the
transcript is not a mislabeled button; it is the model being handed a sentence its user did not
write, in a language they may not have used.

## Decision Drivers

- A widget cannot take props, so whatever the seam is, it cannot be a prop on a widget.
- `@nerey/core` must not gain an i18n layer. ADR 0037 names "no message catalog, no `t()` function,
  no locale context" as a non-goal, and that is still right for the kernel.
- Whatever is added must not become an i18n library. The moment it grows locale negotiation, plural
  rules or ICU message syntax it is `react-intl` with fewer users and worse tests.
- Nothing may be removed from the public API to do this. Thirty-nine exported constants are in the
  ADR 0038 baseline and removing one is a breaking change for a consumer who imported it.
- A consumer overriding one string must not have to restate the other thirty-eight.
- The strings that carry into the transcript must be overridable for the same reason the visible
  ones are, and the record must say why, because they do not look like chrome.

## Considered Options

- A labels context in `@nerey/theme`, defaulting to the existing constants
- Labels in each widget's payload schema, supplied per message by the producer
- A locale context in `@nerey/core`
- A module-level `configureLabels()` mutating a singleton
- Leave it, and record the deviation from ADR 0037

## Decision Outcome

Chosen option: "A labels context in `@nerey/theme`, defaulting to the existing constants", because
it is the only option that reaches a widget at all without either putting an i18n layer in the
kernel or making the model responsible for the interface's wording.

```tsx
import { NereyLabelsProvider } from '@nerey/theme';

<NereyLabelsProvider labels={{ poll: { details: 'Подробнее', answered: 'Ответ отправлен' } }}>
  {children}
</NereyLabelsProvider>;
```

Five things about the shape are decisions rather than details:

- **It lives in the theme, not in core.** ADR 0037's non-goal is scoped to the kernel, and the
  strings are the theme's own. A consumer who writes their own widgets against the `data-*`
  contract writes their own strings too, and owes nothing to this context.
- **The defaults ARE the existing constants.** `defaultNereyLabels` is assembled from
  `POLL_DETAILS_LABEL` and its thirty-eight siblings rather than restating them, so the two cannot
  drift, and every one of those exports stays exactly where it was. The change is additive: no
  removal, no rename, MINOR under ADR 0029 (PATCH on `0.x`).
- **Interpolation is a function, not a format string.** Exactly two strings take a value —
  ` for {option}` and `{label}, {n} results` — and they are typed functions
  (`(context: { title: string }) => string`). A format string would need a parser, a placeholder
  convention and runtime errors for a missing argument; a function is checked by the compiler and
  cannot be called wrongly. There is no `t()`, no key lookup by string, and no message catalogue
  format.
- **An override deep-merges over the defaults.** A consumer replaces one string and keeps the rest,
  which is the difference between a seam people use and one they copy-paste thirty-nine lines into.
- **Payload still wins.** Where a label already travels in the payload — a poll's `submitLabel`, a
  citation's `quoteLabel` — that per-message value overrides the context, which overrides the
  built-in default. The producer is more specific than the application, and the application is more
  specific than the library.

**`@nerey/core` gains one optional prop**, `dismissLabel` on `OverlaySlotHost`, which is precisely
the fix its own source comment names. That makes ADR 0037's claim about core true rather than
aspirational, and it is a prop rather than a context, so core still has no locale anything.

### Consequences

- Good, because a non-English deployment can now ship correct accessible names and correct reply
  text, which is the part no gate in this repository could have caught.
- Good, because it is additive: every existing constant remains exported and every existing payload
  override keeps working.
- Good, because it stops at strings. No locale detection, no plural forms, no date or number
  formatting — a consumer who needs those has an i18n library already and can call it in the
  override.
- Neutral, because a consumer wanting more than one language mounts the provider with the strings
  their own i18n layer resolved. Nerey does not know what a locale is, which is the point.
- Neutral, because a future widget could still import a constant directly and bypass the context.
  That was recorded here as an open gap and is now closed by `npm run check:widget-labels`, which
  derives the chrome vocabulary from the imports `labels.tsx` itself makes — so adding a string to
  the record extends the ban with no edit to the gate. What it does not judge is a string literal
  written inline in a component; catching that means judging every quoted string in JSX, and the
  false-positive rate over class names and test ids would make the gate unreadable.
- Bad, because the record is one flat typed object, so adding a widget with chrome strings is now a
  change to a public type — a MINOR release rather than a private detail.

### Confirmation

Colocated tests in `packages/theme/src/labels/labels.test.tsx`:

- **Defaults cannot drift from the constants.** Every field of `defaultNereyLabels` is asserted
  equal to the exported constant it comes from. If somebody changes `POLL_DETAILS_LABEL` and
  forgets the defaults, or vice versa, this fails — it is the only thing keeping one string from
  becoming two.
- **A partial override keeps its siblings.** Overriding `poll.details` alone must leave
  `poll.answered` and every other section untouched, at every depth the record has.
- **A widget renders the override.** One widget is rendered through `WidgetRenderer` inside
  `MockWidgetHost` — the chain, not the component (ADR 0031) — under a provider, and the overridden
  string must appear in the DOM while the default must not.
- **Interpolation is typed.** Both functions are called with their context and asserted; a
  `@ts-expect-error` pins that they cannot be called with the wrong shape.

`npm run check:widget-labels` (`scripts/check-widget-labels.mjs`) is the fitness function for the
rule itself, rather than for the eleven widgets that happen to exist. It fails when a widget
component imports a chrome constant from its schema module, and it derives which constants those
are from what `labels.tsx` imports — so the vocabulary cannot drift from the record it describes. A
second rule, `empty-vocabulary`, fails when nothing was derived at all: a gate whose vocabulary
silently emptied would pass every component by having nothing to object to.

The existing 352-story browser suite (ADR 0031 / 0032) continues to run against the defaults, so
the rewiring is covered end to end by the a11y gate as well: a widget that lost a string entirely
would fail axe for a missing accessible name rather than merely rendering oddly.

## Pros and Cons of the Options

### A labels context in `@nerey/theme`, defaulting to the existing constants

- Good, because it is the only mechanism that reaches inside a widget whose props are fixed.
- Good, because React context is the idiom a consumer already mounts things with, and it composes
  with whatever i18n library resolved the strings.
- Neutral, because it adds a provider a consumer must remember to mount. Omitting it is harmless —
  the defaults are the current behaviour exactly.
- Bad, because context is invisible in a component's signature, so a widget's strings no longer
  read as literals at the point of use. The hook call makes it greppable; nothing makes it obvious.

### Labels in each widget's payload schema, supplied per message

- Good, because it needs no new mechanism at all — the payload is already validated, versioned and
  per-message.
- Good, because a producer could genuinely want different wording for one particular question.
- Bad, because interface chrome is an application-level fact, not a per-message one, and asking a
  model to restate `Details` on every payload is asking it to get it wrong eventually.
- Bad, because it inflates every payload with strings the model has no opinion about, and every one
  of them becomes something a prompt has to explain (ADR 0040).
- Bad, because a model choosing the accessible name of a radio group is a model choosing an
  accessibility outcome.

### A locale context in `@nerey/core`

- Good, because it would cover core's own strings and the theme's through one mechanism.
- Bad, because ADR 0037 names "no locale context" as a non-goal in as many words, and a kernel that
  knows about locales is a kernel that will eventually be asked about plurals and dates.
- Bad, because core has exactly one unreachable string. A context for one string is a layer for one
  string.

### A module-level `configureLabels()` mutating a singleton

- Good, because it needs no provider and no context read, so widget code stays literal.
- Bad, because it is the global mutable registry ADR 0010 rejected, wearing different clothes: the
  strings would depend on import order, tests would need a reset hook, and two mounted applications
  in one page could not differ.

### Leave it, and record the deviation

- Good, because it costs nothing and the packages are unpublished, so no consumer is stuck yet.
- Bad, because the accessible-name half is a real accessibility defect for every non-English
  deployment, and this repository fails builds over 4.08:1 contrast.
- Bad, because ADR 0037 would keep stating something untrue, which is the failure mode
  `docs/deviations.md` exists to stop.

## More Information

Corrects the "overridable through props" claim in ADR 0037 for `@nerey/core` by making it true, and
extends it to `@nerey/theme`, which that record did not cover. Related: ADR 0008 and ADR 0014 (why
a widget cannot take props), ADR 0032 (why the a11y gate cannot catch this class), ADR 0029 and
ADR 0038 (why nothing is removed), ADR 0031 (why the widget test renders through the chain).

The two interpolated strings are the whole of Nerey's interpolation requirement, and the record
is deliberate that they stay functions. If a third arrives that needs plural agreement, that is
the signal to stop and let the consumer's i18n library own the string entirely — the provider
already accepts whatever they resolved.
