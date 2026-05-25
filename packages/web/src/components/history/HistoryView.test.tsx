import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BN from "bn.js";
import type { HistoryEntry } from "@/lib/history";
import { HistoryView } from "./HistoryView";

const entry: HistoryEntry = {
  kind: "matched",
  signature: "5xabc",
  blockTime: 1_700_000_000,
  market: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  summary: "Filled as taker",
  price: new BN(700_000),
  size: new BN(1_000_000),
  asset: "tok",
};

function cancel(asset: HistoryEntry["asset"], refunded: number): HistoryEntry {
  return {
    kind: "cancelled",
    signature: "5xcancel",
    blockTime: 1_700_000_001,
    market: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    summary: "Cancelled an order",
    price: null,
    size: new BN(refunded),
    asset,
  };
}

describe("HistoryView", () => {
  it("prompts to connect when disconnected", () => {
    render(<HistoryView entries={[]} connected={false} />);
    expect(screen.getByText(/connect a wallet/i)).toBeInTheDocument();
  });

  it("shows an empty state when connected with no activity", () => {
    render(<HistoryView entries={[]} connected />);
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  it("shows an error state (not 'no activity') when loading failed", () => {
    render(<HistoryView entries={[]} connected error={new Error("rpc 410")} />);
    expect(screen.getByTestId("history-error")).toBeInTheDocument();
    expect(screen.getByText(/couldn't load your history/i)).toBeInTheDocument();
    expect(screen.queryByText(/no activity yet/i)).not.toBeInTheDocument();
  });

  it("renders execution rows with summary, size, and price", () => {
    render(<HistoryView entries={[entry]} connected />);
    expect(screen.getByTestId("history-log")).toBeInTheDocument();
    expect(screen.getByText("Filled as taker")).toBeInTheDocument();
    expect(screen.getByText(/1 tok/)).toBeInTheDocument();
    expect(screen.getByText("$0.70")).toBeInTheDocument();
  });

  it("labels a cancelled bid's refund as USDC, not tokens", () => {
    render(<HistoryView entries={[cancel("usdc", 6_160_000)]} connected />);
    expect(screen.getByText("$6.16")).toBeInTheDocument();
    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
  });

  it("labels a cancelled ask's refund as tokens", () => {
    render(<HistoryView entries={[cancel("tok", 5_200_000)]} connected />);
    expect(screen.getByText("5.2 tok")).toBeInTheDocument();
  });

  it("uses a neutral label when a cancel's side is unknown", () => {
    render(<HistoryView entries={[cancel(null, 5_200_000)]} connected />);
    expect(screen.getByText("5.2 refunded")).toBeInTheDocument();
    expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
  });
});
