/**
 * Tiny structured logger.
 *
 * Operations must be observable so a failed run is visible (an acceptance criterion). The
 * logger emits one JSON object per line with a level, a timestamp, a message, and
 * optional fields — friendly to log aggregators. The sink is injectable so tests capture
 * lines instead of writing to stdout, and a deployment can redirect output.
 */

export enum LogLevel {
  Info = "info",
  Warn = "warn",
  Error = "error",
  /** Operator-facing: a failure that needs human attention (mirrors an alert). */
  Alert = "alert",
}

/** A single structured log line handed to the sink. */
export interface LogLine {
  level: LogLevel;
  msg: string;
  fields?: Record<string, unknown>;
}

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  alert(msg: string, fields?: Record<string, unknown>): void;
}

export interface LoggerOptions {
  /** Where lines go. Defaults to stdout as JSON; tests pass a capturing sink. */
  sink?: (line: LogLine) => void;
  /** Clock for the timestamp (ms). Injectable for deterministic tests. */
  now?: () => number;
}

/** The default sink: one JSON line per record to stdout, with an ISO timestamp. */
function stdoutSink(now: () => number): (line: LogLine) => void {
  return (line) => {
    const record = {
      ts: new Date(now()).toISOString(),
      level: line.level,
      msg: line.msg,
      ...(line.fields ?? {}),
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(record));
  };
}

/** Build a {@link Logger}. */
export function createLogger(opts: LoggerOptions = {}): Logger {
  const now = opts.now ?? Date.now;
  const sink = opts.sink ?? stdoutSink(now);
  const emit =
    (level: LogLevel) => (msg: string, fields?: Record<string, unknown>) =>
      sink({ level, msg, fields });
  return {
    info: emit(LogLevel.Info),
    warn: emit(LogLevel.Warn),
    error: emit(LogLevel.Error),
    alert: emit(LogLevel.Alert),
  };
}
