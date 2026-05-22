import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "Meridian — binary stock markets on Solana",
  description:
    "Trade Yes/No on whether a MAG7 stock closes at or above a strike today. One book. Four actions. Two perspectives.",
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
            <footer className="relative z-10 border-t border-line-soft px-5 py-6 text-center text-xs text-fg-faint">
              Non-custodial by construction. The program is the only thing that
              can move funds.
            </footer>
          </div>
        </Providers>
      </body>
    </html>
  );
}
