"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useHistory } from "@/lib/useHistory";
import { HistoryView } from "@/components/history/HistoryView";

export default function HistoryPage() {
  const { publicKey } = useWallet();
  const { entries, loading, error } = useHistory();
  return (
    <HistoryView
      entries={entries}
      connected={!!publicKey}
      loading={loading}
      error={error}
    />
  );
}
