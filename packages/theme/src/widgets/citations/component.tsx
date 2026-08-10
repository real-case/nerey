import type { ReactElement } from 'react';

import { WidgetPart, WidgetRoot, useWidgetState } from '@nerey/core';
import type { NereyState, WidgetComponentProps } from '@nerey/core';

import { Badge } from '../../components/badge/badge';
import { Button } from '../../components/button/button';
import { ExternalLinkIcon } from '../../components/icons/icons';
import { Popover } from '../../components/popover/popover';
import { VisuallyHidden } from '../../components/visually-hidden/visually-hidden';
import { cx } from '../../internal/cx';
import styles from './citations.module.css';
import {
  CITATIONS_PLACEMENT,
  CITATIONS_TYPE,
  CITATIONS_VERSION,
  DEFAULT_NO_SOURCES_LABEL,
  DEFAULT_QUOTE_LABEL,
  NEW_TAB_HINT,
  QUOTE_ACTION,
  displayHost,
  quoteRequest,
} from './schema';
import type { CitationSource, CitationsPayload, CitationsState } from './schema';

export type CitationsWidgetProps = WidgetComponentProps<CitationsPayload, CitationsState>;

/**
 * Shared and frozen, for the reason core's confirmation freezes its own: a fresh `{}` per render
 * is a new `initial` identity for `useWidgetState`, and freezing turns a widget that mutates its
 * own state object into a loud failure rather than a quiet divergence from what was stored.
 */
const EMPTY_STATE: CitationsState = Object.freeze({});
const NO_IDS: readonly string[] = Object.freeze([]);

/**
 * Citations, as an affordance for **verification rather than decoration**.
 *
 * The research this widget is built from is blunt about the problem: readers open a citation
 * something like four times in a hundred, while a large share of generated citations do not say
 * what the answer claims they say. A citation list that is merely present therefore buys the
 * answer unearned credibility — it looks sourced to everyone and is checked by almost nobody. So
 * every decision below is aimed at lowering the cost of the check rather than at signalling that
 * one is possible:
 *
 *   - the markers sit **against the claim they support**, not in a bibliography under the message,
 *     so "which source says this?" needs no scrolling and no matching up of numbers;
 *   - they are **visually distinct from body text** — a filled numeric pill, not a superscript
 *     digit — because an affordance that reads as punctuation is not read as an affordance;
 *   - the snippet is **previewed in place** on hover, focus or press, so the cheapest possible
 *     check (does the quoted line resemble the claim?) costs no navigation at all;
 *   - the outbound link shows the **host**, because "is this nature.com or a site that copied
 *     nature.com" is most of what a reader wants from a citation before clicking it;
 *   - and `quote-source` lets the reader push the burden back to the agent without leaving the
 *     conversation, which is the only verification path that survives someone reading on a phone.
 *
 * ARIA is written by hand, deliberately (ADR 0022). A consumer cannot reach inside this component
 * to add a name to a marker, so a marker that is not named here is not named at all, and the
 * WCAG 2.2 AA gate (ADR 0032) would fail with no legitimate way to pass.
 */
