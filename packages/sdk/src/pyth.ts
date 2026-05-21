/**
 * Pyth / Hermes price-update helpers for settlement.
 *
 * Settlement is a **pull oracle** (ARCHITECTURE ADR-004): a client fetches a signed
 * price update from Pyth's Hermes service and posts it on-chain via the **Pyth Solana
 * Receiver**; `settle_market` then consumes the resulting `PriceUpdateV2` account.
 *
 * The two heavy/network pieces — Hermes fetch and the Receiver post — depend on Pyth's
 * SDKs (`@pythnetwork/hermes-client`, `@pythnetwork/pyth-solana-receiver`). Those are
 * declared as **optional peer dependencies** and imported lazily, so a consumer that only
 * builds instructions or derives PDAs never pays for them (and a browser bundle that does
 * not settle stays lean). The pure pieces below — the Receiver program id, the
 * `PriceUpdateV2` layout, and a fixture builder — have no such dependency and are always
 * available (used by tests and by anyone validating an update locally).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { MeridianProgram } from "./program";
import { settleMarket, type MarketId } from "./instructions";

/** The Pyth Solana Receiver program id — same on devnet and mainnet (ADR-004). */
export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"
);

/** Anchor account discriminator for `PriceUpdateV2` (must match `oracle.rs`). */
export const PRICE_UPDATE_V2_DISCRIMINATOR = Uint8Array.from([
  34, 241, 35, 99, 157, 126, 244, 205,
]);

const VERIFICATION_PARTIAL_TAG = 0;
const VERIFICATION_FULL_TAG = 1;

/** Default Hermes endpoint. */
export const DEFAULT_HERMES_URL = "https://hermes.pyth.network";

/** A normalized, signed price update fetched from Hermes. */
export interface HermesPriceUpdate {
  /** The 32-byte feed id (hex, no 0x), as Hermes returns it. */
  feedId: string;
  /** Signed price in native scale (`price × 10^exponent`). */
  price: bigint;
  /** Confidence interval, same scale as price. */
  conf: bigint;
  /** Base-10 exponent. */
  exponent: number;
  /** Publish time (unix seconds). */
  publishTime: number;
  /** The raw binary update(s) to post via the Receiver (base64 or hex per Hermes). */
  binary: { encoding: string; data: string[] };
}

/**
 * Fetch the latest signed price update for a feed from Hermes.
 *
 * Requires the optional peer dep `@pythnetwork/hermes-client` (imported lazily). The
 * returned `binary.data` is what {@link postPriceUpdate} posts on-chain.
 *
 * @param feedId 32-byte feed id (hex string, with or without `0x`).
 */
export async function fetchPriceUpdate(
  feedId: string,
  hermesUrl: string = DEFAULT_HERMES_URL
): Promise<HermesPriceUpdate> {
  const hermes = await import("@pythnetwork/hermes-client").catch(() => {
    throw new Error(
      "fetchPriceUpdate requires the optional peer dependency '@pythnetwork/hermes-client'. " +
        "Install it in the consuming app (it is not bundled into @meridian/sdk)."
    );
  });
  const client = new hermes.HermesClient(hermesUrl);
  const id = feedId.startsWith("0x") ? feedId.slice(2) : feedId;
  const res = await client.getLatestPriceUpdates([id]);
  const parsed = res?.parsed?.[0];
  if (!parsed || !res?.binary) {
    throw new Error(`Hermes returned no price for feed ${id}`);
  }
  // Hermes encodes price/conf as integer strings; guard against an unexpected decimal
  // or non-numeric value so the failure is a clear error, not a raw BigInt SyntaxError.
  const toBigInt = (v: string | number, field: string): bigint => {
    try {
      return BigInt(v);
    } catch {
      throw new Error(
        `Hermes returned a non-integer ${field} for feed ${id}: ${String(v)}`
      );
    }
  };
  return {
    feedId: parsed.id,
    price: toBigInt(parsed.price.price, "price"),
    conf: toBigInt(parsed.price.conf, "conf"),
    exponent: parsed.price.expo,
    publishTime: Number(parsed.price.publish_time),
    binary: res.binary,
  };
}

/**
 * Post a Hermes price update on-chain via the Pyth Solana Receiver and return the
 * resulting `PriceUpdateV2` account pubkey — usable directly as `settle_market`'s
 * `priceUpdate`.
 *
 * Requires the optional peer dep `@pythnetwork/pyth-solana-receiver` (imported lazily).
 * The `payer` signs and funds the post (and the ephemeral update account).
 *
 * @returns the price-update account pubkey and the signatures of the post transactions.
 */
