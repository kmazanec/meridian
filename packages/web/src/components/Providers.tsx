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
// sign without an extension. This signs with a key read from localStorage, so it must
// NEVER reach a production build: refuse to enable it under `NODE_ENV === "production"`,
// turning a misconfigured `NEXT_PUBLIC_E2E=1` prod deploy into a hard, obvious failure
// rather than a silent key-signing backdoor. The branch is dead-code-eliminated when
// `NEXT_PUBLIC_E2E` is unset (Next inlines the env literal).
const E2E =
  process.env.NEXT_PUBLIC_E2E === "1" && process.env.NODE_ENV !== "production";

if (
  process.env.NEXT_PUBLIC_E2E === "1" &&
  process.env.NODE_ENV === "production"
) {
  throw new Error(
    "NEXT_PUBLIC_E2E must not be set in a production build — the e2e keypair wallet is a test-only signing backdoor."
  );
}

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
