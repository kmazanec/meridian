import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";
import { MeridianMark } from "@/components/Logo";

export const metadata: Metadata = {
  title: {
    default: "Meridian — daily stock verdicts",
    template: "%s · Meridian",
  },
  description:
    "The prediction market for what stocks do today. Take a side on whether a stock closes above the line — deterministic, settled by the bell, no human oracle.",
  applicationName: "Meridian",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "Meridian — daily stock verdicts",
    description:
      "The prediction market for what stocks do today. Deterministic, settled by the bell, no human oracle.",
    siteName: "Meridian",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f1115",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        <Providers>
          <div className="relative z-10 flex min-h-screen flex-col">
            <Header />
            <main className="mx-auto w-full max-w-page flex-1 px-5 py-8">
              {children}
            </main>
            <footer className="relative z-10 border-t border-line-soft">
              <div className="mx-auto flex max-w-page flex-col items-center justify-between gap-3 px-5 py-6 text-xs text-fg-faint sm:flex-row">
                <span className="inline-flex items-center gap-2">
                  <MeridianMark size={16} />
                  <span className="font-serif text-sm text-fg-dim">
                    Meridian
                  </span>
                </span>
                <span className="flex flex-col items-center gap-1 text-center sm:flex-row sm:items-center sm:gap-4 sm:text-right">
                  <Link href="/faq" className="hover:text-fg-dim">
                    FAQ
                  </Link>
                  <span>
                    Non-custodial by construction. The program is the only thing
                    that can move funds.
                  </span>
                </span>
              </div>
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
