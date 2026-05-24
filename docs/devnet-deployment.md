# Deploying Meridian to Solana devnet — a step-by-step runbook

This guide takes you from nothing to a **live Meridian deployment on Solana devnet** that you
can watch run the full lifecycle (create → mint → trade → settle → redeem). It assumes **no
prior blockchain experience** — every command is spelled out and explained.

> **Devnet is a free test network.** The "money" is fake (test SOL and a mock USDC), so you
> can't lose anything real. We never deploy to mainnet here.

The same scripts you run below (`make ...-devnet`) are the ones CI runs against a local
validator, so what you're deploying is exactly what's been tested.

---

## 0. What you'll need (one-time)

| Thing | Why | How |
|---|---|---|
| **Rust + Solana CLI + Anchor** | to build and deploy the on-chain program | see below |
| **Node.js + Yarn** | to run the deploy/lifecycle scripts | Node 20+; `corepack enable` |
| **A devnet keypair** | your "wallet" — pays the (test-SOL) deploy/transaction fees and is the program admin | we create one below |
| **~5 test SOL on devnet** | deploying a program costs a few test SOL | free faucet, below |

### Install the toolchain

```bash
# Rust (the toolchain version is pinned by this repo's rust-toolchain.toml)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Solana CLI (provides `solana`, `solana-keygen`, `solana-test-validator`)
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
# follow the printed instruction to add it to your PATH, then:
solana --version        # expect 3.1.x

# Anchor (the framework the program is built with)
cargo install --git https://github.com/coral-xyz/anchor avm --locked
avm install 1.0.2 && avm use 1.0.2
anchor --version        # expect anchor-cli 1.0.2

# Node + Yarn (this repo uses Yarn 4 via corepack)
corepack enable
node --version          # expect v20+ (v22 works)
```

---

## 1. Create and fund your devnet wallet

A **keypair** is a file holding your public address (shareable) and secret key (NEVER share).
We make one just for devnet:

```bash
# Create a keypair file. Press Enter for "no passphrase" when prompted.
solana-keygen new --outfile ~/.config/solana/meridian-devnet.json

# Point the CLI at devnet and at this keypair.
solana config set --url https://api.devnet.solana.com
solana config set --keypair ~/.config/solana/meridian-devnet.json

# See your address and (zero) balance.
solana address
solana balance
```

Now get free **test SOL** (you need ~5 for a program deploy):

```bash
solana airdrop 5
solana balance        # should show ~5 SOL
```

If the airdrop is rate-limited (devnet's faucet often is), use the web faucet instead:
paste your address (from `solana address`) into **https://faucet.solana.com** (select
**devnet**), then re-check `solana balance`. Repeat until you have ~5 SOL.

> **Keep that keypair file safe and never commit it.** It controls your devnet program. The
> repo's `.gitignore` already excludes `.env` and keypair-bearing files, but don't paste a
> secret key anywhere public.

---

## 2. Build the program

The on-chain program is a compiled binary (`target/deploy/meridian.so`). Build it once:

```bash
# from the repo root
anchor build
```

This also writes/uses the **canonical program keypair**
(`target/deploy/meridian-keypair.json`, committed) so your program gets the **same program
ID** (`9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen`) every time — that file identifies the
program, it is **not** a funded wallet.

Then build the TypeScript the scripts use:

```bash
corepack yarn@4.10.2 install
corepack yarn@4.10.2 workspace @meridian/sdk build
corepack yarn@4.10.2 workspace @meridian/automation build
```

---

## 3. Tell the scripts about your devnet setup

Copy the env template and fill in the two things that matter for devnet — your keypair and
the devnet RPC:

```bash
cp .env.example .env
```

Edit `.env` so these are set (everything else can stay commented out):

```bash
DEPLOYER_KEYPAIR=~/.config/solana/meridian-devnet.json
RPC_URL=https://api.devnet.solana.com
# At least one previous close so there are strikes to create:
MOCK_CLOSE_META=680
```

Load it into your shell (so `make` and the scripts can read it):

```bash
set -a; . ./.env; set +a
```

> **`.env` is gitignored — never commit it.** `DEPLOYER_KEYPAIR` here is a *file path*; the
> secret stays in that file, not in the repo.

---

## 4. Deploy + run the lifecycle on devnet

Now the four commands. Each one prints what it did; a deploy manifest
(`deploy-manifest.json`, gitignored, public addresses only) carries state between them.

```bash
# 1) Deploy the program to devnet (costs a few test SOL). Idempotent: re-running upgrades.
make deploy-devnet

# 2) Create the collateral USDC mint and initialize the program's Config (you = admin).
make bootstrap-devnet

# 3) Create today's markets from your MOCK_CLOSE_* values (e.g. META strikes around $680).
make create-markets-devnet

# 4) Run the full lifecycle: create → mint → trade → settle → redeem, with a transcript and
#    the on-chain invariants checked at each step.
make lifecycle-devnet
```

