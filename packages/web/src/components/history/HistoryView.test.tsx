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
};

describe("HistoryView", () => {
  it("prompts to connect when disconnected", () => {
    render(<HistoryView entries={[]} connected={false} />);
    expect(screen.getByText(/connect a wallet/i)).toBeInTheDocument();
  });

  it("shows an empty state when connected with no activity", () => {
    render(<HistoryView entries={[]} connected />);
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  it("renders execution rows with summary, size, and price", () => {
    render(<HistoryView entries={[entry]} connected />);
    expect(screen.getByTestId("history-log")).toBeInTheDocument();
    expect(screen.getByText("Filled as taker")).toBeInTheDocument();
    expect(screen.getByText(/1 tok/)).toBeInTheDocument();
    expect(screen.getByText("$0.70")).toBeInTheDocument();
  });
});
