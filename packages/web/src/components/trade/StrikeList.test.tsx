import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { Outcome, Ticker } from "@meridian/sdk";
import type { DiscoveredMarket } from "@/lib/discovery";
import { StrikeList } from "./StrikeList";

function strike(
  value: number,
  state: "open" | "settled" = "open"
): DiscoveredMarket {
  return {
    address: PublicKey.unique(),
    ticker: Ticker.Meta,
    strike: new BN(value),
    tradingDay: new BN(1),
    state,
    outcome: Outcome.Unsettled,
  };
}

describe("StrikeList", () => {
  it("lists strikes with their state", () => {
    render(
      <StrikeList
        strikes={[strike(660_000_000), strike(680_000_000, "settled")]}
        selected={null}
        onSelect={() => {}}
      />
    );
    expect(screen.getByText("$660.00")).toBeInTheDocument();
    expect(screen.getByText("$680.00")).toBeInTheDocument();
    expect(screen.getByText("settled")).toBeInTheDocument();
  });

  it("marks the selected strike and fires onSelect on click", async () => {
    const a = strike(660_000_000);
    const onSelect = vi.fn();
    render(
      <StrikeList strikes={[a]} selected={a.address} onSelect={onSelect} />
    );
    const opt = screen.getByRole("option");
    expect(opt).toHaveAttribute("aria-selected", "true");
    await userEvent.click(opt);
    expect(onSelect).toHaveBeenCalledWith(a);
  });

  it("shows an empty state when there are no strikes", () => {
    render(<StrikeList strikes={[]} selected={null} onSelect={() => {}} />);
    expect(screen.getByText(/No strikes yet/i)).toBeInTheDocument();
  });
});
