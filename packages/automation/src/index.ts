// Public surface of @meridian/automation. The barrel is the interface the integration
// tests and any operator harness import: the two job entrypoints, the calendar/strike
// pure functions, and the pluggable PriceSource/Alerter interfaces. The service consumes
// @meridian/sdk for every chain interaction — it never hand-rolls serialization or PDA
// derivation.

export { VERSION } from "./version";
export {
  computeStrikes,
  roundToStep,
  dollarsToStrikeUnits,
  STRIKE_OFFSET_BPS,
  STRIKE_ROUND_DOLLARS,
  type ComputeStrikesOptions,
} from "./strikes";
// Calendar lives in @meridian/sdk now (shared with the web admin form); re-exported here
// so automation's public surface — and its consumers — keep these names.
export {
  isTradingDay,
  isHalfDay,
  isHoliday,
  isWeekend,
  closeInstant,
  sessionForDate,
  etParts,
  type SessionInfo,
} from "@meridian/sdk";
export {
  createLogger,
  LogLevel,
  type Logger,
  type LogLine,
  type LoggerOptions,
} from "./logger";
export {
  WebhookAlerter,
  LogAlerter,
  makeAlerter,
  type Alerter,
  type AlertPayload,
  type AlertSeverity,
  type MakeAlerterOptions,
} from "./alerter";
export {
  MockPriceSource,
  PythPriceSource,
  nativeToUsdcBaseUnits,
  type PriceSource,
  type PriceFetcher,
  type FetchedPrice,
  type PythPriceSourceOptions,
} from "./priceSource";
export {
  withBackoff,
  retryEvery,
  RetryGaveUp,
  type BackoffOptions,
  type RetryEveryOptions,
} from "./retry";
export { RpcChainClient, type ChainClient } from "./chain";
export {
  SdkMarketProvisioner,
  SdkMarketDiscovery,
  type MarketProvisioner,
  type MarketDiscovery,
  type ProvisionResult,
} from "./markets";
export {
  runMorningJob,
  type MorningJobOptions,
  type MorningJobSummary,
} from "./morningJob";
export {
  runSettlementJob,
  SettleStatus,
  type Settler,
  type SettleResult,
  type SettlementJobOptions,
  type SettlementJobSummary,
} from "./settlementJob";
export {
  PythSettler,
  type PythSettlerOptions,
  type SettleWithPythFn,
} from "./settler";
export { loadKeypairFromEnv, AUTOMATION_KEYPAIR_ENV } from "./keypair";
export {
  loadConfig,
  PriceSourceKind,
  ENV_KEYS,
  type AutomationConfig,
} from "./config";
export {
  buildRuntime,
  morningDeps,
  settlementDeps,
  type Runtime,
} from "./runtime";
