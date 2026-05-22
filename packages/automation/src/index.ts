// Public surface of @meridian/automation. Expanded chunk by chunk. The barrel is the
// interface the integration tests (F-09) and any operator harness import: the two job
// entrypoints, the calendar/strike pure functions, and the pluggable PriceSource/Alerter
// interfaces. The service consumes @meridian/sdk for every chain interaction — it never
// hand-rolls serialization or PDA derivation.

export { VERSION } from "./version";
export {
  computeStrikes,
  roundToStep,
  dollarsToBaseUnits,
  STRIKE_OFFSET_BPS,
  STRIKE_ROUND_DOLLARS,
  type ComputeStrikesOptions,
} from "./strikes";
export {
  isTradingDay,
  isHalfDay,
  isHoliday,
  isWeekend,
  closeInstant,
  sessionForDate,
  etParts,
  type SessionInfo,
} from "./calendar";
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
