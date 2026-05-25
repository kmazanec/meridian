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
import { OpenCountdown } from "./OpenCountdown";

/**
 * The home page. Bet-centric, not a price grid — and it stays alive whether you land mid-session
 * or after the bell:
 *
 *  - OPEN: a hero, a live activity strip (scale + the settlement countdown), then "Today's
 *    closest calls" — the nearest-the-money markets phrased as real questions with live odds.
 *  - CLOSED: the strip becomes a dramatic "trading opens in" countdown to the next opening bell,
 *    building anticipation; "closest calls" hides (there's nothing to trade) so the settled
 *    results rise to fill the space.
 *
 * Always-on below the fold: a "Recent wins" results feed of settled markets, and a vertical
 * "How it works" timeline that walks a newcomer through one trading day, top to bottom.
 *
 * Presentational: the connect control is injected as a *factory* (so it renders in tests
 * without the wallet provider, and so the page can mount an independent instance in both the
 * hero and the closing CTA — a React element can't live in two places). All market data arrives
 * pre-derived as {@link FeaturedCall}s, {@link RecentWin}s, and an {@link ActivitySummary}.
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
  connect: () => ReactNode;
}) {
  // The board is "closed" when nothing is tradable. That single fact reshapes the top of the
  // page: the strip swaps to an opening-bell countdown and "closest calls" drops out.
  const closed = activity.openMarkets === 0;

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
          {connect()}
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

      {/* Live activity — the settlement strip when open, the opening-bell countdown when closed. */}
      {closed ? (
        <ClosedHero activity={activity} />
      ) : (
        <ActivityBar activity={activity} />
      )}

      {/* Today's closest calls — only when the board is live; hidden when closed so wins rise. */}
      {!closed && featured.length > 0 && (
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-serif text-2xl tracking-tight text-fg">
              Today's closest calls
            </h2>
            <Link
              href="/markets"
              className="text-sm text-accent hover:underline"
            >
              All markets →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((call) => (
              <FeaturedCard key={call.symbol} call={call} />
            ))}
          </div>
        </section>
      )}

      {/* Recent wins — settled results, on-chain. Alive even when the board is closed. */}
      <RecentWins wins={wins} />

      {/* How it works — one trading day as a vertical timeline, for newcomers. */}
      <HowItWorks />

      {/* Closing CTA — the scroll lands somewhere, not in a dead end. */}
      <ClosingCta closed={closed} connect={connect} />
    </div>
  );
}

/**
 * The closing call-to-action: a centered panel that catches the scroll instead of trailing off.
 * It restates the hook in one line and hands the reader the two next steps — connect a wallet to
 * trade, or read the FAQ to learn how. The lead copy shifts with the board: an open session
 * invites you to trade now; a closed one invites you to be set up before the bell.
 */
