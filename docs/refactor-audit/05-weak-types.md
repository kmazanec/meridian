# 05 — Weak types audit

Read-only audit of escape-hatch / weak types across `packages/*` (sdk, automation,
traders, web, e2e, ops). Scope: `any`, `as any`, `as unknown as`, `as never`,
unjustified `unknown`, non-null `!`, `Function`, `object`, untyped catch, and
`@ts-ignore`/`@ts-expect-error`.

All proposed replacements were validated by reading the actual library `.d.ts`
files in `node_modules/@anchor-lang/core` and by compiling throw-away type-probe
files against the real package (results noted inline). No source was edited.

## Summary

The codebase is, on the whole, **strongly typed and disciplined**. There are:

- **0** `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` anywhere (src or tests).
- **0** `useState<any>`, `useRef<any>`, or React event-handler `any`.
- **0** `Record<string, any>`, `Array<any>`, `Promise<any>`.
- Most `unknown` is **correct** — it sits at trust boundaries (JSON parse, decoded
  on-chain events, fetch responses) and is immediately narrowed/validated, or it is
  typed error-narrowing in `catch`. Those are KEEP.

The real weak-type debt is concentrated in **one root cause** with a wide blast
radius, plus a handful of localized casts:

| Pattern | Sites (src, excl. tests) | Severity |
| --- | --- | --- |
| `as unknown as` around `program.account.*.fetch/all()` (Anchor decode) | 7 | **high** (one fix clears most) |
| `as never` to pass a partial provider into `getProgram` | 6 | **medium** |
| `as unknown as MeridianProgram` / `MERIDIAN_IDL as Idl` in `getProgram` | 1 | **high** (the root cause of the above) |
| `: any` / `as any` in the lazy Pyth receiver NodeWallet shim | 4 | **medium** |
| `dataset as unknown as Dataset` (JSON import vs interface) | 2 | **low/keep** |
| Non-null `!` (invariant-backed) in src | 5 | **low** |
| `onSubmit … => Promise<unknown>` component props | 4 | **low** |
| `ev as unknown as DecodedEvent` (EventParser `data: any` upstream) | 1 | **low** |
| Mocha dynamic-dispatch casts in e2e `localValidator.ts` | ~6 | **keep** |

Total weak-type sites in **src** (excluding legitimate `unknown`/catch and tests):
**~30**, of which **~14 collapse from a single SDK fix** (the `Program<Meridian>`
generic).

## Findings

### THE ROOT CAUSE — `getProgram` loses the `Meridian` type parameter

**`packages/sdk/src/program.ts:31-33`**

```ts
return new Program(
  MERIDIAN_IDL as Idl,                 // widens to Idl
  provider
) as unknown as MeridianProgram;       // then forcibly re-narrows
```

`@anchor-lang/core`'s `Program` constructor is `constructor(idl: any, …)` — the
`IDL` type parameter is **not** inferred from the argument
(`node_modules/@anchor-lang/core/dist/cjs/program/index.d.ts:238`). So
`new Program(MERIDIAN_IDL as Idl, provider)` produces `Program<Idl>` (the default),
and the author "fixes" it with `as unknown as MeridianProgram`. The `as Idl` widen
is what forces the subsequent `as unknown as`.

**Proposed strong replacement** (verified by compiling a probe):

```ts
return new Program<Meridian>(MERIDIAN_IDL, provider);
```

`MERIDIAN_IDL` is already typed `Meridian` (`idl/index.ts` re-exports it as such),
and `Meridian` is assignable to the constructor's `idl: any`. Supplying the explicit
`<Meridian>` type argument yields `Program<Meridian>` directly — **no cast at all**.
Source of the strong type: `Program<Meridian>` where `Meridian` is the Anchor-
generated IDL type in `packages/sdk/src/idl/meridian-type.ts`.

