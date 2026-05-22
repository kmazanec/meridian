/**
 * Logger + Alerter tests. Observability is an acceptance criterion: a failed run must be
 * visible. Alerts go to a configurable webhook (POST JSON), falling back to a structured
 * log line when no URL is set. The webhook call is exercised via an injected `fetch` spy
 * so no network is touched.
 */

import { expect } from "chai";
import { createLogger, LogLevel } from "../src/logger";
import {
  WebhookAlerter,
  LogAlerter,
  makeAlerter,
  type AlertPayload,
} from "../src/alerter";

/** A logger whose lines are captured in an array for assertions. */
function captureLogger() {
  const lines: { level: LogLevel; msg: string; fields?: object }[] = [];
  const logger = createLogger({
    sink: (line) => lines.push(line),
  });
  return { logger, lines };
}

describe("logger", () => {
  it("emits structured lines at each level", () => {
    const { logger, lines } = captureLogger();
    logger.info("started", { ticker: "AAPL" });
    logger.warn("slow");
    logger.error("boom", { code: 500 });
    logger.alert("page me", { market: "X" });
    expect(lines.map((l) => l.level)).to.deep.equal([
      LogLevel.Info,
      LogLevel.Warn,
      LogLevel.Error,
      LogLevel.Alert,
    ]);
    expect(lines[0].fields).to.deep.equal({ ticker: "AAPL" });
    expect(lines[3].msg).to.equal("page me");
  });
});

describe("WebhookAlerter", () => {
  it("POSTs a JSON alert payload to the configured URL", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchSpy = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "" } as Response;
    };
    const { logger } = captureLogger();
    const alerter = new WebhookAlerter("https://hooks.example/abc", {
      fetchImpl: fetchSpy as unknown as typeof fetch,
      logger,
    });

    const payload: AlertPayload = {
      severity: "critical",
      title: "settlement gave up",
      detail: "META $620 wide confidence after 15m",
      context: { market: "META-620" },
    };
    await alerter.alert(payload);

    expect(calls).to.have.length(1);
    expect(calls[0].url).to.equal("https://hooks.example/abc");
    expect(calls[0].init.method).to.equal("POST");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.title).to.equal("settlement gave up");
    expect(body.severity).to.equal("critical");
    expect(body.context.market).to.equal("META-620");
  });

  it("does not throw if the webhook POST fails — it logs and swallows", async () => {
    const fetchSpy = async () => {
      throw new Error("network down");
    };
    const { logger, lines } = captureLogger();
    const alerter = new WebhookAlerter("https://hooks.example/abc", {
      fetchImpl: fetchSpy as unknown as typeof fetch,
      logger,
    });
    // An alert delivery failure must not crash the job (alerting is best-effort).
    await alerter.alert({ severity: "critical", title: "x", detail: "y" });
    expect(lines.some((l) => l.level === LogLevel.Error)).to.be.true;
  });

  it("logs an error when the webhook returns a non-2xx status", async () => {
    const fetchSpy = async () =>
      ({ ok: false, status: 500, text: async () => "boom" }) as Response;
    const { logger, lines } = captureLogger();
    const alerter = new WebhookAlerter("https://hooks.example/abc", {
      fetchImpl: fetchSpy as unknown as typeof fetch,
      logger,
    });
    await alerter.alert({ severity: "warning", title: "x", detail: "y" });
    expect(lines.some((l) => l.level === LogLevel.Error)).to.be.true;
  });
});

describe("LogAlerter", () => {
  it("writes the alert as an ALERT-level log line", async () => {
    const { logger, lines } = captureLogger();
    const alerter = new LogAlerter(logger);
    await alerter.alert({
      severity: "critical",
      title: "no webhook configured",
      detail: "fell back to logs",
    });
    const alertLines = lines.filter((l) => l.level === LogLevel.Alert);
    expect(alertLines).to.have.length(1);
    expect(alertLines[0].msg).to.contain("no webhook configured");
  });
});

describe("makeAlerter", () => {
  it("returns a WebhookAlerter when a URL is provided", () => {
    const { logger } = captureLogger();
    const a = makeAlerter({ webhookUrl: "https://hooks.example/x", logger });
    expect(a).to.be.instanceOf(WebhookAlerter);
  });

  it("falls back to LogAlerter when no URL is set", () => {
    const { logger } = captureLogger();
    const a = makeAlerter({ webhookUrl: undefined, logger });
    expect(a).to.be.instanceOf(LogAlerter);
  });
});
