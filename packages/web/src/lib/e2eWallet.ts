"use client";

import {
  BaseSignerWalletAdapter,
  WalletReadyState,
  type WalletName,
  type SupportedTransactionVersions,
} from "@solana/wallet-adapter-base";
import {
  Keypair,
  Transaction,
  VersionedTransaction,
  PublicKey,
} from "@solana/web3.js";

/**
 * An in-process keypair wallet adapter for **end-to-end tests only**. The e2e harness
 * funds a keypair on a local validator and injects its secret key via `localStorage`
 * (`meridian.e2eWallet`); this adapter signs with it so the browser can drive real
 * transactions without a wallet extension. It is wired in only when
 * `NEXT_PUBLIC_E2E === "1"` — never in a normal build.
 */
export const E2E_WALLET_NAME =
  "E2E Test Wallet" as WalletName<"E2E Test Wallet">;
export const E2E_WALLET_STORAGE_KEY = "meridian.e2eWallet";

export class E2EWalletAdapter extends BaseSignerWalletAdapter {
  name = E2E_WALLET_NAME;
  url = "https://example.com";
  icon = "";
  supportedTransactionVersions: SupportedTransactionVersions = new Set([
    "legacy",
    0,
  ]);

  private keypair: Keypair | null = null;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;

  get connecting() {
    return this._connecting;
  }

  get publicKey() {
    return this._publicKey;
  }

  get readyState() {
    return WalletReadyState.Loadable;
  }

  private loadKeypair(): Keypair {
    if (this.keypair) return this.keypair;
    const raw =
      typeof localStorage !== "undefined"
        ? localStorage.getItem(E2E_WALLET_STORAGE_KEY)
        : null;
    if (!raw) throw new Error("E2E wallet secret not found in localStorage");
    const secret = Uint8Array.from(JSON.parse(raw) as number[]);
    this.keypair = Keypair.fromSecretKey(secret);
    return this.keypair;
  }

  async connect(): Promise<void> {
    this._connecting = true;
    try {
      const kp = this.loadKeypair();
      this._publicKey = kp.publicKey;
      this.emit("connect", kp.publicKey);
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this._publicKey = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T> {
    const kp = this.loadKeypair();
    if (tx instanceof VersionedTransaction) {
      tx.sign([kp]);
    } else {
      tx.partialSign(kp);
    }
    return tx;
  }
}
