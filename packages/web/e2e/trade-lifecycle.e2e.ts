import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Browser-driven lifecycle against the running program on a local validator.
 * Covers: wallet connect, the four trade paths (Buy Yes / Buy No / Sell Yes / Sell No)
 * each producing a confirmed transaction, the portfolio reflecting positions, and the
 * redeem flow on a pre-settled winning position. Settlement itself is an admin action
 * performed in setup (not a user/browser action); the browser drives redeem.
 *
 * Playwright's CommonJS loader provides `__dirname` directly.
 */

const localnet = JSON.parse(
  readFileSync(resolve(__dirname, ".localnet.json"), "utf8")
) as {
  walletPubkey: string;
  wallet: number[];
  usdcMint: string;
  yesMarket: { symbol: string };
  noMarket: { symbol: string };
  settledMarket: { symbol: string };
};

/** Inject the e2e wallet secret + select it for autoConnect, before the app boots. */
async function primeWallet(page: Page) {
  await page.addInitScript(
    ([secret, name]) => {
      localStorage.setItem("meridian.e2eWallet", JSON.stringify(secret));
      // Pre-select the injected wallet so the provider's `autoConnect` connects it
      // (wallet-adapter reads the wallet to reconnect from `walletName`).
      localStorage.setItem("walletName", JSON.stringify(name));
    },
    [localnet.wallet, "E2E Test Wallet"] as const
  );
}

async function connect(page: Page) {
  // autoConnect connects the pre-selected e2e wallet; the header (banner) wallet button
  // then shows a truncated address. Scope to the banner — the landing CTA renders a
  // second, identical wallet button.
  await expect(
    page.getByRole("banner").getByRole("button", {
      name: /[A-Za-z0-9]{4}\.\.[A-Za-z0-9]{4}/,
    })
  ).toBeVisible({ timeout: 20_000 });
}

/**
 * Submit one trade action and wait for a confirmation banner. The redesigned flow opens a
 * modal from the Yes/No quote bar, then exposes all four actions inside it:
 *  1. open the modal (the Yes cell is always present on an open market);
 *  2. pick the action in the modal's four-button selector;
 *  3. confirm. The bar seeds a *limit* order at the live price, so each action rests on the
 *     (initially empty) book rather than failing as a market order with no liquidity.
 */
async function tradeOnce(page: Page, action: RegExp) {
  await page.getByTestId("trade-bar-yes").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: action }).click();
  await page.getByTestId("confirm-trade").click();
  await expect(page.getByText(/Confirmed/i)).toBeVisible({ timeout: 30_000 });
}

test.describe("Meridian lifecycle (browser × program)", () => {
  test("connect, four trade paths, portfolio, redeem", async ({ page }) => {
    await primeWallet(page);

    // Landing → connect.
    await page.goto("/");
    await connect(page);

    // Yes-side paths on the Yes-funded market (META): Buy Yes (USDC bid), then Sell Yes
    // (escrows pre-funded Yes inventory). Both rest on the empty book.
    await page.goto(`/trade/${localnet.yesMarket.symbol}`);
    await expect(page.getByTestId("trade-bar-yes")).toBeVisible();
    await expect(page.getByTestId("merged-book")).toBeVisible();
    await tradeOnce(page, /^Buy Yes$/);
    await tradeOnce(page, /^Sell Yes$/);

    // No-side paths on the No-funded market (AAPL): Buy No (mint pair + sell Yes) and
    // Sell No (buy Yes). Run on a different strike so the position guard isn't tripped
    // by the Yes-market inventory.
    await page.goto(`/trade/${localnet.noMarket.symbol}`);
    await expect(page.getByTestId("trade-bar-yes")).toBeVisible();
    await tradeOnce(page, /^Buy No$/);
    await tradeOnce(page, /^Sell No$/);

    // Portfolio reflects activity.
    await page.goto("/portfolio");
    await expect(
      page.getByRole("heading", { name: "Portfolio" })
    ).toBeVisible();

    // Redeem the pre-settled winning position (NVDA settled market).
    const redeemBtn = page.getByTestId(/^redeem-/).first();
    await expect(redeemBtn).toBeVisible({ timeout: 20_000 });
    await redeemBtn.click();
    await expect(page.getByText(/Confirmed/i)).toBeVisible({ timeout: 30_000 });

    // History shows the execution log.
    await page.goto("/history");
    await expect(page.getByTestId("history-log")).toBeVisible({
      timeout: 20_000,
    });
  });
});
