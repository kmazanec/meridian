/**
 * Per-bot, human-readable logger.
 *
 * Unlike the automation service's JSON logger (built for aggregators), the whole point of
 * the bots is that a person tails the logs and *watches the agent think* — so this logger
 * is tuned for reading, not parsing. Each line is prefixed with a timestamp and the bot's
 * name (so a combined `tail -f logs/*.log` stays legible), and there are dedicated shapes
 * for the things we care about seeing: the model's reasoning, a tool call, a tool result,
 * a placed trade, and errors.
 *
 * The sink is injectable so tests can capture lines instead of writing to stdout.
 */

/** Tools/levels get a small glyph so the eye can scan a busy combined log. */
const GLYPH = {
  info: "·",
  think: "🧠",
  tool: "→",
  result: "←",
  trade: "💸",
  warn: "⚠",
  error: "✗",
} as const;

export type LogKind = keyof typeof GLYPH;

export interface BotLogLine {
  kind: LogKind;
  bot: string;
  msg: string;
  /** Optional structured detail, rendered compactly after the message. */
  fields?: Record<string, unknown>;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  /** The model's narrated reasoning for this tick. */
  think(msg: string, fields?: Record<string, unknown>): void;
  /** The agent is about to call a tool. */
  tool(name: string, args: unknown): void;
  /** A tool returned a result. */
  result(name: string, summary: string): void;
  /** A trade was placed on-chain. */
  trade(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  bot: string;
  /** Where lines go. Defaults to stdout; tests pass a capturing sink. */
  sink?: (line: BotLogLine) => void;
  /** Clock for the timestamp (ms). Injectable for deterministic tests. */
  now?: () => number;
}

/** Compact one-line rendering of structured fields, e.g. ` {price=0.62, size=10}`. */
function renderFields(fields?: Record<string, unknown>): string {
  if (!fields) return "";
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${stringify(v)}`);
  return parts.length ? ` {${parts.join(", ")}}` : "";
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/** Truncate long blobs (tool args/results) so one line stays one line. */
function clip(s: string, max = 600): string {
  return s.length > max ? `${s.slice(0, max)}… (+${s.length - max} chars)` : s;
}

function stdoutSink(now: () => number): (line: BotLogLine) => void {
  return (line) => {
    const ts = new Date(now()).toISOString();
    const glyph = GLYPH[line.kind];
    // eslint-disable-next-line no-console
    console.log(
      `${ts} [${line.bot}] ${glyph} ${line.msg}${renderFields(line.fields)}`
    );
  };
}

/** Build a {@link Logger} bound to one bot. */
export function createLogger(opts: LoggerOptions): Logger {
  const now = opts.now ?? Date.now;
  const sink = opts.sink ?? stdoutSink(now);
  const emit =
    (kind: LogKind) => (msg: string, fields?: Record<string, unknown>) =>
      sink({ kind, bot: opts.bot, msg, fields });
  return {
    info: emit("info"),
    think: emit("think"),
    trade: emit("trade"),
    warn: emit("warn"),
    error: emit("error"),
    tool: (name, args) =>
      sink({
        kind: "tool",
        bot: opts.bot,
        msg: `${name}(${clip(stringify(args))})`,
      }),
    result: (name, summary) =>
      sink({ kind: "result", bot: opts.bot, msg: `${name}: ${clip(summary)}` }),
  };
}
