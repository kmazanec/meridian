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
export * from "./pdas";
export * from "./instructions";
