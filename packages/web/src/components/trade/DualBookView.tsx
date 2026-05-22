import type { DualBook } from "@meridian/sdk";
import { OrderBookView } from "./OrderBookView";

/**
 * Both perspectives of the one underlying book, side by side. The No view is the
 * SDK's `1 − price` projection of the same Yes book — the frontend never re-derives
 * it. Showing both is the product's "one book, two perspectives" concept made literal.
 */
export function DualBookView({ book }: { book: DualBook }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <OrderBookView title="Yes book" view={book.yes} tone="yes" />
      <OrderBookView title="No book" view={book.no} tone="no" />
    </div>
  );
}
