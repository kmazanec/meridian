import Link from "next/link";
import type { ReactNode } from "react";
import { formatProbability, formatUsdc } from "@/lib/format";
import { impliedComplement } from "@/lib/market-math";
import type { ActivitySummary, FeaturedCall } from "@/lib/marketStats";
import { Price, Button, cx } from "@/components/ui";
import { MeridianMark } from "@/components/Logo";
import { Countdown } from "@/components/trade/Countdown";

/**
 * The home page. Bet-centric, not a price grid: a hero, a live activity bar (scale +
 * liveness), then "Today's closest calls" — a curated set of the nearest-the-money markets
 * phrased as real questions with their live odds — and a short "why Meridian" explainer.
 *
 * Presentational: the connect control is injected (so it renders in tests without the wallet
 * provider) and all market data arrives pre-derived as {@link FeaturedCall}s + an
 * {@link ActivitySummary}.
 */
export function LandingView({
  featured,
  activity,
  connect,
}: {
  featured: FeaturedCall[];
  activity: ActivitySummary;
  connect: ReactNode;
}) {
  return (
    <div className="space-y-14 py-8">
      {/* Hero */}
      <section className="text-center">
        <MeridianMark size={48} className="mx-auto mb-6" />
        <div className="text-xs uppercase tracking-widest text-accent">
          The prediction market for what stocks do today
        </div>
        <h1 className="mt-3 font-serif text-5xl leading-[1.05] tracking-tight text-fg sm:text-6xl">
          Will it close above the line?
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-fg-dim">
          Take a side on where the Magnificent Seven close today. Each contract
          pays <Price tone="usdc">$1.00</Price> to the winning side and settles
          the instant the bell rings — deterministic, no human oracle.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          {connect}
          <Link href="/markets">
            <Button variant="ghost">Browse all markets</Button>
          </Link>
        </div>
      </section>

      {/* Live activity bar — scale + liveness at a glance. */}
      <ActivityBar activity={activity} />

      {/* Today's closest calls — the curated hero unit. */}
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-serif text-2xl tracking-tight text-fg">
            Today's closest calls
          </h2>
          <Link href="/markets" className="text-sm text-accent hover:underline">
            All markets →
          </Link>
        </div>
        {featured.length === 0 ? (
          <div className="panel py-12 text-center" data-testid="no-markets">
            <p className="text-fg-dim">No open markets right now.</p>
            <p className="mt-1 text-sm text-fg-faint">
              Today's board opens at 9:00 AM ET — check back then.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((call) => (
              <FeaturedCard key={call.symbol} call={call} />
            ))}
          </div>
        )}
      </section>

      {/* Why Meridian — the differentiators, sharpened and numbered. */}
      <section>
        <h2 className="mb-4 font-serif text-2xl tracking-tight text-fg">
          Why Meridian
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <WhyCard
            n="01"
            title="Settled by the bell"
            body="The 4:00 PM closing price decides it, read straight from an on-chain oracle. No proposer, no dispute window, no waiting on a human to call the outcome."
          />
          <WhyCard
            n="02"
            title="Pick a side, pay a price"
            body={
              <>
                Buy <span className="text-yes">Yes</span> if you think it closes
                above the strike, <span className="text-no">No</span> if you
                don't. The price is the market's live probability — trade out
                anytime.
              </>
            }
          />
          <WhyCard
            n="03"
            title="Non-custodial, on-chain"
            body="Your wallet signs every action and the program is the only thing that can move funds. No operator ever holds your collateral."
          />
        </div>
      </section>
    </div>
  );
}

