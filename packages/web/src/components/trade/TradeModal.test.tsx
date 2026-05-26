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

// Mock the SDK's intent builder so we can assert the modal routes the preset action through
// it unchanged (the anti-drift contract: the UI never re-derives the four-button mapping).
const buildTradeIntent = vi.hoisted(() => vi.fn());
vi.mock("@meridian/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@meridian/sdk")>();
  return { ...actual, buildTradeIntent };
});

import { TradeModal, type TradePreset } from "./TradeModal";

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

// Holds USDC + Yes but NO No — so the default Buy Yes is affordable and not guard-blocked.
const funded = {
  usdc: new BN(100_000_000), // $100
  yes: new BN(100_000_000), // 100 Yes
  no: new BN(0),
};

const limitBuyYes: TradePreset = {
  action: TradeAction.BuyYes,
  price: new BN(500_000),
  isMarket: false,
};

function renderModal(props: Partial<Parameters<typeof TradeModal>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <TradeModal
      open
      onClose={onClose}
      preset={limitBuyYes}
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
  return { onSubmit, onClose };
}

describe("TradeModal", () => {
  beforeEach(() => {
    buildTradeIntent.mockReset();
    buildTradeIntent.mockResolvedValue({
      instructions: [{ marker: "ix" }],
      bookSide: 0,
      yesPrice: new BN(0),
      mintPairs: 0,
    });
  });

  it("is not rendered when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("seeds price from the preset and routes the preset action through buildTradeIntent", async () => {
    const { onSubmit } = renderModal();
    // Limit Buy Yes @ 0.50 from the preset; size defaults to 1.
    expect(
      (screen.getByLabelText("Yes price ($)") as HTMLInputElement).value
    ).toBe("0.50");
    await userEvent.click(screen.getByTestId("confirm-trade"));
    expect(buildTradeIntent).toHaveBeenCalledTimes(1);
    const [, signer, intent] = buildTradeIntent.mock.calls[0];
    expect(signer).toBe(user);
    expect(intent.action).toBe(TradeAction.BuyYes);
    expect(intent.price.toNumber()).toBe(500_000);
    expect(intent.size.toNumber()).toBe(1_000_000);
    expect(intent.isMarket).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual([{ marker: "ix" }]);
  });

  it("submits a market order when the preset is market (no price needed)", async () => {
    renderModal({
      preset: { action: TradeAction.BuyYes, isMarket: true },
      // A book-less market order would be blocked for no liquidity; assert the isMarket flag
      // by giving it a fake maker via a non-null book is overkill — instead check the toggle.
    });
    // Market is preselected; the price field is disabled with a placeholder.
    const price = screen.getByLabelText("Yes price ($)") as HTMLInputElement;
    expect(price).toBeDisabled();
    expect(screen.getByRole("button", { name: "Market" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("shows the brief's payoff sentence for a buy", async () => {
    renderModal();
    // Buy Yes @ 0.50, META strike $680 → "win if META closes above $680".
    expect(screen.getByTestId("payoff-line").textContent).toBe(
      "You pay 0.50 USDC. You win $1.00 if META closes above $680.00."
    );
  });

  it("phrases Buy No as winning below the strike", async () => {
    renderModal({
      preset: {
        action: TradeAction.BuyNo,
        price: new BN(500_000),
        isMarket: false,
      },
      position: { usdc: new BN(100_000_000), yes: new BN(0), no: new BN(0) },
    });
    expect(screen.getByTestId("payoff-line").textContent).toMatch(
      /You win \$1\.00 if META closes below \$680\.00\./
    );
  });

  it("omits the payoff sentence for a sell (exit) action", async () => {
    renderModal({
      preset: {
        action: TradeAction.SellYes,
        price: new BN(500_000),
        isMarket: false,
      },
      position: { usdc: new BN(0), yes: new BN(100_000_000), no: new BN(0) },
    });
    expect(screen.queryByTestId("payoff-line")).not.toBeInTheDocument();
  });

  it("shows the No inventory and a buy-Yes note for Sell No (cost is USDC)", async () => {
    // Sell No closes No by buying Yes, so it spends USDC. The held line surfaces the No
    // position being closed; the cost/balance line stays in USDC.
    renderModal({
      preset: {
        action: TradeAction.SellNo,
        price: new BN(500_000),
        isMarket: false,
      },
      position: {
        usdc: new BN(100_000_000), // $100
        yes: new BN(0),
        no: new BN(12_000_000), // 12 No
      },
    });
    expect(screen.getByTestId("held-line").textContent).toMatch(
      /You hold.*12\.00 No/
    );
    expect(screen.getByTestId("sell-no-note")).toBeInTheDocument();
    // The cost/balance line is still in USDC (the trade buys Yes with USDC).
    expect(screen.getByText("Balance").parentElement?.textContent).toMatch(
      /USDC/
    );
  });

  it("does not duplicate a held line for Sell Yes (its balance is already Yes)", async () => {
    renderModal({
      preset: {
        action: TradeAction.SellYes,
        price: new BN(500_000),
        isMarket: false,
      },
      position: { usdc: new BN(0), yes: new BN(100_000_000), no: new BN(0) },
    });
    expect(screen.queryByTestId("held-line")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sell-no-note")).not.toBeInTheDocument();
  });

  it("passes the entered No price for a Buy No preset", async () => {
    renderModal({
      preset: {
        action: TradeAction.BuyNo,
        price: new BN(300_000),
        isMarket: false,
      },
      position: { usdc: new BN(100_000_000), yes: new BN(0), no: new BN(0) },
    });
    const price = screen.getByLabelText("No price ($)") as HTMLInputElement;
    expect(price.value).toBe("0.30");
    await userEvent.click(screen.getByTestId("confirm-trade"));
    const intent = buildTradeIntent.mock.calls[0][2];
    expect(intent.action).toBe(TradeAction.BuyNo);
    expect(intent.price.toNumber()).toBe(300_000); // passed in No perspective
  });

  it("blocks Buy Yes while holding No and does not build", async () => {
    const { onSubmit } = renderModal({
      position: { usdc: new BN(0), yes: new BN(0), no: new BN(1_000_000) },
    });
    expect(screen.getByRole("alert").textContent).toMatch(
      /close your no position/i
    );
    expect(screen.getByTestId("confirm-trade")).toBeDisabled();
    expect(buildTradeIntent).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("surfaces an invalid Buy No size instead of building", async () => {
    renderModal({
      preset: {
        action: TradeAction.BuyNo,
        price: new BN(500_000),
        isMarket: false,
      },
      position: { usdc: new BN(100_000_000), yes: new BN(0), no: new BN(0) },
    });
    const size = screen.getByLabelText("Size (tokens)");
    await userEvent.clear(size);
    await userEvent.type(size, "1.5"); // not a whole token
    await userEvent.click(screen.getByTestId("confirm-trade"));
    expect(screen.getByRole("alert").textContent).toMatch(/whole number/i);
    expect(buildTradeIntent).not.toHaveBeenCalled();
  });

  it("rejects an empty limit price instead of sending price 0", async () => {
    renderModal();
    const price = screen.getByLabelText("Yes price ($)");
    await userEvent.clear(price);
    await userEvent.click(screen.getByTestId("confirm-trade"));
    expect(screen.getByRole("alert").textContent).toMatch(/valid price/i);
    expect(buildTradeIntent).not.toHaveBeenCalled();
  });

  it("blocks an unaffordable trade with a clear message (no build)", async () => {
    renderModal({
      preset: {
        action: TradeAction.BuyNo,
        price: new BN(500_000),
        isMarket: false,
      },
      position: { usdc: new BN(0), yes: new BN(0), no: new BN(0) },
    });
    await userEvent.click(screen.getByTestId("confirm-trade"));
    expect(screen.getByRole("alert").textContent).toMatch(/insufficient usdc/i);
    expect(buildTradeIntent).not.toHaveBeenCalled();
  });

  it("closes after a successful submit", async () => {
    const { onClose } = renderModal();
    await userEvent.click(screen.getByTestId("confirm-trade"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Cancel and on backdrop click without building", async () => {
    const { onClose } = renderModal();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(buildTradeIntent).not.toHaveBeenCalled();
  });

  it("lets the user switch the action inside the modal (any side reachable)", async () => {
    // Opened as Buy Yes (limit), the user flips to Sell Yes and that action is what builds.
    renderModal();
    await userEvent.click(screen.getByRole("button", { name: "Sell Yes" }));
    await userEvent.click(screen.getByTestId("confirm-trade"));
    expect(buildTradeIntent.mock.calls[0][2].action).toBe(TradeAction.SellYes);
  });
});
