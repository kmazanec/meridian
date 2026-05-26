import { createElement as h, type ReactNode } from "react";

/**
 * FAQ copy, kept separate from layout so it's easy to edit and to test. Plain-language
 * answers for a finance-literate but crypto-new audience, framed around how Meridian
 * actually works (Mag7, the 4:00 PM bell, an on-chain oracle, your own wallet).
 *
 * Answers are {@link ReactNode} so a few can use colored Yes/No spans and emphasis without
 * dumping raw HTML. We build them with `createElement` (not JSX) to keep this a plain data
 * module. One answer — "Is this real money?" — depends on which network the app is pointed
 * at, so it's a function of the cluster label rather than a constant.
 */
export type FaqItem = {
  /** Stable anchor id, e.g. "what-am-i-betting-on". */
  id: string;
  q: string;
  a: ReactNode;
};

export type FaqSection = {
  title: string;
  items: FaqItem[];
};

const yes = (t: string) => h("span", { className: "text-yes" }, t);
const no = (t: string) => h("span", { className: "text-no" }, t);
const usdc = (t: string) => h("span", { className: "text-usdc" }, t);
const b = (t: string) => h("span", { className: "font-medium text-fg" }, t);

/**
 * Build the FAQ sections. `clusterLabel` is the network the app is pointed at
 * (e.g. "devnet", "mainnet"); the "real money?" answer adapts to it so the copy
 * can never claim the wrong thing.
 */
