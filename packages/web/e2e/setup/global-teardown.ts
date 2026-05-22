import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

// Playwright's CommonJS loader provides `__dirname` directly.
const OUT_PATH = resolve(__dirname, "..", ".localnet.json");

/** Stop the validator started in global setup and clean its temp dirs. */
export default async function globalTeardown() {
  if (!existsSync(OUT_PATH)) return;
  try {
    const info = JSON.parse(readFileSync(OUT_PATH, "utf8")) as {
      validatorPid?: number;
      ledger?: string;
      work?: string;
    };
    if (info.validatorPid) {
      try {
        process.kill(info.validatorPid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    for (const dir of [info.ledger, info.work]) {
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* best effort */
        }
      }
    }
  } finally {
    try {
      rmSync(OUT_PATH, { force: true });
    } catch {
      /* best effort */
    }
  }
}
