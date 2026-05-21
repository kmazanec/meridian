# RESEARCH.md — Background & Architecture Primer for "Meridian"

> **Who this is for:** A competent software engineer who is new to crypto / web3.
> **Goal:** By the end of this document you should understand *every* concept needed to build and defend the architecture of Meridian, and you should be able to explain why we picked the stack we picked.
> **Date of research:** 2026-05-20. Crypto moves fast — versions, feed lists, and "what's on devnet" change. Re-verify the load-bearing facts (especially oracle stock feeds on devnet, see the big caveat in Part 2) before committing to the plan.

---

## 0. What we're building (one paragraph, so the rest has context)

**Meridian** is a non-custodial decentralized app ("dApp") for trading *binary stock-outcome contracts*. Each contract asks a yes/no question: **"Will [STOCK] close at or above [STRIKE] today?"** It pays **$1.00 USDC if yes, $0 if no**. Contracts are *same-day* (called **0DTE** — "zero days to expiry") and settle at **4:00 PM ET** using an on-chain price **oracle**. The underlying stocks are the "MAG7": AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA. Users trade two complementary tokens — **Yes** and **No** — on an on-chain **Central Limit Order Book (CLOB)**. By construction, **Yes + No always equals $1.00**. No identity checks ("KYC"), no custody of user funds, no borrowing ("margin").

The mechanics in one breath: deposit **$1.00 USDC** into a **vault** to **mint a pair** (1 Yes + 1 No). Trade either token on an order book. After 4:00 PM ET, the market **settles**; holders of the winning token **redeem** each one for **$1.00 USDC** from the vault. On-chain rules (invariants) guarantee the vault always holds exactly $1.00 per outstanding pair, and that total payouts never exceed deposits.

Everything below teaches you the concepts and the stack needed to do this on **Solana**.

---

# PART 1 — CRYPTO FUNDAMENTALS

This part assumes zero crypto knowledge. Every term is defined on first use.

## 1.1 What is a blockchain? "On-chain" vs "off-chain"

A **blockchain** is a shared database (a ledger) that is replicated across thousands of independent computers ("nodes") and updated by consensus rather than by a single owner. Think of it as **a giant public Google Sheet that nobody can secretly edit** — every change is signed, every change is visible, and a network of strangers agrees on the contents.

Key properties that make it different from a normal database:

- **Append-only & tamper-evident:** new data is added in batches called **blocks**, each cryptographically chained to the previous one (hence "block-chain"). Rewriting history would require redoing all the work and out-voting the network.
- **Permissionless:** anyone can read it and (usually) anyone can submit changes, as long as they pay the fee and follow the rules.
- **Deterministic & verifiable:** given the same inputs, every node computes the same result, so they can all agree on the new state without trusting each other.

**On-chain** = data or logic that lives *inside* this shared ledger. It is public, verifiable by anyone, and enforced by the network's rules. For Meridian, the vault, the Yes/No tokens, the settlement rule, and (in our design) the order book are **on-chain**. They cannot be quietly changed and don't require trusting us.

**Off-chain** = anything that happens on normal servers/computers *outside* the ledger. It's fast and cheap but you must trust whoever runs it. For Meridian, our **automation service** (a Node.js/TypeScript program that creates each morning's markets and triggers settlement after 4 PM) runs off-chain. Crucially, it has **no special privileges** — it can only call the same public functions any user could call. The *enforcement* is on-chain; the *scheduling* is off-chain.

> **Analogy:** On-chain is the official referee and rulebook everyone can see. Off-chain is the team assistant who reminds the referee "hey, it's 4 PM, time to blow the whistle." The assistant can't change the score.

## 1.2 Wallets, keys, signing, and "non-custodial"

A crypto **wallet** is not a place where money is stored. It's a **keychain**. It holds a pair of cryptographic keys:

- **Public key** (and an address derived from it): like your **account number / email address**. You can share it freely; people send funds to it.
- **Private key**: like the **password that can move the money**, except there is no "reset password" — whoever holds the private key controls the funds. Period.

**Signing a transaction:** When you want to do something (send tokens, place an order), your wallet uses your private key to produce a **digital signature** over the transaction's contents. The network verifies the signature against your public key. This proves *you* authorized *this exact action* without ever revealing your private key. The key never leaves your device.

> **Analogy:** A signature is like a tamper-proof wax seal that only your ring can make, and anyone can check the seal matches your ring — but nobody can forge the ring.

**Non-custodial** means **the app never takes possession of your private keys or your funds.** You sign every action yourself from your own wallet. Contrast with a **custodial** exchange (like a centralized exchange) where you deposit money into *their* account and trust them to give it back. Famous custodial blowups (FTX) lost users billions.

Why this matters for Meridian: we are explicitly **non-custodial**. User USDC sits in their own wallet or in an on-chain vault governed by transparent code — never in a company bank account. We literally *cannot* run off with funds, because we never hold them. This is a core selling point and a core architectural constraint: every value-moving action must be a user-signed transaction or an on-chain rule, never an admin override.

## 1.3 Tokens, fungibility, stablecoins, and USDC

A **token** is a unit of value tracked on a blockchain. Tokens come in two flavors:

- **Fungible:** every unit is identical and interchangeable, like dollars or shares of one stock. 1 USDC = 1 USDC. Meridian's Yes tokens, No tokens, and USDC are all fungible.
- **Non-fungible (NFT):** each unit is unique (a deed, a specific collectible). *Not used in Meridian.*

A **stablecoin** is a token designed to hold a steady value, almost always pegged 1:1 to a fiat currency like the US dollar. Instead of bouncing around like Bitcoin, **1 stablecoin ≈ $1.00**.

