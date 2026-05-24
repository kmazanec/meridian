# Meridian — one-command developer + deployment workflow.
#
# Two worlds, one set of scripts (packages/ops), selected by RPC_URL:
#   • LOCAL   — `make dev` brings up a full local stack (validator + deploy + markets +
#               a seeded demo wallet + the frontend env) you can trade against. `make stop`
#               tears it down. `make demo` runs the headless lifecycle.
#   • DEVNET  — `make *-devnet` runs the SAME scripts against devnet using YOUR funded
#               keypair (see docs/devnet-deployment.md). Nothing here ever touches mainnet.
#
# Secrets come from the environment (copy .env.example -> .env and `set -a; . ./.env; set +a`,
# or pass vars inline). Real keypairs are never committed.

SHELL := /bin/bash
YARN  := corepack yarn@4.10.2

# Local-stack state (gitignored). The validator pid/ledger live here so subsequent
# `make demo`/`make create-markets` reuse the SAME on-chain state; `make stop` wipes this dir.
LOCALNET_DIR     := .localnet
VALIDATOR_PID    := $(LOCALNET_DIR)/validator.pid
VALIDATOR_LEDGER := $(LOCALNET_DIR)/ledger
LOCAL_RPC        := http://127.0.0.1:8899

# Local admin/deployer keypair. Lives OUTSIDE $(LOCALNET_DIR) on purpose: `make stop` does
# `rm -rf $(LOCALNET_DIR)`, so keeping it here gives you a STABLE local admin pubkey that
# survives stop/start. Generated on first `make dev` and reused after. Override with
# `LOCAL_DEPLOYER=/path/to/key.json make dev` (or export it). Note: the validator still starts
# with --reset, so each `make dev` re-inits Config from scratch — just signed by the same admin.
LOCAL_DEPLOYER   ?= $(HOME)/.config/solana/meridian-local-admin.json

# Default mock closes for the local demo markets — one per MAG7 ticker so `make dev` creates
# markets for all seven (each close drives that ticker's ±3/6/9% strikes). Override by passing
# your own on the command line, e.g. `make dev LOCAL_MOCK_CLOSES="MOCK_CLOSE_META=700"`.
# (The seeded demo wallet is still stocked only for META/AAPL/NVDA — see devStack.ts; the
# other markets are created and tradable, just without pre-funded demo inventory.)
LOCAL_MOCK_CLOSES := MOCK_CLOSE_AAPL=190 MOCK_CLOSE_MSFT=420 MOCK_CLOSE_GOOGL=170 \
	MOCK_CLOSE_AMZN=185 MOCK_CLOSE_NVDA=120 MOCK_CLOSE_META=680 MOCK_CLOSE_TSLA=340

# Trading-bot fleet (@meridian/traders). The config lists each bot (name, wallet, model);
# `make bots` spawns one background process per bot, logging to $(BOTS_LOG_DIR)/<name>.log.
BOTS_DIR     := packages/traders
BOTS_CONFIG  := $(BOTS_DIR)/bots.config.json
BOTS_LOG_DIR := $(BOTS_DIR)/logs
BOTS_PIDS    := $(BOTS_LOG_DIR)/bots.pids

# The persistent test-trader wallet paths (one per bot). The funding script creates any that
# don't exist yet and reuses the rest, so re-running is safe.
TRADERS_8 := ~/.config/solana/trader1.json,~/.config/solana/trader2.json,~/.config/solana/trader3.json,~/.config/solana/trader4.json,~/.config/solana/trader5.json,~/.config/solana/trader6.json,~/.config/solana/trader7.json,~/.config/solana/trader8.json

.DEFAULT_GOAL := help
.PHONY: help dev stop demo deploy bootstrap create-markets create-markets-live lifecycle \
        deploy-devnet bootstrap-devnet create-markets-devnet create-markets-live-devnet lifecycle-devnet \
        fund-traders fund-traders-devnet settle-due settle-due-devnet \
        bots bots-stop bots-logs \
        build build-demo test lint clean _require-devnet-keypair _validator-up

help: ## Show this help.
	@echo "Meridian — make targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | sort \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Local quick start:   make dev      (then: $(YARN) workspace @meridian/web dev)"
	@echo "Tear down:           make stop"
	@echo "Headless demo:       make demo"
	@echo "Devnet:              see docs/devnet-deployment.md"

# ── Local one-command stack ───────────────────────────────────────────────────

