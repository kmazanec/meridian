"use client";

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import type { Adapter } from "@solana/wallet-adapter-base";
import { RPC_URL } from "@/lib/env";
import { E2EWalletAdapter } from "@/lib/e2eWallet";

import "@solana/wallet-adapter-react-ui/styles.css";

// In e2e mode an in-process keypair adapter is registered so a headless browser can
// sign without an extension. Never enabled in a normal build.
const E2E = process.env.NEXT_PUBLIC_E2E === "1";

/**
 * The wallet + connection context every page sits inside. Wallets are discovered via
 * the Wallet Standard (Phantom/Solflare/Backpack register themselves), so the static
 * adapter list stays empty; standard wallets still appear in the modal. Tests and the
 * e2e harness inject their own adapter via the `wallets` prop.
 */
export function Providers({
  children,
  endpoint = RPC_URL,
  wallets = [],
}: {
  children: React.ReactNode;
  endpoint?: string;
  wallets?: Adapter[];
}) {
  const walletList = useMemo(
    () => (E2E ? [new E2EWalletAdapter(), ...wallets] : wallets),
    [wallets]
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={walletList} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
