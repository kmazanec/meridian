import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BN from "bn.js";
import { Ticker } from "@meridian/sdk";
import { LandingView } from "./LandingView";

describe("LandingView", () => {
  it("explains the product in the brand voice", () => {
    render(<LandingView prices={{}} connect={<button>Connect</button>} />);
    expect(
      screen.getByRole("heading", { name: /One book\. Four actions\./i })
    ).toBeInTheDocument();
    // The core relation is stated.
    expect(screen.getByText(/Yes \+ No = \$1\.00/)).toBeInTheDocument();
  });

  it("renders the injected connect-wallet control", () => {
    render(<LandingView prices={{}} connect={<button>Connect</button>} />);
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("shows live prices when provided", () => {
    render(
      <LandingView
        prices={{ [Ticker.Nvda]: new BN(420_000) }}
        connect={<button>Connect</button>}
      />
    );
    expect(screen.getByText("$0.42")).toBeInTheDocument();
  });
});