dev: _validator-up ## Bring up the full LOCAL stack (validator + deploy + markets + demo wallet + web env).
	@# Build the program to match the price mode, then deploy that .so. With PRICE_SOURCE=synthetic
	@# (the fake-price demo: bots trade a compressed synthetic day) build with demo-fast-settle so
	@# admin_settle / `make settle-due` is callable ~5 min after close instead of 1h. With real
	@# prices, build the default (1h-delay) program. Either way `make dev` deploys the matching .so,
	@# so you never run a separate build step.
	@if [ "$$PRICE_SOURCE" = "synthetic" ]; then \
	  echo "▶ Building program with demo-fast-settle (PRICE_SOURCE=synthetic)..."; \
	  anchor build -- --features demo-fast-settle; \
	else \
	  echo "▶ Building program (default settlement delay)..."; \
	  anchor build; \
	fi
	@echo "▶ Deploying + seeding the local stack..."
	@# Strikes seed via live (/api/history) → MOCK_CLOSE_* → hardcoded defaults. Set
	@# WEB_BASE_URL (e.g. your deployed dashboard) to pull the REAL last close; otherwise the
	@# MOCK_CLOSE_* defaults below are used. The local frontend isn't up yet during `make dev`,
	@# so localhost won't serve /api/history here — point WEB_BASE_URL at a reachable dashboard.
	@RPC_URL=$(LOCAL_RPC) DEPLOYER_KEYPAIR=$(abspath $(LOCAL_DEPLOYER)) \
	  $(LOCAL_MOCK_CLOSES) \
	  WEB_BASE_URL=$${WEB_BASE_URL:-} \
	  $(YARN) workspace @meridian/ops dev-up
	@echo ""
	@echo "✓ Local stack is up (RPC $(LOCAL_RPC))."
	@echo "  Frontend:  $(YARN) workspace @meridian/web dev   (reads packages/web/.env.local)"
	@echo "  Headless:  make demo"
	@echo "  Stop:      make stop"

_validator-up: ## (internal) Ensure a local validator is running + an ephemeral funded deployer exists.
	@mkdir -p $(LOCALNET_DIR) && chmod 700 $(LOCALNET_DIR)   # holds the local deployer + demo-wallet secrets
	@if [ -f $(VALIDATOR_PID) ] && kill -0 $$(cat $(VALIDATOR_PID)) 2>/dev/null; then \
	  echo "▶ Local validator already running (pid $$(cat $(VALIDATOR_PID)))."; \
	else \
	  echo "▶ Starting solana-test-validator..."; \
	  rm -rf $(VALIDATOR_LEDGER); \
	  nohup solana-test-validator --reset --quiet --ledger $(VALIDATOR_LEDGER) \
	    --enable-rpc-transaction-history --limit-ledger-size 100000000 \
	    > $(LOCALNET_DIR)/validator.log 2>&1 & echo $$! > $(VALIDATOR_PID); \
	  echo "  waiting for RPC..."; \
	  for i in $$(seq 1 60); do \
	    if solana --url $(LOCAL_RPC) cluster-version >/dev/null 2>&1; then break; fi; \
	    sleep 0.5; \
	  done; \
	  solana --url $(LOCAL_RPC) cluster-version >/dev/null 2>&1 \
	    || { echo "✗ validator did not come up (see $(LOCALNET_DIR)/validator.log)"; exit 1; }; \
	fi
	@if [ ! -f $(LOCAL_DEPLOYER) ]; then \
	  echo "▶ Generating a persistent local admin keypair at $(LOCAL_DEPLOYER)..."; \
	  mkdir -p "$$(dirname $(LOCAL_DEPLOYER))"; \
	  solana-keygen new --no-bip39-passphrase --silent --force --outfile $(LOCAL_DEPLOYER) >/dev/null; \
	else \
	  echo "▶ Reusing persistent local admin keypair at $(LOCAL_DEPLOYER)."; \
	fi
	@echo "▶ Funding the local deployer..."
	@DEPLOYER_PUBKEY=$$(solana-keygen pubkey $(LOCAL_DEPLOYER)); \
	  for i in 1 2 3; do \
	    solana --url $(LOCAL_RPC) airdrop 100 $$DEPLOYER_PUBKEY >/dev/null 2>&1 && break; \
	    echo "  airdrop attempt $$i failed; retrying..."; sleep 1; \
	  done; \
	  BAL=$$(solana --url $(LOCAL_RPC) balance $$DEPLOYER_PUBKEY 2>/dev/null | awk '{print $$1}'); \
	  if [ -z "$$BAL" ] || [ "$${BAL%%.*}" -lt 1 ] 2>/dev/null; then \
	    echo "✗ Local deployer is unfunded (balance: $${BAL:-unknown}). The validator airdrop failed —"; \
	    echo "  later deploy/bootstrap steps would fail with opaque insufficient-lamports errors."; \
	    echo "  Check $(LOCALNET_DIR)/validator.log, then re-run 'make dev'."; \
	    exit 1; \
	  fi; \
	  echo "  deployer funded ($$BAL SOL)"

