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
        connect={() => <button>Connect</button>}
      />
    );
    expect(
      screen.getByRole("heading", { name: /Will it close above the line\?/i })
    ).toBeInTheDocument();
    // The differentiator — deterministic, by-the-bell settlement — is stated.
    expect(screen.getByText(/no human oracle/i)).toBeInTheDocument();
  });

  it("renders the injected connect-wallet control in the hero and closing CTA", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        wins={[]}
        connect={() => <button>Connect</button>}
      />
    );
    // The factory is mounted independently in both spots, so the scroll never dead-ends.
    expect(screen.getAllByRole("button", { name: "Connect" })).toHaveLength(2);
  });

  it("shows the live activity bar", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        wins={[]}
        connect={() => <button>Connect</button>}
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
        connect={() => <button>Connect</button>}
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
        connect={() => <button>Connect</button>}
      />
    );
    // The FAQ is offered both up top (for newcomers) and in the closing CTA; both point to /faq.
    const faqLinks = screen.getAllByRole("link", { name: /read the faq/i });
    expect(faqLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of faqLinks) expect(link).toHaveAttribute("href", "/faq");
  });

  it("counts down to the opening bell when the board is closed", () => {
    render(
      <LandingView
        featured={[]}
        activity={{ ...activity, openMarkets: 0, stockCount: 0 }}
        wins={[]}
        connect={() => <button>Connect</button>}
      />
    );
    const hero = screen.getByTestId("closed-hero");
    expect(within(hero).getByTestId("open-countdown")).toHaveTextContent(
      /trading opens in/i
    );
    // The open strip is replaced, not shown alongside the closed hero.
    expect(screen.queryByTestId("activity-bar")).not.toBeInTheDocument();
  });

  it("hides today's closest calls when the board is closed", () => {
    render(
      <LandingView
        // Even if a stale featured call leaks through, a closed board must not show it.
        featured={[call()]}
        activity={{ ...activity, openMarkets: 0, stockCount: 0 }}
        wins={[]}
        connect={() => <button>Connect</button>}
      />
    );
    expect(
      screen.queryByText(/today's closest calls/i)
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("featured-NVDA")).not.toBeInTheDocument();
  });

  it("shows the live activity strip when the board is open", () => {
    render(
      <LandingView
        featured={[call()]}
        activity={activity}
        wins={[]}
        connect={() => <button>Connect</button>}
      />
    );
    expect(screen.getByTestId("activity-bar")).toBeInTheDocument();
    expect(screen.queryByTestId("closed-hero")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /today's closest calls/i })
    ).toBeInTheDocument();
  });

  it("shows recent settled results as a wins feed", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        wins={[win()]}
        connect={() => <button>Connect</button>}
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
        connect={() => <button>Connect</button>}
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
        connect={() => <button>Connect</button>}
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
        connect={() => <button>Connect</button>}
      />
    );
    const flow = screen.getByTestId("how-it-works");
    expect(
      within(flow).getByRole("heading", { name: /how a trading day works/i })
    ).toBeInTheDocument();
    // The day flows from open to auto-settle as a vertical timeline.
    expect(within(flow).getByTestId("timeline")).toBeInTheDocument();
    expect(within(flow).getByText(/the board opens/i)).toBeInTheDocument();
    expect(within(flow).getByText(/the bell rings/i)).toBeInTheDocument();
    expect(within(flow).getByText(/auto-settle/i)).toBeInTheDocument();
  });

  it("closes with a CTA so the scroll never dead-ends", () => {
    render(
      <LandingView
        featured={[]}
        activity={activity}
        wins={[]}
        connect={() => <button>Connect</button>}
      />
    );
    const cta = screen.getByTestId("closing-cta");
    // Both next steps are offered: connect a wallet, or read the FAQ.
    expect(
      within(cta).getByRole("button", { name: "Connect" })
    ).toBeInTheDocument();
    expect(
      within(cta).getByRole("link", { name: /read the faq/i })
    ).toHaveAttribute("href", "/faq");
    // Open session: invite to trade now.
    expect(within(cta).getByText(/take your side today/i)).toBeInTheDocument();
  });

  it("shifts the closing CTA to 'be ready for the bell' when the board is closed", () => {
    render(
      <LandingView
        featured={[]}
        activity={{ ...activity, openMarkets: 0, stockCount: 0 }}
        wins={[]}
        connect={() => <button>Connect</button>}
      />
    );
    const cta = screen.getByTestId("closing-cta");
    expect(
      within(cta).getByText(/be on the board at the bell/i)
    ).toBeInTheDocument();
  });
});
