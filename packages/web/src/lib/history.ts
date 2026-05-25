import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";

/**
 * Trade-history parsing. The program emits events (`OrderPlaced`, `OrderMatched`,
 * `PairMinted`, `Redeemed`, `OrderCancelled`); the history page reads the connected
 * wallet's transactions, decodes their program events, and renders the ones that
 * involve the user as a plain execution log. The decode (RPC + Anchor `EventParser`)
 * is wired in `useHistory`; the *mapping* from a decoded event to a log row is pure
 * and lives here so it can be unit-tested.
 */

export type HistoryKind =
  | "placed"
  | "matched"
  | "minted"
  | "redeemed"
  | "cancelled";

/**
 * What the `size` amount is denominated in. Yes-tokens (`"tok"`) for everything
 * that moves tokens; USDC (`"usdc"`) for a cancelled *bid*, whose escrow refund
 * is dollars, not tokens; `null` when we can't tell (a cancel whose original
 * `OrderPlaced` isn't in the fetched window — see {@link buildHistory}).
 */
export type HistoryAsset = "tok" | "usdc" | null;

export interface HistoryEntry {
  kind: HistoryKind;
  /** Transaction signature. */
  signature: string;
  /** Block time (unix seconds) if known. */
  blockTime: number | null;
  market: string;
  /** A short human description of the execution. */
  summary: string;
  /** Price in price scale, when the event carries one. */
  price: BN | null;
  /** Size/amount in base units, when the event carries one. */
  size: BN | null;
  /** What {@link size} is denominated in (drives the displayed unit). */
  asset: HistoryAsset;
  /**
   * Order sequence number, for a cancel — used to correlate back to the original
   * `OrderPlaced` (which carries the side) in {@link buildHistory}. Internal;
   * undefined for non-cancel kinds.
   */
  seq?: BN;
}

/** A decoded Anchor event: a name + a `data` record of fields. */
export interface DecodedEvent {
  name: string;
  data: Record<string, unknown>;
}

/** Context carried alongside each decoded event from the transaction. */
export interface EventContext {
  signature: string;
  blockTime: number | null;
}

function asKey(v: unknown): PublicKey | null {
  if (v instanceof PublicKey) return v;
  return null;
}

function asBN(v: unknown): BN | null {
  return BN.isBN(v) ? v : null;
}

/**
 * Map one decoded event to a history entry **for `user`**, or null if the event isn't
 * one we log or doesn't involve the user. Matching on the user keeps the log to the
 * connected wallet's own activity (the program emits events for both sides of a match).
 */
export function eventToEntry(
  event: DecodedEvent,
  ctx: EventContext,
  user: PublicKey
): HistoryEntry | null {
  const d = event.data;
  const market = asKey(d.market)?.toBase58() ?? "";
  const base = { signature: ctx.signature, blockTime: ctx.blockTime, market };

  switch (event.name) {
    case "PairMinted": {
      if (asKey(d.user)?.equals(user) !== true) return null;
      const amount = asBN(d.amount);
      return {
        ...base,
        kind: "minted",
        summary: "Minted a Yes/No pair",
        price: null,
        size: amount,
        asset: "tok",
      };
    }
    case "OrderPlaced": {
      if (asKey(d.owner)?.equals(user) !== true) return null;
      const side = Number(d.side) === 0 ? "Buy Yes" : "Sell Yes";
      return {
        ...base,
        kind: "placed",
        summary: `Placed order (${side})`,
        price: asBN(d.price),
        size: asBN(d.size),
        asset: "tok",
      };
    }
    case "OrderMatched": {
      const maker = asKey(d.maker);
      const taker = asKey(d.taker);
      const isUser =
        maker?.equals(user) === true || taker?.equals(user) === true;
      if (!isUser) return null;
      const role = taker?.equals(user) ? "as taker" : "as maker";
      return {
        ...base,
        kind: "matched",
        summary: `Filled ${role}`,
        price: asBN(d.price),
        size: asBN(d.fillSize),
        asset: "tok",
      };
    }
    case "Redeemed": {
      if (asKey(d.user)?.equals(user) !== true) return null;
      const won = d.won === true;
      return {
        ...base,
        kind: "redeemed",
        summary: won ? "Redeemed winning tokens" : "Burned losing tokens",
        price: null,
        size: asBN(d.tokensBurned),
        asset: "tok",
      };
    }
    case "OrderCancelled": {
      if (asKey(d.owner)?.equals(user) !== true) return null;
      return {
        ...base,
        kind: "cancelled",
        summary: "Cancelled an order",
        price: null,
        size: asBN(d.refunded),
        // The OrderCancelled event carries no side, so the refund's denomination
        // (USDC for a bid, tokens for an ask) is unknown here. buildHistory fills
        // this in by correlating with the original OrderPlaced via (market, seq).
        asset: null,
        seq: asBN(d.seq) ?? undefined,
      };
    }
    default:
      return null;
  }
}

/**
 * Map a batch of decoded events (with their tx context) to the user's history entries,
 * newest first. Events not involving the user, or not of a logged kind, are dropped.
 *
 * An `OrderCancelled` event carries no side, so on its own we can't tell whether the
 * refund is USDC (a cancelled bid) or Yes tokens (a cancelled ask). We recover it by
 * correlating with the order's `OrderPlaced` event — same `(market, seq)`, which the
 * place event tags with a side — across the whole batch. If the matching place event
 * isn't in the fetched window, the cancel's `asset` stays `null` and the UI shows a
 * denomination-neutral label rather than guess.
 */
export function buildHistory(
  events: { event: DecodedEvent; ctx: EventContext }[],
  user: PublicKey
): HistoryEntry[] {
  // (market, seq) -> denomination of that order's escrow refund. Built from the
  // user's own OrderPlaced events: bid (side 0) escrows USDC, ask (side 1) tokens.
  const refundAsset = new Map<string, HistoryAsset>();
  for (const { event } of events) {
    if (event.name !== "OrderPlaced") continue;
    const d = event.data;
    if (asKey(d.owner)?.equals(user) !== true) continue;
    const market = asKey(d.market)?.toBase58();
    const seq = asBN(d.seq);
    if (market === undefined || seq === null) continue;
    refundAsset.set(
      `${market}:${seq.toString()}`,
      Number(d.side) === 0 ? "usdc" : "tok"
    );
  }

  const entries: HistoryEntry[] = [];
  for (const { event, ctx } of events) {
    const entry = eventToEntry(event, ctx, user);
    if (!entry) continue;
    if (entry.kind === "cancelled" && entry.seq) {
      entry.asset =
        refundAsset.get(`${entry.market}:${entry.seq.toString()}`) ?? null;
    }
    entries.push(entry);
  }
  entries.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
  return entries;
}
