/**
 * Transaction send + confirm helpers that confirm by **HTTP polling**
 * (`getSignatureStatuses`), not the WebSocket `signatureSubscribe` that web3.js's
 * `sendAndConfirmTransaction` / `Connection.confirmTransaction` use under the hood.
 *
 * Many RPC endpoints (Alchemy's standard Solana endpoints, the public devnet endpoint
 * behind some networks, plain HTTP-only providers) don't expose `signatureSubscribe`, so
 * the subscribe path floods the logs with `-32601 Method 'signatureSubscribe' not found`
 * and only *then* falls back to slow polling. We poll directly: deterministic, no WS
 * dependency, and quiet.
 *
 * This is the single home for confirm logic across the repo. The trading bots, the e2e
 * `Fixture`, the ops bins (create-markets / settle / lifecycle / deploy / bootstrap), and
 * the standalone scripts all confirm through here, so the WS-vs-polling choice can't drift
 * back per-caller again.
 */

import {
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

/** Whether an error looks like RPC rate-limiting (HTTP 429) worth backing off on. */
export function isRateLimited(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("429") || msg.includes("too many requests");
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A jittered backoff delay (ms) for a rate-limited retry. The window grows linearly from
 * `minMs` (attempt 0) toward `maxMs` (attempt ≥3), and the returned delay is a uniform
 * random pick inside that window. The randomness scatters a whole fleet's retries across
 * the window instead of having them all wake at the same instant and re-collide. Exported
 * for unit testing.
 */
export function rateLimitBackoffMs(
  attempt: number,
  minMs: number,
  maxMs: number
): number {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  // Widen the ceiling with each attempt (25% of the span per attempt, capped at hi) so
  // later retries can wait longer, while the floor stays at `lo` to keep the jitter window
  // wide.
  const ceiling = Math.min(hi, lo + (hi - lo) * (attempt * 0.25 + 0.25));
  return Math.round(lo + Math.random() * (ceiling - lo));
}

export interface SendAndConfirmOptions {
  /** Co-signers beyond the fee payer (e.g. a new account being created). */
  signers?: Keypair[];
  /** Max 429 backoff-retries on the *send* (before a signature exists). Default 4. */
  retries?: number;
  /** Lower bound of the first retry's wait window (ms). Default 10000. */
  backoffMinMs?: number;
  /** Upper bound the wait window grows to on later retries (ms). Default 30000. */
  backoffMaxMs?: number;
  /** Poll interval while confirming (ms). Default 1000. */
  pollIntervalMs?: number;
}

/**
 * Build, sign, submit, and confirm one transaction — confirming by HTTP polling.
 *
 * The send phase is retried on 429s: until `sendRawTransaction` returns a signature
 * nothing has landed, so a backoff + re-send can't double-apply the instructions. Once a
 * signature exists we never re-send — the confirm phase only polls (swallowing transient
 * 429s on the status read) and is bounded by the blockhash's `lastValidBlockHeight`.
 */
export async function sendAndConfirm(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  opts: SendAndConfirmOptions = {}
): Promise<string> {
  const signers = opts.signers ?? [];
  const retries = opts.retries ?? 4;
  const backoffMinMs = opts.backoffMinMs ?? 10_000;
  const backoffMaxMs = opts.backoffMaxMs ?? 30_000;

  // Phase 1: get the tx on-chain. Retrying here is safe (no signature yet → nothing landed).
  let signature: string;
  let lastValidBlockHeight: number;
  let attempt = 0;
  for (;;) {
    try {
      const sent = await sendOnce(connection, payer, instructions, signers);
      signature = sent.signature;
      lastValidBlockHeight = sent.lastValidBlockHeight;
      break;
    } catch (err) {
      if (!isRateLimited(err) || attempt >= retries) throw err;
      await sleep(rateLimitBackoffMs(attempt, backoffMinMs, backoffMaxMs));
      attempt++;
    }
  }

  // Phase 2: confirm by polling. Already sent — never re-send on a 429 here.
  return confirmSignature(connection, signature, lastValidBlockHeight, {
    pollIntervalMs: opts.pollIntervalMs,
  });
}

/** Build, sign, and submit one transaction with a fresh blockhash; no confirmation. */
async function sendOnce(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  signers: Keypair[]
): Promise<{ signature: string; lastValidBlockHeight: number }> {
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: payer.publicKey,
    blockhash,
    lastValidBlockHeight,
  });
  for (const ix of instructions) tx.add(ix);
  tx.sign(payer, ...signers);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
  });
  return { signature, lastValidBlockHeight };
}

/**
 * Confirm an already-sent transaction by polling `getSignatureStatuses` until it reaches
 * `confirmed`/`finalized`, the chain passes `lastValidBlockHeight` (expired), or the tx
 * reports an error. A transient rate-limit on the status read is swallowed and retried; a
 * program error or expiry is terminal.
 */
export async function confirmSignature(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  opts: { pollIntervalMs?: number } = {}
): Promise<string> {
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  for (;;) {
    try {
      const { value } = await connection.getSignatureStatuses([signature]);
      const status = value[0];
      if (status?.err) {
        throw new Error(
          `transaction ${signature} failed: ${JSON.stringify(status.err)}`
        );
      }
      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      ) {
        return signature;
      }
      const height = await connection.getBlockHeight("confirmed");
      if (height > lastValidBlockHeight) {
        throw new Error(
          `transaction ${signature} expired (block height ${height} > ${lastValidBlockHeight})`
        );
      }
    } catch (err) {
      // A program error / expiry is terminal; a rate-limit on the status read is not.
      if (!isRateLimited(err)) throw err;
    }
    await sleep(pollIntervalMs);
  }
}
