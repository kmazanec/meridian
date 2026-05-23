/**
 * Translate trade failures into readable text, and detect the empty-book case before sending.
 * The wallet wraps on-chain failures as a generic "Unexpected error"; this maps the common,
 * actionable causes to plain language so the user knows what to do.
 */

/** True when a market order has no crossable liquidity (no makers found on the book). */
export function marketOrderHasNoLiquidity(opts: {
  isMarket: boolean;
  makerCount: number;
}): boolean {
  return opts.isMarket && opts.makerCount === 0;
}

/**
 * Map a raw error (from the wallet/RPC/SDK) to a clear, user-facing message. Falls back to
 * the original message, then a generic line. Matches on substrings so it survives minified
 * production bundles where class names are mangled but the underlying text often survives in
 * logs (and on the SDK-thrown precondition messages, which are not minified).
 */
export function readableTradeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const text = raw.toLowerCase();

  // SOL fee shortfall (check first — more specific than the generic token case).
  if (text.includes("insufficient lamports") || text.includes("insufficient funds for rent")) {
    return "Not enough SOL to pay the network fee. Add devnet SOL and try again.";
  }
  // Token (USDC/Yes/No) shortfall — the mint/transfer failed for lack of balance.
  if (
    text.includes("insufficient") ||
    text.includes("insufficient funds")
  ) {
    return "Insufficient funds for this trade. Check your USDC (or token) balance.";
  }
  if (text.includes("user rejected") || text.includes("rejected the request")) {
    return "You rejected the transaction in your wallet.";
  }
  if (text.includes("blockhash") || text.includes("block height exceeded")) {
    return "The transaction expired before confirming. Please try again.";
  }
  if (text.includes("429") || text.includes("too many requests")) {
    return "The network is rate-limiting requests. Wait a moment and try again.";
  }
  // Fall back to the original message if it's meaningful, else a generic line.
  if (raw && !text.includes("unexpected error")) return raw;
  return "The transaction could not be completed. Please try again.";
}
