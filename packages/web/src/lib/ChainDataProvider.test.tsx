import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Count how often each shared read actually fires. The whole point of the provider is that
// N consumers share ONE poll, so these counters must not scale with consumer count.
const calls = { markets: 0, books: 0, config: 0 };

vi.mock("./useProgram", () => ({ useProgram: () => ({}) }));
vi.mock("./discovery", async (orig) => ({
  ...(await orig<typeof import("./discovery")>()),
  discoverMarkets: async () => {
    calls.markets += 1;
    return [];
  },
}));
vi.mock("@meridian/sdk", async (orig) => ({
  ...(await orig<typeof import("@meridian/sdk")>()),
  fetchAllOrderBooks: async () => {
    calls.books += 1;
    return new Map();
  },
  fetchConfig: async () => {
    calls.config += 1;
    return null;
  },
}));

import { ChainDataProvider } from "./ChainDataProvider";
import { useMarkets, useAllBooks, useConfig } from "./useChain";

function Consumer({ label }: { label: string }) {
  const markets = useMarkets();
  const books = useAllBooks();
  const config = useConfig();
  return (
    <div data-testid={label}>
      {markets.data ? "m" : "-"}
      {books.data ? "b" : "-"}
      {String(config.loading)}
    </div>
  );
}

describe("ChainDataProvider", () => {
  beforeEach(() => {
    calls.markets = 0;
    calls.books = 0;
    calls.config = 0;
  });

  it("polls each shared read once even with multiple consumers", async () => {
    render(
      <ChainDataProvider>
        <Consumer label="a" />
        <Consumer label="b" />
        <Consumer label="c" />
      </ChainDataProvider>
    );

    // All three consumers mounted; the initial load must fire exactly once per resource.
    await waitFor(() => {
      expect(calls.markets).toBe(1);
      expect(calls.books).toBe(1);
      expect(calls.config).toBe(1);
    });

    // All consumers see the same store.
    expect(screen.getByTestId("a")).toBeInTheDocument();
    expect(screen.getByTestId("b")).toBeInTheDocument();
    expect(screen.getByTestId("c")).toBeInTheDocument();
  });

  it("throws if a shared hook is used outside the provider", () => {
    // Silence the expected React error boundary noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer label="orphan" />)).toThrow(
      /ChainDataProvider/
    );
    spy.mockRestore();
  });
});
