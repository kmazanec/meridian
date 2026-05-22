"use client";

import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  Transaction,
  type TransactionInstruction,
  type TransactionSignature,
} from "@solana/web3.js";

export type TxStatus = "idle" | "signing" | "confirming" | "success" | "error";

export interface SendState {
  status: TxStatus;
  signature: TransactionSignature | null;
  error: Error | null;
}

const INITIAL: SendState = { status: "idle", signature: null, error: null };

/**
 * Send a set of instructions as one transaction through the connected wallet (one
 * approval). The frontend builds instructions with the SDK and signs *here*, via the
 * wallet adapter's `sendTransaction` — the app never holds keys. Tracks signing →
 * confirming → success/error so the UI can show status.
 */
export function useSendIx() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [state, setState] = useState<SendState>(INITIAL);

  const reset = useCallback(() => setState(INITIAL), []);

  const send = useCallback(
    async (
      instructions: TransactionInstruction[]
    ): Promise<TransactionSignature> => {
      if (!publicKey) throw new Error("Connect a wallet first.");
      if (instructions.length === 0) throw new Error("Nothing to send.");
      setState({ status: "signing", signature: null, error: null });
      try {
        const tx = new Transaction().add(...instructions);
        const { blockhash, lastValidBlockHeight } =
          await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;

        const signature = await sendTransaction(tx, connection);
        setState({ status: "confirming", signature, error: null });

        await connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          "confirmed"
        );
        setState({ status: "success", signature, error: null });
        return signature;
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        setState({ status: "error", signature: null, error });
        throw error;
      }
    },
    [connection, publicKey, sendTransaction]
  );

  return { ...state, send, reset };
}
