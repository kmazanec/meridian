// CJS counterpart of pyth-receiver-jito-stub.mjs — replaces
// `@pythnetwork/solana-utils/dist/cjs/jito.cjs` at image build. The SDK is compiled to CJS,
// so its lazy `await import("@pythnetwork/pyth-solana-receiver")` is downleveled to a plain
// `require()`, which resolves the receiver's CJS path → solana-utils' CJS jito.cjs →
// jito-ts → a stale nested @solana/web3.js with a `require("rpc-websockets/dist/lib/client")`
// the modern rpc-websockets no longer exports (ERR_PACKAGE_PATH_NOT_EXPORTED). We don't use
// Jito, so stub the file out so jito-ts is never loaded. Same export surface as the upstream
// jito.cjs; only `buildJitoTipInstruction` is genuinely callable (pure web3.js).
"use strict";

const { PublicKey, SystemProgram } = require("@solana/web3.js");

const TIP_ACCOUNTS = [
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
];

function getRandomTipAccount() {
  const i = Math.floor(Math.random() * TIP_ACCOUNTS.length);
  return new PublicKey(TIP_ACCOUNTS[i]);
}

function buildJitoTipInstruction(payer, lamports) {
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: getRandomTipAccount(),
    lamports,
  });
}

async function sendTransactionsJito() {
  throw new Error(
    "Jito send path is not available in this build (jito.cjs was stubbed out to avoid " +
      "an incompatible nested @solana/web3.js in jito-ts)."
  );
}

module.exports = {
  TIP_ACCOUNTS,
  getRandomTipAccount,
  buildJitoTipInstruction,
  sendTransactionsJito,
};
