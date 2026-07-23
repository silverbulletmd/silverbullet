import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort, waitForServer } from "./fixtures.ts";

/** A running release-binary server instance. */
export type ReleaseServer = {
  url: string;
  port: number;
  spaceDir: string;
  /** Stop the server process and clean up its temporary space directory. */
  stop: () => Promise<void>;
};

/**
 * Spawn the `--release` standalone binary at `target/release/silverbullet`
 * (relative to the repo root) against a fresh, empty temporary space.
 *
 * Unlike the debug `sbServer` fixture in `fixtures.ts`, the release binary
 * serves the client and plug assets from the rust-embed embedded base
 * filesystem rather than from disk — so these tests exercise that embedded
 * bundle end-to-end.
 *
 * The server runs with the runtime API disabled (`SB_RUNTIME_API=0`) so it does
 * not spawn its own headless Chrome; these tests drive a normal browser via
 * Playwright and don't need the server-side runtime. The service worker is also
 * disabled for deterministic boot behavior.
 *
 * `extraEnv` lets callers inject additional environment variables, e.g.
 * `{ SB_USER: "alice:s3cret" }` to enable the browser login flow.
 */
export async function startReleaseServer(
  extraEnv: Record<string, string> = {},
): Promise<ReleaseServer> {
  const spaceDir = await mkdtemp(join(tmpdir(), "sb-e2e-release-"));
  const port = await getFreePort();

  // `import.meta.dirname` is `<repo>/e2e`; the release binary lives at
  // `<repo>/target/release/silverbullet`.
  const repoRoot = join(import.meta.dirname, "..");
  const binaryPath = join(repoRoot, "target", "release", "silverbullet");

  // A fresh empty temp dir boots into the first-run setup wizard unless we
  // force single-space mode; both release-embedded scenarios want a single
  // servable space (the login-flow one additionally sets SB_USER for auth).
  const proc: ChildProcess = spawn(
    binaryPath,
    [spaceDir, "-p", String(port), "-L", "127.0.0.1", "--single"],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SB_DISABLE_SERVICE_WORKER: "1",
        SB_RUNTIME_API: "0",
        ...extraEnv,
      },
    },
  );

  let serverOutput = "";
  proc.stdout?.on("data", (d: Buffer) => {
    serverOutput += d.toString();
  });
  proc.stderr?.on("data", (d: Buffer) => {
    serverOutput += d.toString();
  });

  const url = `http://127.0.0.1:${port}`;

  let stopped = false;
  const stop = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    stopped = true;
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 5000);
      proc.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      proc.kill("SIGTERM");
    }).then(() => rm(spaceDir, { recursive: true, force: true }));
  };

  try {
    await waitForServer(`${url}/.ping`);
  } catch (err) {
    await stop();
    throw new Error(
      `Release server failed to start. Output:\n${serverOutput}\n${err}`,
    );
  }

  return { url, port, spaceDir, stop };
}
