import { Connection, PublicKey } from "@solana/web3.js";
import {
  getProgramFromConnection,
  tickerToSymbol,
  tickerFromArg,
  fetchOrderBook,
} from "@meridian/sdk";

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const TARGET_DAY = process.env.TRADING_DAY
  ? Number(process.env.TRADING_DAY)
  : null;
const conn = new Connection(RPC, "confirmed");
const program = getProgramFromConnection(conn);

const raw = await program.account.market.all();
const filtered = raw.filter((r) => {
  const state = Object.keys(r.account.state)[0] ?? "";
  if (state === "settled") return false;
  if (
    TARGET_DAY !== null &&
    Number(r.account.tradingDay.toString()) !== TARGET_DAY
  )
    return false;
  return true;
});

console.log(
  `open markets on ${RPC}${
    TARGET_DAY ? ` for trading_day=${TARGET_DAY}` : ""
  }: ${filtered.length}`
);
const bySym = new Map();
for (const r of filtered) {
  const sym = tickerToSymbol(tickerFromArg(r.account.ticker));
  if (!bySym.has(sym)) bySym.set(sym, []);
  bySym.get(sym).push({
    market: r.publicKey,
    strike: Number(r.account.strike.toString()) / 1e6,
    day: r.account.tradingDay.toString(),
  });
}
for (const [sym, ms] of [...bySym.entries()].sort()) {
  ms.sort((a, b) => a.strike - b.strike);
  console.log(`\n${sym}  (${ms.length} strikes)`);
  for (const m of ms) {
    const book = await fetchOrderBook(program, m.market);
    const bookOK = book !== null;
    const bids = bookOK ? book.bids.filter((o) => o.active).length : 0;
    const asks = bookOK ? book.asks.filter((o) => o.active).length : 0;
    console.log(
      `  $${m.strike.toString().padEnd(6)} book=${
        bookOK ? "OK" : "MISSING"
      }  bids=${bids}  asks=${asks}  ${m.market.toBase58()}`
    );
  }
}
