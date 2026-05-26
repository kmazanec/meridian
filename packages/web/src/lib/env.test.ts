import { describe, it, expect } from "vitest";
import { deriveWsEndpoint } from "./env";

/**
 * The WS-endpoint derivation is the fix for the `-32601 signatureSubscribe not found` flood:
 * hosted providers (Alchemy/QuickNode) serve WSS at the same host/path with only the scheme
 * changed, while the local validator's WS is at rpc-port+1 (which web3.js derives correctly
 * on its own). So we scheme-swap for hosted URLs and return undefined for loopback.
 */
describe("deriveWsEndpoint", () => {
  it("scheme-swaps a hosted https RPC to wss, preserving host + path", () => {
    expect(deriveWsEndpoint("https://solana-devnet.g.alchemy.com/v2/KEY")).toBe(
      "wss://solana-devnet.g.alchemy.com/v2/KEY"
    );
  });

  it("scheme-swaps a hosted http RPC to ws", () => {
    expect(deriveWsEndpoint("http://rpc.example.com/path")).toBe(
      "ws://rpc.example.com/path"
    );
  });

  it("returns undefined for loopback so web3.js uses its rpc-port+1 default", () => {
    expect(deriveWsEndpoint("http://127.0.0.1:8899")).toBeUndefined();
    expect(deriveWsEndpoint("http://localhost:8899")).toBeUndefined();
  });

  it("does not bump the port (the bug in web3.js's own derivation)", () => {
    // Must stay on :8899, not :8900 — hosted WSS shares the HTTP port.
    expect(deriveWsEndpoint("https://rpc.example.com:8899/x")).toBe(
      "wss://rpc.example.com:8899/x"
    );
  });

  it("treats a malformed URL as non-local (scheme-swaps rather than throwing)", () => {
    expect(deriveWsEndpoint("not a url")).toBe("not a url");
  });
});
