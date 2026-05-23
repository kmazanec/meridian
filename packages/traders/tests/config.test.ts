import { expect } from "chai";
import { FleetConfigSchema, resolveBot, loadEnvironment } from "../src/config";

describe("fleet config validation", () => {
  it("accepts a valid fleet and defaults intervalSec + maxStepsPerTick", () => {
    const parsed = FleetConfigSchema.parse({
      bots: [{ name: "a", wallet: "~/x.json", model: "openai/gpt-4o" }],
    });
    expect(parsed.bots[0].intervalSec).to.equal(60);
    expect(parsed.bots[0].maxStepsPerTick).to.equal(60);
  });

  it("honors an explicit maxStepsPerTick", () => {
    const parsed = FleetConfigSchema.parse({
      bots: [{ name: "a", wallet: "w", model: "m", maxStepsPerTick: 100 }],
    });
    expect(parsed.bots[0].maxStepsPerTick).to.equal(100);
  });

  it("rejects filename-unsafe bot names", () => {
    const res = FleetConfigSchema.safeParse({
      bots: [{ name: "bad/name", wallet: "w", model: "m" }],
    });
    expect(res.success).to.equal(false);
  });

  it("requires at least one bot", () => {
    expect(FleetConfigSchema.safeParse({ bots: [] }).success).to.equal(false);
  });

  it("resolveBot finds by name and lists choices on miss", () => {
    const fleet = FleetConfigSchema.parse({
      bots: [
        { name: "alpha", wallet: "w", model: "m" },
        { name: "beta", wallet: "w", model: "m" },
      ],
    });
    expect(resolveBot(fleet, "beta").name).to.equal("beta");
    expect(() => resolveBot(fleet, "gamma")).to.throw(/alpha, beta/);
  });
});

describe("environment loading", () => {
  const base = {
    RPC_URL: "https://api.devnet.solana.com",
    OPENROUTER_API_KEY: "sk-or-x",
  };

  it("requires RPC_URL and OPENROUTER_API_KEY", () => {
    expect(() => loadEnvironment({})).to.throw(/RPC_URL/);
    expect(() => loadEnvironment({ RPC_URL: "x" })).to.throw(
      /OPENROUTER_API_KEY/
    );
  });

  it("parses optional fields and the DRY_RUN flag", () => {
    const env = loadEnvironment({
      ...base,
      WEB_BASE_URL: "http://localhost:3000",
      DRY_RUN: "true",
    });
    expect(env.webBaseUrl).to.equal("http://localhost:3000");
    expect(env.dryRun).to.equal(true);
    expect(loadEnvironment(base).dryRun).to.equal(false);
  });

  it("defaults priceSource to pyth", () => {
    expect(loadEnvironment(base).priceSource).to.equal("pyth");
  });

  it("accepts PRICE_SOURCE=synthetic when WEB_BASE_URL is set", () => {
    const env = loadEnvironment({
      ...base,
      PRICE_SOURCE: "synthetic",
      WEB_BASE_URL: "http://localhost:8788",
    });
    expect(env.priceSource).to.equal("synthetic");
  });

  it("rejects PRICE_SOURCE=synthetic without WEB_BASE_URL", () => {
    expect(() =>
      loadEnvironment({ ...base, PRICE_SOURCE: "synthetic" })
    ).to.throw(/WEB_BASE_URL/);
  });

  it("rejects an invalid PRICE_SOURCE", () => {
    expect(() => loadEnvironment({ ...base, PRICE_SOURCE: "magic" })).to.throw(
      /PRICE_SOURCE/
    );
  });
});
