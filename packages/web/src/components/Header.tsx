"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { CLUSTER_LABEL } from "@/lib/env";
import { cx } from "./ui";
import { Logo } from "./Logo";

// The wallet button touches `window`; load it client-only to avoid SSR mismatch.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

const NAV = [
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/results", label: "Results" },
  { href: "/history", label: "History" },
  // The page itself gates to the Config admin (non-admins see a notice, no controls).
  { href: "/admin", label: "Admin" },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-line-soft bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
        <div className="flex items-center gap-4 sm:gap-8">
          <Link href="/" aria-label="Meridian home">
            <Logo />
          </Link>
          <nav className="order-3 flex w-full items-center gap-5 overflow-x-auto text-sm sm:order-none sm:w-auto">
            {NAV.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cx(
                    "relative shrink-0 py-1 transition-colors",
                    active ? "text-fg" : "text-fg-dim hover:text-fg"
                  )}
                >
                  {item.label}
                  {active && (
                    <span className="absolute -bottom-px left-0 h-0.5 w-full rounded-full bg-accent" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden rounded-full border border-line-soft px-3 py-1 text-xs uppercase tracking-wide text-fg-faint sm:inline">
            {CLUSTER_LABEL}
          </span>
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
