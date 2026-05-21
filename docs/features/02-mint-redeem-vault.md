# Feature: Mint & Redeem (Vault)

**ID:** F-02 · **Roadmap piece:** F-02 · **Status:** Not started

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

## Implementation notes (filled in by the building agent)

> The agent implementing this feature records its implementation decisions and
> rationale here as it builds — chosen libraries/patterns within the architecture's
> constraints, trade-offs made, deviations from assumptions and why, and anything the
> next agent or the integrator needs to know. This section starts empty and is owned
> by the builder, not the planner. Cross-cutting discoveries that affect other
> features must also be propagated to ROADMAP.md or the architecture doc, not just
> left here.
