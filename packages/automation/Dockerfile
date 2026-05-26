# Meridian automation service — one-shot job runner.
#
# The morning and settlement jobs are one-shot CLIs (run once, exit; "no resident
# scheduler"). This image bundles them with their deps; the droplet's host cron runs the
# container per schedule:  docker run --rm --env-file <file> meridian-automation <bin>
# e.g.  docker run --rm --env-file /etc/meridian/automation.env meridian-automation meridian-run-settlement
#
# Multi-stage: build the workspace (SDK dist + automation dist) with the full toolchain,
# then ship only the runtime deps + compiled JS on a slim node image.

# ── build stage ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

# Yarn 4 via corepack (matches the repo's packageManager / CI).
RUN corepack enable

# Copy the workspace manifests first for layer-cached installs.
COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/sdk/package.json packages/sdk/
COPY packages/automation/package.json packages/automation/

# Install the SDK + automation workspaces. The Pyth client (`@pythnetwork/hermes-client`,
# `@pythnetwork/pyth-solana-receiver`) is a regular dependency of @meridian/automation, so
# `workspaces focus` installs it and its transitive deps (e.g. axios) into the image. Other
# workspaces (web/ops/e2e) are not copied, so yarn installs only what these two need.
RUN corepack yarn@4.10.2 workspaces focus @meridian/sdk @meridian/automation

# Patch the Pyth Receiver SDK's published ESM and CJS builds so Node 20 can load it. The
# receiver ships broken imports in both formats:
#
#   1. `solana-utils/.../jito.{mjs,cjs}` pull in `jito-ts`, which pins a stale nested
#      `@solana/web3.js` that's incompatible with the modern `rpc-websockets` we resolve at
#      the top level — `require("rpc-websockets/dist/lib/client")` hits
#      ERR_PACKAGE_PATH_NOT_EXPORTED. The ESM jito.mjs additionally has an extension-less
#      `from "jito-ts/dist/sdk/block-engine/types"` that Node ESM rejects outright. We *never
#      use Jito* (no jitoTipLamports), so replace both jito files with stubs that export the
#      same names. `buildJitoTipInstruction` (pure, web3.js only) is the only function the
#      receiver's build code actually calls and stays functional; `sendTransactionsJito`
#      throws if called so a future opt-in surfaces clearly instead of importing badly.
#   2. `pyth-solana-receiver/.../vaa.mjs` does `from "@coral-xyz/anchor/dist/cjs/utils/bytes"`
#      (directory import, no /index.js) — Node ESM rejects directory imports; CJS require is
#      permissive about them, so only the .mjs needs a sed.
#
# Patching BOTH formats matters: @meridian/sdk is built as CJS, so its lazy
# `await import("@pythnetwork/pyth-solana-receiver")` downlevels to a plain `require()` and
# resolves the receiver's CJS path. Done after `yarn workspaces focus` against whatever
# versions yarn resolved (the receiver pins solana-utils@0.6.0 — `npm view
# @pythnetwork/pyth-solana-receiver dependencies` — so the surfaces are stable across builds).
COPY packages/automation/deploy/pyth-receiver-jito-stub.mjs /tmp/pyth-receiver-jito-stub.mjs
COPY packages/automation/deploy/pyth-receiver-jito-stub.cjs /tmp/pyth-receiver-jito-stub.cjs
# Patch the Pyth Receiver SDK BOTH paths — the SDK is compiled to CJS so the lazy
# `await import("@pythnetwork/pyth-solana-receiver")` downlevels to a plain `require()`, which
# resolves the CJS tree. Stub jito on both sides; sed-fix vaa.mjs's extension-less directory
# import (CJS require is permissive about that so no CJS sed needed).
RUN set -eu; \
    JITO_MJS=node_modules/@pythnetwork/solana-utils/dist/esm/jito.mjs; \
    JITO_CJS=node_modules/@pythnetwork/solana-utils/dist/cjs/jito.cjs; \
    VAA_MJS=node_modules/@pythnetwork/pyth-solana-receiver/dist/esm/vaa.mjs; \
    test -f "$JITO_MJS"; \
    test -f "$JITO_CJS"; \
    test -f "$VAA_MJS"; \
    cp /tmp/pyth-receiver-jito-stub.mjs "$JITO_MJS"; \
    cp /tmp/pyth-receiver-jito-stub.cjs "$JITO_CJS"; \
    sed -i 's|from "@coral-xyz/anchor/dist/cjs/utils/bytes"|from "@coral-xyz/anchor/dist/cjs/utils/bytes/index.js"|' "$VAA_MJS"; \
    rm /tmp/pyth-receiver-jito-stub.mjs /tmp/pyth-receiver-jito-stub.cjs

# Build SDK (automation imports its built dist), then automation.
COPY packages/sdk/ packages/sdk/
COPY packages/automation/ packages/automation/
RUN corepack yarn@4.10.2 workspace @meridian/sdk build && \
    corepack yarn@4.10.2 workspace @meridian/automation build

# ── runtime stage ────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The built workspace + node_modules (incl. the symlinked workspace deps + Pyth peers).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=build /app/packages/sdk/package.json ./packages/sdk/package.json
COPY --from=build /app/packages/automation/dist ./packages/automation/dist
COPY --from=build /app/packages/automation/package.json ./packages/automation/package.json

# Expose the two compiled job entrypoints as PATH commands. `yarn workspaces focus` does
# not create node_modules/.bin symlinks for the focused package's own bins, so we wrap the
# built dist files directly (they have `#!/usr/bin/env node` shebangs).
RUN printf '#!/bin/sh\nexec node /app/packages/automation/dist/bin/run-morning.js "$@"\n' \
      > /usr/local/bin/meridian-run-morning && \
    printf '#!/bin/sh\nexec node /app/packages/automation/dist/bin/run-settlement.js "$@"\n' \
      > /usr/local/bin/meridian-run-settlement && \
    chmod +x /usr/local/bin/meridian-run-morning /usr/local/bin/meridian-run-settlement

# Run as non-root. The keypair/RPC/feeds all arrive via --env-file at runtime; nothing
# secret is baked into the image.
USER node

# Reset the base node image's ENTRYPOINT (docker-entrypoint.sh) so the cron command runs
# the named bin directly via PATH, e.g.
#   docker run --rm --env-file <f> meridian-automation meridian-run-settlement
ENTRYPOINT []
# Default (no command) shows which bins exist.
CMD ["sh", "-c", "echo 'specify a job: meridian-run-morning | meridian-run-settlement' >&2; exit 64"]
