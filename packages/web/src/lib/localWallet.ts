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
 * A built-in keypair wallet for **local development against a `solana-test-validator`**, so a
 * developer can connect and trade with no browser extension installed. It is the human-facing
 * sibling of the e2e-only {@link E2EWalletAdapter}: instead of reading a secret the test
 * harness injected into `localStorage`, it loads the pre-funded demo wallet that `make dev`
 * seeds (passed in at build time via `NEXT_PUBLIC_LOCAL_WALLET_SECRET`), so "Select Wallet"
 * lists one click-to-connect, ready-to-trade account.
 *
 * SAFETY: this is registered **only on localnet** and is refused in a production build (see
 * `Providers.tsx`). The secret it carries is a disposable local demo keypair on a throwaway
 * validator — never a real key. If no secret is configured it stays unavailable rather than
 * pretending to work.
 */
export const LOCAL_WALLET_NAME =
  "Local Dev Wallet" as WalletName<"Local Dev Wallet">;

/** The build-time secret (JSON byte array) for the seeded local demo wallet, if configured. */
const CONFIGURED_SECRET = process.env.NEXT_PUBLIC_LOCAL_WALLET_SECRET;

/** True when a local dev wallet secret was provided at build time (gates registration). */
export function localWalletConfigured(): boolean {
  return Boolean(CONFIGURED_SECRET && CONFIGURED_SECRET.trim().length > 0);
}

export class LocalDevWalletAdapter extends BaseSignerWalletAdapter {
  name = LOCAL_WALLET_NAME;
  url = "http://127.0.0.1:8899";
  // A small inline data-URI wallet glyph so the modal shows an icon (no network fetch).
  icon =
    "data:image/svg+xml;base64," +
    btoaSafe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
        '<rect width="32" height="32" rx="7" fill="#0b1f17"/>' +
        '<path d="M8 11h13a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8z" fill="none" stroke="#3ddc97" stroke-width="2"/>' +
        '<circle cx="20" cy="17" r="1.6" fill="#3ddc97"/></svg>'
    );
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
    // Loadable only when a secret is actually configured; otherwise the modal should not
    // offer it (clicking would just throw).
    return localWalletConfigured()
      ? WalletReadyState.Loadable
      : WalletReadyState.Unsupported;
  }

  private loadKeypair(): Keypair {
    if (this.keypair) return this.keypair;
    if (!CONFIGURED_SECRET) {
      throw new Error(
        "Local Dev Wallet is not configured (NEXT_PUBLIC_LOCAL_WALLET_SECRET unset). " +
          "Run `make dev` to seed it, or install a browser wallet."
      );
    }
    let secret: Uint8Array;
    try {
      secret = Uint8Array.from(JSON.parse(CONFIGURED_SECRET) as number[]);
    } catch {
      throw new Error(
        "NEXT_PUBLIC_LOCAL_WALLET_SECRET is not a valid JSON byte array."
      );
    }
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

/** Base64-encode in the browser (btoa) or Node (Buffer) so the icon works in SSR + client. */
function btoaSafe(s: string): string {
  if (typeof btoa === "function") return btoa(s);
  return Buffer.from(s, "binary").toString("base64");
}
