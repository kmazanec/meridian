import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const walletState = vi.hoisted(() => ({ connected: false }));
vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => walletState,
}));
// The dynamic WalletMultiButton is irrelevant to the gate logic; stub it.
vi.mock("next/dynamic", () => ({
  default: () => () => <button>Select Wallet</button>,
}));

import { ConnectGate } from "./ConnectGate";

describe("ConnectGate", () => {
  it("shows a connect prompt when disconnected", () => {
    walletState.connected = false;
    render(
      <ConnectGate prompt="Connect to trade.">
        <div>secret content</div>
      </ConnectGate>
    );
    expect(screen.getByText("Connect to trade.")).toBeInTheDocument();
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
  });

  it("renders children when connected", () => {
    walletState.connected = true;
    render(
      <ConnectGate>
        <div>secret content</div>
      </ConnectGate>
    );
    expect(screen.getByText("secret content")).toBeInTheDocument();
  });
});
