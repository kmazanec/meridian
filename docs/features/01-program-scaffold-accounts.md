# Feature: Program Scaffold & Accounts

**ID:** F-01 · **Roadmap piece:** F-01 · **Status:** Not started

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

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.
