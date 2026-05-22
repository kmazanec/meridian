"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Panel } from "@/components/ui";

const WalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

/**
 * Gate content behind a connected wallet. Used by surfaces that require a signer
 * (e.g. the trade panel's actions). Shows a connect prompt + button when disconnected.
 */
export function ConnectGate({
  children,
  prompt = "Connect a wallet to continue.",
}: {
  children: ReactNode;
  prompt?: string;
}) {
  const { connected } = useWallet();
  if (!connected) {
    return (
      <Panel className="flex flex-col items-center gap-3 text-center">
        <p className="text-fg-dim">{prompt}</p>
        <WalletMultiButton />
      </Panel>
    );
  }
  return <>{children}</>;
}
