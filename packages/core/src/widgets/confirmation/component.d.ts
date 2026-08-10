import type { ReactElement } from 'react';
import type { WidgetComponentProps } from '../../types';
import type { ConfirmationPayload, ConfirmationState } from './schema';
export type ConfirmationWidgetProps = WidgetComponentProps<ConfirmationPayload, ConfirmationState>;
/**
 * ADR 0035 — the minimum interactive widget, and core's executable specification of its own
 * contracts: `onInteraction` as the only outbound channel (ADR 0014), `useWidgetState` as the only
 * persistence channel (ADR 0015 / 0016), `readonly` from the lifecycle runtime (ADR 0018), and the
 * `data-*` surface as the only styling seam (ADR 0020). It ships no CSS and no layout — two
 * buttons, a title, an optional description, and the attributes a consumer selects on.
 *
 * ARIA is written by hand, deliberately. ADR 0022 reverses the origin codebase's "never author
 * `aria-*`" convention: that rule made sense when a component library supplied the roles, and it is
 * actively harmful here, because nothing else is going to. A consumer cannot reach inside this
 * component to add a labelling relationship, so if the group is not named and described from here
 * it is not named and described at all, and the WCAG 2.2 AA gate (ADR 0032) would fail with no
 * legitimate way to pass.
 */
export declare function ConfirmationWidget(props: ConfirmationWidgetProps): ReactElement;
//# sourceMappingURL=component.d.ts.map
