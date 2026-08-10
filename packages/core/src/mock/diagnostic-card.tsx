import type { ReactElement } from 'react';

import { WidgetPart } from '../primitives/widget-part';
import { WidgetRoot } from '../primitives/widget-root';
import type { AnyWidgetRegistryEntry, WidgetRegistry, WidgetStatus } from '../types';

export type DevDiagnosticProps = {
  /** The `type@version` that failed to resolve — what the message asked for, not what exists. */
  type: string;
  version: string;
  status: WidgetStatus;
  /**
   * The registry that did not contain it. Held rather than snapshotted so the listing is read at
   * render time: a registry composed later in a story shows its real contents, not a stale copy.
   */
  registry: WidgetRegistry;
};

function keyOf(entry: AnyWidgetRegistryEntry): string {
  return `${entry.type}@${entry.version}`;
}

/**
 * The sentence that actually shortens the debugging loop. A registered type at a different version
 * is the single most common wiring bug (ADR 0009 makes resolution exact precisely so it fails
 * loudly rather than resolving to something almost right), and it is indistinguishable from a
 * missing widget in the DOM — so it gets named explicitly.
 */
function diagnose(type: string, entries: readonly AnyWidgetRegistryEntry[]): string {
  const sameType = entries.filter((entry) => entry.type === type).map((entry) => entry.version);

  if (sameType.length > 0) {
    return (
      `\`${type}\` IS registered, at ${sameType.join(', ')}. Resolution is an exact ` +
      `type@version match (ADR 0009), so this is a version mismatch rather than a missing widget.`
    );
  }
  if (entries.length === 0) {
    return 'The registry is empty — no entries were composed into it.';
  }
  return `Nothing is registered under the type \`${type}\`.`;
}

/**
 * What `createDevRegistry` renders in place of the silent fallback.
 *
 * Headless, like everything else in core: no styling, no colour, no icon — the diagnosis is the
 * text content, and the `data-*` attributes (ADR 0020) are how a theme makes it look like an error
 * if it wants to. The root carries the *requested* `type` and `version`, so the missing key is
 * legible in the element inspector without expanding anything.
 *
 * Part names are `dev-` prefixed on purpose. The root advertises the requested type, so a
 * consumer's `[data-nerey-widget="confirmation"] [data-nerey-part="title"]` rule would otherwise
 * paint this card as though it were the widget that failed to resolve.
 */
export function DevDiagnosticCard(props: DevDiagnosticProps): ReactElement {
  const { type, version, status, registry } = props;
  const entries = registry.entries();

  return (
    <WidgetRoot type={type} version={version} slot="message" status={status} state="error" readonly>
      <WidgetPart part="dev-headline" as="p">
        {`No widget registered for \`${type}@${version}\`.`}
      </WidgetPart>

      <WidgetPart part="dev-detail" as="p">
        {diagnose(type, entries)}
      </WidgetPart>

      {/* Rendered even when empty, so a stylesheet and a test can both rely on the shape. */}
      <WidgetPart part="dev-registered" as="ul">
        {entries.map((entry) => (
          <WidgetPart key={keyOf(entry)} part="dev-entry" as="li">
            {keyOf(entry)}
          </WidgetPart>
        ))}
      </WidgetPart>
    </WidgetRoot>
  );
}
