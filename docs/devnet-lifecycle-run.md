# Devnet lifecycle run — captured transcript

This is a captured, **real run** of the full Meridian lifecycle
(create → mint → trade → settle → redeem) against live Solana **devnet**, kept
in the repo as reproducibility evidence. To produce your own run, follow
[`devnet-deployment.md`](devnet-deployment.md) and execute `make lifecycle-devnet`
(or `yarn workspace @meridian/ops lifecycle` with `RPC_URL` + `DEPLOYER_KEYPAIR`
set). The script asserts the on-chain invariants at every phase and exits
non-zero on any failure — a green run is the proof.

## Run metadata

| Field | Value |
|---|---|
| Date | 2026-05-24 |
| Cluster | devnet |
| RPC | `https://api.devnet.solana.com` |
| Program ID | `9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen` |
| USDC mint (collateral) | `Gyyg41J1j72WBY8UnQg6mYPQt2fYtzv8zxEtuJtKUErA` |
| Admin / deployer | `BVNvko29gXsrYHsJ9hFBNzJpJZQkAKjC7CFUinW2R78A` |
| Demo market created | `2nvXW8qVXYF58cYVXyXqYmzyY7WN74qHqTwvuijbiwfy` (META @ $680) |
| Maker wallet | `E3n2dWDeg7Jcv3hdmevsKdw5Za6SYr1oHBjgcBh4QtvM` |
| Taker wallet | `4HBW2e1vPePNDmSaHHzBC7RgummfymoZjhKbKDEe77wt` |
| Exit code | `0` |

Inspect any of the above on a block explorer (devnet cluster), e.g.
<https://explorer.solana.com/address/9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen?cluster=devnet>
or the demo market at
<https://explorer.solana.com/address/2nvXW8qVXYF58cYVXyXqYmzyY7WN74qHqTwvuijbiwfy?cluster=devnet>.

## Transcript

```
── Lifecycle demo (devnet) ──

── Lifecycle: create ──
▶ Created market 2nvXW8qVXYF58cYVXyXqYmzyY7WN74qHqTwvuijbiwfy
    ticker/strike: Meta @ $680.00

── Lifecycle: fund users ──
▶ Funded maker E3n2dWDeg7Jcv3hdmevsKdw5Za6SYr1oHBjgcBh4QtvM (1 SOL, 100 USDC)
▶ Funded taker 4HBW2e1vPePNDmSaHHzBC7RgummfymoZjhKbKDEe77wt (1 SOL, 100 USDC)

── Lifecycle: mint + quote (maker) ──
▶ Maker minted 6 pairs (6 Yes + 6 No, vault $6.00)
▶ Maker posted: ASK 4 Yes @ $0.65, BID 2 Yes @ $0.55

── Lifecycle: trade (taker fills) ──
▶ Taker bought 4 Yes @ $0.65 (paid $2.60)
▶ Maker cancelled its resting bid (escrow returned)

── Lifecycle: settle ──
▶ Settled via admin override — outcome: yesWins
    settlementPrice: $680.00

── Lifecycle: redeem ──
▶ Taker redeemed 4 winning Yes → $4.00
▶ Maker redeemed 2 winning Yes → $2.00, cleared 6 losing No → $0

── Lifecycle: result ──
    outcome: yesWins
    maker P&L: −$1.40
    taker P&L: +$1.40
    zero-sum: yes (✓ asserted)
    vault remaining: +$0.00 (drained ✓)
✓ Lifecycle complete — invariants held at every phase
```

## What this demonstrates

- **All five lifecycle phases** succeed end-to-end on real devnet: create →
  mint → trade (order-book fill + cancel) → settle → redeem.
- **Zero-sum P&L** between the two counterparties (maker −$1.40 / taker +$1.40),
  asserted on-chain.
- **Vault fully drained to $0.00** after every winning token is redeemed and
  every losing token is cleared — the collateral invariant
  (`vault = $1.00 × pairs minted − winning redeemed`) holds at settlement.

## Note on the settlement path

This demo settles via **`admin_settle`** on a deliberately past-dated market, so
the run is deterministic and independent of feed availability. The live-Pyth
`settle_market` path is exercised by the on-chain test suite and is the default
for same-day markets; see
[`devnet-deployment.md` §6](devnet-deployment.md#6-settlement-admin-override-default-vs-the-live-pyth-oracle)
for how the two settlement paths relate.