**USDC** (USD Coin) is the leading regulated, fully-reserved USD stablecoin, issued by **Circle**. Each USDC is backed by ~$1 of cash and short-term US Treasuries held in reserve, and is redeemable 1:1. ([Circle / USDC](https://www.circle.com/usdc))

Why USDC is Meridian's settlement currency:
- **It's a dollar.** A contract that "pays $1.00 if yes" maps perfectly onto a token worth $1.00. No FX risk, no volatility distorting payouts.
- **It's the most liquid, most trusted stablecoin on Solana**, with a native Solana issuance (not just a bridged copy).
- **It's a standard SPL token** (see Part 2), so all the tooling just works.

> One subtlety: the *settlement asset* (USDC) is stable, but the *thing we're betting on* (stock prices) is volatile. The oracle (1.5) is what connects the volatile real-world price to the on-chain payout.

## 1.4 Smart contracts / on-chain programs, fees, finality

A **smart contract** (Solana calls them **programs**) is **code that lives on the blockchain and runs exactly as written**, enforced by the whole network. Nobody can stop it, censor it, or change its behavior mid-execution (unless the code itself allows upgrades). It's "a vending machine made of code": you put in the right inputs, it deterministically gives the right output, no human in the loop.

For Meridian, the smart contract enforces the rules: *minting requires depositing exactly $1.00; redeeming a winning token pays exactly $1.00; the vault can never pay out more than was deposited.* These are **invariants** — properties the code guarantees are always true.

**Gas / transaction fees:** running code and storing data on a shared network of thousands of computers isn't free. Every transaction pays a small **fee** (Ethereum calls it "gas") to compensate the network and to prevent spam. On Solana these fees are tiny — typically a small fraction of a cent. This matters for an order book where users place and cancel many orders: high fees would make active trading prohibitively expensive (a key reason we chose Solana over Ethereum mainnet — see Part 3).

**Finality** is *when can you be sure a transaction is permanent and irreversible?* Until a transaction is "final," there's a theoretical chance it gets reordered or dropped. Different chains have wildly different finality:

| Chain | Practical confirmation | Notes |
|---|---|---|
| Bitcoin | ~10 min/block, ~60 min "safe" | Slow finality |
| Ethereum L1 | ~12 sec/block, ~13 min full finality | Settlement layer |
| Solana | ~400 ms slot; confirmations in well under a second; full finality ~13 sec today | New "Alpenglow" upgrade targets **~150 ms finality** (see 2.1) |

**Why "sub-second finality" matters for an order book:** In trading, prices move fast and traders cancel/replace orders constantly. If you place an order and have to wait 12+ seconds (or minutes) to know it's locked in, the market has already moved — your order book feels laggy and unsafe, like trading over a satellite delay. Sub-second finality makes an *on-chain* order book feel responsive, closer to a real exchange. This is the single biggest technical reason Meridian targets Solana. ([Solana finality / commitment levels](https://www.helius.dev/blog/solana-commitment-levels))

## 1.5 Oracles: getting outside data onto the chain

Here's a fundamental limitation: **a blockchain cannot see the outside world.** It's a closed, deterministic system — it only knows what's already on-chain. It has no idea what Apple stock costs, what the weather is, or who won an election. (If it tried to call out to the internet, different nodes might get different answers and consensus would break.)

An **oracle** is the bridge that brings external data *onto* the chain in a trustworthy way. It solves the "oracle problem": *how do you get real-world data onto a blockchain without reintroducing a single trusted middleman who could lie?* Good oracles aggregate many independent data sources and publishers, sign the result, and post it on-chain so contracts can read it.

For Meridian, the oracle is **mission-critical and the highest-risk dependency**: settlement (does Yes pay $1 or $0?) depends entirely on a trustworthy AAPL/MSFT/etc. closing price at 4:00 PM ET. If the oracle is wrong, late, or unavailable, the whole product breaks. So you must understand two oracle concepts cold:

- **Staleness:** *How old is this price?* An oracle price has a **publish time** (timestamp). A price from 5 seconds ago is fresh; a price from yesterday is **stale**. Code must check freshness ("give me a price no older than N seconds") and refuse to act on stale data. This is *especially* tricky for stocks because **stock feeds freeze when the market is closed** (nights, weekends) — see the big caveat in Part 2.
- **Confidence interval:** A good oracle reports not just a price but an **uncertainty band** — e.g., "AAPL = \$214.30 ± \$0.05." This is the oracle saying *how sure* it is. In volatile or thin conditions the band widens. Robust contracts factor this in (e.g., refuse to settle if confidence is too wide). For a binary "above strike?" decision exactly at the boundary, the confidence band is genuinely important: if the price is \$214.99 ± \$0.10 and the strike is \$215.00, is the answer really "no"? (We'll address this in design — likely with strikes set away from round prices, and possibly using the official close.)

## 1.6 CLOB: Central Limit Order Book

A **Central Limit Order Book (CLOB)** is the classic exchange mechanism you already know from stock trading — just say it in plain words:

- An **order book** is two sorted lists of resting orders for an asset:
  - **Bids** = buy orders ("I'll buy Yes at \$0.62").
  - **Asks** (offers) = sell orders ("I'll sell Yes at \$0.65").
- The **spread** is the gap between the best bid and best ask.
- A trade happens when a buy and sell **cross** (a buyer willing to pay ≥ a seller's ask).
- **Price-time priority** is the fairness rule for matching: better price wins first; if two orders have the same price, the one placed *earlier* wins. ("First come, first served at each price level.")
- **Maker vs taker:**
  - A **maker** posts a resting order that adds liquidity (sits in the book waiting). They "make" the market.
  - A **taker** submits an order that immediately matches an existing one, removing liquidity. They "take" from the book.
  - Exchanges often charge takers more (or pay makers) to reward liquidity provision.

> **Analogy:** The order book is a bulletin board with "WANT TO BUY" and "WANT TO SELL" sticky notes, sorted by price. A maker pins a note and waits; a taker walks up and grabs the best matching note immediately.

**Meridian's clever twist — one book per strike serves all four actions.** Because **Yes + No = \$1.00**, owning/selling one token is economically the mirror of the other:

- **Buy Yes** at \$0.62  ⟺  **Sell No** at \$0.38
- **Sell Yes** at \$0.65  ⟺  **Buy No** at \$0.35

So we run **one order book per strike: Yes priced against USDC.** The UI flips perspective to present "Buy Yes / Buy No / Sell Yes / Sell No," but under the hood it's a single Yes/USDC book. (To go from "buy No at \$0.38" to a book action, the app either routes you through the Yes book at the complementary price, or first mints a pair and sells the Yes leg. We'll nail this in design — the key insight is *one book, four views*.)

The alternative to a CLOB is an **AMM (Automated Market Maker)** — a formula-based pool (like Uniswap) where you trade against a curve instead of against other orders. AMMs are simpler and always-available but give worse pricing for this kind of "priced near $0–$1" instrument and don't express limit orders well. CLOBs give tight spreads and real limit orders — better UX for a trading product, at the cost of more engineering and more performance pressure on-chain.

---

# PART 2 — THE SOLANA STACK (deep dives)

This is the stack we're actually building on. Read it twice.

## 2.1 Solana architecture for a beginner

Solana is a high-throughput Layer-1 ("L1" = a base blockchain, not built on top of another) optimized for speed and low fees. Its design differs from Ethereum in ways that directly shape how you write Meridian.

### The accounts model (the big mental shift from Ethereum)

On **Ethereum**, a smart contract bundles *code and its data together* — the contract "owns" its storage internally.

On **Solana**, **code and data are separated**:

- **Programs are stateless.** A Solana program is pure logic. It holds *no* data of its own.
- **All state lives in separate "accounts."** An **account** is a chunk of storage on-chain (a blob of bytes) with an owner, a balance, and data. Programs *operate on accounts that are passed to them* as inputs.

> **Analogy:** A Solana program is like a **pure function / a stateless microservice**, and accounts are the **database rows** you pass in and get back. The program is the recipe; accounts are the ingredients and the finished dish. The same program can act on millions of different accounts.

This is *why* Solana is fast: because every transaction must declare up front exactly which accounts it will read and write, Solana can run thousands of non-overlapping transactions **in parallel** (its "Sealevel" runtime). Two trades touching different markets don't block each other. ([Solana accounts model](https://solana.com/docs/core/accounts))

For Meridian this means: the **vault**, each **market's config**, the **order book**, and each user's **token balances** are all *accounts*. Our program is the logic that validates and mutates them.

### SOL, lamports, rent, and compute units

- **SOL** is Solana's native currency, used to pay fees and "rent." 1 SOL = 1,000,000,000 **lamports** (the smallest unit, named after Leslie Lamport).
- **Rent:** Storing data on-chain consumes validators' disk forever, so accounts must hold a minimum SOL balance proportional to their size — the **rent-exempt** minimum. Deposit it once and the account lives indefinitely; close the account and you get it back. (Think of it as a **refundable storage deposit**, not an ongoing subscription.)
- **Compute units (CU):** Solana's version of "gas." Each transaction has a CU budget; complex instructions (like matching many order-book levels) cost more CU and there's a per-transaction cap (~1.4M CU by default, requestable higher). **This cap is a real design constraint for an on-chain order book** — a single transaction can only do so much matching work, which is one reason on-chain CLOBs are hard (see 2.7).

### Program Derived Addresses (PDAs) — crucial for Meridian

A normal account is controlled by a private key (a person). But sometimes you want **a program itself to "own" and control an account** — with no human holding a key. That's a **Program Derived Address (PDA)**.

A PDA is an address **deterministically derived** from a program's ID plus some **seeds** (chosen strings/values), engineered to fall *off* the normal key curve so **no private key exists for it**. Only the program that derived it can "sign" for it (via a mechanism called *invoke-signed*).

> **Analogy:** A PDA is a **company safe whose combination is computed from a formula only the company's software knows**. There's no physical key a human could steal or lose; the program is the only thing that can open it, and only by following its own rules.

Why this is the backbone of a non-custodial design:

- **The vault** holding all the USDC will be a **PDA** owned by Meridian's program. Funds can *only* move according to the program's rules (mint/redeem). No admin, no company, holds a key to it. This is what makes "non-custodial" true rather than marketing.
- **The mint authority** for the Yes/No tokens (the entity allowed to create new tokens — see 2.3) will be a **PDA**. Tokens get minted *only* when a real $1.00 deposit happens, enforced by code, because only the program can authorize minting.

PDAs are also derived from seeds like `["market", stock_id, strike, date]`, so each day's AAPL-\$215 market gets its own deterministic, collision-free set of accounts. The off-chain service and the frontend can both *compute* these addresses without asking anyone.

### Clusters: devnet / testnet / mainnet-beta

Solana runs several networks ("clusters"):

- **mainnet-beta:** the real network with real money. (Confusingly still called "beta" for historical reasons; it *is* production.)
- **devnet:** a free public network for development. Tokens have no value; you get free SOL from a **faucet** (a "give me test tokens" service). **This is where Meridian deploys first.**
- **testnet:** used mainly by validators to test new Solana releases — *not* our target.

> **Important:** "It works on devnet" ≠ "it works on mainnet." Some data (notably oracle feeds — see 2.5 caveat) and some liquidity simply differ between clusters.

### Alpenglow (a fresh, relevant 2026 development)

Solana's biggest-ever consensus overhaul, **Alpenglow**, went live on a community test cluster on **2026-05-11**, replacing the old Proof-of-History + TowerBFT consensus and targeting **~150 ms finality** (roughly a 100x improvement). Validators approved it ~98%–1%; co-founder Anatoly Yakovenko suggested mainnet could land **as soon as Q3 2026** if testing goes well. For Meridian this is upside, not a dependency — even *today's* sub-second confirmations are plenty for our order book, and Alpenglow would only make it snappier. ([CoinDesk: Alpenglow live for testing](https://www.coindesk.com/tech/2026/05/11/the-biggest-consensus-overhaul-in-solana-history-is-officially-live-for-testing), [Solana Compass: Alpenglow](https://solanacompass.com/learn/Lightspeed/alpenglow-solanas-largest-protocol-upgrade-ever-brennan-watt-anza))

## 2.2 Anchor framework

Writing raw Solana programs in **Rust** is powerful but verbose and error-prone: you manually deserialize accounts, hand-check that every passed-in account is the right type/owner/signer, and a single missed check is a security hole. **Anchor** is the de-facto standard framework that removes most of that boilerplate and danger.

What Anchor gives you:

- **Declarative account validation.** Instead of manually verifying accounts, you describe the accounts an instruction expects in a struct with attribute macros, and Anchor generates the checks (right owner? signer? matches this PDA? mutable?). This eliminates a whole category of bugs.
- **The `#[program]` / `#[account]` / `Context` model (conceptually):**
  - `#[program]` marks the module whose functions are your **instructions** (the callable entry points, e.g. `mint_pair`, `redeem`, `place_order`, `settle_market`).
  - `#[account]` marks the Rust structs that define your **on-chain data layouts** (e.g. `Market`, `Vault`).
  - Each instruction takes a **`Context<T>`**, where `T` is a struct listing the accounts that instruction touches, annotated with constraints (`#[account(mut)]`, `seeds = [...]`, `has_one = ...`, etc.). Anchor enforces all of it before your code runs.
- **IDL generation.** Anchor emits an **IDL** (Interface Description Language — a JSON description of your program's instructions and accounts), analogous to an OpenAPI/Swagger spec or a gRPC `.proto`. The TypeScript client and the Node automation service use this IDL to call the program with full typing — no hand-rolled serialization.
- **Better testing & ergonomics:** TypeScript test harness, `anchor build/deploy/test`, account macros for init/close/rent.

> **Analogy:** Raw Solana is like writing an HTTP server by parsing raw sockets and bytes yourself. Anchor is like using a framework (Express/NestJS/Spring) that handles routing, request validation, and serialization so you write business logic, not plumbing.

**Versions (verify before you start):** Anchor `0.31.x` (e.g. `0.31.1`, recommended with Solana `~2.1`) was the long-standing baseline, and Anchor reached **`1.0.x` (latest `1.0.2`, released 2026-05-02)**. The Pyth Solana Receiver SDK pins `anchor-lang 0.31.1`, so confirm compatibility between your Anchor version, your Solana toolchain, and the Pyth/oracle SDK before locking the toolchain. ([Anchor docs](https://www.anchor-lang.com/docs), [Anchor 0.31 release notes](https://www.anchor-lang.com/docs/updates/release-notes/0-31-0), [anchor-lang on docs.rs](https://docs.rs/crate/anchor-lang/latest))

## 2.3 SPL Token program — how Yes/No/USDC tokens actually work

There is no "ERC-20" on Solana. Instead, **all fungible tokens share one canonical program: the SPL Token program** ("SPL" = Solana Program Library). You don't deploy your own token contract; you create accounts that the shared SPL Token program manages. (A newer **Token-2022 / Token Extensions** program adds optional features; classic SPL Token is fine for Meridian.)

Two account types matter:

- **Mint account:** the *definition* of a token — its supply, decimals, and two authorities:
  - **Mint authority:** who is allowed to create (mint) new units. **For Meridian's Yes and No tokens, the mint authority is a PDA owned by our program**, so tokens can be minted *only* when the program sees a valid $1.00 deposit.
  - **Freeze authority:** (optional) who can freeze token accounts. **Meridian should set this to `None`** so balances can never be frozen — reinforcing "non-custodial."
- **Token account / ATA:** a holding for *one specific token by one specific owner*. The standard form is an **Associated Token Account (ATA)** — a PDA deterministically derived from `(owner wallet, mint)`. So "Alice's USDC ATA" and "Alice's Yes-AAPL-215 ATA" have predictable addresses the app can compute. A user has a separate token account per token they hold.

> **Analogy:** The **mint** is the *central registry / printing press* for a currency (defines the dollar, controls printing). A **token account/ATA** is *your personal wallet pocket* for that currency. The SPL Token program is the *shared banking software* every token uses.

**Burning** = permanently destroying tokens (reducing supply). Mapping SPL primitives to Meridian:

| Meridian action | SPL operation |
|---|---|
| **Mint a pair** (deposit $1 USDC) | Transfer 1 USDC from user → vault PDA; program (via mint-authority PDA) **mints** 1 Yes + 1 No into the user's ATAs |
| **Trade** | SPL **transfers** of Yes / USDC between users via the order book |
| **Redeem** (after settlement) | User submits winning tokens; program **burns** them and **transfers** $1.00 USDC each from the vault PDA back to the user |

Every one of these is enforced by program code, and the vault-balance / payout invariants are checked on-chain.

## 2.4 USDC on Solana (devnet vs mainnet, faucets)

- **Mainnet:** native USDC issued by Circle is a standard SPL token with a well-known mint address. It's the real dollar token Meridian uses in production. ([Circle: USDC on Solana](https://www.circle.com/usdc))
- **Devnet:** there is a separate **devnet USDC mint** with no real value, intended for testing. You obtain test USDC from faucets (Circle provides a testnet/devnet faucet; some community faucets and the SPL token CLI can also mint test tokens). Your config must switch the USDC mint address by cluster — devnet USDC ≠ mainnet USDC.

**Practical note:** because addresses differ per cluster, keep a per-cluster config map (USDC mint, oracle program/feed IDs, CLOB program ID). A common bug is hardcoding mainnet addresses and wondering why devnet breaks.

## 2.5 Pyth Network oracle (the heart of settlement) — and the #1 feasibility risk

**Pyth Network** is a leading **first-party financial oracle**: instead of scraping public APIs, Pyth aggregates prices contributed directly by ~100+ professional trading firms, exchanges, and market makers. It's the natural choice on Solana (Pyth was born on Solana) and is **the main oracle offering real-time *US equities* prices on-chain** — exactly what Meridian needs for MAG7 stocks. Pyth advertises 380+ feeds across crypto, equities, ETFs, FX, and commodities, updating roughly every 400 ms. ([Pyth price feeds](https://www.pyth.network/price-feeds), [Pyth: supported asset classes](https://www.pyth.network/blog/supported-asset-classes-by-the-pyth-network))

### How a Solana program reads a Pyth price (the "pull" model)

Modern Pyth on Solana is a **pull oracle**, which is a subtle but important architectural point:

1. **Off-chain fetch (Hermes):** Your client (frontend or our Node service) fetches a signed, fresh price update from Pyth's **Hermes** service using `@pythnetwork/hermes-client`.
2. **Post on-chain:** The client submits that update on-chain via the **Pyth Solana Receiver** program, which **verifies** the data and writes it into a **price update account** (type `PriceUpdateV2`). Anyone can create these; they're cheap and ephemeral.
3. **Consume in your program:** Your instruction takes that price update account as one of its accounts. In Rust (using `pyth-solana-receiver-sdk`) you call **`get_price_no_older_than(...)`**, passing a **maximum age** and the **expected feed ID**. It returns the price *only if* it's fresh enough and matches the right feed; otherwise it errors.

> **Why "pull"?** Instead of Pyth constantly pushing every price to every chain (expensive, wasteful), the consumer "pulls" the exact update they need, exactly when they need it, and pays to post it. For Meridian's once-a-day settlement this is ideal: the Node service pulls the 4:00 PM price and posts it as part of the settlement transaction.

The Pyth Solana **Receiver program ID is the same on mainnet and devnet**: `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`. ([Pyth contract addresses (SVM)](https://docs.pyth.network/price-feeds/core/contract-addresses/solana), [Pyth pull integration on Solana](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana))

### The four numbers a Pyth price gives you

A Pyth price object has:

- **`price`** — an integer.
- **`exponent`** (a.k.a. `expo`) — a power of 10 that scales the integer. **Real price = `price × 10^exponent`.** E.g. `price = 21430000000`, `exponent = -8` → `$214.30`. (Crypto avoids floating point; you must apply the exponent yourself.)
- **`conf`** — the **confidence interval** (uncertainty band) in the same units.
- **`publish_time`** — when the price was produced, used for the **staleness** check.

### THE BIG CAVEAT: do equity feeds publish on **devnet**, and only during **market hours**?

This is **the single most feasibility-critical question for Meridian**, so read carefully and **re-verify live** before committing the plan.

**What I could confirm (2026-05-20):**

1. **Equity feeds follow real US market hours.** Pyth's equities feeds **only update while the underlying market is "open."** Per Pyth's Market Hours docs, US equities update during the standard session (**9:30 AM–4:00 PM ET weekdays**), with extended pre-market (4:00–9:30 AM ET), post-market (4:00–8:00 PM ET), and an overnight session (Sun–Thu, 8:00 PM–4:00 AM ET). **Feeds are closed on weekends and on NYSE holidays.** Outside open hours the feed **freezes/goes stale** — `get_price_no_older_than` will (correctly) refuse to return it. ([Pyth: Market Hours](https://docs.pyth.network/price-feeds/core/market-hours), [Pyth: Best Practices](https://docs.pyth.network/price-feeds/core/best-practices))
   - **Implication for Meridian:** Markets settle at **4:00 PM ET** — right at the *boundary* of the regular session. You must decide precisely *which* price counts as "the close" and handle the moment the regular feed transitions to post-market/freeze. Plan settlement to grab a price at/just-before 4:00 PM ET with a tight staleness window, and define behavior on half-days/holidays. **There is no on-chain trading-day awareness for free — your automation service must encode the market calendar.**

2. **Feed IDs differ by cluster.** Pyth explicitly states price feeds "have different ids in mainnet than in testnet or devnet," and provides a feed-list page with a **network dropdown** to pick "Solana Devnet." So you must look up the *devnet* feed ID for each stock, not reuse mainnet IDs. ([Pyth: Solana price feeds / best practices](https://github.com/pyth-network/pyth-gitbook/blob/main/solana-price-feeds/best-practices.md), [Pyth on Solana (push feeds)](https://docs.pyth.network/price-feeds/core/push-feeds/solana))

3. **What I could *not* fully confirm from docs alone:** the *exact, current* list of **which MAG7 equity feeds are actively publishing on Solana devnet right now**, and how reliably they update on devnet specifically. General docs say Pyth covers equities and that feeds exist on both mainnet and devnet, and the **pull model** means *you* post Hermes updates on-chain regardless of cluster — which suggests you can often get equity prices onto devnet even when sponsored push feeds are absent. But **"equities are covered" is not the same as "AAPL is reliably live on *devnet* during the hours you need."**

> ### OPEN QUESTIONS / CAVEATS (oracle) — put these in the project risk register
> - **[CRITICAL] Verify each MAG7 feed on devnet, live.** Before building settlement, write a tiny script that, on **devnet**, fetches each MAG7 price from Hermes, posts it via the Receiver, and calls `get_price_no_older_than` **during US market hours**. Confirm you get fresh prices for all seven. (Pull model means Hermes is the real source; the Receiver verifies on whatever cluster.)
> - **Confirm market-hours/staleness behavior** end-to-end at ~4:00 PM ET: which timestamp is "the close," and how stale is the feed seconds after 4 PM?
> - **Boundary/confidence risk at the strike.** Decide how to treat prices whose confidence band straddles the strike, and whether to use a last-trade vs official-close concept. Consider choosing strikes off round numbers.
> - **Fallback plan if devnet equity coverage is flaky:** options include (a) test settlement logic on devnet using **crypto feeds** (BTC/SOL — reliably available, 24/7) as stand-ins while validating equities separately; (b) mock the oracle behind an interface for dev and swap in real Pyth for staging; (c) move equity testing to mainnet-beta with tiny amounts once devnet logic is proven. **This is a plan-shaping decision — resolve it early.**

## 2.6 Switchboard — the oracle alternative

**Switchboard** is the other major Solana oracle. Key differences vs Pyth:

- **Permissionless feed creation:** Pyth's data set is curated (publishers + DAO governance approve feeds), whereas **Switchboard lets anyone permissionlessly create a custom feed** — handy if a needed feed doesn't exist. ([Switchboard vs competition](https://switchboardxyz.medium.com/switchboard-vs-the-competition-why-we-are-the-everything-oracle-bbc27b967215))
- **On-demand updates** (similar pull philosophy) and a low-latency product, **Switchboard Surge**, advertising sub-100 ms (down to ~8–25 ms colocated). ([Blockworks: Switchboard Surge](https://blockworks.com/news/fastest-oracle-on-solana-launches))
- **Trade-off for Meridian:** For *first-party, institution-sourced US equity* prices, **Pyth is the more established, purpose-fit choice** and explicitly markets real-time equities. Switchboard's strength (custom/permissionless feeds, TEE-based attestation) is most valuable if Pyth lacks a feed you need or you want a second source. **Recommendation:** design settlement behind an **oracle interface** so Switchboard can serve as a backup/secondary, but lead with Pyth.

> **Industry validation:** In 2025 **Polymarket** (the largest prediction market) launched equity & commodity markets **powered by Pyth price feeds** — strong evidence Pyth is the production-grade choice for exactly this use case. ([Cointelegraph: Polymarket + Pyth equities](https://cointelegraph.com/news/polymarket-expands-into-equities-and-commodities-with-pyth-price-feeds))

## 2.7 The CLOB on Solana: build vs integrate

You have two paths for Meridian's order book. Understand both.

### Why on-chain order books are *hard*

A matching engine sorts orders and crosses them on every action. On a normal exchange that's RAM and microseconds. On a blockchain, every order, cancel, and match is a transaction that costs fees, consumes the per-transaction **compute-unit budget**, and writes to accounts that must be sized in advance. Matching across many price levels in one transaction can blow the CU cap; storing a deep book costs rent. This is precisely why order books were impractical on slow/expensive chains and only became viable on fast/cheap ones like Solana — and why most EVM prediction markets keep the book *off-chain* (see Part 3).

### Option A — Integrate **Phoenix** (the leading existing Solana CLOB)

**Phoenix** (by **Ellipsis Labs**) is a fully on-chain CLOB on Solana that atomically settles trades in the same transaction, with **price-time priority** and ~100 bid/ask levels per market. It's battle-tested ($75B+ cumulative volume). Program ID `PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY`. Devnet is usable for testing (you can fund keypairs by airdrop and deploy/test there). ([Phoenix v1 (GitHub)](https://github.com/Ellipsis-Labs/phoenix-v1), [Phoenix on Solana Compass](https://solanacompass.com/projects/phoenix), [Ellipsis Labs](https://www.ellipsislabs.xyz/))

- **Pros:** Don't build/audit a matching engine; proven performance; mature SDK.
- **Cons / open questions:** Phoenix markets are designed for standard spot pairs (TokenA/TokenB). Meridian would create a **Yes-token / USDC** market per strike — feasible (Yes is just an SPL token), but you'd be standing up *many short-lived markets daily* and tearing them down, which Phoenix wasn't primarily built for. Verify: per-market setup cost/permissions, whether you can spin up/retire one market per strike per day economically, and Phoenix's **current devnet status & deploy permissions** (the team has been pushing **Phoenix Perpetuals**, in private beta as of Breakpoint 2025 — make sure spot-CLOB v1 is still the supported thing on devnet). ([Phoenix Perpetuals announcement](https://www.ellipsislabs.xyz/blog-posts/introducing-phoenix-perpetuals))
- **Also consider OpenBook:** **OpenBook** is the community-run successor to **Serum** (the original Solana CLOB that was abandoned after FTX's collapse). It's another on-chain order book option with broad integration. Worth comparing if Phoenix's per-market model doesn't fit.

### Option B — Build a **minimal on-chain order book** ourselves (in Anchor)

Given Meridian's binary instruments are simpler than general spot trading (price is bounded in **$0.00–$1.00**, one Yes/USDC book per strike, modest depth), a **purpose-built minimal CLOB** is plausible:

- **Pros:** Full control over the Yes/No "one book, four views" semantics; tailored to bounded prices; no dependency on a third party's market-creation model; easier to wire the mint/redeem invariants directly into trading.
- **Cons:** You must implement and **carefully audit** order placement, cancellation, price-time-priority matching, and partial fills — all within CU limits and rent constraints. Order-book bugs are funds-at-risk bugs. More attack surface, more testing.

### Recommendation framing (decide in design)

A reasonable plan: **prototype with a minimal in-house book** (because Meridian's bounded-price, one-book-per-strike model is genuinely simpler than a general CLOB, and it keeps mint/redeem/trade invariants in one program), while **keeping Phoenix/OpenBook integration as a fallback** if performance, depth, or audit cost become problematic. Whatever you choose, treat the matching engine as the **second-highest-risk component after the oracle**.

## 2.8 Solana dev tooling (what you'll actually run)

- **`solana` CLI:** manage keypairs, set the cluster (`solana config set --url devnet`), airdrop devnet SOL, inspect accounts, deploy programs.
- **`anchor` CLI:** `anchor init` (scaffold), `anchor build` (compile Rust → on-chain bytecode + IDL), `anchor deploy`, `anchor test` (spin up a local validator and run TS tests). Managed via **`avm`** (Anchor Version Manager).
- **Local validator** (`solana-test-validator`): a single-node Solana on your laptop for fast, free, deterministic tests before touching devnet. You can also *clone* mainnet/devnet accounts (e.g. a Pyth account) into your local validator for realistic tests.
- **Frontend libraries:**
  - **`@solana/wallet-adapter`:** a React library that lets users connect popular wallets (Phantom, Solflare, Backpack, etc.) with a standard UI and hooks. Handles connect/disconnect and exposes a signer. This is how users sign mint/trade/redeem transactions in our **Next.js (React + TypeScript)** app.
  - **`@solana/web3.js`:** the core JS/TS SDK to build transactions, talk to an **RPC node** (the server endpoint that relays your transactions to the network), and read accounts.
  - **`@solana/spl-token`:** helpers to create/read token accounts (ATAs), transfer, mint, burn from JS/TS.
  - Anchor's **TypeScript client** (generated from the **IDL**) gives typed methods like `program.methods.mintPair(...)` so the frontend and the Node service call the program without hand-writing serialization.
- **The Node.js / TypeScript automation service:** This off-chain worker (a) **creates the day's strike markets each morning** by sending transactions that initialize the per-strike accounts/PDAs, and (b) **settles each market after 4:00 PM ET** by pulling the Pyth price (Hermes → Receiver → price update account) and calling `settle_market`. It signs transactions with **its own keypair** loaded from a secret (env var / KMS) using `@solana/web3.js` + the Anchor client. **Reminder:** it has *no* privileged powers — it can only invoke the same public, rule-checked instructions any user could; the on-chain program is the source of truth. Secure that keypair (it pays fees and triggers settlement), monitor it, and design settlement to be **idempotent** (safe to retry) and **permissionless if possible** (so anyone could settle a market if our service is down — a resilience win).

---

# PART 3 — REJECTED ALTERNATIVES (so you can defend the choices)

You'll be asked "why not X?" Here are crisp answers.

## 3.1 EVM L2s (Arbitrum, Base) with Solidity

**What they are:** **EVM** = Ethereum Virtual Machine, the runtime Ethereum and most chains use; smart contracts are written in **Solidity**. **L2s** ("Layer 2s" — chains built *on top of* Ethereum for cheaper/faster transactions) like **Arbitrum** and **Base** inherit Ethereum's ecosystem and security while lowering fees.

**Why we preferred Solana for a real-time CLOB:**

- **Latency / finality for an order book.** EVM rollups confirm fast at the sequencer (Arbitrum produces blocks ~250 ms; Base ~2 s), but **full finality inherits Ethereum's ~12+ minutes**, and the trading UX is shaped by block cadence and a single **sequencer**. Solana gives **~400 ms slots with sub-second confirmations today** (and ~150 ms finality coming via Alpenglow) on the base layer itself — better suited to an order book that lives fully on-chain. ([Solana vs Ethereum speed](https://www.redswitches.com/blog/solana-vs-ethereum/))
- **Account model & parallelism.** Solana's accounts model lets non-overlapping trades execute **in parallel** (Sealevel); the EVM is largely sequential per block. For many simultaneous markets/orders, parallelism helps.
- **Fees & micro-transactions.** Active order-book trading means many place/cancel actions. Solana's per-transaction fees are fractions of a cent; even on cheap L2s costs are higher and more variable. Cheap fees make an *on-chain* book economically sane.
- **Ecosystem fit.** Solana already has **native first-party equity oracles (Pyth)** and proven on-chain CLOBs (Phoenix/OpenBook). On EVM, fully on-chain order books are rare precisely because of the latency/cost issues above — which is *why* Polymarket (EVM) keeps its book off-chain (see 3.4).

**Honest counterpoint:** EVM has more total liquidity, more developer mind-share, Solidity has more auditors, and L2s are improving fast. But for *this* product — a latency-sensitive, fully on-chain CLOB on US-equity outcomes — Solana is the better-fit base layer.

## 3.2 HyperLiquid

**What it is:** **HyperLiquid** is its own purpose-built L1 ("HyperCore") whose entire reason for existing is **a native, fully on-chain central limit order book** — it's the leading on-chain perpetual-futures ("perps") DEX, handling ~200k orders/sec with deterministic finality. Intriguingly, **HIP-3 ("builder-deployed perpetuals," live on mainnet 2025-10-13)** lets third parties **permissionlessly launch their own perp markets** on HyperCore's matching engine, with custom parameters and oracles — a deployer essentially runs their own perp DEX atop shared infra. ([HIP-3 docs](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals), [CCN explainer](https://www.ccn.com/education/crypto/hyperliquid-hip3-builders-launch-perp-markets/))

**Why it's tempting:** It already has the thing that's hardest to build — a blazing on-chain CLOB — *and* HIP-3 opens it to builders. If you want an on-chain order book, HyperLiquid is the most CLOB-native chain in existence.

**Why we're not choosing it (be honest about feasibility):**

- **Wrong instrument shape.** HIP-3 is for **perpetual futures**, not arbitrary **binary $0/$1 outcome tokens with mint-pair/redeem mechanics**. Meridian's design (mint 1 Yes + 1 No from $1 USDC; redeem winner for $1) is a *fully-collateralized binary option*, not a leveraged perp. There's **no evidence HyperLiquid natively supports custom binary-outcome instruments** today; you'd be bending a perps engine into a shape it wasn't built for.
- **High barrier & less general programmability.** HIP-3 deployment requires a large **HYPE stake (500k HYPE)** and operates within HyperCore's fixed margining/perp framework — not a general smart-contract platform where we can write arbitrary mint/redeem/invariant logic. Solana+Anchor gives us a clean canvas to express exactly our token mechanics.
- **Tooling/learning-curve & maturity for *our* use case.** Solana's general-purpose programs, SPL tokens, Pyth equities, and CLOB options map *directly* onto our design with well-documented tooling; HyperLiquid would require fitting into a specialized, perps-centric model.

**Verdict:** Worth admiring and worth a one-line mention as "future exploration," but **not a fit for fully-collateralized binary equity outcomes today.** Document it as evaluated-and-rejected on instrument-fit grounds.

## 3.3 Oracle alternatives recap (Chainlink vs Pyth)

- **Chainlink** is the dominant oracle in the **EVM** world — robust, widely integrated, but historically a **push** model with update intervals/heartbeats tuned for EVM and a strong DeFi (crypto-price) focus. Since we're on **Solana** and need **real-time first-party US equities**, **Pyth** (Solana-native, first-party publishers, explicit equities coverage, pull model) is the better fit. **Switchboard** (2.6) is the in-ecosystem backup. If we were on EVM, Chainlink (and Pyth's EVM deployment) would be the conversation instead. ([Oracle comparison: Chainlink vs Pyth vs RedStone](https://blog.redstone.finance/2025/01/16/blockchain-oracles-comparison-chainlink-vs-pyth-vs-redstone-2025/))

## 3.4 Polymarket — a useful design comparison (not a competitor to copy verbatim)

**Polymarket** is the largest prediction market and a great reference for "binary outcome tokens." How it works:

- **EVM (Polygon).** Outcome shares use **Gnosis Conditional Token Framework (CTF)** — when a market is created, it mints mutually exclusive **YES/NO tokens fully collateralized by USDC**, redeemable $1 per winning share. (This is *exactly* Meridian's mint-pair / redeem idea — strong validation of the model.)
- **Hybrid order book:** an **off-chain** operator hosts the order book and matches orders for speed; **settlement is on-chain** — the CTF Exchange contract verifies both parties' signed orders and atomically swaps USDC ↔ outcome tokens. **They keep matching off-chain because fully on-chain order books are impractical on EVM.**
- **Resolution via UMA's Optimistic Oracle:** after the event, a proposer submits the outcome, there's a ~2-hour **dispute window**, and if undisputed it resolves on-chain; winners redeem $1 each. ([Polymarket + UMA](https://legacy-docs.polymarket.com/polymarket-+-uma), [How prediction-market resolution works (UMA)](https://rocknblock.io/blog/how-prediction-markets-resolution-works-uma-optimistic-oracle-polymarket))

**What Meridian does differently (and why):**

| Dimension | Polymarket | Meridian |
|---|---|---|
| Chain | EVM (Polygon) | **Solana** (faster/cheaper for on-chain CLOB) |
| Order book | **Off-chain** matching | **On-chain** CLOB (Phoenix/OpenBook or minimal in-house) |
| Outcome tokens | Gnosis CTF YES/NO, USDC-collateralized | SPL Yes/No, USDC-collateralized (same economic model) |
| Resolution | **UMA optimistic oracle** (human proposer + ~2h dispute window) | **Pyth price oracle** (deterministic price feed, no dispute window) |
| Market type | Arbitrary real-world events | **Programmatic 0DTE stock-vs-strike** (mechanically resolvable by price) |

The key architectural insight: Polymarket needs a *human/optimistic* oracle because "who won the election?" isn't a number on a feed. **Meridian's questions are purely numeric** ("is AAPL ≥ \$215 at 4 PM?"), so we can use a **deterministic price oracle (Pyth)** and settle automatically with **no dispute window** — simpler and faster, *provided* the oracle is trustworthy and fresh (back to the 2.5 caveat). Going fully on-chain for the order book is the bet that Solana makes that feasible where EVM did not.

---

# Appendix A — Glossary (quick reference)

- **0DTE:** Zero days to expiry; expires same day.
- **ATA:** Associated Token Account; a PDA holding one token for one owner.
- **AMM:** Automated Market Maker; formula-based trading pool (the non-CLOB alternative).
- **Anchor:** Rust framework for Solana programs (validation, IDL, ergonomics).
- **CLOB:** Central Limit Order Book; bids/asks with price-time priority.
- **Compute units (CU):** Solana's per-transaction "gas" budget.
- **Confidence interval (`conf`):** Oracle's reported uncertainty band around a price.
- **Cluster:** A Solana network (devnet / testnet / mainnet-beta).
- **EVM:** Ethereum Virtual Machine; runtime for Solidity contracts.
- **Exponent (`expo`):** Power-of-10 scaler; real price = `price × 10^expo`.
- **Faucet:** Service that hands out free test tokens (devnet SOL/USDC).
- **Finality:** When a transaction becomes irreversible.
- **Fungible / Non-fungible:** Interchangeable units vs unique items (NFTs).
- **Gas / fee:** Cost to run a transaction.
- **Hermes:** Pyth's off-chain service for fetching signed price updates.
- **IDL:** Interface Description Language; JSON spec of an Anchor program (like OpenAPI).
- **KYC:** Know Your Customer (identity verification) — Meridian has none.
- **Lamport:** Smallest unit of SOL (1 SOL = 1e9 lamports).
- **L1 / L2:** Base chain / chain built atop another for scale.
- **Maker / Taker:** Adds resting liquidity / removes it by crossing.
- **Mint (account):** The on-chain definition of a token (supply, decimals, authorities).
- **Mint / Burn:** Create / destroy token units.
- **Non-custodial:** App never holds user keys/funds.
- **Oracle:** Bridge bringing off-chain data on-chain.
- **PDA:** Program Derived Address; account a program controls with no private key.
- **Program:** Solana's word for a smart contract (stateless logic).
- **Pull oracle:** Consumer fetches + posts the price update when needed (Pyth on Solana).
- **Rent / rent-exempt:** Refundable SOL deposit to keep an account alive on-chain.
- **SOL:** Solana's native currency (fees, rent).
- **SPL Token:** Solana's shared fungible-token program (the "ERC-20 of Solana").
- **Staleness:** How old an oracle price is; guarded via `get_price_no_older_than`.
- **Stablecoin / USDC:** Token pegged to $1; USDC is Circle's regulated USD stablecoin.
- **Wallet:** Keychain holding public/private keys; signs transactions.

# Appendix B — Source links (verify the fast-moving ones)

**Pyth / oracle (highest-priority to re-verify):**
- Pyth pull integration on Solana — https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana
- Pyth Market Hours — https://docs.pyth.network/price-feeds/core/market-hours
- Pyth Best Practices (staleness) — https://docs.pyth.network/price-feeds/core/best-practices
- Pyth contract addresses (SVM/Solana) — https://docs.pyth.network/price-feeds/core/contract-addresses/solana
- Pyth Solana price feeds / best-practices (feed IDs differ per network; devnet dropdown) — https://github.com/pyth-network/pyth-gitbook/blob/main/solana-price-feeds/best-practices.md
- Pyth price feeds (browse + network dropdown) — https://www.pyth.network/price-feeds
- Pyth supported asset classes (equities) — https://www.pyth.network/blog/supported-asset-classes-by-the-pyth-network
- Polymarket + Pyth equities (industry validation) — https://cointelegraph.com/news/polymarket-expands-into-equities-and-commodities-with-pyth-price-feeds
- Switchboard vs competition — https://switchboardxyz.medium.com/switchboard-vs-the-competition-why-we-are-the-everything-oracle-bbc27b967215
- Switchboard Surge (low latency) — https://blockworks.com/news/fastest-oracle-on-solana-launches
- Oracle comparison (Chainlink/Pyth/RedStone) — https://blog.redstone.finance/2025/01/16/blockchain-oracles-comparison-chainlink-vs-pyth-vs-redstone-2025/

**Solana / Anchor / tooling:**
- Solana accounts model — https://solana.com/docs/core/accounts
- Solana commitment levels / finality — https://www.helius.dev/blog/solana-commitment-levels
- Anchor docs — https://www.anchor-lang.com/docs
- Anchor 0.31 release notes — https://www.anchor-lang.com/docs/updates/release-notes/0-31-0
- anchor-lang crate (latest version) — https://docs.rs/crate/anchor-lang/latest
- Alpenglow live for testing (CoinDesk) — https://www.coindesk.com/tech/2026/05/11/the-biggest-consensus-overhaul-in-solana-history-is-officially-live-for-testing
- Alpenglow overview (Solana Compass) — https://solanacompass.com/learn/Lightspeed/alpenglow-solanas-largest-protocol-upgrade-ever-brennan-watt-anza
- Solana vs Ethereum speed/fees — https://www.redswitches.com/blog/solana-vs-ethereum/

**CLOB:**
- Phoenix v1 (GitHub) — https://github.com/Ellipsis-Labs/phoenix-v1
- Phoenix (Solana Compass) — https://solanacompass.com/projects/phoenix
- Phoenix Perpetuals (private beta) — https://www.ellipsislabs.xyz/blog-posts/introducing-phoenix-perpetuals
- Ellipsis Labs — https://www.ellipsislabs.xyz/

**Rejected alternatives:**
- HyperLiquid HIP-3 docs — https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips/hip-3-builder-deployed-perpetuals
- HIP-3 explainer (CCN) — https://www.ccn.com/education/crypto/hyperliquid-hip3-builders-launch-perp-markets/
- Polymarket + UMA (resolution) — https://legacy-docs.polymarket.com/polymarket-+-uma
- How prediction-market resolution works (UMA optimistic oracle) — https://rocknblock.io/blog/how-prediction-markets-resolution-works-uma-optimistic-oracle-polymarket

**USDC:**
- Circle / USDC — https://www.circle.com/usdc

---

## TL;DR for the build plan

1. **Solana + Anchor + SPL tokens** is the right base: cheap, sub-second, parallel, with native equity oracles and proven on-chain CLOBs — the only realistic home for a *fully on-chain* binary-equity order book.
2. **PDAs** make "non-custodial" real: the **vault** and **mint authority** are program-controlled, key-less accounts. Mint-pair / redeem invariants live on-chain.
3. **Pyth (pull model)** is the settlement oracle; **design behind an oracle interface** with **Switchboard** as backup.
4. **CLOB:** lean toward a **minimal in-house book** (bounded $0–$1 prices, one book per strike, "one book / four views"), with **Phoenix/OpenBook** as the integration fallback.
5. **#1 RISK TO RESOLVE FIRST:** Confirm **MAG7 equity feeds actually publish on Solana devnet** and verify the **market-hours/staleness** behavior right at the **4:00 PM ET** settlement boundary. Equity feeds are **closed nights/weekends/holidays** and use **different feed IDs per cluster**. Have a fallback (crypto feeds as stand-ins / mocked oracle / mainnet test) ready in case devnet equity coverage is thin. **This can reshape the whole plan — do it before writing settlement code.**
