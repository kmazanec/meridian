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
}

export type PortfolioRow = OpenRow | SettledRow;

const PRICE_SCALE = new BN(1_000_000);

/** The mark for a side: the Yes mark for yes, its complement for no. */
function sideMark(side: Side, yesMark: BN): BN {
  return side === "yes" ? yesMark : PRICE_SCALE.sub(yesMark);
}

/** Build the portfolio rows for a set of holdings, given the local cost basis. */
export function buildPortfolio(
  holdings: Holding[],
  basis: Map<string, CostBasis>
): PortfolioRow[] {
  const rows: PortfolioRow[] = [];
  for (const h of holdings) {
    if (h.amount.lten(0)) continue;

    if (h.state === "settled" && h.outcome !== Outcome.Unsettled) {
      const payout = settledPayout(h, h.side, h.amount);
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
