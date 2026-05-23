/**
 * Tool: the bot's wallet balance.
 *
 * Reports the spendable USDC balance (the collateral every wager uses) plus any open
 * Yes/No token positions the bot holds across the currently open markets. USDC lives in a
 * single ATA shared across markets, so it's reported once; positions are per-market, so we
 * scan the open markets and list the ones where the bot holds a non-zero Yes or No balance.
 * SOL (for fees) is included too, since a bot with no SOL can't transact.
 */

import { tool, type StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { fetchMarket, fetchUserPosition } from "@meridian/sdk";
import type { BotContext } from "../context";
import { discoverOpenMarkets } from "../context";
import { unitsToAmount, round } from "../format";

const schema = z.object({});

export function makeWalletBalanceTool(
  ctx: BotContext
): StructuredToolInterface {
  return tool(
    async () => {
      const { chain, usdcMint } = ctx;
      const solLamports = await chain.connection.getBalance(chain.pubkey);
      const markets = await discoverOpenMarkets(chain.program);

      let usdc = 0;
      const positions: {
        symbol: string;
        strike: number;
        yes: number;
        no: number;
      }[] = [];
      for (const m of markets) {
        const market = await fetchMarket(chain.program, m.address);
        if (!market) continue;
        const pos = await fetchUserPosition(
          chain.connection,
          chain.pubkey,
          market,
          usdcMint
        );
        // USDC is the same ATA for every market; capture it once.
        usdc = unitsToAmount(pos.usdc);
        const yes = unitsToAmount(pos.yes);
        const no = unitsToAmount(pos.no);
        if (yes > 0 || no > 0) {
          positions.push({
            symbol: m.symbol,
            strike: unitsToAmount(m.strike),
            yes: round(yes),
            no: round(no),
          });
        }
      }

      return JSON.stringify({
        wallet: chain.pubkey.toBase58(),
        sol: round(solLamports / LAMPORTS_PER_SOL, 4),
        usdc: round(usdc),
        positions,
      });
    },
    {
      name: "get_wallet_balance",
      description:
        "Get this bot's wallet balance: spendable USDC (your trading collateral), SOL " +
        "for fees, and any open Yes/No positions you hold per market.",
      schema,
    }
  );
}