**Why this matters:** once `MeridianProgram` is a true `Program<Meridian>`, the
`AccountClient` for each account is typed `T = IdlAccounts<Meridian>[A]`
(`node_modules/@anchor-lang/core/dist/cjs/program/namespace/account.d.ts:36`), so
`fetch`/`fetchNullable` return `T` and `.all()` returns `ProgramAccount<T>[]` —
strongly typed. **That removes the need for the hand-rolled `Raw*` interfaces and
the `as unknown as` casts in every reader below.**

### SDK — `packages/sdk/src/reads.ts` (all flow from the root cause)

- **`reads.ts:125`** — `const r = raw as unknown as { admin … bump }` after
  `program.account.config.fetchNullable`. Proposed: `fetchNullable` already returns
  `IdlAccounts<Meridian>["config"] | null` once the program is properly typed; drop
  the cast and consume `raw` directly (its enum field `ticker` is an object
  assignable to the existing `tickerFromArg(… as Record<string, unknown>)`).
- **`reads.ts:153`** — `const r = raw as unknown as Record<string, unknown>` for a
  market, then ~12 `r.x as BN`/`as PublicKey` field casts. Proposed: type `raw` as
  `IdlAccounts<Meridian>["market"]`; fields `strike`/`tradingDay`/`pairsMinted`/
  `winningRedeemed` are `BN`, `yesMint`/`noMint`/`vault`/`orderBook` are
  `PublicKey`, `settlementPrice`/`settledAt` are `BN | null`, `bump`/`vaultBump`/
  `mintAuthorityBump` are `number`, and `state`/`outcome`/`ticker` are tagged-enum
  objects accepted by the existing `enumKey`/`normalizeOutcome`/`tickerFromArg`.
  **Verified**: a probe assigning these into the existing `MarketAccount` interface
  compiled clean.
- **`reads.ts:196`** — `as unknown as { market … bump }` for an order book.
  Proposed: `IdlAccounts<Meridian>["orderBook"]`; `bids`/`asks` element `.side` is an
  object accepted by `orderSideFromArg`.
- **`reads.ts:235`** — `(await program.account.orderBook.all()) as unknown as
  RawOrderBookEntry[]`. Proposed: drop cast; `.all()` returns
  `ProgramAccount<IdlAccounts<Meridian>["orderBook"]>[]` (i.e. `{ publicKey, account }`)
  — the hand-rolled `RawOrderBookEntry` interface (lines 213-222) becomes dead and
  can be deleted.

Source for all four: `IdlAccounts<Meridian>` +
`ProgramAccount<T>` from `@anchor-lang/core` (publicly exported via
`program/namespace/types` and `…/account`).

### traders / web / ops — same `.all()` cast, same fix

- **`packages/traders/src/context.ts:58`** — `as unknown as RawMarketAll[]`. Replace
  hand-rolled `RawMarketAll` (lines 44-52) with
  `ProgramAccount<IdlAccounts<Meridian>["market"]>[]`; `r.account.state` /
  `.ticker` stay object-typed for `Object.keys(...)[0]` / `tickerFromArg`.
- **`packages/web/src/lib/discovery.ts:89`** — `as unknown as RawMarketAccount[]`.
  Same replacement; `RawMarketAccount` interface becomes
  `ProgramAccount<IdlAccounts<Meridian>["market"]>`.
- **`packages/ops/src/settleDue.ts:104`** — `as unknown as RawMarketAll[]`. Same.

### SDK — `packages/sdk/src/pyth.ts` (lazy Pyth receiver wallet shim)

- **`pyth.ts:132`** `signTransaction: async (tx: any)`,
  **`:137`** `signAllTransactions: async (txs: any[])`,
  **`:146`** `wallet: wallet as any`. The shim must accept **both** a legacy
  `Transaction` (`tx.partialSign`) and a `VersionedTransaction` (`tx.sign([...])`).
  Proposed strong type:
  `tx: Transaction | VersionedTransaction` (from `@solana/web3.js`, already imported
  in this file), and for the receiver's wallet param use the `Wallet` type
  re-exported by `@anchor-lang/core` (used in `program.ts`) or
  `@coral-xyz/anchor`'s `Wallet`. `signTransaction` would need a generic
  `<T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>` to match the
  receiver SDK's `Wallet` interface. **Risk: medium** — the optional peer dep
  `@pythnetwork/pyth-solana-receiver` defines its own `Wallet` shape; the exact
  generic must match *its* signature, so this one needs the peer-dep types open
  while editing. The `as any` on the wallet object may still be reducible to a single
  structural `Wallet` cast rather than `any`.

