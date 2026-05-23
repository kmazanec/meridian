import Link from "next/link";
import type { ReactNode } from "react";
import { Ticker, TICKER_SYMBOLS } from "@meridian/sdk";
import type { LivePrices } from "@/lib/marketStats";
import { formatPrice } from "@/lib/format";
import { Panel, Price, Button } from "@/components/ui";
import { MeridianMark } from "@/components/Logo";

/**
 * The Landing page: explains the product in the brand voice, shows a live-price strip,
 * and offers connect-wallet. Presentational — the connect control is injected so this
 * renders in tests without the wallet provider, and live prices are passed in.
 */
export function LandingView({
  prices,
  connect,
}: {
  prices: LivePrices;
  connect: ReactNode;
}) {
  return (
    <div className="space-y-16 py-8">
      <section className="text-center">
        <MeridianMark size={48} className="mx-auto mb-6" />
        <div className="text-xs uppercase tracking-widest text-accent">
          The prediction market for what stocks do today
        </div>
        <h1 className="mt-3 font-serif text-5xl leading-[1.05] tracking-tight text-fg sm:text-6xl">
          Daily stock verdicts.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-fg-dim">
          Take a side on whether a stock closes above the line today. Each
          contract pays <Price tone="usdc">$1.00</Price> to the winning side and
          settles the instant the market closes — deterministic, by the bell, no
          human oracle.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          {connect}
          <Link href="/markets">
            <Button variant="ghost">Browse today's markets</Button>
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-3 text-center text-xs uppercase tracking-widest text-fg-faint">
          Today's odds
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {TICKER_SYMBOLS.map((symbol, ordinal) => {
            const price = prices[ordinal as Ticker] ?? null;
            return (
              <Link key={symbol} href={`/trade/${symbol}`}>
                <Panel className="p-3 text-center transition-colors hover:border-accent/30">
                  <div className="font-serif text-base tracking-tight text-fg">
                    {symbol}
                  </div>
                  <Price tone="yes" className="mt-1 block text-lg">
                    {price ? formatPrice(price) : "—"}
                  </Price>
                </Panel>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Panel>
          <h3 className="font-serif text-lg text-fg">
            Settled by the bell, not by a person
          </h3>
          <p className="mt-2 text-sm text-fg-dim">
            The closing price decides it — read straight from an on-chain oracle
            at 4:00 PM ET. No proposer, no dispute window, no waiting on a human
            to call the outcome.
          </p>
        </Panel>
        <Panel>
          <h3 className="font-serif text-lg text-fg">
            Pick a side, pay a price
          </h3>
          <p className="mt-2 text-sm text-fg-dim">
            Buy <span className="text-yes">Yes</span> if you think it closes
            above the strike, <span className="text-no">No</span> if you don't.
            Trade out anytime against a live on-chain order book.
          </p>
        </Panel>
        <Panel>
          <h3 className="font-serif text-lg text-fg">
            Non-custodial by construction
          </h3>
          <p className="mt-2 text-sm text-fg-dim">
            Your wallet signs every action and the program is the only thing that
            can move funds. No operator ever holds your collateral.
          </p>
        </Panel>
      </section>
    </div>
  );
}
