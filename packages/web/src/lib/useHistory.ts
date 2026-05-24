"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { EventParser, BorshCoder } from "@anchor-lang/core";
import { MERIDIAN_IDL, PROGRAM_ID } from "@meridian/sdk";
import {
  buildHistory,
  type DecodedEvent,
  type EventContext,
  type HistoryEntry,
} from "./history";

/** How many recent signatures to scan for the wallet's history. */
const SIGNATURE_LIMIT = 40;

/**
 * The connected wallet's trade-execution log. Reads the user's recent transaction
 * signatures, fetches each transaction's logs, decodes the program's events with
 * Anchor's `EventParser`, and folds the user-involving ones into history entries
 * (newest first). Pure mapping lives in `history.ts`; this only wires RPC + decoding.
 */
export function useHistory(): {
  entries: HistoryEntry[];
  loading: boolean;
  /** Set when the RPC fetch or event decode failed, so the UI can say so rather than
   *  showing a misleading "no activity" — e.g. an RPC without transaction history. */
  error: Error | null;
  refresh: () => void;
} {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!publicKey) {
      setEntries([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const parser = new EventParser(
        PROGRAM_ID,
        new BorshCoder(MERIDIAN_IDL as never)
      );

      const sigs = await connection.getSignaturesForAddress(publicKey, {
        limit: SIGNATURE_LIMIT,
      });
      const collected: { event: DecodedEvent; ctx: EventContext }[] = [];

      for (const info of sigs) {
        if (info.err) continue; // failed txs have no settled events
        const tx = await connection.getTransaction(info.signature, {
          maxSupportedTransactionVersion: 0,
        });
        const logs = tx?.meta?.logMessages;
        if (!logs) continue;
        const ctx: EventContext = {
          signature: info.signature,
          blockTime: tx?.blockTime ?? info.blockTime ?? null,
        };
        // EventParser.parseLogs yields decoded { name, data } events.
        for (const ev of parser.parseLogs(logs)) {
          collected.push({
            event: ev as unknown as DecodedEvent,
            ctx,
          });
        }
      }

      if (!cancelled) {
        setEntries(buildHistory(collected, publicKey));
        setLoading(false);
      }
    })().catch((e: unknown) => {
      // Surface the failure instead of silently showing "no activity". The most common
      // cause is an RPC without transaction history (e.g. a local validator started
      // without --enable-rpc-transaction-history, or a provider that prunes signatures).
      if (cancelled) return;
      const err = e instanceof Error ? e : new Error(String(e));
      console.error("useHistory: failed to load transaction history", err);
      setError(err);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, publicKey?.toBase58(), tick]);

  return { entries, loading, error, refresh };
}
