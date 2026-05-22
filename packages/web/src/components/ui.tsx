import type { ReactNode } from "react";

/** Compose class names, dropping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** A bordered, slightly translucent surface — the deck's panel motif. */
export function Panel({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
}) {
  return <Tag className={cx("panel p-5", className)}>{children}</Tag>;
}

/** A labelled metric: small dim label over a mono value. */
export function Stat({
  label,
  value,
  accent,
  className,
}: {
  label: string;
  value: ReactNode;
  accent?: "yes" | "no" | "usdc" | "accent";
  className?: string;
}) {
  const tone =
    accent === "yes"
      ? "text-yes"
      : accent === "no"
      ? "text-no"
      : accent === "usdc"
      ? "text-usdc"
      : accent === "accent"
      ? "text-accent"
      : "text-fg";
  return (
    <div className={className}>
      <div className="text-xs uppercase tracking-wide text-fg-faint">
        {label}
      </div>
      <div className={cx("stat-mono mt-1 text-lg", tone)}>{value}</div>
    </div>
  );
}

export type ButtonVariant = "accent" | "yes" | "no" | "ghost" | "default";

/** Brand button. `variant` selects the tint; the rest is standard button props. */
export function Button({
  variant = "default",
  className,
  children,
  ...rest
}: {
  variant?: ButtonVariant;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const v =
    variant === "accent"
      ? "btn-accent"
      : variant === "yes"
      ? "btn-yes"
      : variant === "no"
      ? "btn-no"
      : variant === "ghost"
      ? "btn-ghost"
      : "";
  return (
    <button className={cx("btn", v, className)} {...rest}>
      {children}
    </button>
  );
}

/** A monospace price/probability readout with an optional tone. */
export function Price({
  children,
  tone,
  className,
}: {
  children: ReactNode;
  tone?: "yes" | "no" | "usdc";
  className?: string;
}) {
  const t =
    tone === "yes"
      ? "text-yes"
      : tone === "no"
      ? "text-no"
      : tone === "usdc"
      ? "text-usdc"
      : "text-fg";
  return <span className={cx("stat-mono", t, className)}>{children}</span>;
}
