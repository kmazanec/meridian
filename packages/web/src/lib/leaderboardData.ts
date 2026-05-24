import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { unpackAccount } from "@solana/spl-token";
import { ata, fetchMarket } from "@meridian/sdk";
import type { DiscoveredMarket } from "./discovery";
import type { BookMap } from "./marketStats";
import { yesMarkFor } from "./marketStats";
import type {
  LeaderboardInputs,
  MarketHolding,
} from "./leaderboard";

/**
 * RPC discovery for the admin leaderboard — the impure half, kept out of leaderboard.ts so the
 * accounting core stays unit-testable without a connection. Given the (already-polled) markets
 * + books, this resolves the missing pieces: each market's mints, the top-N holders of those
 * mints (and the wallet behind each token account), and those wallets' USDC balances. The
 * result is exactly the {@link LeaderboardInputs} the pure fold consumes.
 *
 * Discovery is intentionally top-N (getTokenLargestAccounts) rather than an exhaustive
 * getProgramAccounts-by-mint scan: one cheap call per mint, no devnet rate-limit risk, at the
 * cost of excluding long-tail/dust holders.
 */

/** How many holders to pull per mint side. getTokenLargestAccounts caps at 20. */
const TOP_N = 20;

/** getMultipleAccountsInfo rejects > 100 keys per call; chunk to stay under the limit. */
const MAX_MULTI = 100;

export async function getMultipleAccountsChunked(
  connection: Connection,
  keys: PublicKey[]
): Promise<(Awaited<ReturnType<Connection["getMultipleAccountsInfo"]>>[number])[]> {
  const out: (Awaited<ReturnType<Connection["getMultipleAccountsInfo"]>>[number])[] = [];
  for (let i = 0; i < keys.length; i += MAX_MULTI) {
    const batch = keys.slice(i, i + MAX_MULTI);
    out.push(...(await connection.getMultipleAccountsInfo(batch)));
  }
  return out;
}

interface MintInfo {
  yesMint: PublicKey;
  noMint: PublicKey;
}

/** Fetch each market's Yes/No mints (DiscoveredMarket doesn't carry them). */
export async function marketMints(
  program: Parameters<typeof fetchMarket>[0],
  markets: DiscoveredMarket[]
): Promise<Map<string, MintInfo>> {
  const out = new Map<string, MintInfo>();
  const fetched = await Promise.all(
    markets.map((m) => fetchMarket(program, m.address))
  );
  markets.forEach((m, i) => {
    const acc = fetched[i];
    if (acc) out.set(m.address.toBase58(), { yesMint: acc.yesMint, noMint: acc.noMint });
  });
  return out;
}

/**
 * Top holders of one mint, resolved to owner wallets. getTokenLargestAccounts returns token
 * *account* addresses; we then read those accounts to recover each `.owner`.
 */
export async function topHolders(
  connection: Connection,
  mint: PublicKey
): Promise<{ owner: PublicKey; amount: BN }[]> {
  const largest = await connection.getTokenLargestAccounts(mint);
  const accounts = largest.value
    .filter((v) => v.amount && v.amount !== "0")
    .slice(0, TOP_N);
  if (accounts.length === 0) return [];

  const infos = await connection.getMultipleAccountsInfo(
    accounts.map((a) => a.address)
  );
  const holders: { owner: PublicKey; amount: BN }[] = [];
  infos.forEach((info, i) => {
    if (!info) return; // closed/missing → skip
    try {
      const decoded = unpackAccount(accounts[i].address, info);
      holders.push({
        owner: decoded.owner,
        amount: new BN(decoded.amount.toString()),
      });
    } catch {
      // not a token account / undecodable → skip
    }
  });
  return holders;
}

/** Batched USDC balances for a set of owners (their USDC ATA; 0 if absent). */
export async function ownerUsdcBalances(
  connection: Connection,
  owners: PublicKey[],
  usdcMint: PublicKey
): Promise<Map<string, BN>> {
  const out = new Map<string, BN>();
  if (owners.length === 0) return out;
  const atas = owners.map((o) => ata(usdcMint, o));
  const infos = await getMultipleAccountsChunked(connection, atas);
  owners.forEach((o, i) => {
    const info = infos[i];
    let bal = new BN(0);
    if (info) {
      try {
        bal = new BN(unpackAccount(atas[i], info).amount.toString());
      } catch {
        /* not a token account → 0 */
      }
    }
    out.set(o.toBase58(), bal);
  });
  return out;
}

/**
 * Assemble the full {@link LeaderboardInputs} from chain state. `markets` and `books` come from
 * the shared ChainDataProvider polls (free); only the holder/balance reads below are new RPC,
 * and only run when an admin opens the panel.
 */
export async function loadLeaderboardInputs(opts: {
  program: Parameters<typeof fetchMarket>[0];
  connection: Connection;
  markets: DiscoveredMarket[];
  books: BookMap;
  usdcMint: PublicKey;
}): Promise<LeaderboardInputs> {
  const { program, connection, markets, books, usdcMint } = opts;

  const mints = await marketMints(program, markets);

  // Discover holders per market side, building holdingsByOwner + the owner set.
  const holdingsByOwner = new Map<string, MarketHolding[]>();
  const owners = new Set<string>();
  const ownerKeys = new Map<string, PublicKey>();
  const addHolding = (owner: PublicKey, h: MarketHolding) => {
    const k = owner.toBase58();
    owners.add(k);
    ownerKeys.set(k, owner);
    const list = holdingsByOwner.get(k);
    if (list) list.push(h);
    else holdingsByOwner.set(k, [h]);
  };

  for (const m of markets) {
    const mi = mints.get(m.address.toBase58());
    if (!mi) continue;
    const [yes, no] = await Promise.all([
      topHolders(connection, mi.yesMint),
      topHolders(connection, mi.noMint),
    ]);
    for (const h of yes)
      addHolding(h.owner, { market: m.address.toBase58(), side: "yes", amount: h.amount });
    for (const h of no)
      addHolding(h.owner, { market: m.address.toBase58(), side: "no", amount: h.amount });
  }

  // Order owners also count (a wallet may have only resting orders, no token holdings).
  for (const m of markets) {
    const book = books.get(m.orderBook.toBase58());
    if (!book) continue;
    for (const o of [...book.bids, ...book.asks]) {
      const k = o.owner.toBase58();
      owners.add(k);
      ownerKeys.set(k, o.owner);
    }
  }

  const ownerUsdc = await ownerUsdcBalances(
    connection,
    [...owners].map((k) => ownerKeys.get(k)!),
    usdcMint
  );

  const yesMarkByMarket = new Map<string, BN | null>(
    markets.map((m) => [m.address.toBase58(), yesMarkFor(m, books)])
  );

  return { markets, books, ownerUsdc, holdingsByOwner, yesMarkByMarket };
}

/** Top holders (YES + NO) of one market, for the drilldown. */
export async function loadMarketHolders(opts: {
  program: Parameters<typeof fetchMarket>[0];
  connection: Connection;
  market: DiscoveredMarket;
}): Promise<{ owner: PublicKey; side: "yes" | "no"; amount: BN }[]> {
  const { program, connection, market } = opts;
  const acc = await fetchMarket(program, market.address);
  if (!acc) return [];
  const [yes, no] = await Promise.all([
    topHolders(connection, acc.yesMint),
    topHolders(connection, acc.noMint),
  ]);
  return [
    ...yes.map((h) => ({ owner: h.owner, side: "yes" as const, amount: h.amount })),
    ...no.map((h) => ({ owner: h.owner, side: "no" as const, amount: h.amount })),
  ];
}
