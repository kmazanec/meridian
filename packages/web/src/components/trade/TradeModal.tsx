"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  buildTradeIntent,
  TradeAction,
  PAYOFF_UNIT,
  TICKER_SYMBOLS,
  type MarketAccount,
  type OrderBookAccount,
  type UserPosition,
  type MeridianProgram,
} from "@meridian/sdk";
import { formatPrice, formatUsdc } from "@/lib/format";
import { makerAccountsFor } from "@/lib/crossing";
import {
  yesSideFor,
  yesPriceFor,
  isNoAction,
  validateTradeForm,
  parsePrice,
  parseSize,
} from "@/lib/tradeForm";
import {
  tradeCost,
  formatAmount,
  type TradeCost,
} from "@/lib/tradeAffordability";
import {
  marketOrderHasNoLiquidity,
  readableTradeError,
} from "@/lib/tradeErrors";
import { checkPositionConstraint } from "@/lib/positionGuard";
import { Button, cx } from "@/components/ui";
import type { TradeFill } from "./types";

/**
 * How the modal was opened, set by whatever the user clicked:
 *  - the Yes/No quote bar → a *limit* entry on that side seeded with the live price, so the
 *    user can rest an order even when the book is empty (and switch to market if they want);
 *  - an order-book row → a *limit* entry at that row's price (Buy Yes on an ask, Sell Yes
 *    on a bid), so the user acts on the exact level they pointed at.
 * The preset is only the *starting* context: inside the modal the side toggle (Buy/Sell ×
 * Yes/No), the market⇄limit toggle, and the price/size are all editable, so any of the four
 * actions is reachable from any entry point.
 */
export interface TradePreset {
  action: TradeAction;
  /** Seed price in the action's own perspective (Yes price / No price). Omitted → 0.50. */
  price?: BN;
  isMarket: boolean;
}

/** The four trade actions, in selector order, with the tint each side uses. */
const ACTIONS: { action: TradeAction; label: string; tone: "yes" | "no" }[] = [
  { action: TradeAction.BuyYes, label: "Buy Yes", tone: "yes" },
  { action: TradeAction.SellYes, label: "Sell Yes", tone: "yes" },
  { action: TradeAction.BuyNo, label: "Buy No", tone: "no" },
  { action: TradeAction.SellNo, label: "Sell No", tone: "no" },
];

const ACTION_LABEL: Record<TradeAction, string> = {
  [TradeAction.BuyYes]: "Buy Yes",
  [TradeAction.SellYes]: "Sell Yes",
  [TradeAction.BuyNo]: "Buy No",
  [TradeAction.SellNo]: "Sell No",
};

/** A one-line "what does this mechanism mean" explainer for the order type, in context. */
function orderTypeHelp(action: TradeAction, isMarket: boolean): string {
  if (isMarket) {
    return action === TradeAction.SellYes || action === TradeAction.SellNo
      ? "Market — sell immediately into the best resting bid, at whatever price clears."
      : "Market — buy immediately from the best resting ask, at whatever price clears.";
  }
  return "Limit — rest at your price and only fill at it or better. May wait, or not fill at all.";
}

/** What buying this side means in plain language, shown under the side label. */
function sideHelp(
  action: TradeAction,
  symbol: string,
  strikeLabel: string
): string {
  switch (action) {
    case TradeAction.BuyYes:
      return `A Yes token pays $1.00 if ${symbol} closes at or above ${strikeLabel}, else $0.`;
    case TradeAction.BuyNo:
      return `A No token pays $1.00 if ${symbol} closes below ${strikeLabel}, else $0.`;
    case TradeAction.SellYes:
      return "Exit your Yes position — sell tokens back into the book.";
    case TradeAction.SellNo:
      return "Exit your No position — sell tokens back into the book.";
  }
}

/**
 * The brief's payoff sentence for a *buy* action (null for sells). Mirrors the previous
 * confirm-dialog copy so the contract stays the same after the redesign.
 */
function payoffSentence(
  action: TradeAction,
  cost: TradeCost,
  symbol: string,
  strikeLabel: string
): string | null {
  if (action !== TradeAction.BuyYes && action !== TradeAction.BuyNo)
    return null;
  const direction =
    action === TradeAction.BuyYes ? "closes above" : "closes below";
  return `You pay ${formatAmount(cost.required)} ${
    cost.asset
  }. You win $1.00 if ${symbol} ${direction} ${strikeLabel}.`;
}

/**
 * The focused, two-step trade surface: a centered modal over a dimmed backdrop. Opened from
 * an in-context affordance (the Yes/No quote bar or an order-book row), it carries that
 * context in via `preset`, then collects amount + order type with inline explainers and a
 * live cost/payoff preview before a single Confirm.
 *
 * All on-chain logic — validation, affordability, the position guard, maker-account crossing,
 * and `buildTradeIntent` — is identical to the old always-on panel; only the presentation
 * moved. The four-button action mapping is never re-derived here.
 */
