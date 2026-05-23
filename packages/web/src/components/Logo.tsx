import { cx } from "./ui";

/**
 * The Meridian mark: a ring (the market / the globe) crossed by a meridian arc that
 * crests at a single peak point — "meridian" as both a line of longitude and the highest
 * point a price crosses in a session. Drawn as inline SVG so it stays crisp at any size,
 * inherits the brand mint via `currentColor`, and ships with zero asset requests. The
 * same geometry is exported to `public/favicon.svg`.
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
      {/* The ring — the market. */}
      <circle
        cx="16"
        cy="16"
        r="13"
        stroke="currentColor"
        strokeWidth="2"
        strokeOpacity="0.35"
      />
      {/* The meridian arc, cresting toward the top-right peak. */}
      <path
        d="M5 22 C 10 22, 12 8, 20 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      {/* The peak marker at the meridian's crest. */}
      <circle cx="20" cy="7" r="3" fill="currentColor" />
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
