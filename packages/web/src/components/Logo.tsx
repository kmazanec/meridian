import { cx } from "./ui";

/**
 * The Meridian mark: the sun at its meridian — the instant it crosses its highest point —
 * rising in an arc above the horizon line of the daily close. "Meridian" is solar noon
 * (the apex) and a line of longitude both; the product settles at the close, so the mark
 * is the sun cresting over the close line with the brand gold disc at the apex.
 *
 * Drawn as inline SVG so it stays crisp at any size, inherits the brand gold via
 * `currentColor` (`text-accent`), and ships with zero asset requests. The same geometry is
 * mirrored in `public/favicon.svg` (with hardcoded hex, since favicons can't inherit color).
 */
export function MeridianMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Meridian"
      className={cx("text-accent", className)}
    >
      {/* The arc the sun travels — rising to and falling from its meridian. */}
      <path
        d="M4 22 C 8 8, 24 8, 28 22"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeOpacity="0.45"
      />
      {/* The horizon — the daily close the price must cross. */}
      <line
        x1="3"
        y1="24"
        x2="29"
        y2="24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeOpacity="0.8"
      />
      {/* The sun at its meridian: the solid gold disc at the arc's apex. */}
      <circle cx="16" cy="11" r="4.2" fill="currentColor" />
    </svg>
  );
}

/** The mark plus the Fraunces wordmark — the full lockup for the header. */
export function Logo({
  className,
  markSize = 24,
}: {
  className?: string;
  markSize?: number;
}) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <MeridianMark size={markSize} />
      <span className="font-serif text-xl tracking-tight text-fg">
        Meridian
      </span>
    </span>
  );
}
