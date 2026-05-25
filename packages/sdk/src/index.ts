// Public surface of @meridian/sdk. Expanded chunk by chunk; finalized in the
// "public surface" step. The barrel is the interface downstream features import.

export { MERIDIAN_IDL, type Meridian } from "./idl";
export {
  PROGRAM_ID,
  getProgram,
  getProgramFromConnection,
  type MeridianProgram,
} from "./program";
export {
  PAYOFF_UNIT,
  PRICE_SCALE,
  TOKEN_DECIMALS,
  USDC_DECIMALS,
  ORDERBOOK_N,
  NUM_TICKERS,
} from "./constants";
export * from "./types";
// US equity market calendar: which dates are trading sessions and the unix `trading_day`
// (4:00 PM ET close, 1:00 PM on half-days). Owns the off-chain timing concern (ADR-005);
// shared by the morning job and the admin "add strike" form. Dependency-free (Intl only).
export {
  isWeekend,
  isHoliday,
  isHalfDay,
  isTradingDay,
  closeInstant,
  sessionForDate,
  etParts,
  type SessionInfo,
} from "./calendar";
export * from "./pdas";
export * from "./instructions";
export * from "./reads";
export * from "./intent";
// Pyth helpers: the constants + fixture builder are dependency-free; the Hermes/Receiver
// functions lazy-import their optional peer deps only when called, so re-exporting here
// does not pull those into a consumer's bundle. A dedicated `@meridian/sdk/pyth` subpath
// also exists for tree-shaking.
export * from "./pyth";
