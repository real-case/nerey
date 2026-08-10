import type { ReactElement, ReactNode } from 'react';

import styles from './icons.module.css';

/**
 * The glyphs the theme needs, and no others.
 *
 * There is no icon dependency here on purpose. This is fourteen paths on a 16×16 grid; the
 * smallest icon package that would supply them adds an install-graph entry, an audit-report
 * entry, a version to keep in step with React, and a second set of sizing and colour conventions
 * for the theme's stylesheets to agree with. That is a bad trade for fourteen paths, and it gets
 * worse for a consumer, who pays for the whole package to render a chevron.
 *
 * Every glyph is decorative by construction: `aria-hidden` and `focusable="false"` are set here
 * rather than left to the caller, because an icon is never the accessible name of anything in
 * this theme — IconButton takes a required `label`, and every other control has visible text.
 * `focusable="false"` is not redundant with `aria-hidden`: legacy engines put SVG in the tab
 * order regardless, which produces a focus stop with nothing in it.
 *
 * `size` is a number rather than a token because it lands on the `width`/`height` attributes,
 * which take unitless pixels. A caller who needs the glyph to follow a token sizes it from CSS
 * on the element around it — presentation attributes lose to any stylesheet declaration.
 */

export type IconProps = {
  /** Edge length in pixels. The grid is 16×16, so anything else is a scale factor. */
  size?: number;
};

const GRID = 16;

type GlyphProps = IconProps & { children: ReactNode };

function Glyph({ size = GRID, children }: GlyphProps): ReactElement {
  return (
    <svg
      className={styles.glyph}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function CheckIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M3.5 8.5 6.5 11.5 12.5 5" />
    </Glyph>
  );
}

export function CloseIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M4 4 12 12" />
      <path d="M12 4 4 12" />
    </Glyph>
  );
}

export function ChevronDownIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M4 6.25 8 10.25 12 6.25" />
    </Glyph>
  );
}

export function ChevronUpIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M4 9.75 8 5.75 12 9.75" />
    </Glyph>
  );
}

export function ChevronRightIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M6.25 4 10.25 8 6.25 12" />
    </Glyph>
  );
}

export function InfoIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5 8 11" />
      {/* A zero-length subpath under a round cap renders as a dot of the stroke's diameter,
          which keeps the whole set stroke-only and therefore uniform under `currentColor`. */}
      <path d="M8 5.25 8 5.26" />
    </Glyph>
  );
}

export function AlertCircleIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5 8 8.75" />
      <path d="M8 11 8 11.01" />
    </Glyph>
  );
}

export function AlertTriangleIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M8 2.75 14.75 13.25 1.25 13.25Z" />
      <path d="M8 6.5 8 9.5" />
      <path d="M8 11.5 8 11.51" />
    </Glyph>
  );
}

export function ExternalLinkIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M7 3.5 3.5 3.5 3.5 12.5 12.5 12.5 12.5 9" />
      <path d="M9.5 3.5 12.5 3.5 12.5 6.5" />
      <path d="M12.5 3.5 7.75 8.25" />
    </Glyph>
  );
}

export function SearchIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10 13.5 13.5" />
    </Glyph>
  );
}

export function DotsHorizontalIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      {/* Filled circles rather than the zero-length-stroke trick used above: at three dots in a
          row the 1.5 stroke width reads as too light next to the rest of the set. */}
      <circle cx="4" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function PlusIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M8 3.5 8 12.5" />
      <path d="M3.5 8 12.5 8" />
    </Glyph>
  );
}

export function MinusIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M3.5 8 12.5 8" />
    </Glyph>
  );
}

/**
 * The static form of the Spinner's graphic — a 270° arc — for places that need the shape without
 * the animation, such as a legend or a paused state. Spinner itself draws its own copy, because
 * it has to size and animate from CSS and this one is sized by an attribute.
 */
export function SpinnerArcIcon({ size }: IconProps): ReactElement {
  return (
    <Glyph size={size}>
      <path d="M8 2a6 6 0 1 1-6 6" />
    </Glyph>
  );
}
