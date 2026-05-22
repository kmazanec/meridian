import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Panel, Stat, Button, Price, cx } from "./ui";

describe("brand primitives", () => {
  it("cx joins truthy class names only", () => {
    expect(cx("a", false, "b", null, undefined, "c")).toBe("a b c");
  });

  it("Panel renders children inside the panel surface", () => {
    render(<Panel>collateral</Panel>);
    expect(screen.getByText("collateral")).toBeInTheDocument();
  });

  it("Stat shows its label and value with the requested tone", () => {
    render(<Stat label="Yes price" value="$0.65" accent="yes" />);
    expect(screen.getByText("Yes price")).toBeInTheDocument();
    const value = screen.getByText("$0.65");
    expect(value).toBeInTheDocument();
    expect(value.className).toContain("text-yes");
  });

  it("Button applies the variant tint and forwards props", () => {
    render(
      <Button variant="no" disabled>
        Buy No
      </Button>
    );
    const btn = screen.getByRole("button", { name: "Buy No" });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain("btn-no");
  });

  it("Price applies a tone class", () => {
    render(<Price tone="usdc">$1.00</Price>);
    expect(screen.getByText("$1.00").className).toContain("text-usdc");
  });
});
