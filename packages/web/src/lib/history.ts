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
      };
    }
    default:
      return null;
  }
}

/**
 * Map a batch of decoded events (with their tx context) to the user's history entries,
 * newest first. Events not involving the user, or not of a logged kind, are dropped.
 */
export function buildHistory(
  events: { event: DecodedEvent; ctx: EventContext }[],
  user: PublicKey
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const { event, ctx } of events) {
    const entry = eventToEntry(event, ctx, user);
    if (entry) entries.push(entry);
  }
  entries.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));
  return entries;
}