export function TradeModal({
  open,
  onClose,
  preset,
  program,
  user,
  market,
  marketAddress,
  book,
  position,
  usdcMint,
  onSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  preset: TradePreset;
  program: MeridianProgram;
  user: PublicKey | null;
  market: MarketAccount;
  marketAddress: PublicKey;
  book: OrderBookAccount | null;
  position: UserPosition | null;
  usdcMint: PublicKey | null;
  onSubmit: (
    instructions: import("@solana/web3.js").TransactionInstruction[],
    fill: TradeFill
  ) => Promise<unknown>;
  busy?: boolean;
}) {
  const [action, setAction] = useState<TradeAction>(preset.action);
  const [priceInput, setPriceInput] = useState("0.50");
  const [sizeInput, setSizeInput] = useState("1");
  const [isMarket, setIsMarket] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Re-seed the form from the preset every time the modal opens, so clicking a $0.55 ask
  // lands you on Buy Yes @ $0.55 limit and clicking the Yes bar lands you on a Buy Yes limit
  // seeded with the live price. The user can change any of these afterward.
  useEffect(() => {
    if (!open) return;
    setAction(preset.action);
    setIsMarket(preset.isMarket);
    setPriceInput(preset.price ? formatAmount(preset.price) : "0.50");
    setSizeInput("1");
    setFormError(null);
  }, [open, preset]);

  // Close on Escape, the modal convention.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  const guard = useMemo(
    () => checkPositionConstraint(action, position),
    [action, position]
  );

  const balances = position ?? {
    usdc: new BN(0),
    yes: new BN(0),
    no: new BN(0),
  };
  const symbol = TICKER_SYMBOLS[market.ticker];
  const strikeLabel = formatUsdc(market.strike, 2);
  const priceLabel = isNoAction(action) ? "No price ($)" : "Yes price ($)";

  // Live cost preview, recomputed from the current inputs (best-effort; invalid inputs just
  // hide the preview rather than erroring while the user is still typing).
  const preview = useMemo<TradeCost | null>(() => {
    const price = isMarket ? new BN(0) : parsePrice(priceInput);
    if (!isMarket && !price) return null;
    const size = parseSize(sizeInput);
    if (!size) return null;
    return tradeCost({
      action,
      price: price ?? new BN(0),
      size,
      isMarket,
      balances,
    });
  }, [action, priceInput, sizeInput, isMarket, balances]);

  const submit = async () => {
    if (submitting || busy) return;
    setFormError(null);
    if (!user || !usdcMint) {
      setFormError("Connect a wallet to trade.");
      return;
    }
    const price = parsePrice(priceInput);
    if (!isMarket && !price) {
      setFormError("Enter a valid price.");
      return;
    }
    const effectivePrice = price ?? new BN(0);
    const size = parseSize(sizeInput);
    if (!size) {
      setFormError("Enter a valid size.");
      return;
    }
    const valid = validateTradeForm({
      action,
      price: effectivePrice,
      size,
      isMarket,
    });
    if (!valid.ok) {
      setFormError(valid.error ?? "Invalid trade.");
      return;
    }
    if (guard.blocked) {
      setFormError(guard.message ?? "Close the opposite position first.");
      return;
    }

    const cost = tradeCost({
      action,
      price: effectivePrice,
      size,
      isMarket,
      balances,
    });
    if (!cost.affordable) {
      setFormError(
        `Insufficient ${cost.asset}: this needs ${formatAmount(
          cost.required
        )} but you have ${formatAmount(cost.have)}.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const makerAccounts =
        book && usdcMint
          ? makerAccountsFor({
              book,
              side: yesSideFor(action),
              price: yesPriceFor(action, effectivePrice),
              size,
              isMarket,
              usdcMint,
              yesMint: market.yesMint,
            })
          : [];

      if (
        marketOrderHasNoLiquidity({
          isMarket,
          makerCount: makerAccounts.length,
        })
      ) {
        setFormError(
          "No liquidity to fill a market order yet — place a limit order instead."
        );
        return;
      }

      const built = await buildTradeIntent(program, user, {
        market: marketAddress,
        action,
        price: effectivePrice,
        size,
        isMarket,
        usdcMint,
        makerAccounts,
      });
      await onSubmit(built.instructions, {
        action,
        price: effectivePrice,
        size,
      });
      onClose();
    } catch (e) {
      setFormError(readableTradeError(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const isBuy = action === TradeAction.BuyYes || action === TradeAction.BuyNo;
  const sideTone = isNoAction(action) ? "no" : "yes";
  const busyOrSubmitting = busy || submitting;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={ACTION_LABEL[action]}
    >
      {/* Dimmed backdrop — click to dismiss (unless mid-send). */}
      <div
        className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
        aria-hidden
        onClick={() => !busyOrSubmitting && onClose()}
      />

      <div className="panel relative z-10 w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div
              className={cx(
                "text-xs uppercase tracking-widest",
                sideTone === "no" ? "text-no" : "text-yes"
              )}
            >
              {strikeLabel} strike
            </div>
            <h2 className="mt-1 font-serif text-2xl text-fg">
              {ACTION_LABEL[action]}
            </h2>
            <p className="mt-1 text-sm text-fg-dim">
              {sideHelp(action, symbol, strikeLabel)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={busyOrSubmitting}
            className="-mr-1 -mt-1 rounded-lg p-1 text-fg-faint transition-colors hover:text-fg disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {/* Side selector: any of the four actions is reachable, whatever opened the modal.
              Each button uses its side's tint when active so Buy/Sell Yes read green and
              Buy/Sell No read coral. */}
          <div>
            <span className="text-xs uppercase tracking-wide text-fg-faint">
              Action
            </span>
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ACTIONS.map((a) => (
                <Button
                  key={a.action}
                  variant={action === a.action ? a.tone : "default"}
                  aria-pressed={action === a.action}
                  className={cx(
                    "px-2 text-sm",
                    action !== a.action && "text-fg-dim hover:text-fg"
                  )}
                  onClick={() => {
                    setAction(a.action);
                    setFormError(null);
                  }}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Order type as a segmented toggle, with the in-context explainer beneath it. */}
          <div>
            <span className="text-xs uppercase tracking-wide text-fg-faint">
              Order type
            </span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Button
                variant={isMarket ? "accent" : "default"}
                aria-pressed={isMarket}
                className={cx(!isMarket && "text-fg-dim hover:text-fg")}
                onClick={() => setIsMarket(true)}
              >
                Market
              </Button>
              <Button
                variant={!isMarket ? "accent" : "default"}
                aria-pressed={!isMarket}
                className={cx(isMarket && "text-fg-dim hover:text-fg")}
                onClick={() => setIsMarket(false)}
              >
                Limit
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-fg-faint">
              {orderTypeHelp(action, isMarket)}
            </p>
          </div>

          {/* Limit price — disabled (and visually muted) for market orders. */}
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-fg-faint">
              {priceLabel}
            </span>
            <input
              type="text"
              inputMode="decimal"
              aria-label={priceLabel}
              value={isMarket ? "" : priceInput}
              placeholder={isMarket ? "best available" : undefined}
              onChange={(e) => setPriceInput(e.target.value)}
              disabled={isMarket}
              className="mt-1 w-full rounded-lg border border-line bg-ink-2 px-3 py-2 font-mono text-fg placeholder:text-fg-faint disabled:opacity-40"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-fg-faint">
              Size (tokens)
            </span>
            <input
              type="text"
              inputMode="decimal"
              aria-label="Size (tokens)"
              value={sizeInput}
              onChange={(e) => setSizeInput(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-ink-2 px-3 py-2 font-mono text-fg"
            />
          </label>
        </div>

        {/* Live cost + payoff preview — the "what am I about to do" readout. */}
        {preview && (
          <div className="mt-4 rounded-lg border border-line-soft bg-ink-2/60 p-3">
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-fg-faint">
                {preview.asset === "Yes"
                  ? "You sell"
                  : isMarket
                  ? "Cost (max)"
                  : "Cost"}
              </span>
              <span className="stat-mono text-fg">
                {formatAmount(preview.required)} {preview.asset}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between text-xs text-fg-faint">
              <span>Balance</span>
              <span className="stat-mono">
                {formatAmount(preview.have)} {preview.asset}
              </span>
            </div>
            {(() => {
              const sentence = preview
                ? payoffSentence(action, preview, symbol, strikeLabel)
                : null;
              return sentence ? (
                <p
                  className="mt-2 border-t border-line-soft pt-2 text-xs text-fg-dim"
                  data-testid="payoff-line"
                >
                  {sentence}
                </p>
              ) : null;
            })()}
          </div>
        )}

        {guard.blocked && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-amber/40 bg-amber/10 p-3 text-sm text-amber"
          >
            {guard.message}
          </div>
        )}

        {formError && !guard.blocked && (
          <div role="alert" className="mt-4 text-sm text-no">
            {formError}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <Button
            variant={isBuy ? "accent" : sideTone}
            className="flex-1"
            data-testid="confirm-trade"
            disabled={busyOrSubmitting || guard.blocked || !user}
            onClick={submit}
          >
            {!user
              ? "Connect wallet"
              : busyOrSubmitting
              ? "Submitting…"
              : `Confirm ${ACTION_LABEL[action]}`}
          </Button>
          <Button
            variant="ghost"
            className="flex-1"
            disabled={busyOrSubmitting}
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
