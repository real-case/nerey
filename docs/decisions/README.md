# Architecture Decision Records

Architecture Decision Records for this project, in [MADR](https://adr.github.io/madr/) format. Each record captures one decision and the reasoning behind it.

| ADR | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-record-decisions-as-madr-adrs.md) | 0001. Record architecture decisions as MADR ADRs | accepted | 2026-08-09 |
| [0002](0002-npm-workspaces-monorepo.md) | 0002. npm workspaces monorepo with three published packages | accepted | 2026-08-09 |
| [0003](0003-typescript-strict-no-any.md) | 0003. TypeScript strict mode, noUncheckedIndexedAccess, no any | accepted | 2026-08-09 |
| [0004](0004-node-24-npm-toolchain.md) | 0004. Node 24 runtime and npm as package manager | accepted | 2026-08-09 |
| [0005](0005-eslint-flat-config-prettier.md) | 0005. ESLint flat config with Prettier | accepted | 2026-08-09 |
| [0006](0006-testing-vitest-rtl-storybook-browser.md) | 0006. Vitest and React Testing Library, with Storybook browser mode as a second project | accepted | 2026-08-09 |
| [0007](0007-coverage-threshold-gate.md) | 0007. Merged coverage threshold gate | accepted | 2026-08-09 |
| [0008](0008-registry-based-generative-ui.md) | 0008. Registry-based generative UI: the model parameterises pre-declared widgets | accepted | 2026-08-09 |
| [0009](0009-exact-type-version-widget-resolution.md) | 0009. Exact type@version widget resolution | accepted | 2026-08-09 |
| [0010](0010-explicit-registry-composition.md) | 0010. Explicit registry composition instead of a global mutable registry | accepted | 2026-08-09 |
| [0011](0011-standard-schema-validation.md) | 0011. Standard Schema v1 for payload and state validation | accepted | 2026-08-09 |
| [0012](0012-degradation-chain-injected-fallback.md) | 0012. Four-step degradation chain with an injected fallback renderer | accepted | 2026-08-09 |
| [0013](0013-typed-error-taxonomy.md) | 0013. Typed error taxonomy and the onWidgetError diagnostics hook | accepted | 2026-08-09 |
| [0014](0014-widget-interaction-contract.md) | 0014. onInteraction is a widget’s only outbound channel | accepted | 2026-08-09 |
| [0015](0015-widgets-perform-no-io.md) | 0015. Widgets perform no I/O, enforced by a shipped ESLint config | accepted | 2026-08-09 |
| [0016](0016-message-persistence-port.md) | 0016. MessagePersistence as an injected port | accepted | 2026-08-09 |
| [0017](0017-widget-placement-model.md) | 0017. Widget placement model: message, input and overlay slots | accepted | 2026-08-09 |
| [0018](0018-widget-lifecycle-runtime.md) | 0018. A widget lifecycle runtime, not merely lifecycle types | accepted | 2026-08-09 |
| [0019](0019-streaming-status-contract.md) | 0019. Streaming status prop mirroring the tool-part state machine | accepted | 2026-08-09 |
| [0020](0020-data-attribute-styling-contract.md) | 0020. data-* attributes are the public styling API | accepted | 2026-08-09 |
| [0021](0021-headless-primitives-className-render.md) | 0021. Headless primitives accept className and a polymorphic render prop | accepted | 2026-08-09 |
| [0022](0022-base-ui-wrapped-dependency.md) | 0022. Base UI as a wrapped, never re-exported behavioural dependency | accepted | 2026-08-09 |
| [0023](0023-css-modules-compiled-at-build.md) | 0023. CSS Modules compiled to a static stylesheet at build time | accepted | 2026-08-09 |
| [0024](0024-design-tokens-css-custom-properties.md) | 0024. Design tokens as --nerey-* custom properties with inline fallbacks | accepted | 2026-08-09 |
| [0025](0025-theme-self-sufficient-cascade.md) | 0025. The theme is self-sufficient in the cascade | accepted | 2026-08-09 |
| [0026](0026-themed-components-variant-not-classname.md) | 0026. Themed components expose variant, size and tone — never className | accepted | 2026-08-09 |
| [0027](0027-light-dark-token-override.md) | 0027. Light and dark as a token-value override | accepted | 2026-08-09 |
| [0028](0028-package-exports-policy.md) | 0028. Package exports map policy and the ban on deep imports | accepted | 2026-08-09 |
| [0029](0029-semantic-versioning-published-packages.md) | 0029. Semantic versioning for published packages | accepted | 2026-08-09 |
| [0030](0030-widget-schema-migration-on-read.md) | 0030. Tolerant reader and migration-on-read for widget schema evolution | accepted | 2026-08-09 |
| [0031](0031-storybook-component-workbench.md) | 0031. Storybook 10 as the component workbench, CSF 3 with play functions | accepted | 2026-08-09 |
| [0032](0032-accessibility-gate-axe-wcag22aa.md) | 0032. Accessibility gate: axe at WCAG 2.2 AA, failing not advisory | accepted | 2026-08-09 |
| [0033](0033-deterministic-self-testing-gates.md) | 0033. Deterministic gates that self-test by rejecting a planted violator | accepted | 2026-08-09 |
| [0034](0034-claude-code-hooks-edit-time-enforcement.md) | 0034. Claude Code hooks for edit-time enforcement | accepted | 2026-08-09 |
| [0035](0035-built-in-widget-scope.md) | 0035. Core ships only the text and confirmation widgets | accepted | 2026-08-09 |
| [0036](0036-conventional-commits.md) | 0036. Conventional Commits as the commit contract | accepted | 2026-08-09 |
| [0037](0037-core-non-goals-transport-llm-markdown.md) | 0037. Core has no transport, LLM SDK binding, or markdown renderer | accepted | 2026-08-09 |
| [0038](0038-semver-gated-by-surface-snapshots.md) | 0038. Semantic versioning for published packages, gated by generated surface snapshots | proposed | 2026-08-24 |
| [0039](0039-tagged-releases-published-by-trusted-publishing.md) | 0039. Releases are cut from a per-package tag and published from CI by trusted publishing | proposed | 2026-08-25 |
| [0040](0040-registry-describes-itself-to-the-model.md) | 0040. The registry describes itself to the model, through an injected schema converter | proposed | 2026-08-25 |
| [0041](0041-chrome-strings-through-a-labels-context.md) | 0041. Chrome strings resolve through a labels context in @nerey/theme | proposed | 2026-08-25 |
| [0042](0042-visual-regression-against-pinned-references.md) | 0042. Visual regression against committed, container-pinned reference images | proposed | 2026-08-25 |
| [0043](0043-pinned-ci-supply-chain.md) | 0043. The CI supply chain is pinned by digest and updated by Dependabot | proposed | 2026-08-25 |
| [0044](0044-publish-the-workbench-to-github-pages.md) | 0044. Publish the workbench to GitHub Pages, and build it on every pull request | proposed | 2026-08-25 |
