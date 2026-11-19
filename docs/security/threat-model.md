# Threat model

What Nerey defends, where its responsibility ends, and what is left to the application that embeds it.
The decision behind this document is ADR 0053. Each threat names the record that defends it, so
`npm run check:citations` fails if a defence's record disappears. That check covers structure, not
truth: a citation can still resolve after the defence behind it has weakened.

## Assets

- **The user's interface.** What renders in the consumer's application, and what a person can be
  led to click.
- **The user's voice.** The text a widget sends is consumed by the agent as the user's own message.
- **The user's widget state.** What a widget persists through the host's persistence port.
- **The consumer's supply chain.** The packages a consumer installs from npm, and the code that runs
  when they do.

## Trust boundaries

| From                          | To           | Trust                                                                        |
| ----------------------------- | ------------ | ---------------------------------------------------------------------------- |
| The model                     | Nerey        | **Untrusted.** Every payload, `meta` value and message text is model output. |
| A widget component            | The host     | Trusted code, written by the consumer or shipped in `@nerey/theme`.          |
| The host's persistence port   | Nerey        | Trusted to store faithfully, not to be available.                            |
| npm and the CI that publishes | The consumer | Verified by provenance, not by trust in a maintainer's machine.              |

## Threats

### The model's payload is untrusted input

A model can emit any JSON, including JSON crafted by a prompt injection earlier in the conversation.

**Defended by:**

- The model parameterises pre-declared widgets and never emits executable UI (ADR 0008). There is no
  path from a payload to `eval`, `dangerouslySetInnerHTML`, or a component chosen by name at runtime
  outside the registry.
- Lookup is an exact match on `type@version` (ADR 0009). A payload cannot reach a widget the
  consumer did not register.
- Payloads are validated through the entry's Standard Schema before a component sees them
  (ADR 0011). A streaming payload is never validated, and a widget must treat streaming props as
  partial.
- Each failure degrades to readable text with a typed error, never to a blank or a crash (ADR 0012).

**Left to the consumer:** what their own widgets do with strings that passed validation. A schema
that accepts any string as a URL accepts `javascript:` too. Validate the shape you rely on.

### The fallback renderer

When a widget cannot render, Nerey hands the message text to the injected `renderFallback`
(ADR 0012). Core ships no markdown renderer (ADR 0037).

**Left to the consumer:** sanitising markdown or HTML in `renderFallback`. Nerey does not sanitise
the text it passes there, and the default `renderFallback` returns it as a plain string, which React escapes.

### `meta` is untrusted

A widget may attach `meta` to an interaction. Core never reads it, and passes it on unchanged
(ADR 0048).

**Left to the consumer:** a host that forwards `meta` to a server or a tool must treat it as data
derived from the model, exactly like the payload it came from.

### Reply text is the user's voice

A widget's `text` reaches the agent as the user's own words (ADR 0048). Text a widget derives from
its payload therefore lets the model author a message that the agent reads as coming from the
user. This is a prompt-injection path, and **Nerey does not prevent it.** A widget that sends
`Approved: ${payload.title}` lets the model choose what the user "said".

**Mitigations, for widget authors and hosts:**

- Compose reply text from fixed templates and the user's own input, never from model strings. The
  theme's reply templates live in the labels record, where the consumer can see and override them
  (ADR 0041).
- Where the reply must carry structured data, send it as a `result` validated by the entry's
  `resultSchema` and routed through `host.respond` (ADR 0048), not as prose.
- On the host side, mark widget-originated messages so the agent can tell them from typed input.

### Widgets perform no I/O

A widget that fetches, writes storage or opens a socket can leak model-controlled data or exfiltrate
user data. Widgets perform no I/O; their only outbound channels are `onInteraction` and
`useWidgetState`. This is enforced by `@nerey/eslint-config` (ADR 0015), whose rule surface is
snapshotted so a ban cannot silently disappear (ADR 0045). The conformance kit checks a widget's
source for the same thing.

**Left to the consumer:** applying `@nerey/eslint-config` to their own widget code. The rule only
protects code it is run on.

### The supply chain

**Defended by:**

- Every GitHub Action is pinned to a commit SHA, and the Playwright container image to an exact tag
  (ADR 0043).
- Packages are published only from CI, by tag, through npm trusted publishing with provenance
  attestations. No publish credential exists in the repository or on a maintainer's machine
  (ADR 0039).
- `@nerey/core` depends only on `@standard-schema/spec`, adapters take their SDK as a peer, and no
  published package depends on an analytics or telemetry library (ADR 0051).

**Left to the consumer:** verifying provenance (`npm audit signatures`) and keeping their own
dependencies current.

## Out of scope

- Vulnerabilities in the consumer's transport, model provider, MCP client or persistence backend.
  Nerey ships none of these (ADR 0037).
- Denial of service by a model that emits very large payloads. Bounding message size belongs to the
  transport.
- Styling attacks through consumer-supplied CSS. The theme reads only custom properties the consumer
  controls.
