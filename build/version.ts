import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { version } from "../version.ts";

/**
 * Generate `version.json` — the build-time version identifier shared by the
 * TypeScript client and the Rust server.
 *
 * The value is `git describe --tags --long` (falling back to
 * `${version}-${GITHUB_SHA}` when there's no git repo, as in CI) with a
 * wall-clock ISO timestamp appended. Nothing parses it for ordering; its only
 * job is to be identical between the client bundle and the server that built
 * it, and to differ whenever the bundle changes (so a long-lived client tab
 * can detect "the server upgraded, reload").
 *
 * The output is a language-neutral JSON file (`{ "version": "…" }`) so neither
 * side has to parse the other's source: the client imports it as JSON, and the
 * Rust crate reads it with `serde_json`.
 *
 * The timestamp is only minted when the git-describe part actually changes.
 * Regenerating it on every build broke the invariant above: the client bakes
 * version.json in at bundle time and the Rust binary at *compile* time, so a
 * client-only rebuild (`npm run build` without `cargo build`) left the two
 * permanently disagreeing — and a disagreement is what raises "A new version
 * of SilverBullet client is available. A reload or two is required to update."
 * That banner then never cleared, because reloading cannot fix a version skew
 * that isn't a stale cache. Holding the timestamp steady within a commit also
 * stops every client build from dirtying the input to `cargo:rerun-if-changed`
 * and forcing a needless Rust rebuild.
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

      // Keep the existing string when it was minted for this same commit, so
      // repeated builds stay byte-identical (see the note above).
      if (isForCommit(await readVersionFile(), commitVersion)) {
        resolve();
        return;
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

/**
 * Whether an existing version string was minted for `commitVersion`, and can
 * therefore be reused instead of getting a fresh timestamp.
 *
 * The trailing separator is load-bearing: without it a `git describe` of
 * `2.9.0-7` would claim an existing `2.9.0-70-g…` string as its own.
 */
export function isForCommit(
  existing: string | undefined,
  commitVersion: string,
): boolean {
  return existing?.startsWith(`${commitVersion}-`) ?? false;
}

/** Current `version.json` value, or undefined when absent/unreadable. */
async function readVersionFile(): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile("./version.json", "utf-8"));
    return typeof parsed?.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}
