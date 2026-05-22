# Local Development

## TL;DR — which Solana cluster do I need?

**None.** The current dev loop does not depend on your Solana CLI's active
cluster. You can leave the CLI pointed at devnet, localnet, or anything else and
everything below still works.

| Workflow | What it targets | Depends on CLI cluster? |
|---|---|---|
| `cargo test` (unit/invariant tests) | LiteSVM, in-process — no validator, no RPC | No |
| `anchor build` / `anchor test` / `anchor deploy` | Reads `cluster`/`wallet` from `Anchor.toml` (`localnet`, `~/.config/solana/id.json`) | No |
| Bare `solana ...` commands you type (`balance`, `airdrop`, manual deploys) | Whatever `~/.config/solana/cli/config.yml` points at | Yes |

So switching the CLI to devnet (e.g. to fund a wallet from the faucet) does **not**
break local development. Only commands you invoke as `solana ...` directly are
affected.

## Running the tests

```bash
cargo test
```

The suite under `programs/meridian/tests/` uses
[LiteSVM](https://github.com/LiteSVM/litesvm), which loads the program into an
in-process VM. There is no local validator to start and no airdrop to perform.

The off-chain workspaces have their own tests:

```bash
yarn workspace @meridian/sdk test          # SDK (pure + LiteSVM)
yarn workspace @meridian/automation test   # automation (unit + LiteSVM)
yarn workspace @meridian/web test          # frontend (vitest)
```

## Convergence E2E suite (`@meridian/e2e`)

The cross-stack convergence suite drives the **full integrated lifecycle** against a
**real `solana-test-validator`** using the SDK and automation service (create → mint →
trade → settle → redeem, all four trade paths, a multi-user scenario, and the
on-chain invariants after each phase). Unlike the LiteSVM suites it boots an actual
validator, so it is **not** part of the Node-only CI job and is run locally:

```bash
# Build the program first (the harness loads target/deploy/meridian.so):
anchor build
yarn workspace @meridian/sdk build          # the e2e package imports the SDK's dist
yarn workspace @meridian/automation build

# Then run the suite (it boots + tears down its own validator):
yarn workspace @meridian/e2e test
```

Requirements: `solana-test-validator` and the `solana` CLI on PATH, and a built
`target/deploy/meridian.so`. In a git worktree whose `target/` is empty, point the
harness at a `.so` built elsewhere for the same program source:

```bash
MERIDIAN_SO=/path/to/target/deploy/meridian.so \
MERIDIAN_PROGRAM_KEYPAIR=/path/to/target/deploy/meridian-keypair.json \
  yarn workspace @meridian/e2e test
```

If no validator/`.so` is available the suite **skips** itself (green, no failures). Set
`E2E_REQUIRE_VALIDATOR=1` to turn a missing validator into a hard failure instead.

### Live-devnet settlement (opt-in)

One test exercises the genuine Pyth pull-oracle path (Hermes → Receiver →
`settle_market`) and is **skipped unless** enabled. It needs a funded devnet keypair and
a fresh price (US market hours for an equity feed; a 24/7 crypto feed works any time):

```bash
E2E_DEVNET=1 RPC_URL=https://api.devnet.solana.com \
SOLANA_KEYPAIR=~/.config/solana/id.json FEED_META=<devnet hex feed id> \
  yarn workspace @meridian/e2e test
```

## Anchor commands

`anchor build`, `anchor test`, and `anchor deploy` read their provider settings
from `Anchor.toml`, not from your CLI config:

```toml
[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"
```

To run against a local validator, start one separately (`solana-test-validator`)
and use the Anchor commands as usual. To deploy elsewhere, override per-command
(`anchor deploy --provider.cluster devnet`) rather than switching your global CLI
config.

## Switching the CLI cluster (only needed for manual `solana` commands)

These shell helpers (defined in the maintainer's dotfiles, not in this repo) copy
a saved profile into `~/.config/solana/cli/config.yml`:

```bash
sol-devnet   # CLI → https://api.devnet.solana.com, devnet keypair
sol-local    # CLI → http://localhost:8899, id.json
sol-which    # show the active RPC URL
```

Equivalent without the helpers:

```bash
solana config set -u devnet      # or:  -u localhost
# or per-command, leaving the saved config untouched:
solana balance -u devnet
```

Funding a devnet wallet:

```bash
sol-devnet
solana airdrop 2
solana balance
# if rate-limited, use https://faucet.solana.com with your devnet address
```

## Devnet deployment

A reproducible devnet deploy + market-creation + end-to-end lifecycle workflow is
scoped as a separate deliverable (see `docs/features/10-deployment-reproducibility.md`)
and is not part of the current local dev loop.
