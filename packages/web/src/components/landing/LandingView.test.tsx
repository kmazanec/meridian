import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import BN from "bn.js";
import { Ticker } from "@meridian/sdk";
import { LandingView } from "./LandingView";
import type { ActivitySummary, FeaturedCall } from "@/lib/marketStats";

const activity: ActivitySummary = {
  openInterest: new BN(48_200_000000), // $48,200
  openMarkets: 34,
  stockCount: 7,
  tradingDay: new BN(Math.floor(Date.now() / 1000) + 3600),
};

function call(overrides: Partial<FeaturedCall> = {}): FeaturedCall {
  return {
    ticker: Ticker.Nvda,
    symbol: "NVDA",
    strike: new BN(1_180_000000), // $1,180
    yesPrice: new BN(520_000), // 52%
    spot: 1174.2,
    changePct: -0.019,
    openInterest: new BN(9_400_000000),
    tradingDay: new BN(Math.floor(Date.now() / 1000) + 3600),
    ...overrides,
  };
}

describe("LandingView", () => {
  it("explains the product in the brand voice", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        connect={<button>Connect</button>}
      />
    );
    expect(
      screen.getByRole("heading", { name: /Will it close above the line\?/i })
    ).toBeInTheDocument();
    // The differentiator — deterministic, by-the-bell settlement — is stated.
    expect(screen.getByText(/no human oracle/i)).toBeInTheDocument();
  });

  it("renders the injected connect-wallet control", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        connect={<button>Connect</button>}
      />
    );
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("shows the live activity bar", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        connect={<button>Connect</button>}
      />
    );
    const bar = screen.getByTestId("activity-bar");
    expect(within(bar).getByText("$48,200")).toBeInTheDocument();
    expect(within(bar).getByText("34")).toBeInTheDocument();
  });

  it("features a nearest-the-money call as a question with its odds", () => {
    render(
      <LandingView
        featured={[call()]}
        activity={activity}
        connect={<button>Connect</button>}
      />
    );
    const card = screen.getByTestId("featured-NVDA");
    expect(card).toHaveTextContent(/Will\s+NVDA\s+close at or above\s+\$1,180/);
    expect(within(card).getByText("52%")).toBeInTheDocument(); // Yes
    expect(within(card).getByText("48%")).toBeInTheDocument(); // No = 1 − Yes
  });

  it("shows a graceful note when no markets are open", () => {
    render(
      <LandingView
        featured={[]}
        activity={{ ...activity, openMarkets: 0, stockCount: 0 }}
        connect={<button>Connect</button>}
      />
    );
    expect(screen.getByTestId("no-markets")).toHaveTextContent(
      /No open markets right now/i
    );
  });
});
