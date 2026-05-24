/**
 * The chain boundary for one bot.
 *
 * Wraps a Solana {@link Connection} + the bot's {@link Keypair} into a typed
 * {@link MeridianProgram} (so the SDK's instruction builders and account reads work), and
 * provides a `send` that signs with the bot's wallet and confirms with a light retry on
 * transient RPC failures — chiefly the 429 rate-limiting the web app already contends with
 * on the shared devnet endpoint. The bots never hand-roll Anchor encoding; they build
 * instructions via `@meridian/sdk` and submit them here.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { getProgram, fetchConfig, type MeridianProgram } from "@meridian/sdk";

/** Whether an error looks like RPC rate-limiting (HTTP 429) worth backing off on. */
function isRateLimited(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("429") || msg.includes("too many requests");
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A jittered backoff delay (ms) for a rate-limited retry. The window grows linearly from
 * `minMs` (attempt 0) toward `maxMs` (attempt ≥3), and the returned delay is a uniform random
 * pick inside that window. The randomness is the point: it scatters a whole fleet's retries
 * across the window instead of having them all wake at the same instant and re-collide.
 * Exported for unit testing.
 */
export function rateLimitBackoffMs(
  attempt: number,
  minMs: number,
  maxMs: number
): number {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  // Widen the ceiling with each attempt (25% of the span per attempt, capped at hi) so later
  // retries can wait longer, while the floor stays at `lo` to keep the jitter window wide.
  const ceiling = Math.min(hi, lo + (hi - lo) * (attempt * 0.25 + 0.25));
  return Math.round(lo + Math.random() * (ceiling - lo));
}

/** Minimal Anchor `Wallet` around a Keypair (matches the automation service's shape). */
function keypairWallet(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async (tx: Transaction) => {
      tx.partialSign(kp);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) => {
      for (const tx of txs) tx.partialSign(kp);
      return txs;
    },
  };
}

export class BotChain {
  readonly program: MeridianProgram;
  readonly connection: Connection;
  readonly keypair: Keypair;

  constructor(rpcUrl: string, keypair: Keypair) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.keypair = keypair;
    // connection + wallet provider: lets the program build instructions AND read accounts
    // (program.account.*) against this RPC. We send transactions ourselves in `send`.
    this.program = getProgram({
      connection: this.connection,
      publicKey: keypair.publicKey,
      wallet: keypairWallet(keypair),
    } as never);
  }

  /** The bot's public key (its trading identity / fee payer). */
  get pubkey(): PublicKey {
    return this.keypair.publicKey;
  }

  /**
   * Sign (with the bot wallet + any extra signers) and confirm one transaction. Retries a
   * few times on 429 rate-limiting; other errors throw immediately so a real program error
   * (insufficient funds, bad order) surfaces fast.
   *
   * The backoff is deliberately long AND jittered. On the shared devnet endpoint a whole fleet
   * tends to hit the limit at once; a short, fixed backoff just has every bot retry in lockstep
   * and re-trigger the limit (a thundering herd). So each 429 waits a *random* delay drawn from
   * a widening window — by default ~10s on the first retry up to ~30s — which both gives the
   * endpoint room and spreads the fleet's retries across time so they stop colliding. Tune via
   * {@link backoffMinMs}/{@link backoffMaxMs} (per-attempt window grows linearly to the max).
   */
  async send(
    instructions: TransactionInstruction[],
    extraSigners: Keypair[] = [],
    opts: {
      retries?: number;
      /** Lower bound of the first retry's wait window (ms). Default 10000. */
      backoffMinMs?: number;
      /** Upper bound the wait window grows to on later retries (ms). Default 30000. */
      backoffMaxMs?: number;
    } = {}
  ): Promise<string> {
    const retries = opts.retries ?? 4;
    const backoffMinMs = opts.backoffMinMs ?? 10_000;
    const backoffMaxMs = opts.backoffMaxMs ?? 30_000;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const tx = new Transaction();
        for (const ix of instructions) tx.add(ix);
        return await sendAndConfirmTransaction(this.connection, tx, [
          this.keypair,
          ...extraSigners,
        ]);
      } catch (err) {
        lastErr = err;
        if (!isRateLimited(err) || attempt === retries) throw err;
        await sleep(rateLimitBackoffMs(attempt, backoffMinMs, backoffMaxMs));
      }
    }
    throw lastErr;
  }

  /**
   * Resolve the collateral (USDC) mint: the explicit override if given, else the mint
   * recorded in the on-chain Config. Throws if neither is available.
   */
  async resolveUsdcMint(override?: string): Promise<PublicKey> {
    if (override) return new PublicKey(override);
    const config = await fetchConfig(this.program);
    if (!config) {
      throw new Error(
        "On-chain Config not found and USDC_MINT not set; cannot resolve the collateral mint."
      );
    }
    return config.usdcMint;
  }
}
