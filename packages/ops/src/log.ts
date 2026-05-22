/**
 * Human-readable console logging for the ops scripts.
 *
 * Unlike the automation service's JSON-per-line {@link Logger} (built for log aggregators),
 * the ops scripts are run interactively by an operator or a reviewer watching a demo, so
 * their output is a readable transcript: section headers, step lines, key/value detail, and
 * a clear success/failure marker. The sink is injectable so tests can capture lines instead
 * of writing to stdout.
 */

export interface ConsoleLog {
  /** A bold section header (e.g. "Deploy", "Lifecycle: settle"). */
  section(title: string): void;
  /** A numbered/▶ step line. */
  step(msg: string): void;
  /** An indented key: value detail line. */
  detail(key: string, value: string): void;
  /** A success ✓ line. */
  ok(msg: string): void;
  /** A warning line (non-fatal). */
  warn(msg: string): void;
}

export interface ConsoleLogOptions {
  /** Where lines go (already formatted). Defaults to stdout. Tests pass a capturing sink. */
  sink?: (line: string) => void;
  /** Disable ANSI styling (e.g. when not a TTY or for stable test output). Default: auto. */
  color?: boolean;
}

const ANSI = {
  reset: "[0m",
  bold: "[1m",
  dim: "[2m",
  green: "[32m",
  yellow: "[33m",
  cyan: "[36m",
};

/** Build a {@link ConsoleLog}. */
export function createConsoleLog(opts: ConsoleLogOptions = {}): ConsoleLog {
  // eslint-disable-next-line no-console
  const sink = opts.sink ?? ((line: string) => console.log(line));
  const useColor = opts.color ?? Boolean(process.stdout.isTTY);
  const style = (codes: string, s: string): string =>
    useColor ? `${codes}${s}${ANSI.reset}` : s;

  return {
    section(title: string): void {
      sink("");
      sink(style(ANSI.bold + ANSI.cyan, `── ${title} ──`));
    },
    step(msg: string): void {
      sink(`${style(ANSI.cyan, "▶")} ${msg}`);
    },
    detail(key: string, value: string): void {
      sink(`    ${style(ANSI.dim, key + ":")} ${value}`);
    },
    ok(msg: string): void {
      sink(`${style(ANSI.green, "✓")} ${msg}`);
    },
    warn(msg: string): void {
      sink(`${style(ANSI.yellow, "!")} ${msg}`);
    },
  };
}