### web — JSON-import vs interface (low / borderline KEEP)

- **`packages/web/functions/api/price.ts:54`** and
  **`packages/web/functions/api/intraday.ts:52`** —
  `const CURVES = dataset as unknown as Dataset` where `dataset` is
  `import … from "./_intraday-curves.json"`. TS infers a deep literal type from the
  JSON that does not structurally match the hand-written `Dataset`
  (`Record<string, DayCurve[]>` index signature vs the inferred fixed keys), so a
  direct `as Dataset` fails and `as unknown as` is used. Cleaner alternative: a
  one-line `*.json` module-augmentation `.d.ts` typing the import as `Dataset`, then
  drop the cast. Low value; acceptable to KEEP.

### Non-null assertions in src (low; invariant-backed)

- **`web/src/lib/leaderboardData.ts:202`** — `ownerKeys.get(k)!` where `k` was added
  to `ownerKeys` in the same loop. Avoidable by iterating `ownerKeys.values()`.
- **`web/src/lib/results.ts:128`** — `settledMarkets.get(pos.market)!`; `pos` is only
  built from settled markets. True invariant; could throw explicitly.
- **`web/src/lib/useChain.ts:198`** — `publicKey!`, `market!`, `usdcMint!` guarded by
  an `enabled` boolean (computed from `!!` checks two lines up) that TS can't narrow
  through. Replace the `enabled` indirection with inline `market && publicKey &&
  usdcMint ? … : …` to let TS narrow without `!`.
- **`ops/src/lifecycle.ts:184, 214`** — `book!` after `fetchOrderBook(): … | null`.
  Add `if (!book) throw new Error("book not found")` before use. (Script/dev path.)

### Component callback props returning `Promise<unknown>` (low)

- **`web/src/components/trade/TradePanel.tsx:82`**,
  **`admin/PauseControl.tsx:25`**, **`admin/SettleControl.tsx:34`**,
  **`admin/AddStrikeControl.tsx:35`** — `onSubmit: (…) => Promise<unknown>`. The
  injected sender is `useSendIx().send`, which actually returns
  `Promise<TransactionSignature>` (`web/src/lib/useSendIx.ts:37,67`). Since these
  components ignore the resolved value, `Promise<void>` is the honest, stronger
  type (a function returning a value is assignable to a `=> Promise<void>` prop).
  `Promise<unknown>` is not *wrong* but is looser than necessary. Low priority.

### EventParser decode cast (low; upstream `any`)

- **`web/src/lib/useHistory.ts:75`** — `ev as unknown as DecodedEvent`. Anchor's
  `EventParser.parseLogs` yields `Generator<Event>` where
  `Event = { name: string; data: any }`
  (`node_modules/@anchor-lang/core/dist/cjs/program/event.d.ts:6-8`) — the `any` is
  *upstream*. The project's `DecodedEvent` (`{ name; data: Record<string, unknown> }`)
  is actually a *stronger* shape. Because `Event.data` is `any`, a plain
  `ev as DecodedEvent` (drop the `as unknown`) already type-checks. Cosmetic
  tightening. (`packages/sdk/src/reads.ts:531` has the identical pattern as
  `as ParsedEvent[]` — already only a single `as`, fine.)

## Recommendations

**high — Type `getProgram` with `new Program<Meridian>(MERIDIAN_IDL, provider)`**
(`packages/sdk/src/program.ts`). Removes the `as Idl` widen and the
`as unknown as MeridianProgram` re-narrow. *Blast radius: large but benign* — it
only **strengthens** the public `MeridianProgram` type. Verified that
`new Program<Meridian>(MERIDIAN_IDL, …)` compiles with no cast. This is the keystone.

