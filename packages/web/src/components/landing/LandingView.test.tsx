import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import BN from "bn.js";
import { Outcome, Ticker } from "@meridian/sdk";
import { LandingView } from "./LandingView";
import type {
  ActivitySummary,
  FeaturedCall,
  RecentWin,
} from "@/lib/marketStats";

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

function win(overrides: Partial<RecentWin> = {}): RecentWin {
  return {
    address: "Win1111111111111111111111111111111111111111",
    symbol: "TSLA",
    strike: new BN(300_000000), // $300
    settlementPrice: new BN(312_400000), // $312.40
    outcome: Outcome.YesWins,
    payout: new BN(4_200_000000), // $4,200
    tradingDay: new BN(Math.floor(Date.now() / 1000) - 86_400),
    ...overrides,
  };
}

describe("LandingView", () => {
  it("explains the product in the brand voice", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        wins={[]}
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
        wins={[]}
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
        wins={[]}
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
        wins={[]}
        connect={<button>Connect</button>}
      />
    );
    const card = screen.getByTestId("featured-NVDA");
    expect(card).toHaveTextContent(/Will\s+NVDA\s+close at or above\s+\$1,180/);
    expect(within(card).getByText("52%")).toBeInTheDocument(); // Yes
    expect(within(card).getByText("48%")).toBeInTheDocument(); // No = 1 − Yes
    // Deep-links to this exact strike (dollars), not just the symbol.
    expect(card).toHaveAttribute("href", "/trade/NVDA?strike=1180");
  });

  it("offers newcomers a link to the FAQ", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        wins={[]}
        connect={<button>Connect</button>}
      />
    );
    const faqLink = screen.getByRole("link", { name: /read the faq/i });
    expect(faqLink).toHaveAttribute("href", "/faq");
  });

  it("shows a graceful note when no markets are open", () => {
    render(
      <LandingView
        featured={[]}
        activity={{ ...activity, openMarkets: 0, stockCount: 0 }}
        wins={[]}
        connect={<button>Connect</button>}
      />
    );
    expect(screen.getByTestId("no-markets")).toHaveTextContent(
      /No open markets right now/i
    );
  });

  it("shows recent settled results as a wins feed", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        wins={[win()]}
        connect={<button>Connect</button>}
      />
    );
    const feed = screen.getByTestId("recent-wins");
    const row = within(feed).getByTestId(
      "win-Win1111111111111111111111111111111111111111"
    );
    // The decided question, its close, and the winning margin are all stated.
    expect(row).toHaveTextContent(/TSLA/);
    expect(row).toHaveTextContent(/\$312\.40/); // settled close
    expect(row).toHaveTextContent(/\$300/); // the strike it beat
    // Yes won by closing $12.40 above the $300 strike.
    expect(row).toHaveTextContent(/cleared by/i);
    expect(row).toHaveTextContent(/\$12\.40/);
    expect(row).toHaveAttribute("href", "/trade/TSLA");
  });

  it("frames a No win as the close missing the strike", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        wins={[
          win({
            address: "Miss222222222222222222222222222222222222222",
            symbol: "AAPL",
            strike: new BN(320_000000), // $320
            settlementPrice: new BN(309_380000), // $309.38 — under the line
            outcome: Outcome.NoWins,
          }),
        ]}
        connect={<button>Connect</button>}
      />
    );
    const row = screen.getByTestId(
      "win-Miss222222222222222222222222222222222222222"
    );
    expect(row).toHaveTextContent(/missed by/i);
    expect(row).toHaveTextContent(/\$10\.62/); // 320 − 309.38
  });

  it("invites traders back when nothing has settled yet", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        wins={[]}
        connect={<button>Connect</button>}
      />
    );
    expect(screen.getByTestId("no-wins")).toHaveTextContent(
      /No markets have settled yet/i
    );
  });

  it("explains the lifecycle with an always-present how-it-works flow", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        wins={[]}
        connect={<button>Connect</button>}
      />
    );
    const flow = screen.getByTestId("how-it-works");
    expect(
      within(flow).getByRole("heading", { name: /how it works/i })
    ).toBeInTheDocument();
    expect(within(flow).getByText(/the bell rings/i)).toBeInTheDocument();
    expect(within(flow).getByText(/auto-settle/i)).toBeInTheDocument();
  });
});
