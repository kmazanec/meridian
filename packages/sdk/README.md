# @meridian/sdk

The shared TypeScript client for the Meridian on-chain program. It is the **single
client interface** to the program — the automation service and the frontend both depend
on it so they never hand-roll chain-calling code or the trade-intent translation.

It provides:

- **Typed instruction builders** for every program instruction, built from the IDL (not
  hand-rolled serialization).
- **PDA derivation** for every account, from the program's frozen seed conventions.
- **Reading helpers**, including the *dual-perspective* order book (one on-chain book,
  rendered as both the Yes and the No side).
- **The "four buttons → one book" intent translation** as a single API, so Buy/Sell ×
  Yes/No each resolve onto the one Yes-vs-USDC book.
- **Pyth/Hermes helpers** to fetch a signed price update and post it via the Pyth Solana
  Receiver for settlement.

## Install

```bash
yarn add @meridian/sdk @solana/web3.js
# Only if you use the Pyth settlement helpers (optional peer deps):
yarn add @pythnetwork/hermes-client @pythnetwork/pyth-solana-receiver
```

The package ships both CommonJS and ES modules (Node services and bundlers both work).

## Quick start

```ts
import { Connection, Keypair } from "@solana/web3.js";
import {
  getProgramFromConnection,
  Ticker,
  buildTradeIntent,
  TradeAction,
  fetchOrderBook,
  dualBook,
  marketPda,
} from "@meridian/sdk";

const connection = new Connection("https://api.devnet.solana.com");
const program = getProgramFromConnection(connection, wallet); // wallet: a signer

// Identify a market by (ticker, strike, trading day).
const market = { ticker: Ticker.Meta, strike: 680_000_000, tradingDay: 1_716_300_000 };

// Read both perspectives of the single book.
const book = await fetchOrderBook(program, marketPda(market.ticker, market.strike, market.tradingDay));
const views = dualBook(book!); // { yes: {bids,asks}, no: {bids,asks} }

// "Buy No" → one transaction (mint a pair + sell the Yes).
const built = await buildTradeIntent(program, wallet.publicKey, {
  market,
  action: TradeAction.BuyNo,
  price: 300_000, // the NO price ($0.30); the SDK sells Yes at $0.70
  size: 1_000_000, // 1.0 token (whole-token multiple required for BUY_NO)
  usdcMint: USDC_MINT,
});
// built.instructions → send as one transaction (one wallet approval).
```

## Units (frozen contract)

- All monetary amounts are **USDC base units** (6 decimals). `PAYOFF_UNIT = 1_000_000` is
  `$1.00`; a winning token redeems for exactly `PAYOFF_UNIT`.
- Order prices are integers in `[0, PRICE_SCALE]` (= `[$0.00, $1.00]`), USDC-per-Yes. The
  Yes price is the market-implied probability. The No price is `PRICE_SCALE − yesPrice`.
- No floats — pass `BN`, numbers, or decimal strings; the SDK uses integer math throughout.

## The four-button translation

| Action     | On the single Yes-vs-USDC book                                       |
| ---------- | ------------------------------------------------------------------- |
| `BUY_YES`  | bid (buy Yes) at the Yes price                                       |
| `SELL_YES` | ask (sell Yes) at the Yes price                                      |
| `BUY_NO`   | `mint_pair` + sell the Yes (ask) at `1 − noPrice`; keep the No       |
| `SELL_NO`  | buy Yes (bid) at `1 − noPrice`; closes the No exposure               |

`buildTradeIntent` returns the ordered instructions for one wallet approval and prepends
idempotent token-account creations. `BUY_NO` sizes must be whole-token multiples of
`PAYOFF_UNIT`. For marketable orders, pass `makerAccounts` (the resting makers' payout
accounts, computed from the current book) so the cross can settle.

## Settlement (Pyth pull oracle)

```ts
import { settleWithPyth } from "@meridian/sdk";
// fetch from Hermes → post via the Receiver → crank settle_market
await settleWithPyth(program, connection, crankerKeypair, market, feedIdHex);
```

The Pyth helpers lazy-load their optional peer deps, so a consumer that never settles does
not pull them into its bundle. `buildPriceUpdateV2` (always available, no peer deps) emits
a deterministic `PriceUpdateV2` account for tests and crypto-feed stand-ins.

## Testing

The SDK's tests run the **real compiled program** in-process via LiteSVM (no validator
daemon). They need the built program binary:

```bash
anchor build          # produces target/deploy/meridian.so (from the repo root)
yarn workspace @meridian/sdk test
```

The live Hermes→Receiver devnet round-trip is an opt-in test
(`PYTH_LIVE=1 PYTH_FEED_ID=… yarn workspace @meridian/sdk test`); it needs a funded devnet
keypair, an RPC, and (for equities) US market hours.

## Regenerating the vendored IDL

The IDL is vendored so the package is self-contained. After any program change:

```bash
anchor build
cp target/idl/meridian.json   packages/sdk/src/idl/meridian.json
cp target/types/meridian.ts   packages/sdk/src/idl/meridian-type.ts
node packages/sdk/scripts/gen-idl-module.mjs
```

`tests/idl.test.ts` fails loudly if the embedded IDL drifts from the program id / unit
contract.
