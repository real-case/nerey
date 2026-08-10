import { useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import { WidgetPart, WidgetRoot, useWidgetState } from '@nerey/core';
import type { NereyState, WidgetComponentProps } from '@nerey/core';

import { Button } from '../../components/button/button';
import { Combobox } from '../../components/combobox/combobox';
import { Stack } from '../../components/stack/stack';
import { Surface } from '../../components/surface/surface';
import { Text } from '../../components/text/text';
import { Toggle, ToggleGroup } from '../../components/toggle-group/toggle-group';
import { VisuallyHidden } from '../../components/visually-hidden/visually-hidden';
import styles from './filter-panel.module.css';
import {
  DEFAULT_CLEAR_LABEL,
  DEFAULT_FACET_PLACEHOLDER,
  DEFAULT_SEARCH_LABEL,
  EMPTY_QUERY_HINT,
  FILTER_PANEL_PLACEMENT,
  FILTER_PANEL_TYPE,
  FILTER_PANEL_VERSION,
  NO_MATCHES_TEXT,
  PANEL_LABEL,
  composeQuery,
  hasSelection,
  selectionFor,
  usesCombobox,
} from './schema';
import type { Facet, FilterOption, FilterPanelPayload, FilterPanelState } from './schema';

export type FilterPanelWidgetProps = WidgetComponentProps<FilterPanelPayload, FilterPanelState>;

/** Shared and frozen — see the note on the form widget's own empty state. */
const EMPTY_STATE: FilterPanelState = Object.freeze({});

type FacetControlProps = {
  facet: Facet;
  values: readonly string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
};

type OptionContentProps = { option: FilterOption };

/**
 * One option's visible content and, when it carries a count, its accessible name.
 *
 * The visible count glyph is `aria-hidden` and the same fact is restated as a spoken phrase.
 * WCAG 2.5.3 (Label in Name) asks that a control's accessible name contain its visible words, and
 * a chip announced as "Open 42" hands a screen-reader user a bare digit glued to the label with
 * nothing saying what it counts. Hiding the digits from the name and restating them as "42
 * results" keeps the visible words a clean prefix of the name and still announces the count.
 *
 * The name is sourced from ONE hidden string rather than from the visible label plus a hidden
 * suffix, and that is a fix for a real defect rather than a matter of taste. The accessible name
 * computation concatenates each child node's contribution WITH A SPACE between them, so a bare
 * `Open` text node beside a hidden `, 42 results` is named "Open , 42 results" — the comma
 * detached from the word it belongs to, and a name that no caller, test, or translator can
 * predict from the strings they supplied. Taking the whole name from a single text node removes
 * the join, which is why the visible label is wrapped and hidden from the tree here: leaving it
 * exposed would name the chip "Open Open, 42 results".
 *
 * An option with no count needs none of this — its label already IS its name — so it stays a
 * plain text node and the extra markup is not paid for.
 */
function OptionContent({ option }: OptionContentProps): ReactElement {
  if (option.count === undefined) return <>{option.label}</>;

  return (
    <>
      <span aria-hidden="true">{option.label}</span>
      <span className={styles.count} aria-hidden="true">
        {option.count}
      </span>
      <VisuallyHidden>{`${option.label}, ${String(option.count)} results`}</VisuallyHidden>
    </>
  );
}

/**
 * One facet's control.
 *
 * The fork is on option count, not on configuration, and the two halves genuinely differ in
 * behaviour: chips are multi-select because a short facet is a set of flags you tick, and the
 * Combobox is single-select because a long facet is one thing you already have in mind and can
 * type. Base UI's Combobox multi-select model is chips with their own keyboard contract, which
 * this theme has not wrapped yet — shipping it half-styled would be worse than not shipping it.
 */
function FacetControl({ facet, values, disabled, onChange }: FacetControlProps): ReactElement {
  const selectedOption = useMemo(
    () => facet.options.find((option) => option.value === values[0]) ?? null,
    [facet.options, values],
  );

  if (usesCombobox(facet)) {
    return (
      <Combobox.Root<FilterOption>
        items={facet.options}
        value={selectedOption}
        onValueChange={(next) => {
          onChange(next === null ? [] : [next.value]);
        }}
        itemToStringLabel={(item) => item.label}
        disabled={disabled}
      >
        <Combobox.InputGroup>
          <Combobox.Input label={facet.label} placeholder={DEFAULT_FACET_PLACEHOLDER} />
          <Combobox.Clear />
          <Combobox.Trigger />
        </Combobox.InputGroup>
        <Combobox.Portal>
          <Combobox.Positioner>
            <Combobox.Popup>
              <Combobox.Empty>{NO_MATCHES_TEXT}</Combobox.Empty>
              <Combobox.List<FilterOption>>
                {(item) => (
                  <Combobox.Item key={item.value} value={item}>
                    <OptionContent option={item} />
                    <Combobox.ItemIndicator />
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    );
  }

  return (
    <ToggleGroup
      label={facet.label}
      multiple
      variant="chips"
      size="sm"
      value={values}
      onValueChange={onChange}
      disabled={disabled}
    >
      {facet.options.map((option) => (
        <Toggle key={option.value} value={option.value}>
          <OptionContent option={option} />
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/**
 * A composer-attached filter panel: pick facets, read the sentence they compose, send it.
 *
 * The placement is the point. `{ slot: 'input', position: 'above' }` puts this widget against the
 * host's composer rather than in the transcript (ADR 0017), which changes what the widget is for:
 * it does not answer a question the agent asked, it helps the user write their next message. The
 * composed query is shown before it is sent, so the user reads the sentence the agent will read.
 *
 * Clearing is deliberately NOT an interaction. `onInteraction` is the outbound channel and every
 * call sends a message (ADR 0014); a "Clear filters" that posted "Clear filters" into the
 * conversation would be a widget talking to the agent about its own UI state. Clearing is local,
 * and the only thing that leaves this widget is the search.
 */
export function FilterPanelWidget(props: FilterPanelWidgetProps): ReactElement {
  const { messageId, payload, state, readonly, status, onInteraction } = props;

  // The default debounce: ticking four chips in a row is one burst, and the window is what stops
  // it from being four writes through the persistence port.
  const { state: persisted, setState } = useWidgetState<FilterPanelState>(messageId, state ?? EMPTY_STATE);

  const selection = useMemo(
    () => selectionFor(payload.facets, persisted.selected),
    [payload.facets, persisted.selected],
  );

  const query = composeQuery(payload.facets, selection);
  const anySelected = hasSelection(selection);

  // No `submitted` flag in state, unlike the form. This entry expires on the search and hides
  // itself afterwards (see `index.ts`), so there is no terminal appearance to reconstruct — a
  // flag would only describe a render that never happens.
  const actionable = status === 'ready' && !readonly;
  const rootState: NereyState = readonly
    ? 'locked'
    : status === 'error'
      ? 'error'
      : anySelected
        ? 'selected'
        : 'idle';

  const setFacet = useCallback(
    (name: string, values: string[]) => {
      setState((previous) => ({ ...previous, selected: { ...previous.selected, [name]: values } }));
    },
    [setState],
  );

  const clear = useCallback(() => {
    setState((previous) => ({ ...previous, selected: {} }));
  }, [setState]);

  function search(): void {
    // Re-checked rather than trusted to `disabled`: an empty query would send the bare prefix,
    // which reads to the agent as a search for nothing in particular.
    if (!actionable || query === '') return;
    onInteraction('search', { text: query, meta: { filters: selection } });
  }

  return (
    <WidgetRoot
      type={FILTER_PANEL_TYPE}
      version={FILTER_PANEL_VERSION}
      slot={FILTER_PANEL_PLACEMENT.slot}
      status={status}
      state={rootState}
      readonly={readonly}
      className={styles.root}
      // A named `group`, because a panel of unrelated-looking controls sitting above a text box
      // is otherwise announced as loose buttons with no explanation of what they belong to. The
      // name is written here because nothing outside this component can reach in and add it
      // (ADR 0022 / 0032).
      render={(rootProps) => <div {...rootProps} role="group" aria-label={PANEL_LABEL} />}
    >
      {/* `sunken` rather than `raised`: this panel is attached to the composer, not floating in
          the transcript, and a raised card above a text box reads as a second message. */}
      <Surface variant="sunken" padding="sm" radius="lg">
        <Stack gap={3}>
          <WidgetPart part="facets" render={<Stack direction="row" gap={4} wrap />}>
            {payload.facets.map((facet) => (
              <WidgetPart
                key={facet.name}
                part="facet"
                state={(selection[facet.name] ?? []).length > 0 ? 'selected' : undefined}
                render={<Stack gap={2} />}
              >
                {/* A visible name for the group, alongside the `label` each control carries as
                    its accessible name. The two are the same string, so nothing a sighted user
                    reads differs from what is announced. */}
                <Text as="span" size="sm" weight="medium" tone="secondary">
                  {facet.label}
                </Text>
                <FacetControl
                  facet={facet}
                  values={selection[facet.name] ?? []}
                  disabled={!actionable}
                  onChange={(values) => {
                    setFacet(facet.name, values);
                  }}
                />
              </WidgetPart>
            ))}
          </WidgetPart>

          <WidgetPart part="actions" className={styles.actions}>
            {/* The sentence, before it is sent. `aria-live` is deliberately absent: the query
                changes on every chip press, and announcing a whole rebuilt sentence after each
                one would talk over the user. The text is reachable, and the Search button's own
                name says what pressing it does. */}
            <WidgetPart part="query" className={styles.query}>
              {/* `secondary`, never `muted`: muted measures 4.08:1 on the canvas in light, which
                  is under AA for normal-size text and is how a hint like this fails the gate. */}
              <Text size="sm" tone="secondary">
                {anySelected ? query : EMPTY_QUERY_HINT}
              </Text>
            </WidgetPart>

            <Button
              variant="ghost"
              tone="neutral"
              size="sm"
              onClick={clear}
              disabled={!actionable || !anySelected}
            >
              {DEFAULT_CLEAR_LABEL}
            </Button>
            <Button size="sm" onClick={search} disabled={!actionable || !anySelected}>
              {DEFAULT_SEARCH_LABEL}
            </Button>
          </WidgetPart>
        </Stack>
      </Surface>
    </WidgetRoot>
  );
}
