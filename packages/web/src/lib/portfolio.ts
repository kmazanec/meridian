import BN from "bn.js";
import { Outcome, Ticker } from "@meridian/sdk";
import type { Side, CostBasis } from "./tradeStore";
import { basisKey } from "./tradeStore";
import { positionPnl, settledPayout } from "./market-math";

/**
 * Assemble portfolio rows from holdings + marks + cost basis. Pure: the page fetches
 * the inputs (positions, marks, basis) and this folds them into displayable rows, so
 * the P&L/payout math is unit-tested directly.
 */

export interface Holding {
  market: string; // base58 address
  ticker: Ticker;
  strike: BN;
  side: Side;
  /** Token base units held (6dp). */
  amount: BN;
  /** Market lifecycle. */
  state: "open" | "settled";
  outcome: Outcome;
  /** The market's 4:00 PM ET settlement instant (unix seconds) — the trading day. */
  tradingDay: BN;
  /** Current Yes price (price scale) for marking open positions. */
  yesMark: BN;
}

export interface OpenRow {
  kind: "open";
  market: string;
  ticker: Ticker;
  strike: BN;
  side: Side;
  amount: BN;
  /** The market's settlement instant (unix seconds). */
  tradingDay: BN;
  /** Current mark for this side (Yes mark for yes, 1−Yes for no). */
  markPrice: BN;
  /** Entry price if known from the local store, else null. */
  entryPrice: BN | null;
  value: BN;
  pnl: BN | null;
}

export interface SettledRow {
  kind: "settled";
  market: string;
  ticker: Ticker;
  strike: BN;
  side: Side;
  amount: BN;
  /** The market's settlement instant (unix seconds). */
  tradingDay: BN;
  /** USDC the holding redeems for (winning side 1:1, loser 0). */
  payout: BN;
  /** Whether this holding can be redeemed (won and not yet redeemed). */
  redeemable: boolean;
  /**
   * True when this is a *claimed* winner reconstructed from redeem history — its tokens were
   * already burned, so it no longer appears in holdings. `payout` is the USDC it paid out.
   * (A still-held winner has `redeemable: true`; a held loser has both false.)
   */
  redeemed: boolean;
}

/**
 * A past redemption recovered from on-chain logs, joined to its market for display. Lets the
 * portfolio show *claimed winners* that no longer exist in the wallet's token balances.
 */
export interface RedeemedPosition {
  market: string;
  ticker: Ticker;
  strike: BN;
  side: Side;
  tradingDay: BN;
  /** Tokens burned by the redeem (= the position size). */
  amount: BN;
  /** USDC paid out by the redeem. */
  payout: BN;
}

export type PortfolioRow = OpenRow | SettledRow;

const PRICE_SCALE = new BN(1_000_000);

/** The mark for a side: the Yes mark for yes, its complement for no. */
function sideMark(side: Side, yesMark: BN): BN {
  return side === "yes" ? yesMark : PRICE_SCALE.sub(yesMark);
}

/**
 * Build the portfolio rows from current holdings + the local cost basis, plus any
 * `redeemed` positions reconstructed from on-chain redeem history. The redeemed list is what
 * surfaces **claimed winners** — without it, a redeemed (burned) winning position would simply
 * be absent, leaving only the still-held losers and making a profitable wallet look all-red.
 */