export function faqSections(clusterLabel: string): FaqSection[] {
  const isMainnet = clusterLabel.toLowerCase() === "mainnet";

  return [
    {
      title: "The basics",
      items: [
        {
          id: "what-am-i-betting-on",
          q: "What exactly am I trading here?",
          a: h(
            "p",
            null,
            "A simple yes-or-no question about a stock, decided by the end of the day. For example: ",
            b("“Will Apple close at or above $210 today?”"),
            " You buy ",
            yes("Yes"),
            " if you think it will, or ",
            no("No"),
            " if you think it won't. Each contract pays out ",
            usdc("$1.00"),
            " if your side is right, and nothing if it's wrong."
          ),
        },
        {
          id: "price-is-probability",
          q: "Why does a contract cost something like 65¢ instead of a normal share price?",
          a: h(
            "p",
            null,
            "Because the price ",
            b("is the odds."),
            " A ",
            yes("Yes"),
            " contract trading at ",
            usdc("65¢"),
            " means the market thinks there's roughly a 65% chance it happens. ",
            "If you're right, every contract becomes worth ",
            usdc("$1.00"),
            " — so paying 65¢ to maybe win $1.00 is the market pricing in those odds. ",
            "Cheaper contracts are longer shots; more expensive ones are closer to a sure thing."
          ),
        },
        {
          id: "what-is-0dte",
          q: "What does “closes today” mean — how long do these last?",
          a: h(
            "p",
            null,
            "They last one trading day. Every contract is created in the morning and ",
            b("settles at the 4:00 PM ET closing bell the same day."),
            " There's nothing to hold overnight and no expiration weeks away to track — you find out if you won the moment the market closes."
          ),
        },
        {
          id: "yes-no-add-to-one",
          q: "Why do the Yes and No prices always add up to $1.00?",
          a: h(
            "p",
            null,
            "Because together they fund exactly one ",
            usdc("$1.00"),
            " payout. Exactly one side wins, so a ",
            yes("Yes"),
            " at ",
            usdc("60¢"),
            " and a ",
            no("No"),
            " at ",
            usdc("40¢"),
            " add up to the dollar that gets paid to whoever is right. ",
            "It also means buying ",
            no("No"),
            " is the same bet as selling ",
            yes("Yes"),
            " — just from the other direction."
          ),
        },
      ],
    },
    {
      title: "Your money and your wallet",
      items: [
        {
          id: "do-i-need-a-wallet",
          q: "Do I need a crypto wallet, and is my money safe?",
          a: h(
            "p",
            null,
            "Yes — you connect a Solana wallet (a free browser app like Phantom) to trade. ",
            "Meridian is ",
            b("non-custodial,"),
            " which means we never hold your money. Your wallet signs each action, and the on-chain program is the only thing that can move funds — by rules anyone can inspect. ",
            "There's no account to open and no balance sitting with an operator who could lose it or freeze it."
          ),
        },
        {
          id: "what-is-usdc",
          q: "What's USDC, and why do I trade in it?",
          a: h(
            "p",
            null,
            usdc("USDC"),
            " is a digital dollar — a “stablecoin” that's designed to always be worth $1. ",
            "It's the money you put up to buy contracts and the money you're paid in when you win. ",
            "Pricing everything in dollars is what lets a contract simply pay ",
            usdc("$1.00"),
            " to the winning side."
          ),
        },
        {
          id: "is-this-real-money",
          q: "Is this real money?",
          a: isMainnet
            ? h(
                "p",
                null,
                "Yes. This app is running on ",
                b("Solana mainnet"),
                ", so you're trading with real ",
                usdc("USDC"),
                " and real winnings and losses. Only trade what you're comfortable risking."
              )
            : h(
                "p",
                null,
                "No. This app is running on ",
                b(`Solana ${clusterLabel}`),
                ", a test network. The ",
                usdc("USDC"),
                " here is free test money with no real-world value — perfect for learning how the markets work without risking a cent. ",
                "Everything behaves exactly like the real thing; only the dollars are play money."
              ),
        },
        {
          id: "how-do-i-cash-out",
          q: "How do I get my winnings out?",
          a: h(
            "p",
            null,
            "After the 4:00 PM settlement, your winning contracts are each worth ",
            usdc("$1.00"),
            ", which you redeem back into ",
            usdc("USDC"),
            " in your wallet. ",
            "The funds were in your own wallet the whole time — cashing out is just converting settled contracts back to dollars, with no withdrawal request to an operator."
          ),
        },
        {
          id: "fees",
          q: "Are there fees?",
          a: h(
            "p",
            null,
            "There's no Meridian commission on your trades. The only cost is Solana's network fee for each transaction — typically a tiny fraction of a cent — which goes to the network, not to us. ",
            "Keep a small amount of SOL (Solana's native token) in your wallet to cover those fees."
          ),
        },
      ],
    },
    {
      title: "How trading works",
      items: [
        {
          id: "four-buttons",
          q: "How do I actually place a trade?",
          a: h(
            "p",
            null,
            "Tap a side in the ",
            yes("Yes"),
            " / ",
            no("No"),
            " bar above the chart — or click any price in the order book — and a ticket opens where you set the amount and choose market or limit. Every ticket offers the same four actions: ",
            yes("Buy Yes"),
            ", ",
            yes("Sell Yes"),
            ", ",
            no("Buy No"),
            ", and ",
            no("Sell No"),
            ". Pick the side you believe in and how much, and you're trading. ",
            "Behind the scenes those four actions all feed one shared market, so you always get the best available price for what you asked for — you don't need to understand the plumbing to use it."
          ),
        },
        {
          id: "order-book",
          q: "How do buy and sell orders get matched?",
          a: h(
            "p",
            null,
            "Through an ",
            b("order book"),
            " — the same idea a stock exchange uses. Buyers and sellers post the prices they'll accept, and when a buy and a sell line up, they trade. ",
            "Better-priced orders go first, and ties are broken by who was there first. It all happens on-chain, in the open, with no middleman deciding who fills."
          ),
        },
        {
          id: "no-counterparty",
          q: "What if nobody takes the other side of my trade?",
          a: h(
            "p",
            null,
            "Then your order simply waits in the order book until someone does — or until you cancel it. ",
            "If you want to trade ",
            b("right now"),
            ", match an order that's already posted at its price. If you're patient, post your own price and wait for a taker. Quieter markets can take longer to fill, or may not fill at all."
          ),
        },
        {
          id: "sell-early",
          q: "Can I change my mind before the close?",
          a: h(
            "p",
            null,
            "Yes. You're never locked in until 4:00 PM. As long as someone will trade with you, you can ",
            b("sell your position any time"),
            " the market is open — to lock in a profit, cut a loss, or just step aside. ",
            "Whatever you don't sell rides to settlement and pays out based on the closing price."
          ),
        },
      ],
    },
    {
      title: "Markets and settlement",
      items: [
        {
          id: "which-stocks",
          q: "Which stocks can I trade?",
          a: h(
            "p",
            null,
            "The ",
            b("“Magnificent Seven”"),
            " — the megacap tech names that drive much of the market: Apple, Microsoft, Nvidia, Amazon, Alphabet (Google), Meta, and Tesla. ",
            "They're heavily traded and closely watched, which keeps the daily questions interesting."
          ),
        },
        {
          id: "where-strikes-come-from",
          q: "Where do the price “lines” (strikes) come from?",
          a: h(
            "p",
            null,
            "Each morning Meridian sets a few price lines around where each stock is trading — some a little above, some a little below. ",
            "That gives you a range of questions to take a side on, from “almost certainly yes” to “long shot,” instead of a single coin-flip. ",
            "The line in a question (like “$210”) is that strike."
          ),
        },
        {
          id: "who-decides-the-winner",
          q: "How is the winner decided — who calls it?",
          a: h(
            "p",
            null,
            "Nobody calls it — it's automatic. At the close, the program reads the official closing price from an ",
            b("on-chain price oracle"),
            " (a trusted, tamper-resistant price feed) and pays out accordingly. ",
            "There's no human judge, no dispute window, and no waiting: if the stock closed at or above the line, ",
            yes("Yes"),
            " wins; otherwise ",
            no("No"),
            " wins."
          ),
        },
        {
          id: "risks",
          q: "What can go wrong — what are the risks?",
          a: h(
            "div",
            { className: "space-y-2" },
            h(
              "p",
              null,
              "Like any trade, you can lose what you put in — if your side is wrong at the close, those contracts are worth nothing. A few things worth knowing:"
            ),
            h(
              "ul",
              { className: "list-disc space-y-1 pl-5" },
              h(
                "li",
                null,
                "Prices can move fast near the close, and a question that looked safe can flip in the final minutes."
              ),
              h(
                "li",
                null,
                "Quieter markets can be hard to get in or out of at a good price."
              ),
              h(
                "li",
                null,
                "Only stake what you'd be comfortable losing — these are short-term bets, not investments."
              ),
              isMainnet
                ? null
                : h(
                    "li",
                    null,
                    "Right now this runs on a ",
                    b("test network with play money"),
                    ", so there's no real financial risk while you learn."
                  )
            )
          ),
        },
      ],
    },
  ];
}
