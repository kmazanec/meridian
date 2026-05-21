# Feature: Mint & Redeem (Vault)

**ID:** F-02 · **Roadmap piece:** F-02 · **Status:** In progress

## Description

This delivers the collateral lifecycle: the `mint_pair` instruction (deposit $1.00
USDC into the PDA vault, receive 1 Yes + 1 No token) and the `redeem` instruction
(burn tokens after settlement to receive the payout from the vault). It owns the
PDA-owned USDC vault and the PDA mint authority for the Yes/No mints.

It exists because minting and redemption are the entry and exit of all value in the
system, and they mechanically enforce the collateralization invariant
(`vault balance == $1.00 × pairs_minted`). This is the non-custodial heart of
Meridian: funds move only under program rules.

## How it fits the roadmap

Wave 1, on the critical path (F-01 → F-02 → F-04 → …). Runs in parallel with F-03
and F-05. It is the prerequisite for settlement (F-04), because redemption payouts
depend on the settled outcome and the vault it manages.

## Dependencies (must exist before this starts)

- **F-01 Program scaffold & accounts** — needs `Market`, the vault and mint-authority
  PDA seeds, the `pairs_minted` field, and the fixed-point scale.
- External: a USDC mint available on the target cluster (devnet USDC / a test mint).

## Unblocks (what waits on this)

- **F-04 Settlement & oracle** — `redeem` consumes the settled `outcome`; settlement
  and redemption share the vault and the payout-completeness invariant.
- **F-09 Integration & E2E** — the lifecycle's mint and redeem legs.

## Acceptance criteria

- `mint_pair` transfers exactly $1.00 USDC from the user to the vault, mints exactly
  1 Yes and 1 No to the user's token accounts, and increments `pairs_minted`.
- `redeem` after settlement burns the presented tokens and pays $1.00 per winning
  token and $0 per losing token from the vault; winning tokens remain redeemable
  indefinitely.
- The collateralization invariant holds exactly after every `mint_pair` and `redeem`
  (vault balance equals `$1.00 × pairs_minted` net of redemptions), with any fee
  routed to the separate fee account, never the vault (ARCHITECTURE.md §7.1).
- Tokens can be created only via `mint_pair` and destroyed only via `redeem`
  (program holds mint + freeze authority via PDA; ARCHITECTURE.md §7.3).
- Minting is rejected when the program is paused; redeeming is rejected before the
  market is settled.
- The vault and mint authority are PDAs with no external signer.

## Testing requirements

- Unit tests: mint happy path; redeem of winning vs losing tokens; collateralization
  invariant asserted after every operation; redeem-before-settle rejected;
  mint-while-paused rejected; attempt to mint/burn outside the instructions rejected.
- Tests must cover the invariant across multiple mint/redeem sequences and partial
  redemptions.
- Run on a local validator via the Anchor test harness.

## Manual setup required

- A USDC mint/faucet on the test cluster (devnet USDC or a locally created test
  mint with a funded user account).

## Approved implementation plan (build checklist)

**Decisions (user-approved):**
- **F-02 owns market+collateral creation** via `create_strike_market` (Market + Yes/No
  mints + USDC vault). This moves provisioning from F-05 → F-02 (single creation path);
  F-05 narrows to `add_strike` + `pause`/`unpause` + admin. **Propagated to ROADMAP.md.**
  The OrderBook account is left to F-03 (Market.order_book is a placeholder until then).
- **PDA holds mint AND freeze authority** (ARCHITECTURE §7.3); no freeze instruction is
  exposed in F-02 (capability held for a future emergency instruction).
- **LiteSVM local test mint** for USDC (6 decimals); no devnet dependency.
- **anchor-spl token-only**: `default-features = false, features = ["token","mint","associated_token"]`
  to avoid the broken `spl-token-2022-interface` on this toolchain (verified compiles).
- **Redeem test shim:** since `settle_market` is F-04, redeem tests set
  `market.state=Settled`/`outcome` directly via a LiteSVM account write.

- [x] **Chunk 1 — Dependency + module wiring.** anchor-spl added; create_strike_market /
  mint_pair / redeem modules wired. Clean build (after the solana-zero-copy toolchain fix).
