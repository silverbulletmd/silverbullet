import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getFreePort,
  provisionDataRoot,
  seedWelcomePage,
  waitForServer,
} from "./core.ts";

/** A running release-binary server instance. */
export type ReleaseServer = {
  url: string;
  port: number;
  spaceDir: string;
  /** Stop the server process and clean up its temporary space directory. */
  stop: () => Promise<void>;
};

// The release binary must serve embedded assets; the debug fixture reads them from disk.
export async function startReleaseServer(
  opts: { admin?: { username: string; password: string } } = {},
): Promise<ReleaseServer> {
  const spaceDir = await mkdtemp(join(tmpdir(), "sb-e2e-release-"));
  const port = await getFreePort();

  const repoRoot = join(import.meta.dirname, "../..");
  const binaryPath = join(repoRoot, "target", "release", "silverbullet");

  // Both release-embedded scenarios want one servable space (the login-flow
  // one with an admin account, so anonymous visitors get no access).
  const dataRoot = provisionDataRoot(
    spaceDir,
    { access: opts.admin ? "none" : "write", admin: opts.admin },
    binaryPath,
  );
  await seedWelcomePage(spaceDir);
  const proc: ChildProcess = spawn(
    binaryPath,
    [dataRoot, "-p", String(port), "-L", "127.0.0.1"],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SB_DISABLE_SERVICE_WORKER: "1",
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
    }).then(async () => {
      await rm(spaceDir, { recursive: true, force: true });
      await rm(dataRoot, { recursive: true, force: true });
    });
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
