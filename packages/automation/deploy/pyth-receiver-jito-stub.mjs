// Replacement for `@pythnetwork/solana-utils/dist/esm/jito.mjs`, applied by the automation
// Dockerfile after `yarn workspaces focus`. The upstream file does:
//
//   import { Bundle } from "jito-ts/dist/sdk/block-engine/types";
//
// which is an extension-less ESM import Node 20 rejects, AND jito-ts itself transitively
// pulls in a stale nested `@solana/web3.js` that's incompatible with the modern
// `rpc-websockets` we resolve at the top level (ERR_PACKAGE_PATH_NOT_EXPORTED). We never
// use Jito (no `jitoTipLamports` is ever passed), so the simplest correct fix is to replace
// jito.mjs with a stub that has the same exported names. `buildJitoTipInstruction` is the
// only Jito function the receiver's build code actually calls and it's pure (web3.js only),
// so it stays. `sendTransactionsJito` is preserved as an export but throws if invoked, so a
// future opt-in surfaces clearly instead of importing badly.
import { PublicKey, SystemProgram } from "@solana/web3.js";

export const TIP_ACCOUNTS = [
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
];

export function getRandomTipAccount() {
  const i = Math.floor(Math.random() * TIP_ACCOUNTS.length);
  return new PublicKey(TIP_ACCOUNTS[i]);
}

export function buildJitoTipInstruction(payer, lamports) {
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: getRandomTipAccount(),
    lamports,
  });
}

export async function sendTransactionsJito() {
  throw new Error(
    "Jito send path is not available in this build (jito.mjs was stubbed out to avoid " +
      "an incompatible nested @solana/web3.js in jito-ts)."
  );
}
