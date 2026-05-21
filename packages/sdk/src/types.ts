/**
 * Shared domain types mirroring the on-chain program's enums and structs.
 *
 * Where the program encodes an enum as an ordinal `u8` (e.g. `Ticker`), the order
 * here MUST match the program's declaration order — it *is* the on-chain encoding.
 */

/**
 * The supported MAG7 underlyings. The numeric value is the on-chain ordinal
 * (borsh discriminant). Do not reorder — it must match the program's `Ticker` enum
 * (`state.rs`): Aapl=0, Msft=1, Googl=2, Amzn=3, Nvda=4, Meta=5, Tsla=6.
 */
export enum Ticker {
  Aapl = 0,
  Msft = 1,
  Googl = 2,
  Amzn = 3,
  Nvda = 4,
  Meta = 5,
  Tsla = 6,
}

/** Human ticker symbols indexed by {@link Ticker} ordinal. */
export const TICKER_SYMBOLS = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
] as const;

export type TickerSymbol = (typeof TICKER_SYMBOLS)[number];

/** Map a {@link Ticker} to its display symbol. */
export function tickerToSymbol(ticker: Ticker): TickerSymbol {
  const sym = TICKER_SYMBOLS[ticker];
  if (sym === undefined) {
    throw new Error(`Unknown ticker ordinal: ${ticker}`);
  }
  return sym;
}

/** Map a display symbol to its {@link Ticker} ordinal. */
export function symbolToTicker(symbol: string): Ticker {
  const idx = TICKER_SYMBOLS.indexOf(symbol.toUpperCase() as TickerSymbol);
  if (idx < 0) {
    throw new Error(`Unsupported ticker symbol: ${symbol}`);
  }
  return idx as Ticker;
}

/**
 * The Anchor-encoded representation of a `Ticker` argument (what the IDL expects for
 * an enum: `{ aapl: {} }`, `{ msft: {} }`, …). Instruction builders pass this shape to
 * `program.methods.*`. Keys are the camelCase variant names from the IDL.
 */
export type TickerArg =
  | { aapl: Record<string, never> }
  | { msft: Record<string, never> }
  | { googl: Record<string, never> }
  | { amzn: Record<string, never> }
  | { nvda: Record<string, never> }
  | { meta: Record<string, never> }
  | { tsla: Record<string, never> };

const TICKER_VARIANT_KEYS = [
  "aapl",
  "msft",
  "googl",
  "amzn",
  "nvda",
  "meta",
  "tsla",
] as const;

/** Build the Anchor enum-arg shape for a {@link Ticker}. */
export function tickerToArg(ticker: Ticker): TickerArg {
  const key = TICKER_VARIANT_KEYS[ticker];
  if (key === undefined) {
    throw new Error(`Unknown ticker ordinal: ${ticker}`);
  }
  return { [key]: {} } as TickerArg;
}

/** Recover a {@link Ticker} from a decoded Anchor enum arg/account field. */
export function tickerFromArg(arg: Record<string, unknown>): Ticker {
  const key = Object.keys(arg)[0]?.toLowerCase();
  const idx = TICKER_VARIANT_KEYS.indexOf(
    key as (typeof TICKER_VARIANT_KEYS)[number]
  );
  if (idx < 0) {
    throw new Error(`Unrecognized ticker variant: ${JSON.stringify(arg)}`);
  }
  return idx as Ticker;
}

/** Which side of the single Yes-vs-USDC book an order rests on. */
export enum OrderSide {
  /** Buy Yes. */
  Bid = 0,
  /** Sell Yes. */
  Ask = 1,
}

/** Anchor enum-arg shape for {@link OrderSide}. */
export type OrderSideArg =
  | { bid: Record<string, never> }
  | { ask: Record<string, never> };

/** Build the Anchor enum-arg shape for an {@link OrderSide}. */
export function orderSideToArg(side: OrderSide): OrderSideArg {
  return side === OrderSide.Bid ? { bid: {} } : { ask: {} };
}

/** Recover an {@link OrderSide} from a decoded Anchor enum arg/account field. */
export function orderSideFromArg(arg: Record<string, unknown>): OrderSide {
  const key = Object.keys(arg)[0]?.toLowerCase();
  if (key === "bid") return OrderSide.Bid;
  if (key === "ask") return OrderSide.Ask;
  throw new Error(`Unrecognized order side variant: ${JSON.stringify(arg)}`);
}

/** Which outcome token is being redeemed. */
export enum RedeemSide {
  Yes = 0,
  No = 1,
}

/** Anchor enum-arg shape for {@link RedeemSide}. */
export type RedeemSideArg =
  | { yes: Record<string, never> }
  | { no: Record<string, never> };

/** Build the Anchor enum-arg shape for a {@link RedeemSide}. */
export function redeemSideToArg(side: RedeemSide): RedeemSideArg {
  return side === RedeemSide.Yes ? { yes: {} } : { no: {} };
}

/** Settlement outcome of a market (mirrors the program's `Outcome` enum). */
export enum Outcome {
  Unsettled = "unsettled",
  YesWins = "yesWins",
  NoWins = "noWins",
}

/** Lifecycle state of a market. */
export enum MarketState {
  Open = "open",
  Settled = "settled",
}
