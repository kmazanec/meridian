import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BN from "bn.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  Outcome,
  Ticker,
  TradeAction,
  type MarketAccount,
  type MeridianProgram,
} from "@meridian/sdk";

// Mock the SDK's intent builder so we can assert the panel routes each button through
// it with the right args (the anti-drift contract: the UI never re-derives the mapping).
const buildTradeIntent = vi.hoisted(() => vi.fn());
vi.mock("@meridian/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@meridian/sdk")>();
  return { ...actual, buildTradeIntent };
});

import { TradePanel } from "./TradePanel";

const usdcMint = Keypair.generate().publicKey;
const yesMint = Keypair.generate().publicKey;
const noMint = Keypair.generate().publicKey;
const user = Keypair.generate().publicKey;
const marketAddress = Keypair.generate().publicKey;

const market = {
  ticker: Ticker.Meta,
  strike: new BN(680_000_000),
  tradingDay: new BN(1_716_321_600),
  yesMint,
  noMint,
  vault: PublicKey.default,
  orderBook: PublicKey.default,
  pairsMinted: new BN(0),
  winningRedeemed: new BN(0),
  state: "open",
  outcome: Outcome.Unsettled,
  settlementPrice: null,
  settledAt: null,
  bump: 0,
  vaultBump: 0,
  mintAuthorityBump: 0,
} as MarketAccount;

const program = {} as MeridianProgram;

function renderPanel(props: Partial<Parameters<typeof TradePanel>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <TradePanel
      program={program}
      user={user}
      market={market}
      marketAddress={marketAddress}
      book={null}
      position={null}
      usdcMint={usdcMint}
      onSubmit={onSubmit}
      {...props}
    />
  );
  return { onSubmit };
}

describe("TradePanel", () => {
  beforeEach(() => {
    buildTradeIntent.mockReset();
    buildTradeIntent.mockResolvedValue({
      instructions: [{ marker: "ix" }],
      bookSide: 0,
      yesPrice: new BN(0),
      mintPairs: 0,
    });
  });

  it("renders all four action buttons", () => {
    renderPanel();
    // Action buttons carry aria-pressed; the submit button does not, so this scopes
    // to the four-button selector even though the submit label can duplicate one.
    const actionButtons = screen
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("aria-pressed"))
      .map((b) => b.textContent);
    expect(actionButtons).toEqual(["Buy Yes", "Sell Yes", "Buy No", "Sell No"]);
  });

  it("routes Buy Yes through buildTradeIntent with the BUY_YES action", async () => {
    const { onSubmit } = renderPanel();
    // Buy Yes is the default action; price 0.50, size 1 are the defaults.
    await userEvent.click(screen.getByTestId("submit-trade"));
    expect(buildTradeIntent).toHaveBeenCalled();
    const [, signer, intent] = buildTradeIntent.mock.calls[0];
    expect(signer).toBe(user);
    expect(intent.action).toBe(TradeAction.BuyYes);
    expect(intent.price.toNumber()).toBe(500_000);
    expect(intent.size.toNumber()).toBe(1_000_000);
    // onSubmit receives the built instructions plus the fill summary.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([{ marker: "ix" }]);
    expect(onSubmit.mock.calls[0][1].action).toBe(TradeAction.BuyYes);
  });

  it("routes each of the four actions through the SDK with the right action", async () => {
    const cases: [string, TradeAction][] = [
      ["Sell Yes", TradeAction.SellYes],
      ["Buy No", TradeAction.BuyNo],
      ["Sell No", TradeAction.SellNo],
    ];
    for (const [label, expected] of cases) {
      buildTradeIntent.mockClear();
      const { unmount } = render(
        <TradePanel
          program={program}
          user={user}
          market={market}
          marketAddress={marketAddress}
          book={null}
          position={null}
          usdcMint={usdcMint}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
        />
      );
      await userEvent.click(screen.getByRole("button", { name: label }));
      await userEvent.click(screen.getByTestId("submit-trade"));
      expect(buildTradeIntent.mock.calls[0][2].action).toBe(expected);
      unmount();
    }
  });

  it("passes the entered No price for a No action (reflected by the SDK)", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Buy No" }));
    const price = screen.getByLabelText("No price ($)");
    await userEvent.clear(price);
    await userEvent.type(price, "0.30");
    await userEvent.click(screen.getByTestId("submit-trade"));
    const intent = buildTradeIntent.mock.calls[0][2];
    expect(intent.action).toBe(TradeAction.BuyNo);
    expect(intent.price.toNumber()).toBe(300_000); // passed in No perspective
  });

  it("blocks Buy Yes while holding No and does not build", async () => {
    const { onSubmit } = renderPanel({
      position: { usdc: new BN(0), yes: new BN(0), no: new BN(1_000_000) },
    });
    // Buy Yes is already the default action.
    expect(screen.getByRole("alert").textContent).toMatch(
      /close your no position/i
    );
    expect(screen.getByTestId("submit-trade")).toBeDisabled();
    expect(buildTradeIntent).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("surfaces an invalid BUY_NO size instead of building", async () => {
    renderPanel();
    await userEvent.click(screen.getByRole("button", { name: "Buy No" }));
    const size = screen.getByLabelText("Size (tokens)");
    await userEvent.clear(size);
    await userEvent.type(size, "1.5"); // not a whole token
    await userEvent.click(screen.getByTestId("submit-trade"));
    expect(screen.getByRole("alert").textContent).toMatch(/whole number/i);
    expect(buildTradeIntent).not.toHaveBeenCalled();
  });
});
