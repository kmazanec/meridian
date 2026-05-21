# Feature: Program Scaffold & Accounts

**ID:** F-01 · **Roadmap piece:** F-01 · **Status:** In review — [MR !1](https://labs.gauntletai.com/keithmazanec/meridian/-/merge_requests/1)

## Description

This delivers the foundation of the Meridian on-chain program: an Anchor program
shell that compiles and deploys, the core account types (`Config`, `Market`,
`OrderBook`, and the `Order` struct), the Program Derived Address (PDA) conventions
for the vault and mint authority, the shared error and event definitions, and the
one-time `initialize_config` instruction.

It exists because every other on-chain feature builds on these account layouts and
PDA seeds. Getting the data model and seed conventions right *once*, here, prevents
breaking changes cascading through the mint/redeem, order-book, settlement, and
market-creation features. This feature defines the contracts; it does not implement
the trading/settlement logic.

## How it fits the roadmap

Wave 0, the serial foundation at the head of the critical path. Nothing else can
start until this lands. It unblocks the three parallel program tracks (F-02, F-03,
F-05).

## Dependencies (must exist before this starts)

None — can start immediately.
- External: Solana + Anchor toolchain installed; a local validator for testing.

## Unblocks (what waits on this)

- **F-02 Mint & redeem** — consumes `Market`, the vault/mint-authority PDA seeds, and `pairs_minted`.
- **F-03 Order book & matching** — consumes `OrderBook`, `Order`, and the price/size fixed-point scale.
- **F-05 Market creation & admin** — consumes `Config`, `Market`, and all PDA seeds to provision new markets.

## Acceptance criteria

- The program builds with the Anchor toolchain and deploys to a local validator.
- `Config`, `Market`, `OrderBook`, and `Order` exist with the fields described in
  ARCHITECTURE.md §4, including space/size accounting adequate for the chosen order
  book capacity `N`.
- PDA seed schemes for the vault, the mint authority, `Market`, and `OrderBook` are
  defined and documented (the exact seeds are a frozen contract for downstream
  features — see ROADMAP.md cross-cutting concern #3).
- The fixed-point scale for prices/strikes/sizes is fixed and documented (no floats;
  see ROADMAP.md cross-cutting concern #2).
- `initialize_config` creates the singleton `Config` with admin, USDC mint,
  supported tickers + per-ticker oracle feed ids, paused flag, and optional fee
  account; calling it twice fails.
- Shared error codes and events used by later features are declared.
- The generated IDL is produced and available for the SDK feature.

## Testing requirements

- Unit tests: `initialize_config` happy path; re-initialization rejected;
  field round-trip (write/read) for each account type; PDA derivation matches the
  documented seeds.
- Tests run on a local validator via the Anchor test harness.
- Coverage must include the account size/space assumptions so later features don't
  overflow account data.

## Manual setup required

- Install Rust, the Solana CLI, Anchor (via `avm`), and configure a local validator.
  (No secrets or paid services for this feature.)

## Approved implementation plan (build checklist)

**Frozen contracts (user-approved decisions):**
- Money scale: **6 decimals** = USDC base units (1 USDC = 1_000_000). $1.00 = 1_000_000.
- Yes/No tokens: **6 decimals**, 1e6 base units ⇄ $1.00 (1:1 with collateral).
- Order price: integer in USDC-per-Yes, range [0, 1_000_000] (6dp).
- Order book capacity: **N = 128 per side** (128 bids + 128 asks).
- OrderBook/Order shape declared now (size frozen); matching logic deferred to F-03.

**Toolchain (verified):** Rust 1.95.0 · anchor-cli 1.0.1 · solana-cli 3.1.15 (Agave) · platform-tools 1.52.

- [x] **Chunk 1 — Anchor workspace scaffold.** `anchor init` meridian (v1 layout), `declare_id!`, `Anchor.toml` with `[tooling] validator = "solana"`, deps (anchor 1.0.1, solana 3.x, `resolver = "2"`). Proves: builds + **deploy success on local validator**.
- [x] **Chunk 2 — Constants & frozen contracts.** `constants.rs`: decimals, PAYOFF_UNIT, PRICE_SCALE, ORDERBOOK_N=128, PDA seed bytestrings. Tests pass: constant values + PDA derivation + seed distinctness.
- [x] **Chunk 3 — Account types & enums.** `Config`/`Market`/`OrderBook`/`Order` + `MarketState`/`Outcome`/`OrderSide`/`Ticker` per ARCHITECTURE.md §4. INIT_SPACE accounting. Tests pass: size ≤ 10MB (Config 338B, Market 184B, OrderBook 14905B).
- [x] **Chunk 4 — Errors & events.** Single `#[error_code] MeridianError` enum (20 codes) for F-02–F-05; `ConfigInitialized` event.
- [x] **Chunk 5 — `initialize_config`.** Singleton `Config` PDA (`b"config"`): admin, usdc_mint, 7 tickers + feed ids, paused=false, optional fee_account. Idempotent via `init`. 3 LiteSVM tests pass: happy path, re-init rejected, fee_account variant.
- [x] **Chunk 6 — IDL output & handoff.** `anchor build` emits `target/idl/meridian.json` + `target/types/meridian.ts` (initialize_config, Config, ConfigInitialized, 20 errors, 4 constants).
- [x] **Adversarial review** + triage-fix (high/med) done; PR next.

**Test result:** 12/12 pass (`cargo test -p meridian`): 7 contract/PDA/size/enum + 4 initialize_config (LiteSVM) + 1 built-in.

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.

**Deviation (testing):** Unit tests use **LiteSVM in-process** (per solana-dev skill's
recommended pyramid) rather than the TS/mocha anchor harness — faster, runs the real
compiled `.so`, allows clock/account manipulation. The "deploys to a local validator"
criterion is proven via `anchor build` + a deploy smoke check against the standard
validator (`[tooling] validator = "solana"`, since `anchor test` would otherwise default
to surfpool in v1). Rationale: faster, more reliable CI gate; same behavioral coverage.

**Toolchain note:** `avm` (Anchor version manager) is installed **from the Anchor git
repo** (`cargo install --git https://github.com/solana-foundation/anchor avm`) and
self-updated to **1.0.2**; `avm self-update` works (compiles from git). Do **not** use
`cargo install avm` from crates.io — that resolves to a stale package whose ancient
`openssl-sys 0.6.7` fails to build against OpenSSL 3.x. The active **anchor-cli is
1.0.1** (kept in lockstep with `anchor-lang = "1.0.1"`); `anchor` is an avm-managed
symlink. A future CLI bump to 1.0.2 should update `anchor-lang` + the CLI together and
re-run the full build/test as its own change. Solana CLI lives at
`~/.local/share/solana/install/active_release/bin` (add to PATH).

### Frozen contract handoff (for F-02–F-06)

- **Account sizes** (incl. 8-byte discriminator): Config 338B, Market 184B,
  Order 58B, OrderBook 14905B. OrderBook reserves room for 128 bids + 128 asks.
- **OrderBook uses `Vec<Order>` with `#[max_len(128)]`** (not `[Order; 128]`):
  `init` pre-allocates the full byte budget, so F-03 can `push` up to 128/side with
  **no realloc** — only the borsh length prefix grows. `Order.active` is the sole
  source of truth for slot occupancy (a default `Order` looks like a 0-price Bid;
  gate all reads on `active`).
- **PDA seeds** (frozen — derive from program id `j9aDZ19LCUNscRzu4pb8xMfcB42vxKN9MKyS3ej13vR`):
  - Config: `[b"config"]`
  - Market: `[b"market", ticker_index:u8, strike:u64 LE, trading_day:i64 LE]`
  - OrderBook: `[b"order_book", market]` · Vault: `[b"vault", market]`
  - Mint authority: `[b"mint_auth", market]` · Yes mint: `[b"yes_mint", market]` · No mint: `[b"no_mint", market]`
- **Enum ordinals are frozen** (borsh wire format), pinned by `enum_discriminants_are_frozen`.
  Append-only; never reorder `Ticker`/`MarketState`/`Outcome`/`OrderSide`/`MeridianError`.
- **IDL note:** `Market` and `OrderBook` are NOT yet in the IDL `accounts` list —
  Anchor only emits account types referenced by an instruction's context. They appear
  once F-02–F-05 add instructions that use them. The structs compile and are sized now.
- **`initialize_config` is admin-validated:** only the program's **upgrade authority**
  may call it (closes the front-run admin-capture vector). Deploy flow: deploy the
  program, then call `initialize_config` signed by the upgrade authority (becomes admin).
  `usdc_mint` is checked to be token-program-owned + non-default here; full `Mint`
  typing is F-02's job.

### Adversarial review outcome

Independent review run; HIGH + MEDIUM findings fixed and re-tested:
- **HIGH** — permissionless-init admin capture → fixed: `initialize_config` now requires
  the program's upgrade authority (`program` + `program_data` accounts; test
  `initialize_config_rejects_non_upgrade_authority`).
- **MEDIUM** — unvalidated `usdc_mint` → fixed: handler rejects non-token-owned / zero keys.
- **MEDIUM** — enum discriminants not enforced → fixed: `enum_discriminants_are_frozen`.
- **MEDIUM** — weak re-init assertion → fixed: distinct second payload + asserts config
  unchanged (`initialize_config_rejects_reinitialization`).

**Deferred LOW findings (for the user to decide; not blocking):**
- **L5** `Order::default()` is a valid-looking 0-price Bid; F-03 must gate reads on
  `active` (documented above). No code change in F-01.
- **L6** `Vec<Order>` vs `[Order; N]`: the Vec adds ~8 bytes of length prefixes vs a
  fixed array; chosen per spec and confirmed sound (no realloc risk). No change.
- **L7** `ConfigInitialized` event omits `tickers`/feed-ids; an indexer must read the
  account for the feed mapping. Optional enhancement.

**Dependency hygiene note:** F-01 deliberately does **not** depend on `anchor-spl`.
Adding it pulled in `spl-token-2022-interface`, which currently fails to compile against
this solana 3.x toolchain (a transitive `spl-pod`/`Into` ambiguity). Since F-01 needs no
token CPIs, we validate the mint with a lightweight owner check instead. F-02 will need a
working token stack — resolve the `anchor-spl`/token-2022 version conflict there (pin
compatible versions or use the slim interface crates).
