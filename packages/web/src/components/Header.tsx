"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { CLUSTER_LABEL } from "@/lib/env";
import { cx } from "./ui";

// The wallet button touches `window`; load it client-only to avoid SSR mismatch.
const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

const NAV = [
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/history", label: "History" },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="relative z-10 border-b border-line-soft">
      <div className="mx-auto flex max-w-page items-center justify-between gap-6 px-5 py-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="font-serif text-xl text-fg">
            Meridian
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            {NAV.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cx(
                    "transition-colors",
                    active ? "text-fg" : "text-fg-dim hover:text-fg"
                  )}
                >
                  {item.label}
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