stop: ## Stop the local validator and remove local-stack state.
	@if [ -f $(VALIDATOR_PID) ] && kill -0 $$(cat $(VALIDATOR_PID)) 2>/dev/null; then \
	  echo "▶ Stopping local validator (pid $$(cat $(VALIDATOR_PID)))..."; \
	  kill $$(cat $(VALIDATOR_PID)) 2>/dev/null || true; \
	  sleep 1; \
	else \
	  echo "▶ No tracked local validator running."; \
	fi
	@pkill -f 'solana-test-validator --reset --quiet --ledger $(VALIDATOR_LEDGER)' 2>/dev/null || true
	@rm -rf $(LOCALNET_DIR)
	@echo "✓ Local stack stopped + state removed."

demo: ## Run the headless lifecycle (create -> mint -> trade -> settle -> redeem) against the local stack.
	@if [ ! -f $(LOCALNET_DIR)/dev.json ]; then echo "✗ No local stack — run 'make dev' first."; exit 1; fi
	@RPC_URL=$(LOCAL_RPC) DEPLOYER_KEYPAIR=$(abspath $(LOCAL_DEPLOYER)) \
	  $(YARN) workspace @meridian/ops lifecycle

# ── Local ops steps (run against the running local validator individually) ─────

deploy: ## Deploy the program to the local validator (idempotent upgrade).
	@RPC_URL=$(LOCAL_RPC) DEPLOYER_KEYPAIR=$(abspath $(LOCAL_DEPLOYER)) $(YARN) workspace @meridian/ops deploy
bootstrap: ## Initialize Config + USDC on the local validator (idempotent).
	@RPC_URL=$(LOCAL_RPC) DEPLOYER_KEYPAIR=$(abspath $(LOCAL_DEPLOYER)) $(YARN) workspace @meridian/ops bootstrap
create-markets: ## Create the day's markets on the local validator (from MOCK_CLOSE_*).
	@RPC_URL=$(LOCAL_RPC) DEPLOYER_KEYPAIR=$(abspath $(LOCAL_DEPLOYER)) $(LOCAL_MOCK_CLOSES) \
	  $(YARN) workspace @meridian/ops create-markets
