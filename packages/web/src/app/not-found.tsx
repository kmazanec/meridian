import Link from "next/link";
import { TICKER_SYMBOLS } from "@meridian/sdk";
import { Panel } from "@/components/ui";
import { MeridianMark } from "@/components/Logo";

/**
 * App-level 404. With static export, a `/trade/<x>` URL for an unknown stock (only the 7
 * MAG7 tickers are pre-rendered) is served as a 404 by the CDN before any component runs —
 * this gives that case a branded page instead of a bare Cloudflare error. Rendered inside
 * the root layout (Header/footer), so it only supplies the inner content.
 */
export default function NotFound() {
  return (
    <Panel className="mx-auto max-w-lg text-center">
      <MeridianMark size={40} className="mx-auto mb-4" />
      <h1 className="font-serif text-3xl text-fg">Market not found</h1>
      <p className="mt-3 text-fg-dim">
        That page doesn’t exist. Meridian trades the MAG7:{" "}
        {TICKER_SYMBOLS.join(", ")}.
      </p>
      <Link href="/markets" className="btn btn-accent mt-6 inline-block">
        Browse markets
      </Link>
    </Panel>
  );
}
