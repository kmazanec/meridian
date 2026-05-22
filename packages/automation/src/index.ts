// Public surface of @meridian/automation. Expanded chunk by chunk. The barrel is the
// interface the integration tests (F-09) and any operator harness import: the two job
// entrypoints, the calendar/strike pure functions, and the pluggable PriceSource/Alerter
// interfaces. The service consumes @meridian/sdk for every chain interaction — it never
// hand-rolls serialization or PDA derivation.

export { VERSION } from "./version";
