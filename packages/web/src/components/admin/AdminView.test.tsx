import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PublicKey } from "@solana/web3.js";

// Mock the chain/wallet hooks so we can drive the gate states without a live cluster.
const wallet = { publicKey: null as PublicKey | null };
const config = { data: null as { admin: PublicKey; paused: boolean } | null };

vi.mock("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({
    publicKey: wallet.publicKey,
    connected: !!wallet.publicKey,
  }),
}));
vi.mock("@/lib/useChain", () => ({
  useConfig: () => config,
  useMarkets: () => ({ data: [], refresh: vi.fn() }),
  useUsdcMint: () => null,
}));
vi.mock("@/lib/useProgram", () => ({ useProgram: () => ({}) }));
vi.mock("@/lib/useSendIx", () => ({
  useSendIx: () => ({
    send: vi.fn(),
    status: "idle",
    signature: null,
    error: null,
  }),
}));
// ConnectGate: render children only when a wallet is present (mirrors real behavior).
vi.mock("@/components/ConnectGate", () => ({
  ConnectGate: ({
    children,
    prompt,
  }: {
    children: React.ReactNode;
    prompt: string;
  }) => (wallet.publicKey ? <>{children}</> : <div>{prompt}</div>),
}));

import { AdminView } from "./AdminView";

const ADMIN = new PublicKey("So11111111111111111111111111111111111111112");
const OTHER = new PublicKey("11111111111111111111111111111111");

beforeEach(() => {
  wallet.publicKey = null;
  config.data = null;
});

describe("AdminView gating", () => {
  it("prompts to connect when no wallet", () => {
    config.data = { admin: ADMIN, paused: false };
    render(<AdminView />);
    expect(screen.getByText(/connect the admin wallet/i)).toBeInTheDocument();
  });

  it("rejects a non-admin wallet (no controls)", () => {
    wallet.publicKey = OTHER;
    config.data = { admin: ADMIN, paused: false };
    render(<AdminView />);
    expect(screen.getByText(/not the config admin/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Pause$/)).not.toBeInTheDocument();
  });

  it("shows controls to the admin wallet", () => {
    wallet.publicKey = ADMIN;
    config.data = { admin: ADMIN, paused: false };
    render(<AdminView />);
    // Each control's section heading + its action button (selected by role to avoid
    // matching the same word in descriptive copy).
    expect(screen.getByRole("heading", { name: "Pause" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /settle now/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Add strike" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });
});
