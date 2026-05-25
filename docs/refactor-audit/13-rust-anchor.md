# 13 — Rust / Anchor program audit

Scope: the on-chain Anchor program at the repo root (`Anchor.toml`, `Cargo.toml`,
`programs/meridian/`). The TS packages are out of scope except where they pin an
on-chain contract (error ordinals / IDL), which is called out below.

## Summary

The program is in unusually good shape for a refactor pass. It is already
clippy-clean at the CI gate (`-D warnings`), uses checked arithmetic
consistently, routes all untrusted-input failures through `require!` / Anchor
errors, and is well-commented (the comments are largely self-contained and
explain *why*, though many still carry `F-0x` / `ADR-00x` / ROADMAP process
references that violate the project's "no ticket refs in comments" rule).

There are **no `unwrap()`/`expect()`/`panic!` sites in non-test code that need
fixing**: the only two `.unwrap()`s in shipping code (`oracle.rs:183`, `:225`)
are on slices whose length is *proven* by a bounds-checked `.get(..)` on the
immediately-preceding line — acceptable runtime invariants, though they can be
made panic-free for free (see M-3). Everything else is in `#[cfg(test)]`.

The real findings are about **duplication** (the market-PDA seed block and the
`CreateStrikeMarket`/`AddStrike` account structs), **one genuinely-dead error
variant** (`InvariantViolated`), and a layer of **process-referencing comments**.
Most of the high-value items are low-risk; anything touching account layout,
seeds, error ordinals, or settlement math is flagged HIGH RISK because the
`include_bytes!(meridian.so)` tests and the off-chain IDL/error-code consumers
depend on byte-for-byte stability.

Counts:
- unwrap/expect/panic in shipping code needing attention: **0** (2 provably-safe `.unwrap()`s, optionally hardenable)
- dead code, high-confidence: **1** (`MeridianError::InvariantViolated`)
- duplication clusters worth addressing: **2** (market-seed block ×11; create/add-strike structs)
- comment-policy (process refs) cleanups: **pervasive** (every module header + many inline)

## Tooling output (clippy default + pedantic excerpts)

`cargo clippy -p meridian --lib` (default lints): **clean, zero warnings.**

> The full `cargo clippy --workspace --all-targets` fails to *compile the test
> targets* only because `target/deploy/meridian.so` isn't built in this worktree
> (`include_bytes!` in `tests/common/mod.rs:132` etc.). That's an environment
> artifact, not a code issue — the library itself checks clean.

`cargo clippy -p meridian --lib -- -W clippy::pedantic` category counts (advisory only):

```
 36 missing_errors_doc        ← noise: every Anchor handler returns Result
 20 needless_pass_by_value    ← noise: Anchor handlers MUST take Context/Args by value
 13 doc_markdown              ← minor: e.g. `PRICE_SCALE`, `Config.usdc_mint` want backticks
  7 cast_lossless             ← style: `x as u128` → `u128::from(x)`
  4 map_unwrap_or             ← style: `.map(..).unwrap_or(0)` → `.map_or(0, ..)`
  4 cast_sign_loss            ← oracle.rs exponent/price casts (deliberate, guarded)
  2 cast_possible_truncation  ← oracle.rs (guarded by checked range)
  2 too_many_lines            ← matching::cross_incoming (135), match_orders::handler (112)
  2 must_use_candidate
  1 wildcard_imports          ← the lib glob re-exports (intentional, see lib.rs allow)
  1 unnecessary_wraps         ← admin_pause::set_paused returns Result<()> but never errs
  1 missing_panics_doc
```

The pedantic output is dominated by two categories (`missing_errors_doc`,
`needless_pass_by_value`) that are *structurally forced by Anchor* and should NOT
be "fixed" — taking `Context` by reference breaks the `#[program]` dispatch
contract. The signal worth acting on is `map_unwrap_or`, `doc_markdown`, and the
two `too_many_lines` (judgment call).

## Findings (file:line, issue, category)

### Duplication

- **`programs/meridian/src/instructions/{create_strike_market,add_strike,mint_pair,redeem,settle_market,admin_settle,place_order,match_orders,cancel_order,init_order_book,grow_order_book}.rs`** — the Market PDA seed block
  ```
  seeds = [MARKET_SEED, &[market.ticker as u8], &market.strike.to_le_bytes(), &market.trading_day.to_le_bytes()]
  ```
  is copy-pasted verbatim into **11** account structs. *Category: duplication.*
  Inherent to Anchor (seed arrays live inside the `#[account(...)]` macro and
  reference per-account fields, so they can't be hoisted into a plain `const`).
  A `macro_rules!` could DRY it, but at real cost to readability and review
  auditability of security-critical seed derivation. **Low priority / leave as-is
  unless a macro is introduced very carefully** — see Risky calls.

- **`programs/meridian/src/instructions/add_strike.rs:22-94` vs `create_strike_market.rs:26-98`** — the `AddStrike` and `CreateStrikeMarket` `#[derive(Accounts)]` structs are **near-identical** (same admin/config/usdc_mint/market/mint_authority/yes_mint/no_mint/vault/programs, same constraints). The handlers differ only in which event they emit (`StrikeAdded` vs `MarketCreated`), and both delegate to the shared `populate_market`. *Category: duplicated account validation.* The handler logic is already de-duped via `populate_market`; the **accounts struct** is the remaining ~70 lines of duplication. Two separate Anchor account contexts with distinct discriminators are arguably justified (distinct instruction identities + distinct events), but the duplication is worth a comment cross-link at minimum, or consolidation if the two are meant to stay byte-identical. *See Risky calls — do not merge the two instructions; that changes the program's instruction surface.*

### Dead code

- **`programs/meridian/src/error.rs:35-36` `InvariantViolated`** — declared, never constructed anywhere in the program, tests, or off-chain TS (only mirrored in the generated IDL). *Category: dead error variant.* **HIGH RISK to remove**: the enum's doc comment states ordinals are the on-chain error contract and "do not reorder … append new variants at the end." `InvariantViolated` sits *mid-enum* (before `BookFull`, settlement, etc.), so deleting it shifts every later variant's error code, desyncing the deployed program from the IDL and from off-chain code that matches on numeric codes. **Recommendation: keep it, but it's the one true dead variant — at most annotate it.** (Contrast: `MarketAlreadyExists` *looks* dead on-chain — the duplicate-market case is actually caught by Anchor's `init` "account already in use", not this variant — **but it is live off-chain**: `packages/automation/src/markets.ts` matches the literal string `"MarketAlreadyExists"` and code `6005`, and `markets.test.ts` asserts on it. Do **not** remove it.)

### `unwrap()` / panic classification

- **`programs/meridian/src/oracle.rs:183` `slice.try_into().unwrap()`** (inside `read_le!`) — *proven invariant*: `slice` is `data.get(start..end)?` with `end = start + N`, so it is exactly `N` bytes; `try_into::<[u8;N]>()` cannot fail. **Acceptable.** (Optionally hardenable, M-3.)
- **`programs/meridian/src/oracle.rs:225` `.try_into().unwrap()`** — *proven invariant*: the slice is `data.get(pm_off..pm_off+32)?`, exactly 32 bytes. **Acceptable.** (Optionally hardenable, M-3.)
- All other `.unwrap()`s (oracle.rs 285/300/339/353/367, plus assert-style) are in `#[cfg(test)]` — fine.
- No `expect!`, `panic!`, `unreachable!`, `todo!`, or `unimplemented!` anywhere in `src/`.

### Style / smells (pedantic, advisory)

- **`programs/meridian/src/instructions/match_orders.rs:114-115`, `:151`, `:155`** — `book.bids.first().map(|o| o.size).unwrap_or(0)` (×4). `clippy::map_unwrap_or` → `.map_or(0, |o| o.size)`. *Category: style.* Trivial, no behavior change.
- **`programs/meridian/src/instructions/matching.rs:69-75`, `:83-88`** — `.iter().position(...).unwrap_or(len)` same `map_unwrap_or` family. *Category: style.*
- **`programs/meridian/src/instructions/admin_pause.rs:42` `set_paused`** — returns `Result<()>` but can never error (`clippy::unnecessary_wraps`). *Category: style.* Keeping `Result` is defensible for call-site symmetry with the two handlers; low value to change.
- **`programs/meridian/src/oracle.rs`** — `cast_lossless` / `cast_sign_loss` / `cast_possible_truncation` (e.g. `self.price as u128` at :108/:157, `shift as u32` at :116/:121). All are deliberate and guarded (sign checked via `require!(price >= 0)`, magnitude via `checked_*`/`try_from`). *Category: style.* `x as u128` → `u128::from(x)` where the source is unsigned is a safe readability win; the signed casts are correct as written.
- **`programs/meridian/src/events.rs:80`, `add_strike.rs:36`, and ~11 others** — doc comments reference `PRICE_SCALE`, `Config.usdc_mint`, etc. without backticks (`clippy::doc_markdown`). *Category: doc style.* Cosmetic.
- **`programs/meridian/src/instructions/matching.rs:162` `cross_incoming` (135 lines)** and **`match_orders.rs:103` `handler` (112 lines)** — `too_many_lines`. *Category: module structure.* Both are genuinely long but already cleanly phased (plan → settle → apply) with comments per phase. Extracting the per-side transfer arm of `cross_incoming` into a helper would cut it under the limit and reduce the Bid/Ask transfer duplication. Judgment call; not required.

### Comment policy (project rule: self-contained, no ticket/process refs)

- Pervasive `F-01`/`F-02`/…/`F-06`, `ADR-004`/`ADR-005`, ROADMAP `concern #N`, and
  adversarial-review tags (`H-1`, `M-1`, `M-4`, `L-1`) throughout module headers
  and inline comments. Examples: `lib.rs:3`, `constants.rs:3-6,99`, `error.rs:5-8`,
  `state.rs:4`, every instruction module header, `matching.rs:98-99` (`H-1`/`L-1`/`M-1`),
  `place_order.rs:117` (`M-4`). *Category: unhelpful/process-referencing comments.*
  The *content* is good and worth keeping; the **references** ("per F-01 adversarial
  review", "ARCHITECTURE §7.1", "ROADMAP concern #2") should be rewritten to be
  self-contained (state the invariant, drop the citation). This is the single
  largest-surface, lowest-risk cleanup. Pure comment edits — zero effect on the
  compiled `.so`.

## Recommendations

- **medium — Rewrite process-referencing comments to be self-contained.**
  Strip `F-0x` / `ADR-00x` / ROADMAP-`concern` / `H-1`-style review tags across all
  `src/` files; keep the explanatory content, drop the citations. Blast radius:
  comments only; no impact on `meridian.so`, IDL, or tests. Largest surface but
  lowest risk. (Matches the comment rules applied on the TS side.)

- **medium — Apply the safe pedantic style fixes.**
  `map_unwrap_or` (match_orders ×4, matching ×2) → `map_or`; unsigned `as u128`
  → `u128::from` in oracle.rs; add doc backticks. Blast radius: in-function only,
  no behavior/layout change. Verify with `cargo clippy -p meridian --lib` after.
  Leave the Anchor-forced `missing_errors_doc` / `needless_pass_by_value` /
  `wildcard_imports` alone (they're already `#[allow]`ed or structurally required).

- **low — De-duplicate the `CreateStrikeMarket` / `AddStrike` account structs OR cross-link them.**
  Handlers already share `populate_market`; the accounts struct is the remaining
  ~70 duplicated lines. Cheapest safe move: add a comment in each pointing at the
  other and stating they must stay in sync. Do **not** merge the two instructions
  (changes the instruction surface / IDL). HIGH RISK if you touch the accounts'
  order or constraints.

- **low — Optionally harden the two oracle `.unwrap()`s (M-3).**
  Replace `slice.try_into().unwrap()` with `.try_into().map_err(|_| error!(MeridianError::InvalidArgument))?`
  in `read_le!` (oracle.rs:183) and the feed-id read (oracle.rs:225). They are
  provably infallible today, but this removes the only panic-capable paths in
  shipping code at no cost. Blast radius: oracle.rs only; behavior identical on
  all valid inputs; covered by existing parser tests. (Defensive, not a bug.)

- **low — Leave `InvariantViolated` in place.**
  It's the one genuinely-dead variant, but removing it shifts on-chain error
  ordinals and desyncs the IDL — not worth it. If anything, add a one-line note
  that it's reserved/unused. HIGH RISK to delete.

- **(do not do) — Don't macro-fy the market-seed block.**
  The 11× repetition is real but the block is security-critical PDA derivation;
  a `macro_rules!` hides it from line-by-line review and risks a derivation
  mismatch that would orphan every existing market account. Not worth the risk.

## Risky calls (account layout / seed / math changes — must not break existing on-chain state or the `include_bytes!` meridian.so tests)

- **Account layout is frozen.** `Config`, `Market`, `OrderBook`, `Order`,
  `TickerConfig`, and all enums (`Ticker`, `MarketState`, `Outcome`, `OrderSide`)
  have fixed on-chain byte layouts and borsh ordinal encodings (state.rs spells
  this out: enums have no explicit discriminants, ordinal order *is* the wire
  format). **Do not reorder fields/variants, add/remove fields, or change
  `#[max_len]`/`ORDERBOOK_N`/`NUM_TICKERS`.** Any such change breaks deserialization
  of deployed accounts and the IDL.
- **Error enum ordinals are a contract.** Deleting/reordering any `MeridianError`
  variant (incl. the dead `InvariantViolated`) shifts numeric codes consumed by
  the IDL and by `packages/automation` (string + `6005`-style code matches). Append-only.
- **PDA seeds are frozen** (constants.rs documents the full derivation contract and
  warns F-06/SDK derive identically). Don't rename seed consts or alter the seed
  byte order in any account struct.
- **Settlement math** (`write_settlement`'s `>= strike → YesWins` boundary,
  `oracle::to_usdc_base_units` rescaling, `fill_usdc` telescoping, `bid_cost_ceil`
  rounding) is consensus-critical and escrow-exact. Do not "simplify" any of it;
  the dust-free telescoping and ceil-rounding are load-bearing for the
  collateralization invariant. Changes here are HIGH RISK and need on-chain tests.
- Any change above must be validated against the `include_bytes!(meridian.so)`
  tests (SDK/automation load the compiled program), which means a rebuild of the
  `.so` and a full `cargo test --workspace` before trusting green.

## Conflicts / dependencies with other concerns

- **TS/IDL concern overlap:** the error-enum ordinals, event field shapes
  (`events.rs`), instruction args, and PDA seeds are mirrored in
  `packages/sdk/src/idl/meridian-idl.ts` and matched by `packages/automation` /
  `packages/ops`. Any auditor touching those packages must NOT "remove unused"
  the on-chain side (e.g. `MarketAlreadyExists`) and vice-versa — they're coupled.
- **Comment-cleanup concern:** the process-reference stripping recommended here is
  the same policy being applied to the TS side; coordinate so the wording style
  matches across both halves of the repo.
- No source-code edits were made by this audit (read-only). The only write was
  this report.
