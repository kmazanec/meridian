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
      await this.chain.send([createIx]);
      created = true;
    }

    // Ensure the order book exists (idempotent: init/grow only when absent). A market
    // whose book is already wired (Market.order_book set) needs neither step.
    const refreshed = await this.chain.fetchMarket(address);
    const bookWired =
      refreshed?.orderBook && !refreshed.orderBook.equals(PublicKey.default);
    if (!bookWired) {
      const initIx = await initOrderBook(this.chain.program, {
        payer: this.chain.payer,
        usdcMint: this.usdcMint,
        market,
      });
      await this.chain.send([initIx]);
      const growIx = await growOrderBook(this.chain.program, {
        payer: this.chain.payer,
        market,
      });
      await this.chain.send([growIx]);
    }

    return { market, created };
  }
}

/** SDK-backed discovery: list `Market` accounts through the chain client. */
export class SdkMarketDiscovery implements MarketDiscovery {
  constructor(private readonly chain: ChainClient) {}

  listMarkets(): Promise<{ address: PublicKey; account: MarketAccount }[]> {
    return this.chain.listMarkets();
  }
}
