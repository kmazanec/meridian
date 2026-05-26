import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BN from "bn.js";
import { Ticker, TradeAction } from "@meridian/sdk";
import { TradeBar } from "./TradeBar";

const strike = new BN(390_000_000); // $390
const yesPrice = new BN(600_000); // $0.60 → No is $0.40

describe("TradeBar", () => {
  it("shows complementary Yes and No quotes", () => {
    render(
      <TradeBar
        ticker={Ticker.Meta}
        strike={strike}
        yesPrice={yesPrice}
        onPick={vi.fn()}
      />
    );
    expect(screen.getByTestId("yes-price").textContent).toBe("$0.60");
    expect(screen.getByTestId("no-price").textContent).toBe("$0.40");
  });

  it("opens Buy Yes when the Yes cell is clicked", async () => {
    const onPick = vi.fn();
    render(
      <TradeBar
        ticker={Ticker.Meta}
        strike={strike}
        yesPrice={yesPrice}
        onPick={onPick}
      />
    );
    await userEvent.click(screen.getByTestId("trade-bar-yes"));
    expect(onPick).toHaveBeenCalledWith(TradeAction.BuyYes);
  });

  it("opens Buy No when the No cell is clicked", async () => {
    const onPick = vi.fn();
    render(
      <TradeBar
        ticker={Ticker.Meta}
        strike={strike}
        yesPrice={yesPrice}
        onPick={onPick}
      />
    );
    await userEvent.click(screen.getByTestId("trade-bar-no"));
    expect(onPick).toHaveBeenCalledWith(TradeAction.BuyNo);
  });

  it("renders quotes but no click affordance when disabled", async () => {
    const onPick = vi.fn();
    render(
      <TradeBar
        ticker={Ticker.Meta}
        strike={strike}
        yesPrice={yesPrice}
        onPick={onPick}
        disabled
      />
    );
    expect(screen.getByTestId("yes-price")).toBeInTheDocument();
    expect(screen.getByTestId("trade-bar-yes")).toBeDisabled();
    await userEvent.click(screen.getByTestId("trade-bar-yes"));
    expect(onPick).not.toHaveBeenCalled();
  });
});
