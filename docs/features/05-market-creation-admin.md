# Feature: Market Creation & Admin

**ID:** F-05 · **Roadmap piece:** F-05 · **Status:** In progress

## Description

This delivers market provisioning and admin controls: `create_strike_market` (create
one stock-strike-day market — its Yes/No mints, the PDA vault, and the order book
account), `add_strike` (add an extra strike intraday), and `pause`/`unpause`
(emergency stop on minting and trading). It also covers the on-chain pieces of the
strike-creation contract that the automation service depends on.

It exists because every tradable market must be instantiated before users can mint
or trade, and the admin authority needs a safety switch. Market creation is *not*
batched — one call per strike (ARCHITECTURE.md §5).

## How it fits the roadmap

Wave 1, parallel with F-02 and F-03. Off the single longest critical path, but it is
a prerequisite for the SDK (F-06) because the SDK must build create/admin
instructions, and for integration (F-09).

## Dependencies (must exist before this starts)

- **F-01 Program scaffold & accounts** — needs `Config`, `Market`, and all PDA seeds
  to provision the per-market accounts.

## Unblocks (what waits on this)

- **F-06 Shared TS SDK** — wraps `create_strike_market`, `add_strike`, `pause`/`unpause`.
- **F-09 Integration & E2E** — the create leg of the lifecycle.

## Acceptance criteria

- `create_strike_market` provisions, for one ticker + strike + trading day: the Yes
  mint, the No mint (both with the program PDA as mint authority), the PDA USDC
  vault, and the `OrderBook` account; the resulting `Market` is in the `Open` state.
- Creating the same ticker/strike/day twice is rejected (idempotent provisioning).
- `add_strike` creates an additional market for an existing ticker/day under admin
  authority.
- `pause` blocks `mint_pair` and trading; `unpause` restores them; both are
  admin-only.
- All create/admin instructions enforce the admin authority from `Config`.
- The strike values supplied conform to the documented strike algorithm
  (±3/6/9% of previous close, rounded to $10, deduplicated); the on-chain side
  accepts admin-provided strikes (the calculation itself lives in the automation
  service, F-07).

## Testing requirements

- Unit tests: create happy path (all accounts provisioned, `Open` state); duplicate
  create rejected; `add_strike` happy path; pause blocks mint + trade; unpause
  restores; non-admin calls rejected for all admin instructions.
- Verify provisioned mints/vault are PDA-owned with no external authority.
- Run on a local validator via the Anchor test harness.

## Manual setup required

None (the admin keypair for tests is generated locally).

## Implementation plan (approved)

**Scope reality check:** F-02 and F-03 have since merged and already cover most of this
spec's literal text. `create_strike_market` (F-02) is already the admin-gated per-strike
provisioning path (Market + Yes/No mints + PDA vault, duplicate rejected by `init`); the
order book is provisioned by F-03's `init_order_book`/`grow_order_book`. The global pause
guard is **already enforced** — `mint_pair`, `place_order`, and `match_orders` all reject
when `Config.paused` is true. So F-05's genuine remaining work is just the pieces that
*flip* the pause flag and a named intraday strike-add.

Decisions: `add_strike` = thin distinct instruction reusing the shared create logic; pause
= **global only** (matches the existing wiring; no per-market flag).

- [x] **Chunk 1 — refactor**: extract `create_strike_market`'s Market-field population +
  `MarketCreated` emit into a shared `populate_market(...)` fn it calls. Pure refactor;
  F-02 tests stay green.
- [x] **Chunk 2 — `pause` / `unpause`**: admin-only instructions setting `Config.paused`;
  `PauseSet` event. Tests: pause blocks `mint_pair` + the real `place_order`/`match_orders`
  paths (`MarketPaused`); unpause restores; non-admin rejected (`Unauthorized`); idempotent
  re-pause. *(AC: pause blocks mint+trading, admin-only)*
- [x] **Chunk 3 — `add_strike`**: instruction mirroring `CreateStrikeMarket`, delegating to
  `populate_market`; `StrikeAdded` event. Tests: happy path (accounts provisioned, `Open`,
  mints/vault PDA-owned with no external authority); duplicate rejected; non-admin rejected;
  added strike supports `mint_pair`. *(AC: add_strike under admin authority)*
- [x] **Chunk 4 — adversarial review + deliver**: review, fix high/medium, re-run suite,
  rebase onto main, push, open MR.

## Implementation notes

### Scope finding (propagated)
Most of the spec's literal text was already delivered by merged F-02/F-03 (see the
"already satisfied" list above). F-05's net new on-chain surface is `pause`/`unpause`,
`add_strike`, and a shared `populate_market` refactor. No cross-cutting *contract* change.

### Adversarial review outcome
An independent review attacked the authority model, the refactor parity, add_strike vs
create equivalence, pause completeness, and invariant preservation. It found **no
critical/high** issues (auth, seeds, mint/vault PDA-ownership, duplicate protection, and
field-for-field refactor parity all verified sound). Medium/low fixes applied:

- **Double-event on `add_strike` (M-2, fixed):** `populate_market` used to emit
  `MarketCreated`, so `add_strike` fired both `MarketCreated` *and* `StrikeAdded`. Moved
  the event emit out of the shared helper into each caller — `create_strike_market` emits
  `MarketCreated`, `add_strike` emits only `StrikeAdded`. Clean event surface per
  instruction.
- **`trading_day` not validated (M-3, fixed):** added `require!(trading_day > 0)` in
  `populate_market` (covers both create and add_strike) — a zero/negative close instant
  would otherwise yield a market settleable the moment it's created. New rejection test.
- **Pause-exemption documentation (M-1, fixed):** `admin_pause.rs` now explicitly lists
  which instructions honor the pause flag (`mint_pair`, `place_order`, `match_orders`) and
  which are intentionally exempt for safe wind-down (`cancel_order`, `redeem`,
  `settle_market`, `admin_settle`).
- **Nits (L-1/L-3 fixed):** dropped the dead `admin` param in `set_paused` (emit from the
  verified `config.admin`); the non-admin-pause test now also asserts the flag is unchanged
  after rejection.

**Low, recorded (not actioned):** `add_strike` does not enforce that the ticker/day already
has a market (L-4) — intentional: the strike-selection algorithm and "which day" decision
live off-chain (ARCHITECTURE §9) and the admin is the trusted provisioner; enforcing it
on-chain would require per-ticker-day existence state the design deliberately avoids.

Final: **109 tests green**, `anchor build` clean with **zero** stack-offset warnings.

**Already satisfied by merged F-02/F-03 (not re-implemented, pointers only):**
- `create_strike_market` provisions Market+mints+vault, `Open` state, duplicate rejected,
  admin-gated, `strike > 0` — F-02 (`test_create_strike_market.rs`).
- OrderBook provisioning — F-03 (`init_order_book`/`grow_order_book`, `test_order_book.rs`).
- Pause *enforcement* on mint/trade — F-02/F-03 guards (this feature adds the *switch*).
- Strike *algorithm* (±3/6/9%, round, dedupe) lives off-chain in the automation service
  (F-07); on-chain accepts the admin-provided strike (ARCHITECTURE §9).

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.