- [x] **Chunk 2 — `create_strike_market`.** Admin-gated; creates Market + Yes/No mints
  (6dp, mint+freeze authority = PDA) + USDC vault PDA. 5 tests: happy, non-admin, zero
  strike, duplicate, wrong-usdc-mint.
- [x] **Chunk 3 — `mint_pair`.** Deposit 1e6 USDC → mint 1e6 Yes + 1e6 No; pairs_minted++.
  5 tests: happy, multi-mint invariant, paused, settled, insufficient USDC.
- [x] **Chunk 4 — `redeem`.** Burn settled tokens; winning side pays 1:1; losing → $0;
  partial. 5 tests: Yes-wins, losing-No→$0, No-wins, partial-then-rest, before-settle reject.
- [x] **Chunk 5 — Invariant & multi-op sweep.** 3 tests: vault==1e6×pairs through full
  cycle, dollar conservation (Yes+No break-even), mismatched side/account rejected.
- [x] **Chunk 6 — IDL + handoff notes.** IDL regenerated (4 instructions). Notes below.
- [x] **Adversarial review** + triage-fix (high/med) done; MR next.

**Test result:** 32/32 pass (`cargo test -p meridian`): F-01 (12) + F-02 create (5) + mint (5)
+ redeem (5) + invariants (5, incl. double-redeem & cross-market substitution).

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.

### Toolchain fix (project-wide — supersedes F-01's "avoid anchor-spl" note)

The real blocker was **not** anchor-spl per se. Anchor 1.0.2's `init` constraint
codegen for mints/token-accounts references `anchor_spl::token_interface`, which needs
`spl-token-2022-interface` — broken on this toolchain by **`solana-zero-copy 1.1.0`**
(adds `From`/`PartialOrd` impls making `PodU64::into()` ambiguous → E0283). **Fix:
pin `solana-zero-copy = "=1.0.0"`** in the program crate. Full anchor-spl then compiles
and we use Anchor's idiomatic `init` constraints. This unblocks F-03/F-04/F-05 too.
Also: **`Box<Account<…>>`** the heavy accounts to stay under the 4KB SBF stack frame.

### Frozen-contract change (propagate to F-01 account model / ARCHITECTURE §4.2)

Added **`Market.winning_redeemed: u64`** (after `pairs_minted`). This gives the
collateralization invariant on-chain representation:
`vault == PAYOFF_UNIT * pairs_minted − winning_redeemed`. `pairs_minted` stays a
monotonic mint counter (it is NOT decremented on redeem — correct, since the vault's
correctness during the Open phase is `vault == PAYOFF_UNIT * pairs_minted`). F-03/F-04/F-05
builders must account for the new field in `Market` (size grew by 8 bytes).

### Key decisions
- **`create_strike_market` moved F-05 → F-02** (single creation path). ROADMAP updated.
- **PDA = mint + freeze authority** for both mints; vault owner. No freeze instruction
  exposed in F-02 (capability held for a future emergency instruction).
- **redeem** burns the presented side's tokens (burn-before-pay → double-redeem safe),
  pays 1:1 only if that side won; losing side burns for $0. Partial redemption supported.
- **anchor-spl token CPIs hardcode the canonical SPL Token program id** (verified in
  1.0.2 source) and ignore the `program_id` arg to `CpiContext::new`; the
  `Program<'info, Token>` type is what binds the token program. No fake-token-program
  vector. (So `CpiContext::new(token_program.key(), …)` is correct.)

### Adversarial review outcome (high + medium fixed, re-tested)
- **HIGH** — §7.1 invariant was enforced only in tests → fixed: added `winning_redeemed`
  counter + a `require!(vault.amount >= amount)` guard before payout.
- **MEDIUM** — `user_usdc.owner` unchecked → fixed: constrain `user_usdc.owner == user`.
- **MEDIUM** — missing adversarial tests → added `double_redeem_rejected` and
  `cross_market_vault_substitution_rejected` (both pass; `has_one = vault` rejects foreign vault).
- **LOW** — `amount==0` used `InvalidOrderSize` → changed to `InvalidArgument`.

**Deferred LOW (user's call, non-blocking):**
- `redeem` requires both `yes_mint` and `no_mint` as `mut` though only one is burned —
  could drop one account/writable-lock by passing a single side-selected mint (efficiency).
- Style: `vault` uses `address =` while mints use `seeds =` (both bind correctly).
