import type BN from "bn.js";
import { TradeAction } from "@meridian/sdk";

/**
 * The client-side position-constraint guardrail (ADR-006). A user shouldn't
 * *persistently* hold both Yes and No for one strike — holding both is a redeemable
 * $1.00 with nothing to trade. This is a **UX guardrail, enforced only here**; the
 * program deliberately does not prohibit it (the Buy-No mint mechanic transiently
 * holds both), so this never claims to be a fund-safety control.
 *
 * The rule: don't let an action that *acquires the opposite side* go through while the
 * user already holds the other — guide them to close it first.
 *   - holding **No** → block **Buy Yes** (would create a both-sides position)
 *   - holding **Yes** → block **Buy No**
 * Selling either side (reducing exposure) is always allowed.
 */
export interface Position {
  yes: BN;
  no: BN;
}

export interface GuardResult {
  blocked: boolean;
  /** A human message + the suggested exit action when blocked. */
  message?: string;
  exitAction?: TradeAction;
}

export function checkPositionConstraint(
  action: TradeAction,
  pos: Position | null
): GuardResult {
  if (!pos) return { blocked: false };
  const holdsYes = pos.yes.gtn(0);
  const holdsNo = pos.no.gtn(0);

  if (action === TradeAction.BuyYes && holdsNo) {
    return {
      blocked: true,
      message:
        "You hold No for this strike. Close your No position before buying Yes — holding both just locks up $1.00.",
      exitAction: TradeAction.SellNo,
    };
  }
  if (action === TradeAction.BuyNo && holdsYes) {
    return {
      blocked: true,
      message:
        "You hold Yes for this strike. Close your Yes position before buying No — holding both just locks up $1.00.",
      exitAction: TradeAction.SellYes,
    };
  }
  return { blocked: false };
}