A successful `make lifecycle-devnet` ends with something like:

```
── Lifecycle: result ──
    outcome: yesWins
    maker P&L: −$1.40
    taker P&L: +$1.40
    zero-sum: yes (✓)
    vault remaining: +$0.00 (drained)
✓ Lifecycle complete — invariants held at every phase
```

That is the create → mint → trade → settle → redeem flow running **on real devnet**.

A captured transcript of an actual run (full phase-by-phase output, plus the program id,
market address, and explorer links) is checked in at
[`devnet-lifecycle-run.md`](devnet-lifecycle-run.md) — read that if you want to see the
evidence without running it yourself.

---

## 5. See it on a block explorer

Every address the scripts print can be viewed on a public explorer. Open:

```
https://explorer.solana.com/address/9R3jRbvh9jeQLGEggB3VXQTwj88YjUKqKM8x75SefGen?cluster=devnet
```

(that's the program ID; swap in any market/account address from the script output). The
`?cluster=devnet` is essential — without it you're looking at mainnet. You can also point the
frontend at devnet by setting `NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com` and
`NEXT_PUBLIC_USDC_MINT=<the USDC mint from the manifest>` in `packages/web/.env.local`, then
`corepack yarn@4.10.2 workspace @meridian/web dev`.

---

## 6. Settlement: admin override (default) vs. the live Pyth oracle

The lifecycle above settles via the **admin override** (`admin_settle`) — a deterministic,
time-delayed admin action that needs no live price feed. It's the guaranteed demo path and is
why step 4 works any time of day.

To exercise the **genuine Pyth pull-oracle** path (`settle_market`, which reads a real price
posted on-chain), you need real per-ticker **devnet feed ids** and, for equity feeds, **US
market hours** (equity feeds only update 9:30 AM–4:00 PM ET on trading days; a 24/7 crypto
feed works any time as a stand-in):

1. Look up the devnet feed id for your ticker at **https://pyth.network/price-feeds** (or via
   Hermes: `GET https://hermes.pyth.network/v2/price_feeds?query=META&asset_type=equity`).
2. Put it in `.env` as `FEED_META=0x...` (32-byte hex), re-`source` it, and re-run
   `make bootstrap-devnet` against a *fresh* deployment so `Config` records the real feed id
   (the on-chain `WrongFeed` check must match).
3. The live settlement path itself is exercised by the convergence suite's opt-in devnet
   smoke test (see `docs/features/09-integration-e2e.md` and `docs/local-development.md`):

   ```bash
   E2E_DEVNET=1 RPC_URL=https://api.devnet.solana.com \
   SOLANA_KEYPAIR=~/.config/solana/meridian-devnet.json FEED_META=<devnet hex feed id> \
     corepack yarn@4.10.2 workspace @meridian/e2e test
   ```

If a feed is stale or unavailable, the **admin override remains the fallback** — the
end-to-end lifecycle is fully demonstrable without the live feed.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `DEPLOYER_KEYPAIR is not set` | `.env` not loaded | `set -a; . ./.env; set +a` |
| Airdrop fails / "rate limited" | devnet faucet throttling | use https://faucet.solana.com (select devnet) |
| Deploy fails: "insufficient funds" | < ~5 test SOL | airdrop more (step 1) |
| `Program binary missing at .../meridian.so` | not built | `anchor build` (step 2) |
| Wrong network in the explorer | missing cluster param | add `?cluster=devnet` to the URL |
| `make create-markets-devnet` creates nothing | no `MOCK_CLOSE_*` set | set at least one (e.g. `MOCK_CLOSE_META=680`) and re-`source` |
| Live `settle_market` rejects (stale/confidence) | equity feed outside market hours | settle via the admin override, or use a 24/7 crypto feed |
| `solana` commands hit the wrong cluster | CLI config | `solana config get`; `solana config set --url https://api.devnet.solana.com` |

---

## Notes & limitations

- **Devnet only.** This runbook never deploys to mainnet or uses real funds. (A mainnet-beta
  deployment is a bonus, out of scope for the core submission.)
- **The deploy keypair is a real secret** even on devnet — keep the file private, never commit
  it. It is the program upgrade authority and the `Config` admin.
- **No regulatory or compliance claims** are made; this is a technical demonstration.
- For the architecture and the "why" behind every decision, see
  [`../ARCHITECTURE.md`](../ARCHITECTURE.md); for the local one-command loop, see
  [`local-development.md`](local-development.md).
