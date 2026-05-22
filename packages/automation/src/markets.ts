/**
 * Market provisioning and discovery.
 *
 * Provisioning wraps the three-instruction "make a tradeable market" flow from the SDK:
 * `create_strike_market`, then `init_order_book`, then `grow_order_book` (the order book
 * exceeds Solana's per-instruction realloc cap, so it is created in two steps — ROADMAP
 * concern #3). Discovery lists the program's `Market` accounts so the settlement job can
 * find open contracts to settle.
 *
 * Both are behind interfaces so the jobs are unit-testable with stubs; the SDK-backed
 * impls are exercised by the LiteSVM integration test.
 */

import {
  createStrikeMarket,
  initOrderBook,
  growOrderBook,
  marketPda,
  type MarketId,
  type MarketAccount,
} from "@meridian/sdk";
import { PublicKey } from "@solana/web3.js";
import type { ChainClient } from "./chain";

/** The result of provisioning one market. */
export interface ProvisionResult {
  market: MarketId;
  /** True if newly created; false if it already existed (idempotent re-run). */
  created: boolean;
}

/** Creates a fully tradeable market for a strike. */
export interface MarketProvisioner {
  provisionMarket(market: MarketId): Promise<ProvisionResult>;
}

/** Lists open markets that are due for settlement. */
export interface MarketDiscovery {
  /** All `Market` accounts the program owns, decoded. */
  listMarkets(): Promise<{ address: PublicKey; account: MarketAccount }[]>;
}

/**
 * SDK + ChainClient-backed provisioner. `create_strike_market` is admin-gated, so the
 * chain client's keypair must be the configured admin. If the market already exists
 * (a re-run of the morning job), the create is treated as a no-op and provisioning
 * proceeds idempotently to ensure the order book is present.
 */
export class SdkMarketProvisioner implements MarketProvisioner {
  constructor(
    private readonly chain: ChainClient,
    private readonly usdcMint: PublicKey
  ) {}

  async provisionMarket(market: MarketId): Promise<ProvisionResult> {
    const address = marketPda(market.ticker, market.strike, market.tradingDay);
    const existing = await this.chain.fetchMarket(address);

    let created = false;
    if (!existing) {
      const createIx = await createStrikeMarket(this.chain.program, {
        admin: this.chain.payer,
        usdcMint: this.usdcMint,
        market,
      });
      // Idempotent under a race / confirmation-timeout retry: if a concurrent runner (or a
      // prior attempt whose confirmation we missed) already created the market, the create
      // reverts MarketAlreadyExists — treat that as success and continue, rather than
      // failing+alerting a market that is in fact provisioned.
      created = await this.sendIdempotent([createIx]);
    }

    // Ensure the order book exists (idempotent: init/grow only when not yet wired). A market
    // whose book is already wired (Market.order_book set) needs neither step. The init/grow
    // sends are likewise tolerant of an "already done" revert from a concurrent runner.
    const refreshed = await this.chain.fetchMarket(address);
    const bookWired =
      refreshed?.orderBook && !refreshed.orderBook.equals(PublicKey.default);
    if (!bookWired) {
      const initIx = await initOrderBook(this.chain.program, {
        payer: this.chain.payer,
        usdcMint: this.usdcMint,
        market,
      });
      await this.sendIdempotent([initIx]);
      const growIx = await growOrderBook(this.chain.program, {
        payer: this.chain.payer,
        market,
      });
      await this.sendIdempotent([growIx]);
    }

    return { market, created };
  }

  /**
   * Send instructions, swallowing an "already exists / already initialized" revert as an
   * idempotent no-op. Returns true if the send actually applied, false if it was a no-op
   * because the target already existed. Any other error propagates.
   */
  private async sendIdempotent(
    instructions: Parameters<ChainClient["send"]>[0]
  ): Promise<boolean> {
    try {
      await this.chain.send(instructions);
      return true;
    } catch (err) {
      if (isAlreadyProvisioned(err)) return false;
      throw err;
    }
  }
}

// Anchor custom-error codes (6000 + ordinal, see programs/meridian/src/error.rs):
//   MarketAlreadyExists = 6005. Plus the SPL/Anchor "already initialized" account error a
//   racing init_order_book surfaces. Matched by name, msg, and the specific code forms.
const ALREADY_PROVISIONED_MARKERS = [
  "MarketAlreadyExists",
  "Market with these parameters already exists",
  "0x1775", // 6005 hex
  "Error Number: 6005",
  "already in use", // system program: account already initialized (init_order_book race)
  "AccountAlreadyInitialized",
];

/** True if a failed provisioning send means the target already exists (a safe no-op). */
function isAlreadyProvisioned(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return ALREADY_PROVISIONED_MARKERS.some((m) => msg.includes(m));
}

/** SDK-backed discovery: list `Market` accounts through the chain client. */
export class SdkMarketDiscovery implements MarketDiscovery {
  constructor(private readonly chain: ChainClient) {}

  listMarkets(): Promise<{ address: PublicKey; account: MarketAccount }[]> {
    return this.chain.listMarkets();
  }
}