create-markets-live: ## Create markets seeded from REAL last close via /api/history (override WEB_BASE_URL).
	@RPC_URL=$(LOCAL_RPC) DEPLOYER_KEYPAIR=$(abspath $(LOCAL_DEPLOYER)) $(LOCAL_MOCK_CLOSES) \
	  WEB_BASE_URL=$${WEB_BASE_URL:-http://localhost:3000} LIVE_CLOSES=1 \
	  $(YARN) workspace @meridian/ops create-markets
settle-due: ## Close (settle) all open markets past their day, then write the demo bot report.
	@RPC_URL=$(LOCAL_RPC) DEPLOYER_KEYPAIR=$(abspath $(LOCAL_DEPLOYER)) \
	  WEB_BASE_URL=$${WEB_BASE_URL:-http://localhost:8788} \
	  $(YARN) workspace @meridian/ops settle-due
	@# Demo-only: after settling, snapshot how each bot did. Prints a leaderboard and writes a
	@# timestamped JSON artifact under $(LOCALNET_DIR)/reports/ (gitignored). Not a production
	@# concern — production wants a market-wide admin view, not this demo-bot roster. Best-effort:
	@# a report failure must not fail the settle.
	@RPC_URL=$(LOCAL_RPC) START_USDC=$${START_USDC:-1000} \
	  node scripts/bot-results.mjs \
	    --out "$(LOCALNET_DIR)/reports/bots-$$(date +%Y%m%d-%H%M%S).json" \
	  || echo "  (bot report skipped — see above; settlement itself succeeded)"
lifecycle: demo ## Alias for `make demo`.

claim-bot-winnings: ## Redeem every bot's won tokens (settled markets) into USDC on the local stack. DRY_RUN=1 to preview.
	@RPC_URL=$(LOCAL_RPC) \
	  node scripts/claim-bot-winnings.mjs $${DRY_RUN:+--dry-run}

fund-traders: ## Fund the persistent test traders (trader{1..8}.json) on the local stack.
	@if [ ! -f $(LOCALNET_DIR)/dev.json ]; then echo "✗ No local stack — run 'make dev' first."; exit 1; fi
	@RPC_URL=$(LOCAL_RPC) DEPLOYER_KEYPAIR=$(abspath $(LOCAL_DEPLOYER)) \
	  USDC_MINT=$$(node -e "console.log(require('./.localnet/dev.json').usdcMint)") \
	  TRADERS="$(TRADERS_8)" node scripts/fund-test-traders.mjs

# ── Devnet (operator-run; uses YOUR funded DEPLOYER_KEYPAIR + RPC_URL from .env) ─
# These deliberately do NOT default the keypair or airdrop. See docs/devnet-deployment.md.

deploy-devnet: _require-devnet-keypair ## Deploy the program to devnet (needs DEPLOYER_KEYPAIR + RPC_URL).
	@RPC_URL=$${RPC_URL:-https://api.devnet.solana.com} $(YARN) workspace @meridian/ops deploy
bootstrap-devnet: _require-devnet-keypair ## Initialize Config + USDC on devnet.
	@RPC_URL=$${RPC_URL:-https://api.devnet.solana.com} $(YARN) workspace @meridian/ops bootstrap
create-markets-devnet: _require-devnet-keypair ## Create the day's markets on devnet (from MOCK_CLOSE_*).
	@RPC_URL=$${RPC_URL:-https://api.devnet.solana.com} $(YARN) workspace @meridian/ops create-markets
create-markets-live-devnet: _require-devnet-keypair ## Create devnet markets seeded from REAL last close (set WEB_BASE_URL).
	@RPC_URL=$${RPC_URL:-https://api.devnet.solana.com} LIVE_CLOSES=1 \
	  WEB_BASE_URL=$${WEB_BASE_URL:?set WEB_BASE_URL to your deployed dashboard (for /api/history)} \
	  $(YARN) workspace @meridian/ops create-markets
fund-traders-devnet: _require-devnet-keypair ## Fund the persistent test traders (trader{1..8}.json) on devnet.
	@RPC_URL=$${RPC_URL:-https://api.devnet.solana.com} TRADERS="$(TRADERS_8)" node scripts/fund-test-traders.mjs
settle-due-devnet: _require-devnet-keypair ## Close due markets on devnet at the synthetic close (set WEB_BASE_URL).
	@RPC_URL=$${RPC_URL:-https://api.devnet.solana.com} \
	  WEB_BASE_URL=$${WEB_BASE_URL:?set WEB_BASE_URL to your deployed dashboard (for /api/price)} \
	  $(YARN) workspace @meridian/ops settle-due
lifecycle-devnet: _require-devnet-keypair ## Run the full lifecycle on devnet.
	@RPC_URL=$${RPC_URL:-https://api.devnet.solana.com} $(YARN) workspace @meridian/ops lifecycle
claim-bot-winnings-devnet: ## Redeem every bot's won tokens into USDC on devnet (bots self-sign). DRY_RUN=1 to preview.
	@RPC_URL=$${RPC_URL:-https://api.devnet.solana.com} \
	  node scripts/claim-bot-winnings.mjs $${DRY_RUN:+--dry-run}

_require-devnet-keypair:
	@if [ -z "$$DEPLOYER_KEYPAIR" ]; then \
	  echo "✗ DEPLOYER_KEYPAIR is not set. Point it at your funded devnet keypair file"; \
	  echo "  (copy .env.example -> .env, fill it in, then: set -a; . ./.env; set +a)."; \
	  echo "  See docs/devnet-deployment.md for the full walkthrough."; \
	  exit 1; \
	fi

# ── Trading bots (LLM fleet, @meridian/traders) ───────────────────────────────
# Requires RPC_URL + OPENROUTER_API_KEY in the environment (and funded trader wallets,
# e.g. `make fund-traders-devnet`). Each bot in $(BOTS_CONFIG) runs as its own process,
# so the fleet trades concurrently — one crashing doesn't stop the others.

bots: ## Spawn one background process per bot in packages/traders/bots.config.json.
	@if [ ! -f $(BOTS_CONFIG) ]; then \
	  echo "✗ No $(BOTS_CONFIG). Copy $(BOTS_DIR)/bots.config.example.json to it and edit."; exit 1; fi
	@if [ -z "$$OPENROUTER_API_KEY" ]; then echo "✗ OPENROUTER_API_KEY is not set."; exit 1; fi
	@if [ -z "$$RPC_URL" ]; then echo "✗ RPC_URL is not set (e.g. https://api.devnet.solana.com)."; exit 1; fi
	@# Refuse to start on top of a running fleet — that's how an OLD build ends up running
	@# next to a new one. Stop first so the rebuilt code is the only code running.
	@if pgrep -f 'dist/bin/run-bot.js' >/dev/null 2>&1; then \
	  echo "✗ Bots already running. Stop them first: make bots-stop"; exit 1; fi
	@# Build to completion BEFORE spawning, so no bot loads a half-written dist.
	@$(YARN) workspace @meridian/sdk build >/dev/null
	@$(YARN) workspace @meridian/traders build >/dev/null
	@mkdir -p $(BOTS_LOG_DIR)
	@: > $(BOTS_PIDS)
	@names=$$(node -e "for(const b of require('./$(BOTS_CONFIG)').bots) console.log(b.name)"); \
	for name in $$names; do \
	  node $(BOTS_DIR)/dist/bin/run-bot.js "$$name" > $(BOTS_LOG_DIR)/$$name.log 2>&1 & \
	  echo "$$!" >> $(BOTS_PIDS); \
	  echo "  ▸ started $$name (pid $$!) → $(BOTS_LOG_DIR)/$$name.log"; \
	done; \
	echo "✓ Fleet running. Watch them: make bots-logs   Stop them: make bots-stop"

bots-stop: ## Stop all running bots (recorded PIDs + any stray run-bot processes).
	@if [ -f $(BOTS_PIDS) ]; then \
	  while read -r pid; do \
	    if kill "$$pid" 2>/dev/null; then echo "  ▪ TERM pid $$pid"; fi; \
	  done < $(BOTS_PIDS); \
	  rm -f $(BOTS_PIDS); \
	fi
	@sleep 1
	@# Safety net: bots are spawned detached, so they can outlive the pids file or reparent to
	@# init. Sweep any survivor run-bot processes and force-kill them. Without this, a
	@# "stop + restart" can silently leave an OLD build running alongside the new one.
	@stray=$$(pgrep -f 'dist/bin/run-bot.js' 2>/dev/null || true); \
	if [ -n "$$stray" ]; then \
	  echo "  ▪ force-killing stray run-bot pids: $$stray"; \
	  kill -9 $$stray 2>/dev/null || true; sleep 1; \
	fi
	@if pgrep -f 'dist/bin/run-bot.js' >/dev/null 2>&1; then \
	  echo "✗ some bots still running — inspect: pgrep -fl run-bot.js"; exit 1; \
	else echo "✓ Fleet stopped (none running)."; fi

bots-logs: ## Tail the combined reasoning logs of all running bots.
	@if [ ! -d $(BOTS_LOG_DIR) ] || [ -z "$$(ls -A $(BOTS_LOG_DIR)/*.log 2>/dev/null)" ]; then \
	  echo "No logs yet in $(BOTS_LOG_DIR). Start the fleet with 'make bots'."; exit 0; fi
	@tail -n 40 -f $(BOTS_LOG_DIR)/*.log

# ── Build / test / lint / clean ───────────────────────────────────────────────

build: ## Build the program (.so) and the TS workspaces.
	anchor build
	$(YARN) workspace @meridian/sdk build
	$(YARN) workspace @meridian/automation build
	$(YARN) workspace @meridian/traders build

build-demo: ## Build the program with demo-fast-settle (5-min settle delay). For DEVNET demos —
	@# `make dev` builds this automatically when PRICE_SOURCE=synthetic, so you don't need this
	@# locally. Use it before a devnet synthetic-demo deploy (then: make deploy-devnet).
	anchor build -- --features demo-fast-settle
	@echo "✓ Built with demo-fast-settle. Re-deploy (make deploy-devnet) to apply, then"
	@echo "  'make settle-due-devnet' is callable ~5 min after close (vs the 1h default)."

test: ## Run the Rust tests + the off-chain workspace tests.
	cargo test
	$(YARN) test

lint: ## Prettier check across the TS workspaces.
	$(YARN) lint

clean: stop ## Stop the local stack and remove generated artifacts.
	@rm -f deploy-manifest.json
	@echo "✓ Cleaned (program build output left intact; use \`cargo clean\` / \`anchor clean\` for that)."
