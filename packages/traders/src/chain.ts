/**
 * The chain boundary for one bot.
 *
 * Wraps a Solana {@link Connection} + the bot's {@link Keypair} into a typed
 * {@link MeridianProgram} (so the SDK's instruction builders and account reads work), and
 * provides a `send` that signs with the bot's wallet, submits, and confirms by HTTP polling
 * (not WebSocket `signatureSubscribe`, which several endpoints don't expose) with a 429-aware
 * retry on the *send* — the 429 rate-limiting the web app already contends with on shared
 * endpoints. The bots never hand-roll Anchor encoding; they build instructions via
 * `@meridian/sdk` and submit them here.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  getProgram,
  fetchConfig,
  sendAndConfirm,
  rateLimitBackoffMs,
  type MeridianProgram,
} from "@meridian/sdk";

// Re-exported from the SDK so the bots' confirm/backoff behavior is the one shared
// implementation (HTTP polling, not WebSocket signatureSubscribe). Kept exported here for
// the existing tests that import it from this module.
export { rateLimitBackoffMs };

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
    // Delegate to the SDK's shared send+confirm: 429-aware retry on the send (safe — no
    // signature exists yet), then HTTP-polling confirmation (no WebSocket signatureSubscribe).
    return sendAndConfirm(this.connection, this.keypair, instructions, {
      signers: extraSigners,
      retries: opts.retries,
      backoffMinMs: opts.backoffMinMs,
      backoffMaxMs: opts.backoffMaxMs,
    });
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