function ClosingCta({
  closed,
  connect,
}: {
  closed: boolean;
  connect: () => ReactNode;
}) {
  return (
    <section
      className="panel relative overflow-hidden px-6 py-12 text-center sm:py-14"
      data-testid="closing-cta"
    >
      {/* A faint gold wash so the footer reads as a destination, not an afterthought. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_320px_at_50%_120%,rgba(232,177,76,0.10),transparent_70%)]"
      />
      <div className="relative">
        <MeridianMark size={36} className="mx-auto mb-5" />
        <h2 className="font-serif text-3xl tracking-tight text-fg sm:text-4xl">
          {closed ? "Be on the board at the bell" : "Take your side today"}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-fg-dim">
          {closed
            ? "Connect your wallet now so you're ready the moment markets open — or read the FAQ while the board is dark."
            : "Connect your wallet and trade where the Magnificent Seven close — or read the FAQ to learn how it all works first."}
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          {connect()}
          <Link href="/faq">
            <Button variant="ghost">Read the FAQ</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

/** "$1,174.20" from a plain-dollar spot. */
function fmtSpot(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The closed-board hero: a big, breathing countdown to the next opening bell, framed as an
 * invitation ("the board reopens at the bell"). The day's results sit right below, so the page
 * reads as *between sessions*, never dead. A single CTA keeps the next step obvious.
 */
function ClosedHero({ activity }: { activity: ActivitySummary }) {
  return (
    <section
      className="panel relative overflow-hidden px-6 py-10 sm:py-12"
      data-testid="closed-hero"
    >
      {/* A faint gold wash so the dark board still feels charged. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_300px_at_50%_-20%,rgba(232,177,76,0.10),transparent_70%)]"
      />
      <div className="relative">
        <OpenCountdown />
        <p className="mx-auto mt-6 max-w-md text-center text-sm text-fg-dim">
          The board is closed between sessions. New markets light up at the
          opening bell — same seven stocks, fresh lines, one trading day.
        </p>
        <div className="mt-6 flex justify-center">
          <Link href="/markets">
            <Button variant="ghost">See yesterday's board →</Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The four-stat live activity strip (open session). Countdown is gold; numbers are tone-coded. */
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
 * "Recent wins": the settled-market results feed, shown as a leaderboard-style ledger. Always
 * rendered — when nothing has settled yet it shows an inviting placeholder rather than vanishing,
 * so the page never reads as dead. Each row is the verdict: which side won, the question that was
 * decided, the price it closed at, and the margin (the row's real drama on a thin devnet).
 */
function RecentWins({ wins }: { wins: RecentWin[] }) {
  return (
    <section data-testid="recent-wins">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="font-serif text-2xl tracking-tight text-fg">
          Recent wins
        </h2>
        <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-fg-faint">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yes/60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-yes" />
          </span>
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {wins.map((win) => (
            <WinCard key={win.address} win={win} />
          ))}
        </div>
      )}
    </section>
  );
}

/** One settled result as a card: the verdict pill, the decided question, the close, and margin. */
function WinCard({ win }: { win: RecentWin }) {
  const yesWon = win.outcome === Outcome.YesWins;
  const strikeLabel = formatUsdc(win.strike, 0);
  const closeLabel =
    win.settlementPrice != null ? formatUsdc(win.settlementPrice) : null;
  // The margin — how far the close beat or missed the strike — is the card's drama, and it's
  // meaningful at any scale (unlike the pot, which is ~$0 on a thin devnet). Yes wins on a
  // clear (close ≥ strike), No wins on a miss; sign of (close − strike) agrees with the outcome.
  const marginUsdc =
    win.settlementPrice != null ? win.settlementPrice.sub(win.strike) : null;
  return (
    <Link
      href={`/trade/${win.symbol}`}
      className={cx(
        "panel group relative block overflow-hidden p-4 transition-colors",
        yesWon ? "hover:border-yes/40" : "hover:border-no/40"
      )}
      data-testid={`win-${win.address}`}
    >
      {/* A side-coded edge so the verdict reads at a glance, before any number. */}
      <div
        aria-hidden
        className={cx(
          "absolute inset-y-0 left-0 w-1",
          yesWon ? "bg-yes" : "bg-no"
        )}
      />
      <div className="flex items-center justify-between gap-3 pl-2">
        <div className="flex items-center gap-2.5">
          <span
            className={cx(
              "stat-mono shrink-0 rounded-md border px-2 py-1 text-xs uppercase tracking-wide",
              yesWon
                ? "border-yes/30 bg-yes/10 text-yes"
                : "border-no/30 bg-no/10 text-no"
            )}
          >
            {yesWon ? "Yes" : "No"}
          </span>
          <span className="font-serif text-lg tracking-tight text-fg">
            {win.symbol}
          </span>
        </div>
        {marginUsdc != null ? (
          <div className="text-right">
            <div
              className={cx(
                "stat-mono text-lg",
                yesWon ? "text-yes" : "text-no"
              )}
            >
              {yesWon ? "+" : "−"}
              {formatUsdc(marginUsdc.abs())}
            </div>
            <div className="text-[0.6rem] uppercase tracking-wide text-fg-faint">
              {yesWon ? "cleared by" : "missed by"}
            </div>
          </div>
        ) : (
          <div className="stat-mono text-sm text-fg-faint">—</div>
        )}
      </div>

      <p className="mt-3 pl-2 text-sm text-fg-dim">
        Closed{" "}
        {closeLabel ? (
          <span className="stat-mono text-fg">{closeLabel}</span>
        ) : (
          "—"
        )}{" "}
        vs <span className="stat-mono text-fg">{strikeLabel}</span> line
      </p>
      <p className="mt-1 pl-2 text-[0.7rem] text-fg-faint">
        {formatTradingDay(win.tradingDay)} ·{" "}
        <span className={yesWon ? "text-yes" : "text-no"}>
          {yesWon ? "Yes" : "No"}
        </span>{" "}
        paid out
      </p>
    </Link>
  );
}

/**
 * "How it works": one trading day as a vertical timeline. A gold spine runs down the middle
 * (left on mobile), a node marks each beat, and cards alternate sides on desktop / stack to the
 * right on mobile. The day flows top-to-bottom: the board opens, you pick a side, you pay the
 * price, the bell rings, and it auto-settles — the whole lifecycle a newcomer needs.
 */
function HowItWorks() {
  return (
    <section data-testid="how-it-works">
      <div className="mb-8 text-center">
        <h2 className="font-serif text-3xl tracking-tight text-fg">
          How a trading day works
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-fg-dim">
          One session, start to finish — no overnight risk, no human in the
          loop.
        </p>
      </div>

      <ol className="relative mx-auto max-w-3xl" data-testid="timeline">
        {/* The spine: a gold rule the nodes sit on. Left on mobile, centered on desktop. */}
        <div
          aria-hidden
          className="absolute bottom-2 top-2 w-px bg-gradient-to-b from-transparent via-accent/40 to-transparent left-[11px] md:left-1/2 md:-translate-x-1/2"
        />
        <TimelineStep
          n="01"
          side="left"
          time="9:30 AM ET"
          title="The board opens"
          icon={<IconSunrise />}
          body={
            <>
              At the bell, fresh markets light up for all seven stocks — a few
              price lines around where each is trading.
            </>
          }
        />
        <TimelineStep
          n="02"
          side="right"
          time="All session"
          title="Pick a side"
          icon={<IconSides />}
          body={
            <>
              Choose a question and take <span className="text-yes">Yes</span>{" "}
              if you think it closes above the line,{" "}
              <span className="text-no">No</span> if you don't.
            </>
          }
        />
        <TimelineStep
          n="03"
          side="left"
          time="All session"
          title="Pay the price"
          icon={<IconCoin />}
          body={
            <>
              The price <em className="not-italic text-fg">is</em> the odds —
              pay it and you hold a contract that wins{" "}
              <Price tone="usdc">$1.00</Price>. Trade out anytime.
            </>
          }
        />
        <TimelineStep
          n="04"
          side="right"
          time="4:00 PM ET"
          title="The bell rings"
          icon={<IconBell />}
          body="The official closing price is read straight from an on-chain oracle — no proposer, no dispute window."
        />
        <TimelineStep
          n="05"
          side="left"
          time="Instantly"
          title="Auto-settle"
          icon={<MeridianMark size={18} />}
          body="The winning side redeems $1.00 each, on-chain, the moment the close is in. No waiting on anyone."
          last
        />
      </ol>
    </section>
  );
}

/**
 * One beat in the timeline. `side` places the card left/right of the spine on desktop; on
 * mobile every card sits to the right of the left-pinned spine. The node straddles the spine.
 */
function TimelineStep({
  n,
  side,
  time,
  title,
  body,
  icon,
  last,
}: {
  n: string;
  side: "left" | "right";
  time: string;
  title: string;
  body: ReactNode;
  icon: ReactNode;
  last?: boolean;
}) {
  return (
    <li className={cx("relative md:grid md:grid-cols-2", last ? "" : "pb-8")}>
      {/* The node on the spine. */}
      <span
        aria-hidden
        className="timeline-node absolute left-0 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-accent/50 bg-ink-2 text-accent md:left-1/2 md:-translate-x-1/2"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      </span>

      {/* Spacer for the empty column on desktop so the card lands on the chosen side. */}
      {side === "right" && <div className="hidden md:block" aria-hidden />}

      <div
        className={cx(
          "pl-10 md:pl-0",
          side === "left" ? "md:pr-10 md:text-right" : "md:pl-10"
        )}
      >
        <div
          className={cx(
            "panel inline-block w-full p-5 text-left transition-colors hover:border-accent/30"
          )}
        >
          <div
            className={cx(
              "flex items-center gap-3",
              side === "left" ? "md:flex-row-reverse" : ""
            )}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-ink-2 text-accent">
              {icon}
            </span>
            <div className={side === "left" ? "md:text-right" : ""}>
              <div className="stat-mono text-[0.65rem] uppercase tracking-wide text-accent">
                {n} · {time}
              </div>
              <h3 className="font-serif text-base text-fg">{title}</h3>
            </div>
          </div>
          <p className="mt-2.5 text-sm text-fg-dim">{body}</p>
        </div>
      </div>
    </li>
  );
}

/* --- Inline step icons (stroke = currentColor, gold via the badge). --- */

function IconSunrise() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 18h18M5.5 18a6.5 6.5 0 0113 0M12 3v3M4.2 8.2l2 1.2M19.8 8.2l-2 1.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
