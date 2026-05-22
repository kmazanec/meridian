"use client";

import { useMemo, useState } from "react";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  buildTradeIntent,
  TradeAction,
  type MarketAccount,
  type OrderBookAccount,
  type UserPosition,
  type MeridianProgram,
} from "@meridian/sdk";
import { makerAccountsFor } from "@/lib/crossing";
import {
  yesSideFor,
  yesPriceFor,
  isNoAction,
  validateTradeForm,
  parsePrice,
  parseSize,
} from "@/lib/tradeForm";
import { checkPositionConstraint } from "@/lib/positionGuard";
import { Button, Panel, cx } from "@/components/ui";

const ACTIONS: { action: TradeAction; label: string; variant: "yes" | "no" }[] =
  [
    { action: TradeAction.BuyYes, label: "Buy Yes", variant: "yes" },
    { action: TradeAction.SellYes, label: "Sell Yes", variant: "yes" },
    { action: TradeAction.BuyNo, label: "Buy No", variant: "no" },
    { action: TradeAction.SellNo, label: "Sell No", variant: "no" },
  ];

/** What the panel reports about a submitted trade (for cost-basis tracking). */
export interface TradeFill {
  action: TradeAction;
  /** The price in the action's own perspective (Yes price / No price). */
  price: BN;
  /** Size in token base units. */
  size: BN;
}

/**
 * The position-aware four-button trade panel. Every action routes through the SDK's
 * `buildTradeIntent` (never re-derived here) into a single transaction, with maker
 * accounts computed from the live book for marketable orders. The position-constraint
 * guard (client-side only) blocks acquiring the opposite side while holding one.
 */
export function TradePanel({
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
  program: MeridianProgram;
  user: PublicKey | null;
  market: MarketAccount;
  marketAddress: PublicKey;
  book: OrderBookAccount | null;
  position: UserPosition | null;
  usdcMint: PublicKey | null;
  /** Send the built instructions (one wallet approval). Injected for testing. */
  onSubmit: (
    instructions: import("@solana/web3.js").TransactionInstruction[],
    fill: TradeFill
  ) => Promise<unknown>;
  busy?: boolean;
}) {
  const [action, setAction] = useState<TradeAction>(TradeAction.BuyYes);
  const [priceInput, setPriceInput] = useState("0.50");
  const [sizeInput, setSizeInput] = useState("1");
  const [isMarket, setIsMarket] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const guard = useMemo(
    () => checkPositionConstraint(action, position),
    [action, position]
  );

  const submit = async () => {
    setFormError(null);
    if (!user || !usdcMint) {
      setFormError("Connect a wallet to trade.");
      return;
    }
    const price = parsePrice(priceInput) ?? new BN(0);
    const size = parseSize(sizeInput);
    if (!size) {
      setFormError("Enter a valid size.");
      return;
    }
    const valid = validateTradeForm({ action, price, size, isMarket });
    if (!valid.ok) {
      setFormError(valid.error ?? "Invalid trade.");
      return;
    }
    if (guard.blocked) {
      setFormError(guard.message ?? "Close the opposite position first.");
      return;
    }

    // Compute maker accounts to cross from the live book, in the Yes-book frame.
    const makerAccounts =
      book && usdcMint
        ? makerAccountsFor({
            book,
            side: yesSideFor(action),
            price: yesPriceFor(action, price),
            size,
            isMarket,
            usdcMint,
            yesMint: market.yesMint,
          })
        : [];

    const built = await buildTradeIntent(program, user, {
      market: marketAddress,
      action,
      price,
      size,
      isMarket,
      usdcMint,
      makerAccounts,
    });
    await onSubmit(built.instructions, { action, price, size });
  };

  const priceLabel = isNoAction(action) ? "No price ($)" : "Yes price ($)";

  return (
    <Panel>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACTIONS.map((a) => (
          <Button
            key={a.action}
            variant={action === a.action ? a.variant : "ghost"}
            aria-pressed={action === a.action}
            onClick={() => setAction(a.action)}
          >
            {a.label}
          </Button>
        ))}
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-fg-faint">
            {priceLabel}
          </span>
          <input
            type="text"
            inputMode="decimal"
            aria-label={priceLabel}
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            disabled={isMarket}
            className="mt-1 w-full rounded-lg border border-line bg-ink-2 px-3 py-2 font-mono text-fg disabled:opacity-40"
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

        <label className="flex items-center gap-2 text-sm text-fg-dim">
          <input
            type="checkbox"
            checked={isMarket}
            onChange={(e) => setIsMarket(e.target.checked)}
          />
          Market order (take any price)
        </label>
      </div>

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

      <Button
        variant={action.startsWith("BUY") ? "accent" : "ghost"}
        className={cx("mt-4 w-full")}
        data-testid="submit-trade"
        disabled={busy || guard.blocked || !user}
        onClick={submit}
      >
        {!user
          ? "Connect wallet"
          : busy
          ? "Submitting…"
          : ACTIONS.find((a) => a.action === action)?.label}
      </Button>
    </Panel>
  );
}