export function CitationsWidget(props: CitationsWidgetProps): ReactElement {
  const { messageId, payload, state, readonly, status, onInteraction } = props;

  /**
   * `debounceMs: 0` because this state is written at most once per source and never in a burst —
   * the same reasoning core's confirmation records. The default window would leave the reply with
   * the agent while the store still said the reader had asked nothing.
   */
  const { state: persisted, setState } = useWidgetState<CitationsState>(messageId, state ?? EMPTY_STATE, {
    debounceMs: 0,
  });

  const asked = persisted.asked ?? NO_IDS;

  // A streaming payload is a half-arrived list of sources, and an errored one is not a list at all
  // (ADR 0019). Neither is something to ask the agent about, and both are still worth rendering:
  // a partially arrived citation is still a citation the reader can start reading.
  const actionable = status === 'ready' && !readonly;

  /**
   * `locked` on the root tracks read-only-ness only, and NOT "has asked about a source". Asking
   * about one source must not close the other four — that would turn the one affordance the reader
   * used into the reason they cannot use the rest. Per-source terminality lives on the marker's own
   * `data-state` instead (ADR 0018 / ADR 0020).
   */
  const rootState: NereyState = readonly ? 'locked' : status === 'error' ? 'error' : 'idle';

  /**
   * A read-only citation list still opens its previews and still links out. `readonly` means the
   * widget fires nothing (ADR 0018), and reading is not firing — a replayed transcript is exactly
   * where someone goes back to check what an answer was based on, so taking the evidence away on
   * replay would remove the affordance at the moment it is most wanted. What read-only removes is
   * `quote-source`, which would put a new message into a conversation the host has closed.
   */

  function ask(source: CitationSource): void {
    // Re-checked rather than trusted to `disabled`, for the reason core's confirmation re-checks:
    // the guard has to survive a substituted control that forgot to forward it, and a second press
    // here would ask the agent the same question twice.
    if (!actionable || asked.includes(source.id)) return;

    // State first, reply second. If the host's handler throws, the marker is already terminal; a
    // widget left live by someone else's exception invites the press that duplicates a request the
    // host may well have sent before it threw (ADR 0016).
    setState({ asked: [...asked, source.id] });
    onInteraction(QUOTE_ACTION, {
      text: quoteRequest(source),
      meta: { sourceId: source.id, url: source.url },
    });
  }

  return (
    <WidgetRoot
      type={CITATIONS_TYPE}
      version={CITATIONS_VERSION}
      slot={CITATIONS_PLACEMENT.slot}
      status={status}
      state={rootState}
      readonly={readonly}
      className={styles.root}
    >
      {/* Skipped entirely when there is neither a claim nor a marker, rather than rendered empty:
          an empty paragraph still occupies a line, and a blank line above the "no sources" notice
          reads as something that failed to load. */}
      {(payload.claim !== undefined || payload.sources.length > 0) && (
        <WidgetPart part="claim" as="p" className={styles.claim}>
          {payload.claim}
          {payload.sources.map((source, index) => (
            <WidgetPart
              key={source.id}
              part="citation"
              state={asked.includes(source.id) ? 'selected' : undefined}
              as="span"
              className={styles.citation}
            >
              {/* The popup is portalled to `<body>`, so nothing inside it is a descendant of the
                widget root and nothing inside it carries `data-nerey-part`: an attribute that
                promises "inside this widget" must not appear on a node in someone else's subtree
                (ADR 0020). The parts stop at the marker, which is where the widget's own DOM
                stops. */}
              <Popover.Root>
                <Popover.Trigger
                  // Hover for a pointer, press for touch, Enter for the keyboard — the reason this
                  // is a popover and not a tooltip. A tooltip survives none of the three, and its
                  // content is unreachable to a screen reader that is not hovering anything.
                  openOnHover
                  render={
                    <button
                      type="button"
                      className={styles.marker}
                      aria-label={`Source ${index + 1}: ${source.title}`}
                    />
                  }
                >
                  <Badge tone="accent" variant="solid" size="sm">
                    {index + 1}
                  </Badge>
                </Popover.Trigger>

                <Popover.Portal>
                  <Popover.Positioner side="top">
                    <Popover.Popup>
                      <Popover.Arrow />
                      <Popover.Title>{source.title}</Popover.Title>

                      {source.publishedAt !== undefined && <Badge size="sm">{source.publishedAt}</Badge>}

                      {source.snippet !== undefined && (
                        <Popover.Description>{source.snippet}</Popover.Description>
                      )}

                      {/* `noopener` denies the opened page a handle on this one through
                        `window.opener`; `noreferrer` is kept alongside it rather than trusted to
                        modern defaults, because the pages a citation points at are exactly the
                        ones nobody here has audited. */}
                      <a className={styles.link} href={source.url} target="_blank" rel="noopener noreferrer">
                        <span className={styles.linkHost}>{displayHost(source.url)}</span>
                        <ExternalLinkIcon />
                        {/* The glyph is decorative by construction, so the warning that this leaves
                          the conversation has to reach the accessibility tree some other way. */}
                        <VisuallyHidden>{`(${NEW_TAB_HINT})`}</VisuallyHidden>
                      </a>

                      <Button
                        size="sm"
                        variant="outline"
                        tone="neutral"
                        disabled={!actionable || asked.includes(source.id)}
                        onClick={() => {
                          ask(source);
                        }}
                      >
                        {DEFAULT_QUOTE_LABEL}
                      </Button>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            </WidgetPart>
          ))}
        </WidgetPart>
      )}

      {payload.sources.length === 0 && (
        <WidgetPart
          part="empty"
          as="p"
          className={cx(styles.claim, styles.empty)}
          // Stated rather than left implicit. An answer that cites nothing is the case this
          // widget exists to make visible, and a blank space where the markers would be reads
          // as a rendering bug rather than as the absence of evidence.
        >
          {DEFAULT_NO_SOURCES_LABEL}
        </WidgetPart>
      )}
    </WidgetRoot>
  );
}
