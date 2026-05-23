import Link from "next/link";
import type { ReactNode } from "react";
import { Ticker, TICKER_SYMBOLS } from "@meridian/sdk";
import type { LivePrices } from "@/lib/useTickerPrices";
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
        <h1 className="font-serif text-5xl leading-tight text-fg">
          One book. Four actions.
          <br />
          Two perspectives.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-fg-dim">
          Trade <span className="text-fg">Yes</span> or{" "}
          <span className="text-fg">No</span> on whether a MAG7 stock closes at
          or above a strike today. Each contract pays{" "}
          <Price tone="usdc">$1.00</Price> to the winning side — always{" "}
          <span className="font-mono text-fg">Yes + No = $1.00</span>.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          {connect}
          <Link href="/markets">
            <Button variant="ghost">Browse markets</Button>
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-3 text-center text-xs uppercase tracking-widest text-fg-faint">
          Live Yes prices
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {TICKER_SYMBOLS.map((symbol, ordinal) => {
            const price = prices[ordinal as Ticker] ?? null;
            return (
              <Link key={symbol} href={`/trade/${symbol}`}>
                <Panel className="p-3 text-center transition-colors hover:border-line">
                  <div className="font-mono text-sm text-fg">{symbol}</div>
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
            Non-custodial by design
          </h3>
          <p className="mt-2 text-sm text-fg-dim">
            The program is the only thing that can move funds. Your wallet signs
            every action; no operator ever holds your collateral.
          </p>
        </Panel>
        <Panel>
          <h3 className="font-serif text-lg text-fg">Four buttons, one book</h3>
          <p className="mt-2 text-sm text-fg-dim">
            Buy Yes, Buy No, Sell Yes, Sell No — all resolve onto a single
            on-chain order book. Selling a Yes is buying a No.
          </p>
        </Panel>
        <Panel>
          <h3 className="font-serif text-lg text-fg">Settles at the close</h3>
          <p className="mt-2 text-sm text-fg-dim">
            At 4:00 PM ET the market settles against an on-chain oracle. Winners
            redeem each token for <Price tone="usdc">$1.00</Price>.
          </p>
        </Panel>
      </section>
    </div>
  );
}
