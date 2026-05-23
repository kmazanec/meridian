import { expect } from "chai";
import { extractCloses } from "../src/tools/priceHistory";

describe("extractCloses", () => {
  it("parses a bare array of {date, close}", () => {
    const out = extractCloses([
      { date: "2026-05-15", close: 680.5 },
      { date: "2026-05-16", close: 682.1 },
    ]);
    expect(out).to.deep.equal([
      { date: "2026-05-15", close: 680.5 },
      { date: "2026-05-16", close: 682.1 },
    ]);
  });

  it("unwraps common envelope keys (closes/history/data)", () => {
    expect(extractCloses({ closes: [{ date: "d", close: 1 }] })).to.have.length(
      1
    );
    expect(extractCloses({ history: [{ day: "d", c: 2 }] })).to.deep.equal([
      { date: "d", close: 2 },
    ]);
    expect(extractCloses({ data: [{ t: "d", price: 3 }] })).to.deep.equal([
      { date: "d", close: 3 },
    ]);
  });

  it("returns null for unrecognized or empty shapes", () => {
    expect(extractCloses(null)).to.equal(null);
    expect(extractCloses({ foo: "bar" })).to.equal(null);
    expect(extractCloses([])).to.equal(null);
    expect(extractCloses([{ nope: 1 }])).to.equal(null);
  });

  it("skips rows with non-numeric closes", () => {
    expect(extractCloses([{ date: "d", close: "NaN" }])).to.equal(null);
  });
});
