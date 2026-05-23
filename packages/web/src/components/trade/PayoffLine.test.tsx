import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import BN from "bn.js";
import { Ticker } from "@meridian/sdk";
import { PayoffLine } from "./PayoffLine";

describe("PayoffLine", () => {
  it("states the payoff with the stock and strike", () => {
    render(
      <PayoffLine
        ticker={Ticker.Meta}
        strike={new BN(680_000_000)}
        yesPrice={new BN(650_000)}
      />
    );
    // The stock appears in the "each winning <SYMBOL> token redeems for $1.00" line.
    expect(screen.getByText(/META/)).toBeInTheDocument();
    // The strike labels the Yes ("closes ≥ $680.00") card.
    expect(screen.getByText(/\$680\.00/)).toBeInTheDocument();
  });

  it("shows the Yes price and the implied No price (1.00 − Yes)", () => {
    render(
      <PayoffLine
        ticker={Ticker.Meta}
        strike={new BN(680_000_000)}
        yesPrice={new BN(650_000)}
      />
    );
    const yes = screen.getByTestId("yes-price");
    const no = screen.getByTestId("no-price");
    // Yes price = 0.65; implied probability shown alongside.
    expect(yes.textContent).toContain("$0.65");
    expect(within(yes.parentElement as HTMLElement).getByText("65%")).toBeInTheDocument();
    // Implied No = 1.00 − 0.65 = 0.35.
    expect(no.textContent).toContain("$0.35");
    expect(within(no.parentElement as HTMLElement).getByText("35%")).toBeInTheDocument();
  });
});
