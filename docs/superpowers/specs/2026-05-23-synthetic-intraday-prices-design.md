# Synthetic intraday price variability (local + devnet)

## Problem

In local dev the bots all read a single **static** spot price per ticker (the most-recent
Pyth close, ~20h stale). With no intraday movement and no disagreement, the bots converge on
the same view and the same trades — the market doesn't come alive. We want believable
**intraday price variability** that is:

1. **Variable over the session** — the price moves so bots have something to react to.
2. **Deterministic per clock tick** — every bot (and the dashboard) querying at the same
   wall-clock moment gets the **same** price. No phantom disagreement.
3. **Realistic** — replayed from real prior-day intraday **%-from-open** paths (relative, so
   it scales to whatever open price a market was seeded at).
4. **Settlement-coherent** — the price converges to the curve's final value as the market's
   trading day closes (the platform settles against a close).
5. **Same mechanism locally and on devnet.** Local is the priority.

## Design

A price is a pure, deterministic function of `(symbol, now, tradingDay)`:

```
price(symbol, now) = open[symbol] × (1 + curve(symbol, day)[ progress(now, tradingDay) ])
```

- **`open[symbol]`** — the day's reference price. The same most-recent close `/api/history`
  already returns (Yahoo-backed). The endpoint reuses that, so it's self-contained.
- **`progress(now, tradingDay)`** — the shared 0→1 clock, anchored to the **market's trading
  day**: `progress = (now − open_instant) / (tradingDay_close − open_instant)`, clamped [0,1].
  `tradingDay_close` is the on-chain market's settlement unix time, passed as `?tradingDay=`.
  `open_instant = tradingDay_close − SYNTH_DAY_SECONDS` (compressed session, configurable).
  Because price is a pure function of these, **all bots agree with zero coordination**, and
  at `progress → 1` the price lands on the curve's end value right as the market settles.
- **`curve(symbol, day)`** — a replayed real intraday %-from-open path. A committed dataset of
  several real trading days (per symbol where available, else a shared pool). One curve is
  selected deterministically by `(symbol, day-of-tradingDay)` so it's stable for the session,
  then linearly interpolated at `progress`.

### Why `/api/price` (server endpoint), not a pure client function

Serving from one endpoint (next to `/api/history`) makes "shared across bots" structural
rather than reliant on every bot independently holding identical data + clock. It works
identically locally (wrangler `:8788`) and on devnet (deployed Pages Function), and the
dashboard can show the *same* synthetic price the bots trade on. The function stays a pure
deterministic computation — no per-request randomness, no stored state — so it's still
reproducible and edge-cacheable for short windows.

## Pieces

### 1. The intraday curve dataset (committed)

- `packages/web/functions/api/_intraday-curves.json` — a small JSON: per symbol, an array of
  one or more days, each a downsampled `[{ t: 0..1, d: pctFromOpen }]` path (e.g. ~24 points/
  day). Relative deltas only (e.g. `d: 0.013` = +1.3% from open). Committed, no runtime fetch.
- `scripts/fetch-intraday-curves.mjs` — a one-off generator: pulls real 5-min bars from
  Yahoo's chart endpoint (`range=5d&interval=5m`, confirmed available, ET timestamps), splits
  by trading day, converts each day to %-from-(day-open), downsamples to ~24 points, writes the
  JSON. Re-runnable to refresh; its output is what ships (the function never calls Yahoo for
  intraday).

### 2. `GET /api/price?symbol=NVDA&tradingDay=<unix>` (Cloudflare Pages Function)

`packages/web/functions/api/price.ts`, mirroring `history.ts` conventions (allow-list, `json()`
helper, edge cache — short TTL here, e.g. 5s, since it changes intra-session):

- Resolve `open[symbol]`: fetch the latest close from the existing Yahoo chart path (same as
  history's last close).
- Compute `progress(now, tradingDay)` using `SYNTH_DAY_SECONDS` (env/binding; default ~5400 =
  90 min compressed day).
- Pick + interpolate `curve(symbol, day)` from the committed JSON at `progress`.
- Return `{ symbol, price, pctFromOpen, progress, open, asOf }` (a superset of what
  get_market_price needs; `price` is the dollar value).

### 3. Bot wiring — `PRICE_SOURCE=synthetic`

- `packages/traders/src/config.ts`: add `priceSource: "pyth" | "synthetic"` (env `PRICE_SOURCE`,
  default `pyth`).
- `packages/traders/src/tools/marketPrice.ts`: when `synthetic`, call
  `{WEB_BASE_URL}/api/price?symbol=…&tradingDay=…` (tradingDay from the market the bot is
  pricing — resolved via the existing open-markets discovery) instead of Hermes. Falls back to
  a clear "unavailable" result on error, like the history tool. `pyth` path unchanged.
- The synthetic price is normalized to the same shape the tool already returns
  (`price`, `confidence`≈0, `publishTime`/`ageSeconds` from `asOf`), so the LLM sees no
  difference in format.

### 4. Config / env / Make

- `.env.example`: document `PRICE_SOURCE` (mock|pyth|synthetic for ops? — bots: pyth|synthetic)
  and `SYNTH_DAY_SECONDS`.
- Local: bots already get `WEB_BASE_URL=http://localhost:8788`; setting `PRICE_SOURCE=synthetic`
  is the only extra knob. Document in `packages/traders/README.md` +
  `docs/local-development.md`.

## Devnet

Same `/api/price` ships with the deployed dashboard (it's a Pages Function, like
`/api/history`), so on devnet the bots set `WEB_BASE_URL=<deployed>` + `PRICE_SOURCE=synthetic`
and get the identical deterministic prices. No on-chain change. (Settlement on devnet still
uses the real oracle/admin path — synthetic prices drive the bots' *decisions*, not on-chain
settlement; that's an acceptable dev/demo separation. A later step could feed the synthetic
close into `admin_settle` for full coherence, out of scope here.)

## Verification

1. **Determinism:** call `/api/price?symbol=NVDA&tradingDay=T` twice in quick succession →
   identical price; two different bot processes → identical price at the same second.
2. **Variability:** sample across a compressed session → price tracks the replayed curve
   (moves up/down, not flat), and `progress` advances 0→1.
3. **Convergence:** at `now ≥ tradingDay` → `progress = 1`, price = open × (1 + curve end).
4. **Bots:** run the fleet with `PRICE_SOURCE=synthetic`; logs show `get_market_price` returning
   moving prices and bots taking *different* sides over time as the curve moves. Yes-book asks /
   No-book bids fill in (combined with the earlier SELL fix).
5. Endpoint unit-ish check (vitest, like history) for the curve interpolation + progress math.

## Out of scope (now)

- Feeding synthetic prices into on-chain settlement (`admin_settle`).
- Per-bot price noise (we explicitly want the *same* price per tick).
- Real-time streaming; polling per tick is sufficient.
