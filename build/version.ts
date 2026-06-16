import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { version } from "../version.ts";

/**
 * Generate `version.json` — the build-time version identifier shared by the
 * TypeScript client and the Rust server.
 *
 * The value is `git describe --tags --long` (falling back to
 * `${version}-${GITHUB_SHA}` when there's no git repo, as in CI) with a
 * wall-clock ISO timestamp appended, so every build produces a distinct string.
 * Nothing parses it for ordering; its only job is to be identical between the
 * client bundle and the server that built it, and to differ whenever the bundle
 * changes (so a long-lived client tab can detect "the server upgraded, reload").
 *
 * The output is a language-neutral JSON file (`{ "version": "…" }`) so neither
 * side has to parse the other's source: the client imports it as JSON, and the
 * Rust crate reads it with `serde_json`.
 */
export function updateVersionFile(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const gitProcess = spawn("git", ["describe", "--tags", "--long"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";

    gitProcess.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    gitProcess.on("close", async (code) => {
      let commitVersion = stdout.trim();

      if (!commitVersion || code !== 0) {
        // Probably no valid .git repo, fallback to GITHUB_SHA env var (used in CI)
        commitVersion = `${version}-${process.env.GITHUB_SHA || "unknown"}`;
      }

      // Attach the build date in YYYY-MM-DDTHH-MM-SSZ format to the version.
      const publicVersion = `${commitVersion}-${new Date()
        .toISOString()
        .split(".")[0]
        .replaceAll(":", "-")
        .concat("Z")}`;

      try {
        await writeFile(
          "./version.json",
          `${JSON.stringify({ version: publicVersion })}\n`,
          "utf-8",
        );
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    gitProcess.on("error", reject);
  });
}