export async function postPriceUpdate(
  connection: Connection,
  payer: Keypair,
  update: HermesPriceUpdate,
  opts: { skipPreflight?: boolean } = {}
): Promise<{ priceUpdateAccount: PublicKey; signatures: string[] }> {
  const mod = await import("@pythnetwork/pyth-solana-receiver").catch(() => {
    throw new Error(
      "postPriceUpdate requires the optional peer dependency " +
        "'@pythnetwork/pyth-solana-receiver'. Install it in the consuming app."
    );
  });
  // Minimal NodeWallet around the payer keypair (the receiver SDK expects a wallet).
  const wallet = {
    publicKey: payer.publicKey,
    payer,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signTransaction: async (tx: any) => {
      tx.partialSign ? tx.partialSign(payer) : tx.sign([payer]);
      return tx;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signAllTransactions: async (txs: any[]) => {
      for (const tx of txs)
        tx.partialSign ? tx.partialSign(payer) : tx.sign([payer]);
      return txs;
    },
  };
  const receiver = new mod.PythSolanaReceiver({
    connection,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wallet: wallet as any,
  });
  const builder = receiver.newTransactionBuilder({
    closeUpdateAccounts: false,
  });
  await builder.addPostPriceUpdates(update.binary.data);

  let priceUpdateAccount: PublicKey | undefined;
  await builder.addPriceConsumerInstructions(async (getPriceUpdateAccount) => {
    priceUpdateAccount = getPriceUpdateAccount(update.feedId);
    return [];
  });

  // Resolve the consumer account before sending, so a feed-id/format problem surfaces as
  // a clear error here rather than as an opaque on-chain WrongFeed from settle later.
  if (!priceUpdateAccount) {
    throw new Error(
      `Receiver did not yield a price-update account for feed ${update.feedId}. ` +
        "Check the feed id format matches what the Receiver expects, and that the " +
        "Hermes update actually carried this feed."
    );
  }

  const txs = await builder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: 0,
  });
  // Preflight is ON by default: a settlement post that would fail simulation should be
  // caught here, not silently submitted. Callers may opt out for known-flaky RPCs.
  const signatures = await receiver.provider.sendAll(txs, {
    skipPreflight: opts.skipPreflight ?? false,
  });
  return { priceUpdateAccount, signatures };
}

/**
 * Build the raw bytes of a `PriceUpdateV2` account exactly as the Pyth Receiver
 * serializes it and as the program's `oracle.rs` parser expects. Used by tests (inject
 * via `setAccount`) and by any consumer that needs a deterministic update without the
 * network — e.g. proving settlement logic against crypto-feed stand-ins.
 *
 * Layout (borsh):
 *   8  discriminator | 32 write_authority | verification_level (Full=1 byte tag,
 *   Partial=tag + num_signatures u8) | feed_id[32] | price i64 | conf u64 |
 *   exponent i32 | publish_time i64 | prev_publish_time i64 | ema_price i64 |
 *   ema_conf u64 | posted_slot u64
 */
export function buildPriceUpdateV2(params: {
  feedId: Uint8Array;
  price: bigint;
  conf: bigint;
  exponent: number;
  publishTime: bigint;
  /** Full verification (required by `settle_market`); default true. */
  fullVerification?: boolean;
  /**
   * For a Partial update (`fullVerification: false`), the `num_signatures` byte. A real
   * Receiver-posted Partial update always carries at least one guardian signature;
   * defaults to 5 (matching the program's own test fixtures) so the fixture is faithful.
   */
  numSignatures?: number;
  writeAuthority?: Uint8Array;
  prevPublishTime?: bigint;
  emaPrice?: bigint;
  emaConf?: bigint;
  postedSlot?: bigint;
}): Buffer {
  if (params.feedId.length !== 32) {
    throw new Error("feedId must be exactly 32 bytes");
  }
  const full = params.fullVerification ?? true;
  const parts: Buffer[] = [];
  parts.push(Buffer.from(PRICE_UPDATE_V2_DISCRIMINATOR));
  parts.push(Buffer.from(params.writeAuthority ?? new Uint8Array(32)));
  parts.push(
    Buffer.from(
      full
        ? [VERIFICATION_FULL_TAG]
        : [VERIFICATION_PARTIAL_TAG, params.numSignatures ?? 5]
    )
  );
  parts.push(Buffer.from(params.feedId));
  parts.push(i64le(params.price));
  parts.push(u64le(params.conf));
  parts.push(i32le(params.exponent));
  parts.push(i64le(params.publishTime));
  parts.push(i64le(params.prevPublishTime ?? BigInt(0)));
  parts.push(i64le(params.emaPrice ?? BigInt(0)));
  parts.push(u64le(params.emaConf ?? BigInt(0)));
  parts.push(u64le(params.postedSlot ?? BigInt(0)));
  return Buffer.concat(parts);
}

/**
 * End-to-end settlement via the pull oracle: fetch the feed from Hermes, post it via the
 * Receiver, then crank `settle_market` against the posted account. Requires both Pyth
 * optional peer deps. Returns the settle transaction signature.
 *
 * `feedIdHex` is the Hermes/per-cluster feed id (hex). It must match the market's
 * configured `Config.tickers[ticker].feed_id`, or `settle_market` rejects with WrongFeed.
 */
export async function settleWithPyth(
  program: MeridianProgram,
  connection: Connection,
  cranker: Keypair,
  market: MarketId | PublicKey,
  feedIdHex: string,
  hermesUrl: string = DEFAULT_HERMES_URL
): Promise<{ priceUpdateAccount: PublicKey; settleSignature: string }> {
  const update = await fetchPriceUpdate(feedIdHex, hermesUrl);
  const { priceUpdateAccount } = await postPriceUpdate(
    connection,
    cranker,
    update
  );
  const ix = await settleMarket(program, {
    cranker: cranker.publicKey,
    market,
    priceUpdate: priceUpdateAccount,
  });
  const tx = new Transaction().add(ix);
  // Preflight ON: a settle that would fail simulation (wrong feed, stale price, wide
  // confidence) should surface here, not be submitted blind.
  const settleSignature = await sendAndConfirmTransaction(connection, tx, [
    cranker,
  ]);
  return { priceUpdateAccount, settleSignature };
}

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

function i64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
}

function i32le(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(v);
  return b;
}
