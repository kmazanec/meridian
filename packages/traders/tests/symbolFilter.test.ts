import { expect } from "chai";
import { normalizeSymbolFilter } from "../src/context";

describe("normalizeSymbolFilter", () => {
  it("returns undefined for a genuinely absent filter", () => {
    expect(normalizeSymbolFilter(undefined)).to.equal(undefined);
    expect(normalizeSymbolFilter(null)).to.equal(undefined);
  });

  it("treats LLM sentinel strings as 'no filter'", () => {
    // The actual bug: a model passed the literal string "null", which filtered out
    // every market and made the bot think nothing was open.
    for (const s of ["null", "NULL", "undefined", "none", "all", "", "  "]) {
      expect(normalizeSymbolFilter(s), `for ${JSON.stringify(s)}`).to.equal(
        undefined
      );
    }
  });

  it("uppercases and trims a real symbol", () => {
    expect(normalizeSymbolFilter("meta")).to.equal("META");
    expect(normalizeSymbolFilter("  nvda ")).to.equal("NVDA");
    expect(normalizeSymbolFilter("AAPL")).to.equal("AAPL");
  });
});