**high — Drop the `as unknown as Raw*` casts in the account readers** once the
program is typed: `reads.ts:125,153,196,235`, `traders/context.ts:58`,
`web/discovery.ts:89`, `ops/settleDue.ts:104`. *Blast radius: the hand-rolled
`Raw*` interfaces get deleted; consumers already use the normalized `*Account`
return types, so the public surface is unchanged.* Verified that
`IdlAccounts<Meridian>` fields satisfy the existing `*Account` interfaces and that
the enum objects remain assignable to `Record<string, unknown>` for the
`enumKey`/`tickerFromArg`/`orderSideFromArg` normalizers. Do this **with** the high
item above (it depends on it).

**medium — Replace the `as never` provider casts with a narrowed `getProgram`
parameter type.** `getProgram(provider: Provider)` demands the full
`Provider` interface, but every real caller passes a partial
`{ connection, publicKey, … }` (web `useProgram.ts:40`, automation/traders
`chain.ts`, ops `settleDue.ts`/`createMarkets.ts`/`bootstrap.ts`). `as never`
disables *all* shape checking (a misspelled field wouldn't be caught). Narrow the
param to what Anchor actually needs for read/encode, e.g.
`Pick<Provider, "connection"> & Partial<Provider>`, or accept `Provider` and have
callers use `AnchorProvider`/a tiny typed `readOnlyProvider` returning `Provider`.
*Blast radius: 6 src call sites + a few tests; mechanical.*

**medium — Strengthen the Pyth wallet shim** (`pyth.ts:132,137,146`) to
`Transaction | VersionedTransaction` and the receiver's `Wallet` type. Needs the
optional peer-dep types available; keep the `eslint-disable` removal in sync.

**low** — `Promise<unknown>` → `Promise<void>` on the four component `onSubmit`
props; drop `as unknown` on `useHistory.ts:75`; remove invariant `!`s via explicit
narrowing/guards; optionally a `*.json` `.d.ts` to kill the two `dataset` casts.

## Risky calls (replacements that might cascade type errors)

- **The `Program<Meridian>` change is load-bearing.** It is the safest *and* the
  most far-reaching: it tightens every `program.account.*` return type repo-wide. If
  any consumer was *relying* on the loose `Program<Idl>` (e.g. accessing a field by a
  name that differs from the IDL's camelCase), it would now error. The normalizers
  all go through `enumKey`/`tickerFromArg` on `Record<string, unknown>`, which I
  verified still accept the IDL enum objects, so the risk is low — but this change
  must be typechecked across **sdk, traders, web, ops** together (they all import
  `MeridianProgram`), not package-by-package.
- **Pyth wallet shim**: the receiver SDK's `Wallet.signTransaction` is generic
  (`<T extends …>`). A non-generic replacement (`(tx: Transaction |
  VersionedTransaction) => Promise<…>`) may *not* be assignable to it and could
  reintroduce a cast. Must be edited with `@pythnetwork/pyth-solana-receiver` types
  loaded to confirm the exact generic.
- **`Promise<unknown>` → `Promise<void>`**: harmless for the components, but check
  no test asserts on the resolved signature via these props (tests at
  `TradePanel.test.tsx` mock with `mockResolvedValue(undefined)` — compatible).

## KEEP list (justified `any` / `unknown`)

- **Typed error narrowing in `catch` / `errMessage` helpers** — `unknown` is correct
  (TS `useUnknownInCatchVariables`): `automation/src/morningJob.ts:142`,
  `settlementJob.ts:245`, `markets.ts:127` (`isAlreadyProvisioned`),
  `retry.ts:37`, `traders/src/chain.ts:23` (`isRateLimited`),
  `web/src/lib/tradeErrors.ts:21` (`readableTradeError`), `e2e/src/fixture.ts:487`
  (`isAccountNotFound`), and the `.catch((e: unknown) => …)` in
  `useHistory/useCurrentPrice/useIntradaySession/usePriceHistory/useChain`. These
  coordinate with the **defensive-programming** concern's catch-clause review — keep
  them `unknown`, that's the point.
- **Trust-boundary JSON validation** — `let parsed: unknown; parsed = JSON.parse(...)`
  followed by explicit `Array.isArray` / shape checks, then a narrowing `as number[]`:
  `traders/src/wallet.ts:41-52`, `traders/src/config.ts:85-87`,
  `ops/src/env.ts:131-133`, `automation/src/keypair.ts:50-52`. Exemplary; KEEP.
- **Fetch-response narrowing** — `const body: unknown = await res.json()` then
  guarded field reads: `ops/src/liveCloses.ts:58-61`,
  `ops/src/settleDue.ts:80` (`{ price?: unknown }`), and the web
  `parseCurrentPrice/parseIntraday/parseHistory(json: unknown)` parsers
  (`useCurrentPrice.ts:45`, `useIntradaySession.ts:50`, `usePriceHistory.ts:30`)
  with their `unknown`-typed optional fields. Correct boundary typing; KEEP.
- **`web/src/lib/history.ts:63-69`** `asKey(v: unknown)/asBN(v: unknown)` — runtime
  type guards over decoded-event `data: Record<string, unknown>`. KEEP.
- **`traders/src/agent.ts:150`** `textOf(content: unknown)` — LangChain message
  `content` is genuinely `string | MessageContentComplex[]`; the `unknown` + runtime
  branching is reasonable. The inner `(c as { text?: string })` could be narrowed to
  LangChain's `MessageContentText`, but that's optional polish, not an escape hatch.
- **`traders/src/logger.ts:40,64`** `tool(name, args: unknown)` / `stringify(v:
  unknown)` — a generic logger sink; `unknown` is the right input type. KEEP.
- **e2e `localValidator.ts` Mocha dynamic dispatch** (`148,150,163,164,172,174,183`)
  — a lazy thunk that forwards to `describe`/`describe.skip`/`describe.only`
  resolved at first call. Inherently dynamic; typing it precisely would need a lot of
  machinery for test-only infra. The `as unknown as Mocha.SuiteFunction` /
  `(...a: unknown[]) => unknown` casts are justified. KEEP.
- **`dataset as unknown as Dataset`** (`price.ts:54`, `intraday.ts:52`) — borderline;
  KEEP unless a `.json` `.d.ts` is added (see low rec).
- **Test files' `as unknown as` / `as never` / `!`** (e.g. `tests/harness.ts:68`,
  `sdk/tests/intent.test.ts`, `web/src/lib/*.test.ts`, `e2e/tests/*`) — building mock
  programs/providers/connections. Acceptable in tests; out of scope for hardening.

## Conflicts / dependencies with other concerns

- **Defensive-programming concern (catch clauses):** overlaps directly on every
  `err: unknown` / `catch (e: unknown)` site. We agree those `unknown`s are
  **correct** and should stay — do not let a "remove weak types" pass strip them.
  Coordinate so neither audit proposes changing the other's KEEP items.
- **Duplication concern:** the `Raw*` market interfaces + `as unknown as
  …all()` + enum-normalization (`enumKey`/`normalizeOutcome`) are **duplicated**
  across `sdk/reads.ts`, `sdk/discovery? `→ `web/discovery.ts`, `traders/context.ts`,
  and `ops/settleDue.ts`. The high recommendation here (proper `Program<Meridian>` +
  `IdlAccounts`) is the natural enabler for the duplication concern to **consolidate**
  these into a single shared `@meridian/sdk` reader/normalizer. Sequence: do the
  weak-type `Program<Meridian>` fix **first**, then the de-dup.
- **Ordering constraint:** the SDK `program.ts` change must land before (or with) the
  reader cast-removals in traders/web/ops, since those depend on the strengthened
  `MeridianProgram` type. Treat them as one atomic change set and typecheck all four
  packages together.
