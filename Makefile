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

# Local-stack state (gitignored). The validator pid/ledger and the ephemeral local deployer
# keypair live here so subsequent `make demo`/`make create-markets` reuse the SAME admin that
# initialized Config.
LOCALNET_DIR     := .localnet
VALIDATOR_PID    := $(LOCALNET_DIR)/validator.pid
VALIDATOR_LEDGER := $(LOCALNET_DIR)/ledger
LOCAL_DEPLOYER   := $(LOCALNET_DIR)/deployer.json
LOCAL_RPC        := http://127.0.0.1:8899

# Default mock closes for the local demo markets — one per MAG7 ticker so `make dev` creates
# markets for all seven (each close drives that ticker's ±3/6/9% strikes). Override by passing
# your own on the command line, e.g. `make dev LOCAL_MOCK_CLOSES="MOCK_CLOSE_META=700"`.
# (The seeded demo wallet is still stocked only for META/AAPL/NVDA — see devStack.ts; the
# other markets are created and tradable, just without pre-funded demo inventory.)
LOCAL_MOCK_CLOSES := MOCK_CLOSE_AAPL=190 MOCK_CLOSE_MSFT=420 MOCK_CLOSE_GOOGL=170 \
	MOCK_CLOSE_AMZN=185 MOCK_CLOSE_NVDA=120 MOCK_CLOSE_META=680 MOCK_CLOSE_TSLA=340

.DEFAULT_GOAL := help
.PHONY: help dev stop demo deploy bootstrap create-markets lifecycle \
        deploy-devnet bootstrap-devnet create-markets-devnet lifecycle-devnet \
        build test lint clean _require-devnet-keypair _validator-up

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
	@echo "▶ Deploying + seeding the local stack..."
	@RPC_URL=$(LOCAL_RPC) DEPLOYER_KEYPAIR=$(abspath $(LOCAL_DEPLOYER)) \
	  $(LOCAL_MOCK_CLOSES) \
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
	  echo "▶ Generating an ephemeral local deployer keypair..."; \
	  solana-keygen new --no-bip39-passphrase --silent --force --outfile $(LOCAL_DEPLOYER) >/dev/null; \
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
	@if [ ! -f $(LOCAL_DEPLOYER) ]; then echo "✗ No local stack — run 'make dev' first."; exit 1; fi
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
lifecycle: demo ## Alias for `make demo`.

# ── Devnet (operator-run; uses YOUR funded DEPLOYER_KEYPAIR + RPC_URL from .env) ─
# These deliberately do NOT default the keypair or airdrop. See docs/devnet-deployment.md.

deploy-devnet: _require-devnet-keypair ## Deploy the program to devnet (needs DEPLOYER_KEYPAIR + RPC_URL).
	@RPC_URL=$${RPC_URL:-https://api.devnet.solana.com} $(YARN) workspace @meridian/ops deploy
bootstrap-devnet: _require-devnet-keypair ## Initialize Config + USDC on devnet.
	@RPC_URL=$${RPC_URL:-https://api.devnet.solana.com} $(YARN) workspace @meridian/ops bootstrap
create-markets-devnet: _require-devnet-keypair ## Create the day's markets on devnet (from MOCK_CLOSE_*).
	@RPC_URL=$${RPC_URL:-https://api.devnet.solana.com} $(YARN) workspace @meridian/ops create-markets
lifecycle-devnet: _require-devnet-keypair ## Run the full lifecycle on devnet.
	@RPC_URL=$${RPC_URL:-https://api.devnet.solana.com} $(YARN) workspace @meridian/ops lifecycle

_require-devnet-keypair:
	@if [ -z "$$DEPLOYER_KEYPAIR" ]; then \
	  echo "✗ DEPLOYER_KEYPAIR is not set. Point it at your funded devnet keypair file"; \
	  echo "  (copy .env.example -> .env, fill it in, then: set -a; . ./.env; set +a)."; \
	  echo "  See docs/devnet-deployment.md for the full walkthrough."; \
	  exit 1; \
	fi

# ── Build / test / lint / clean ───────────────────────────────────────────────

build: ## Build the program (.so) and the TS workspaces.
	anchor build
	$(YARN) workspace @meridian/sdk build
	$(YARN) workspace @meridian/automation build

test: ## Run the Rust tests + the off-chain workspace tests.
	cargo test
	$(YARN) test

lint: ## Prettier check across the TS workspaces.
	$(YARN) lint

clean: stop ## Stop the local stack and remove generated artifacts.
	@rm -f deploy-manifest.json
	@echo "✓ Cleaned (program build output left intact; use \`cargo clean\` / \`anchor clean\` for that)."
