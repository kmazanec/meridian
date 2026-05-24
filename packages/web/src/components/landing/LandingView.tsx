import Link from "next/link";
import type { ReactNode } from "react";
import { Outcome } from "@meridian/sdk";
import { formatProbability, formatUsdc, formatTradingDay } from "@/lib/format";
import { impliedComplement } from "@/lib/market-math";
import type {
  ActivitySummary,
  FeaturedCall,
  RecentWin,
} from "@/lib/marketStats";
import { Price, Button, cx } from "@/components/ui";
import { MeridianMark } from "@/components/Logo";
import { Countdown } from "@/components/trade/Countdown";

/**
 * The home page. Bet-centric, not a price grid: a hero, a live activity bar (scale +
 * liveness), then "Today's closest calls" — a curated set of the nearest-the-money markets
 * phrased as real questions with their live odds. Below the fold, two always-on sections keep
 * the page alive even when the board is closed: a "Recent wins" results feed of settled markets
 * and a visual "How it works" flow, capped by the "Why Meridian" differentiators.
 *
 * Presentational: the connect control is injected (so it renders in tests without the wallet
 * provider) and all market data arrives pre-derived as {@link FeaturedCall}s, {@link RecentWin}s,
 * and an {@link ActivitySummary}.
 */
export function LandingView({
  featured,
  activity,
  wins,
  connect,
}: {
  featured: FeaturedCall[];
  activity: ActivitySummary;
  wins: RecentWin[];
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
        <p className="mt-4 text-sm text-fg-faint">
          New to this?{" "}
          <Link href="/faq" className="text-accent hover:underline">
            Read the FAQ →
          </Link>
        </p>
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

      {/* Recent wins — settled results, on-chain. Alive even when the board is closed. */}
      <RecentWins wins={wins} />

      {/* How it works — the lifecycle as a visual flow, for newcomers. */}
      <HowItWorks />

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

/**
 * "Recent wins": the settled-market results feed. Always rendered — when nothing has settled
 * yet it shows an inviting placeholder rather than vanishing, so the page never reads as dead.
 * Each row states the question that was decided, the price it closed at, and which side paid.
 */
function RecentWins({ wins }: { wins: RecentWin[] }) {
  return (
    <section data-testid="recent-wins">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-serif text-2xl tracking-tight text-fg">
          Recent wins
        </h2>
        <span className="text-xs uppercase tracking-wide text-fg-faint">
          Settled on-chain
        </span>
      </div>
      {wins.length === 0 ? (
        <div className="panel py-12 text-center" data-testid="no-wins">
          <p className="text-fg-dim">No markets have settled yet.</p>
          <p className="mt-1 text-sm text-fg-faint">
            Results land here the instant the 4:00 PM bell rings.
          </p>
        </div>
      ) : (
        <div className="panel divide-y divide-line-soft p-0">
          {wins.map((win) => (
            <WinRow key={win.address} win={win} />
          ))}
        </div>
      )}
    </section>
  );
}

/** One settled result: SYMBOL · the question · the close · the winning side · the margin. */
function WinRow({ win }: { win: RecentWin }) {
  const yesWon = win.outcome === Outcome.YesWins;
  const strikeLabel = formatUsdc(win.strike, 0);
  const closeLabel =
    win.settlementPrice != null ? formatUsdc(win.settlementPrice) : null;
  // The margin — how far the close beat or missed the strike — is the row's drama, and it's
  // meaningful at any scale (unlike the pot, which is ~$0 on a thin devnet). Yes wins on a
  // clear (close ≥ strike), No wins on a miss; sign of (close − strike) agrees with the outcome.
  const marginUsdc =
    win.settlementPrice != null ? win.settlementPrice.sub(win.strike) : null;
  return (
    <Link
      href={`/trade/${win.symbol}`}
      className="flex items-center gap-4 px-5 py-3.5 transition-colors first:rounded-t-panel last:rounded-b-panel hover:bg-panel-2/60"
      data-testid={`win-${win.address}`}
    >
      {/* Winning-side pill — the verdict, color-coded teal/terracotta. */}
      <span
        className={cx(
          "stat-mono w-12 shrink-0 rounded-md border py-1 text-center text-xs uppercase tracking-wide",
          yesWon
            ? "border-yes/30 bg-yes/10 text-yes"
            : "border-no/30 bg-no/10 text-no"
        )}
      >
        {yesWon ? "Yes" : "No"}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-fg">
          <span className="font-serif tracking-tight">{win.symbol}</span>{" "}
          <span className="text-fg-dim">
            closed{" "}
            {closeLabel ? (
              <span className="stat-mono text-fg">{closeLabel}</span>
            ) : (
              "—"
            )}{" "}
            vs {strikeLabel}
          </span>
        </p>
        <p className="mt-0.5 text-[0.7rem] text-fg-faint">
          {formatTradingDay(win.tradingDay)} ·{" "}
          <span className={yesWon ? "text-yes" : "text-no"}>
            {yesWon ? "Yes" : "No"}
          </span>{" "}
          paid out
        </p>
      </div>

      <div className="shrink-0 text-right">
        {marginUsdc != null ? (
          <>
            <div
              className={cx(
                "stat-mono text-sm",
                yesWon ? "text-yes" : "text-no"
              )}
            >
              {yesWon ? "+" : "−"}
              {formatUsdc(marginUsdc.abs())}
            </div>
            <div className="text-[0.65rem] uppercase tracking-wide text-fg-faint">
              {yesWon ? "cleared by" : "missed by"}
            </div>
          </>
        ) : (
          <div className="stat-mono text-sm text-fg-faint">—</div>
        )}
      </div>
    </Link>
  );
}

/** One numbered step in the "how it works" flow. */
function FlowStep({
  n,
  title,
  body,
  icon,
}: {
  n: string;
  title: string;
  body: ReactNode;
  icon: ReactNode;
}) {
  return (
    <li className="panel relative flex-1 p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-ink-2 text-accent">
          {icon}
        </span>
        <span className="stat-mono text-xs text-fg-faint">{n}</span>
      </div>
      <h3 className="mt-3 font-serif text-base text-fg">{title}</h3>
      <p className="mt-1.5 text-sm text-fg-dim">{body}</p>
    </li>
  );
}

/**
 * "How it works": the contract lifecycle as a four-step flow — pick a side, pay the price,
 * the bell rings, it auto-settles. Laid out as a connected stepper on desktop (the gold
 * connector line traces the meridian motif: price crossing the close), stacked on mobile.
 */
function HowItWorks() {
  return (
    <section data-testid="how-it-works">
      <div className="mb-4">
        <h2 className="font-serif text-2xl tracking-tight text-fg">
          How it works
        </h2>
        <p className="mt-1 text-sm text-fg-dim">
          One trading day, start to finish — no overnight risk, no human in the
          loop.
        </p>
      </div>

      <ol className="relative grid grid-cols-1 gap-4 md:grid-cols-4">
        {/* The connector: a faint gold rule the steps sit on (desktop only). */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-[12.5%] top-[2.6rem] hidden h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent md:block"
        />
        <FlowStep
          n="01"
          title="Pick a side"
          icon={<IconSides />}
          body={
            <>
              Choose a daily question and take{" "}
              <span className="text-yes">Yes</span> or{" "}
              <span className="text-no">No</span> on where a stock closes.
            </>
          }
        />
        <FlowStep
          n="02"
          title="Pay the price"
          icon={<IconCoin />}
          body={
            <>
              The price <em className="not-italic text-fg">is</em> the odds —
              pay it, and you hold a contract that wins{" "}
              <Price tone="usdc">$1.00</Price>.
            </>
          }
        />
        <FlowStep
          n="03"
          title="The bell rings"
          icon={<IconBell />}
          body="At 4:00 PM ET the official closing price is read straight from an on-chain oracle."
        />
        <FlowStep
          n="04"
          title="Auto-settle"
          icon={<MeridianMark size={18} />}
          body="Winners redeem $1.00 each, instantly. No proposer, no dispute window, no waiting."
        />
      </ol>
    </section>
  );
}

/* --- Inline step icons (stroke = currentColor, gold via the badge). --- */

function IconSides() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v18M5 8l-2 4 2 4M19 8l2 4-2 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCoin() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 8v8M9.5 9.5h3.2a1.3 1.3 0 010 2.6H9.5h3.5a1.3 1.3 0 010 2.6H9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 16V11a6 6 0 1112 0v5l1.5 2H4.5L6 16z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M10 20a2 2 0 004 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
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