export function buildPortfolio(
  holdings: Holding[],
  basis: Map<string, CostBasis>,
  redeemed: RedeemedPosition[] = []
): PortfolioRow[] {
  const rows: PortfolioRow[] = [];
  // Track which (market:side) we've emitted as settled from live holdings, so a redeem-history
  // entry for the same position doesn't double-count it.
  const settledSeen = new Set<string>();
  for (const h of holdings) {
    if (h.amount.lten(0)) continue;

    if (h.state === "settled" && h.outcome !== Outcome.Unsettled) {
      const payout = settledPayout(h, h.side, h.amount);
      settledSeen.add(`${h.market}:${h.side}`);
      rows.push({
        kind: "settled",
        market: h.market,
        ticker: h.ticker,
        strike: h.strike,
        side: h.side,
        amount: h.amount,
        tradingDay: h.tradingDay,
        payout,
        redeemable: payout.gtn(0),
        redeemed: false,
      });
      continue;
    }

    const markPrice = sideMark(h.side, h.yesMark);
    const entry = basis.get(basisKey(h.market, h.side));
    const entryPrice = entry ? entry.avgPrice : null;
    const { value, pnl } = positionPnl(
      h.amount,
      entryPrice ?? markPrice,
      markPrice
    );
    rows.push({
      kind: "open",
      market: h.market,
      ticker: h.ticker,
      strike: h.strike,
      side: h.side,
      amount: h.amount,
      tradingDay: h.tradingDay,
      markPrice,
      entryPrice,
      value,
      pnl: entryPrice ? pnl : null,
    });
  }

  // Claimed winners: positions the wallet redeemed (tokens burned, so not in holdings). Skip
  // any already shown from live holdings (e.g. a partial redeem that left a balance).
  for (const r of redeemed) {
    if (r.amount.lten(0)) continue;
    if (settledSeen.has(`${r.market}:${r.side}`)) continue;
    rows.push({
      kind: "settled",
      market: r.market,
      ticker: r.ticker,
      strike: r.strike,
      side: r.side,
      amount: r.amount,
      tradingDay: r.tradingDay,
      payout: r.payout,
      redeemable: false, // already claimed
      redeemed: true,
    });
  }
  return rows;
}

/** Top-line portfolio numbers for the page header, folded from the rows. */
export interface PortfolioSummary {
  /** Σ current mark value of open positions (USDC base units). */
  positionValue: BN;
  /** Σ P&L across open positions with a known entry (null if none have one). */
  openPnl: BN | null;
  openCount: number;
  /** Σ payout of redeemable (won, unredeemed) settled positions (USDC base units). */
  claimable: BN;
  claimableCount: number;
}

/** Fold rows into the header summary. Pure — unit-tested directly. */
export function portfolioSummary(rows: PortfolioRow[]): PortfolioSummary {
  let positionValue = new BN(0);
  let pnlSum = new BN(0);
  let hasPnl = false;
  let openCount = 0;
  let claimable = new BN(0);
  let claimableCount = 0;
  for (const r of rows) {
    if (r.kind === "open") {
      openCount += 1;
      positionValue = positionValue.add(r.value);
      if (r.pnl !== null) {
        pnlSum = pnlSum.add(r.pnl);
        hasPnl = true;
      }
    } else if (r.redeemable) {
      claimable = claimable.add(r.payout);
      claimableCount += 1;
    }
  }
  return {
    positionValue,
    openPnl: hasPnl ? pnlSum : null,
    openCount,
    claimable,
    claimableCount,
  };
}

/**
 * A wallet's settled-position record, derived from its settled rows — what turns the "Settled"
 * table into something that reads as a record rather than a graveyard. A position *won* when its
 * payout is positive (it redeems for USDC, whether still redeemable or already claimed); it
 * settled-and-lost otherwise. Counts are over positions (a market can hold both a Yes and No
 * row); `marketsTraded` dedupes to distinct settled markets.
 *
 * NOTE on `winRate`: the portfolio reconstructs *winners* from a bounded recent signature scan
 * (to cap RPC compute-unit cost), while *losers* linger as held tokens across all time — so the
 * two sides cover different windows and the rate would understate. The portfolio strip therefore
 * shows the absolute totals (won / markets / claimed) and **not** `winRate`; the field stays for
 * completeness/tests but should not be surfaced over a bounded scan.
 */
export interface LifetimeStats {
  /** Settled positions that paid out (won). */
  wins: number;
  /** All settled positions (won + lost). */
  decided: number;
  /** Distinct settled markets the wallet had a position in. */
  marketsTraded: number;
  /** Σ payout across winning settled positions (USDC base units) — total won. */
  totalWon: BN;
  /** Wins / decided in [0,1], or null when nothing has settled. See the NOTE above before showing it. */
  winRate: number | null;
}

/** Fold settled rows into a settled-position record. Pure — unit-tested directly. */
export function lifetimeStats(rows: PortfolioRow[]): LifetimeStats {
  let wins = 0;
  let decided = 0;
  let totalWon = new BN(0);
  const markets = new Set<string>();
  for (const r of rows) {
    if (r.kind !== "settled") continue;
    decided += 1;
    markets.add(r.market);
    if (r.payout.gtn(0)) {
      wins += 1;
      totalWon = totalWon.add(r.payout);
    }
  }
  return {
    wins,
    decided,
    marketsTraded: markets.size,
    totalWon,
    winRate: decided > 0 ? wins / decided : null,
  };
}
