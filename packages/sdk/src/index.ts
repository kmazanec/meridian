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
export * from "./reads";
export * from "./intent";
// Pyth helpers: the constants + fixture builder are dependency-free; the Hermes/Receiver
// functions lazy-import their optional peer deps only when called, so re-exporting here
// does not pull those into a consumer's bundle. A dedicated `@meridian/sdk/pyth` subpath
// also exists for tree-shaking.
export * from "./pyth";
