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
