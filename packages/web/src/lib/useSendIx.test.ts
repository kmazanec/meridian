import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { Keypair, type TransactionInstruction } from "@solana/web3.js";

// Mock the wallet-adapter hooks so the send path runs without a real wallet/RPC.
const sendTransaction = vi.hoisted(() => vi.fn());
const connection = vi.hoisted(() => ({
  getLatestBlockhash: vi.fn(),
  confirmTransaction: vi.fn(),
}));
const wallet = vi.hoisted(() => ({
  publicKey: null as unknown,
  sendTransaction,
}));

vi.mock("@solana/wallet-adapter-react", () => ({
  useConnection: () => ({ connection }),
  useWallet: () => wallet,
}));

import { useSendIx } from "./useSendIx";

const ix = {
  keys: [],
  programId: Keypair.generate().publicKey,
  data: Buffer.from([]),
} as unknown as TransactionInstruction;

describe("useSendIx", () => {
  beforeEach(() => {
    sendTransaction.mockReset();
    connection.getLatestBlockhash.mockReset();
    connection.confirmTransaction.mockReset();
    wallet.publicKey = Keypair.generate().publicKey;
    connection.getLatestBlockhash.mockResolvedValue({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 100,
    });
    connection.confirmTransaction.mockResolvedValue({ value: { err: null } });
    sendTransaction.mockResolvedValue("SIGNATURE123");
  });

  it("sends the instructions through the wallet adapter and reports success", async () => {
    const { result } = renderHook(() => useSendIx());
    expect(result.current.status).toBe("idle");

    await act(async () => {
      await result.current.send([ix]);
    });

    expect(sendTransaction).toHaveBeenCalledTimes(1);
    // The transaction passed to the adapter carries our instruction.
    const sentTx = sendTransaction.mock.calls[0][0];
    expect(sentTx.instructions).toHaveLength(1);
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.signature).toBe("SIGNATURE123");
  });

  it("refuses to send with no wallet connected", async () => {
    wallet.publicKey = null;
    const { result } = renderHook(() => useSendIx());
    await expect(result.current.send([ix])).rejects.toThrow(
      /connect a wallet/i
    );
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("reports an error when the send fails", async () => {
    sendTransaction.mockRejectedValue(new Error("user rejected"));
    const { result } = renderHook(() => useSendIx());
    await act(async () => {
      await expect(result.current.send([ix])).rejects.toThrow("user rejected");
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("user rejected");
  });
});
