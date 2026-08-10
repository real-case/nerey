import { createElement } from 'react';
import type { FunctionComponent } from 'react';

import { TEXT_WIDGET_TYPE, TEXT_WIDGET_VERSION } from '../adapter';
import { NEVER_EXPIRES } from '../lifecycle/expiry';
import { asAnyWidget } from '../registry';
import type { AnyWidgetRegistryEntry, WidgetComponentProps, WidgetRegistry } from '../types';
import { DevDiagnosticCard } from './diagnostic-card';

export type DevRegistryOptions = {
  /**
   * Defaults to `true` — calling this function is itself the opt-in, and core reads no environment
   * variable to decide (ADR 0037: whether a build is "development" is the consumer's bundler's
   * question, not core's). The flag exists so a caller can keep one registry expression and switch
   * it off from their own build condition.
   */
  enabled?: boolean;
};

/**
 * A registry that, on an unknown `type@version`, renders a visible DIAGNOSTIC card instead of the
 * ordinary silent fallback — naming the missing key and listing what IS registered.
 *
 * In development the silent fallback is the wrong default: it looks like the model produced plain
 * text, and the version-mismatch failure it hides is the single most common wiring bug (ADR 0009).
 * The degradation chain is still doing the right thing — a transcript that stays readable is the
 * whole guarantee (ADR 0012) — but "right in production" and "useful while wiring a widget up" are
 * different requirements, and this wrapper is where they are allowed to differ.
 */
export function createDevRegistry(base: WidgetRegistry, options: DevRegistryOptions = {}): WidgetRegistry {
  // Returns `base` itself rather than a pass-through wrapper. A disabled dev registry must be
  // indistinguishable from no dev registry, including by identity — a host value memoised on
  // `registry` would otherwise churn on every render that rebuilt the wrapper.
  if (options.enabled === false) return base;

  /**
   * One synthesised entry per missing key, cached. Identity matters: `WidgetRenderer` memoises the
   * degradation chain on the entry, and React remounts on a new `component` identity — a fresh
   * entry per `get` would tear down and rebuild the card on every render of the transcript.
   *
   * Unbounded by design. It is keyed by the distinct missing widgets in one session, which is a
   * handful in the only situation this code runs in.
   */
  const diagnostics = new Map<string, AnyWidgetRegistryEntry>();

  function diagnosticFor(type: string, version: string): AnyWidgetRegistryEntry {
    const key = `${type}@${version}`;
    const cached = diagnostics.get(key);
    if (cached !== undefined) return cached;

    const Diagnostic: FunctionComponent<WidgetComponentProps> = (widgetProps) =>
      createElement(DevDiagnosticCard, { type, version, status: widgetProps.status, registry: base });
    // Named so the React tree reads as the diagnosis rather than as an anonymous arrow.
    Diagnostic.displayName = `NereyDevDiagnostic(${key})`;

    const entry = asAnyWidget({
      // The *requested* coordinates, which is also what makes the entry resolvable: `migratePayload`
      // compares `envelope.version` against `entry.version`, so any other value here would fail
      // migration and route to the very fallback this card exists to replace (ADR 0030).
      type,
      version,
      component: Diagnostic,
      placement: { slot: 'message' },
      // Nothing about a missing registration becomes stale, and an expired diagnostic would vanish
      // mid-debugging (ADR 0018).
      lifecycle: NEVER_EXPIRES,
      // No `payloadSchema` on purpose: the payload is whatever the absent widget expected, and
      // validating it could only send the message back to the fallback (ADR 0012).
    });

    diagnostics.set(key, entry);
    return entry;
  }

  return {
    get(type, version) {
      const hit = base.get(type, version);
      if (hit !== undefined) return hit;

      // `text@1.0.0` is core's own synthesised envelope for a message with no widget, not model
      // output (see `resolveEnvelope`). Its absence is not a wiring bug — the fallback renders
      // `message.text`, which is exactly what the text widget would have rendered — so diagnosing
      // it would turn every ordinary assistant message in the transcript into an error card.
      if (type === TEXT_WIDGET_TYPE && version === TEXT_WIDGET_VERSION) return undefined;

      return diagnosticFor(type, version);
    },

    // `has` and `entries` report the truth and are not widened by the wrapper. A diagnostic is a
    // rendered error message, not a registration: a host that branches on `has` to decide whether a
    // message even carries a renderable widget must not be told yes, and a listing that included
    // phantom entries would make the card enumerate its own previous failures.
    has: (type, version) => base.has(type, version),
    entries: () => base.entries(),
  };
}