/** "$1,174.20" from a plain-dollar spot. */
function fmtSpot(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** The four-stat live activity strip. Countdown is gold; numbers are tone-coded. */
function ActivityBar({ activity }: { activity: ActivitySummary }) {
  return (
    <section
      className="panel grid grid-cols-2 divide-line-soft p-0 sm:grid-cols-4 sm:divide-x"
      data-testid="activity-bar"
    >
      <div className="flex flex-col items-center justify-center border-b border-line-soft p-4 text-center sm:border-b-0">
        <div className="text-xs uppercase tracking-wide text-fg-faint">
          Markets settle in
        </div>
        {activity.tradingDay ? (
          <Countdown tradingDay={activity.tradingDay} variant="inline" />
        ) : (
          <div className="stat-mono mt-1 text-xl text-fg-faint">—</div>
        )}
      </div>
      <Stat
        label="Open interest"
        value={formatUsdc(activity.openInterest, 0)}
        tone="usdc"
        className="border-b border-line-soft sm:border-b-0"
      />
      <Stat
        label="Open markets"
        value={String(activity.openMarkets)}
        tone="yes"
      />
      <Stat label="Stocks today" value={String(activity.stockCount)} />
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: string;
  tone?: "usdc" | "yes";
  className?: string;
}) {
  const t =
    tone === "usdc" ? "text-usdc" : tone === "yes" ? "text-yes" : "text-fg";
  return (
    <div className={cx("p-4 text-center", className)}>
      <div className="text-xs uppercase tracking-wide text-fg-faint">
        {label}
      </div>
      <div className={cx("stat-mono mt-1 text-xl", t)}>{value}</div>
    </div>
  );
}

/** One featured "closest call": the nearest-the-money bet phrased as a question. */
function FeaturedCard({ call }: { call: FeaturedCall }) {
  const strikeLabel = formatUsdc(call.strike, 0);
  const yesPct = formatProbability(call.yesPrice);
  const noPct = formatProbability(impliedComplement(call.yesPrice));
  const up = (call.changePct ?? 0) >= 0;
  // Deep-link straight to this featured strike (dollars), so the detail page opens on the
  // same bet the card shows rather than its default strike.
  const strikeDollars = call.strike.toNumber() / 1_000_000;
  return (
    <Link
      href={`/trade/${call.symbol}?strike=${strikeDollars}`}
      className="panel block p-5 transition-colors hover:border-accent/30"
      data-testid={`featured-${call.symbol}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-serif text-lg tracking-tight text-fg">
          {call.symbol}
        </span>
        <span className="stat-mono text-xs text-fg-faint">
          {fmtSpot(call.spot)}{" "}
          {call.changePct != null && (
            <span className={up ? "text-yes" : "text-no"}>
              {up ? "▲" : "▼"} {Math.abs(call.changePct * 100).toFixed(1)}%
            </span>
          )}
        </span>
      </div>

      <p className="mt-3 text-sm text-fg">
        Will <span className="font-medium">{call.symbol}</span> close at or
        above <span className="font-medium">{strikeLabel}</span> today?
      </p>

      <div className="mt-4 flex gap-2">
        <div className="flex-1 rounded-lg border border-yes/30 bg-yes/5 p-2.5 text-center">
          <div className="stat-mono text-xl text-yes">{yesPct}</div>
          <div className="text-[0.65rem] uppercase tracking-wide text-yes/80">
            Yes
          </div>
        </div>
        <div className="flex-1 rounded-lg border border-no/30 bg-no/5 p-2.5 text-center">
          <div className="stat-mono text-xl text-no">{noPct}</div>
          <div className="text-[0.65rem] uppercase tracking-wide text-no/80">
            No
          </div>
        </div>
      </div>

      {/* Probability bar — the market's live Yes lean. */}
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-line-soft">
        <div className="h-full bg-yes" style={{ width: yesPct }} />
      </div>

      <div className="mt-3 flex items-center justify-between text-[0.7rem] text-fg-faint">
        <span className="stat-mono">{formatUsdc(call.openInterest, 0)} OI</span>
        {call.tradingDay && (
          <Countdown tradingDay={call.tradingDay} variant="inline" />
        )}
      </div>
    </Link>
  );
}

function WhyCard({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: ReactNode;
}) {
  return (
    <div className="panel p-5">
      <div className="stat-mono text-sm text-accent">{n}</div>
      <h3 className="mt-1.5 font-serif text-lg text-fg">{title}</h3>
      <p className="mt-2 text-sm text-fg-dim">{body}</p>
    </div>
  );
}
