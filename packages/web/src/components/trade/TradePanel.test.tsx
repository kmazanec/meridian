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

// A funded position so the affordability pre-check passes by default. Holds USDC + Yes but
// NO No tokens — otherwise the position-constraint guard would block the default Buy Yes.
// Tests that exercise No-side actions or the insufficient path override this.
const funded = {
  usdc: new BN(100_000_000), // $100
  yes: new BN(100_000_000), // 100 Yes
  no: new BN(0),
};

function renderPanel(props: Partial<Parameters<typeof TradePanel>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <TradePanel
      program={program}
      user={user}
      market={market}
      marketAddress={marketAddress}
      book={null}
      position={funded}
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
    // Prepare builds the intent and opens the confirmation dialog.
    expect(buildTradeIntent).toHaveBeenCalled();
    const [, signer, intent] = buildTradeIntent.mock.calls[0];
    expect(signer).toBe(user);
    expect(intent.action).toBe(TradeAction.BuyYes);
    expect(intent.price.toNumber()).toBe(500_000);
    expect(intent.size.toNumber()).toBe(1_000_000);
    // Nothing is sent until the user confirms.
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("confirm-trade"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([{ marker: "ix" }]);
    expect(onSubmit.mock.calls[0][1].action).toBe(TradeAction.BuyYes);
  });

  it("shows the brief's payoff sentence in the confirm dialog for a buy", async () => {
    renderPanel();
    await userEvent.click(screen.getByTestId("submit-trade"));
    // Buy Yes @ 0.50, META strike $680 → "win if META closes above $680".
    expect(screen.getByTestId("payoff-line").textContent).toBe(
      "You pay 0.50 USDC. You win $1.00 if META closes above $680.00."
    );
  });

  it("phrases Buy No as winning below the strike", async () => {
    renderPanel({
      position: { usdc: new BN(100_000_000), yes: new BN(0), no: new BN(0) },
    });
    await userEvent.click(screen.getByRole("button", { name: "Buy No" }));
    await userEvent.click(screen.getByTestId("submit-trade"));
    expect(screen.getByTestId("payoff-line").textContent).toMatch(
      /You win \$1\.00 if META closes below \$680\.00\./
    );
  });

  it("omits the payoff sentence for a sell (exit) action", async () => {
    renderPanel({
      position: { usdc: new BN(0), yes: new BN(100_000_000), no: new BN(0) },
    });
    await userEvent.click(screen.getByRole("button", { name: "Sell Yes" }));
    await userEvent.click(screen.getByTestId("submit-trade"));
    expect(screen.queryByTestId("payoff-line")).not.toBeInTheDocument();
  });

  it("routes each of the four actions through the SDK with the right action", async () => {
    // Each action has different needs: a per-action position that satisfies BOTH the
    // affordability pre-check AND the position-constraint guard (Buy Yes blocked by No,
    // Buy No blocked by Yes; sells need the token).
    const big = new BN(100_000_000);
    const cases: [string, TradeAction, { usdc: BN; yes: BN; no: BN }][] = [
      [
        "Sell Yes",
        TradeAction.SellYes,
        { usdc: new BN(0), yes: big, no: new BN(0) },
      ],
      [
        "Buy No",
        TradeAction.BuyNo,
        { usdc: big, yes: new BN(0), no: new BN(0) },
      ],
      ["Sell No", TradeAction.SellNo, { usdc: big, yes: new BN(0), no: big }],
    ];
    for (const [label, expected, position] of cases) {
      buildTradeIntent.mockClear();
      const { unmount } = render(
        <TradePanel
          program={program}
          user={user}
          market={market}
          marketAddress={marketAddress}
          book={null}
          position={position}
          usdcMint={usdcMint}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
        />
      );
      await userEvent.click(screen.getByRole("button", { name: label }));
      // Submit (prepare) builds the intent; confirm is a separate step.
      await userEvent.click(screen.getByTestId("submit-trade"));
      expect(buildTradeIntent.mock.calls[0][2].action).toBe(expected);
      unmount();
    }
  });

  it("passes the entered No price for a No action (reflected by the SDK)", async () => {
    // Buy No needs USDC and must NOT hold Yes (guard) — funded holds Yes, so override.
    renderPanel({
      position: { usdc: new BN(100_000_000), yes: new BN(0), no: new BN(0) },
    });
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
    // USDC-only so the guard allows Buy No and the size error is what surfaces.
    renderPanel({
      position: { usdc: new BN(100_000_000), yes: new BN(0), no: new BN(0) },
    });
    await userEvent.click(screen.getByRole("button", { name: "Buy No" }));
    const size = screen.getByLabelText("Size (tokens)");
    await userEvent.clear(size);
    await userEvent.type(size, "1.5"); // not a whole token
    await userEvent.click(screen.getByTestId("submit-trade"));
    expect(screen.getByRole("alert").textContent).toMatch(/whole number/i);
    expect(buildTradeIntent).not.toHaveBeenCalled();
  });

  it("rejects an empty/invalid limit price instead of sending price 0", async () => {
    renderPanel();
    const price = screen.getByLabelText("Yes price ($)");
    await userEvent.clear(price); // invalid → must not fall back to 0
    await userEvent.click(screen.getByTestId("submit-trade"));
    expect(screen.getByRole("alert").textContent).toMatch(/valid price/i);
    expect(buildTradeIntent).not.toHaveBeenCalled();
  });

  it("does not re-prepare once the confirmation dialog is open", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <TradePanel
        program={program}
        user={user}
        market={market}
        marketAddress={marketAddress}
        book={null}
        position={funded}
        usdcMint={usdcMint}
        onSubmit={onSubmit}
      />
    );
    const submit = screen.getByTestId("submit-trade");
    await userEvent.click(submit);
    // The dialog is open; the submit button is disabled, so a second click can't rebuild.
    expect(submit).toBeDisabled();
    await userEvent.click(submit);
    expect(buildTradeIntent).toHaveBeenCalledTimes(1);
    // Confirm sends exactly once.
    await userEvent.click(screen.getByTestId("confirm-trade"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("blocks an unaffordable trade with a clear message (no build)", async () => {
    // Zero USDC → Buy No (needs full size USDC for the mint deposit) must be blocked.
    renderPanel({
      position: { usdc: new BN(0), yes: new BN(0), no: new BN(0) },
    });
    await userEvent.click(screen.getByRole("button", { name: "Buy No" }));
    await userEvent.click(screen.getByTestId("submit-trade"));
    expect(screen.getByRole("alert").textContent).toMatch(/insufficient usdc/i);
    expect(buildTradeIntent).not.toHaveBeenCalled();
    expect(screen.queryByTestId("confirm-trade")).not.toBeInTheDocument();
  });
});
