/**
 * Failure alerting.
 *
 * When the morning job can't create a market or the settlement job exhausts its
 * wide-confidence retry window, the operator must be paged so they can intervene (e.g.
 * run `admin_settle`). Alerts go to a configurable webhook (a generic JSON POST that
 * works with Slack/Discord/PagerDuty incoming webhooks); when no URL is configured the
 * service falls back to an ALERT-level structured log line so the signal is never lost.
 *
 * Alert *delivery* is best-effort: a webhook that is down or returns an error must never
 * crash the job (the on-chain state is the source of truth; a missed alert is a
 * monitoring gap, not a correctness bug). Failures to deliver are themselves logged.
 */

import { Logger } from "./logger";

/** Severity of an operator alert. */
export type AlertSeverity = "warning" | "critical";

/** The payload delivered to the alert channel. */
export interface AlertPayload {
  severity: AlertSeverity;
  /** Short headline. */
  title: string;
  /** Human-readable detail. */
  detail: string;
  /** Optional structured context (market id, ticker, error, …). */
  context?: Record<string, unknown>;
}

/** Something that can deliver an operator alert. */
export interface Alerter {
  alert(payload: AlertPayload): Promise<void>;
}

export interface WebhookAlerterOptions {
  /** Injectable fetch (defaults to the global). */
  fetchImpl?: typeof fetch;
  /** Logger for delivery diagnostics + the swallowed-failure record. */
  logger: Logger;
  /** Per-request timeout (ms); guards against a hung webhook. Default 10s. */
  timeoutMs?: number;
}

/** Posts alerts to a webhook URL as JSON. */
export class WebhookAlerter implements Alerter {
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;
  private readonly timeoutMs: number;

  constructor(url: string, opts: WebhookAlerterOptions) {
    this.url = url;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.logger = opts.logger;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    if (!this.fetchImpl) {
      throw new Error(
        "WebhookAlerter requires a fetch implementation (Node 18+ global fetch or an injected one)"
      );
    }
  }

  async alert(payload: AlertPayload): Promise<void> {
    // Always emit the alert locally too, so it is visible even if the webhook fails.
    this.logger.alert(payload.title, {
      severity: payload.severity,
      detail: payload.detail,
      ...(payload.context ?? {}),
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        this.logger.error("alert webhook returned non-2xx", {
          status: res.status,
          body: text.slice(0, 500),
        });
      }
    } catch (err) {
      // Best-effort: never let an alerting failure abort the caller.
      this.logger.error("alert webhook POST failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Writes alerts as ALERT-level log lines (the no-webhook fallback). */
export class LogAlerter implements Alerter {
  constructor(private readonly logger: Logger) {}

  async alert(payload: AlertPayload): Promise<void> {
    this.logger.alert(payload.title, {
      severity: payload.severity,
      detail: payload.detail,
      ...(payload.context ?? {}),
    });
  }
}

export interface MakeAlerterOptions {
  /** Webhook URL; when absent the log fallback is used. */
  webhookUrl?: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

/** Pick the alerter: webhook when a URL is configured, else the log fallback. */
export function makeAlerter(opts: MakeAlerterOptions): Alerter {
  if (opts.webhookUrl && opts.webhookUrl.length > 0) {
    return new WebhookAlerter(opts.webhookUrl, {
      logger: opts.logger,
      fetchImpl: opts.fetchImpl,
    });
  }
  opts.logger.warn(
    "no alert webhook configured; alerts will go to logs only (set ALERT_WEBHOOK_URL)"
  );
  return new LogAlerter(opts.logger);
}
