import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BN from "bn.js";
import type { LeaderboardRow } from "@/lib/leaderboard";

// Drive the panel via a stubbed hook so we don't need wallet/chain context. We also assert the
// hook is only "enabled" after the user opens the panel (the lazy-load contract).
const hookState = {
  data: null as LeaderboardRow[] | null,
  loading: false,
  error: null as Error | null,
};
let lastEnabled: boolean | undefined;
vi.mock("@/lib/useLeaderboard", () => ({
  useLeaderboard: (enabled: boolean) => {
    lastEnabled = enabled;
    return { ...hookState, refresh: vi.fn() };
  },
}));

import { LeaderboardPanel } from "./LeaderboardPanel";

const pkStr = (n: number) =>
  Array(43).fill(String(n % 10)).join("").slice(0, 44);

function row(owner: string, net: number): LeaderboardRow {
  return {
    owner,
    usdc: new BN(net),
    tokenValue: new BN(0),
    escrowValue: new BN(0),
    net: new BN(net),
    openOrders: 0,
    positions: [],
    unpriceableCount: 0,
  };
}

beforeEach(() => {
  hookState.data = null;
  hookState.loading = false;
  hookState.error = null;
  lastEnabled = undefined;
});

describe("LeaderboardPanel", () => {
  it("is collapsed (hook disabled) until opened, then ranks rows", () => {
    hookState.data = [row(pkStr(1), 5_000_000), row(pkStr(2), 3_000_000)];
    render(<LeaderboardPanel />);

    // Lazy: hook starts disabled, no table yet.
    expect(lastEnabled).toBe(false);
    expect(screen.queryByText("Net worth")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Load leaderboard"));
    expect(lastEnabled).toBe(true);
    expect(screen.getByText("Net worth")).toBeInTheDocument();
    // Top row value rendered (appears in both net + USDC columns).
    expect(screen.getAllByText("$5.00").length).toBeGreaterThan(0);
    // Both wallets ranked (each value appears in net + USDC columns).
    expect(screen.getAllByText("$3.00").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 traders
  });

  it("surfaces an error with retry", () => {
    hookState.error = new Error("rpc boom");
    render(<LeaderboardPanel />);
    fireEvent.click(screen.getByText("Load leaderboard"));
    expect(screen.getByText(/rpc boom/)).toBeInTheDocument();
    expect(screen.getByText("retry")).toBeInTheDocument();
  });
});
