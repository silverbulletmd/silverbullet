import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import { platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type APIRequestContext,
  test as base,
  expect,
  type Page,
} from "@playwright/test";

/** The platform-appropriate modifier key: Meta on macOS, Control elsewhere. */
export const mod = platform() === "darwin" ? "Meta" : "Control";

/**
 * Full redo chord, per the "Editor: Redo" binding in editor_commands.ts:
 * Cmd-Shift-z on macOS, Ctrl-y elsewhere. `${mod}+Shift+z` is NOT a redo
 * anywhere but macOS -- it silently does nothing on Linux.
 */
export const redoChord = platform() === "darwin" ? "Meta+Shift+z" : "Control+y";

/**
 * Chord for `mod`+Shift+<letter>. The letter must be UPPERCASE: with a
 * lowercase letter Playwright's Linux layout dispatches `key: "k"` with
 * shiftKey set, and CodeMirror then resolves "Ctrl-k" before "Shift-Ctrl-k",
 * running the wrong command. A real browser reports `key: "K"`.
 */
export const shiftChord = (letter: string) =>
  `${mod}+Shift+${letter.toUpperCase()}`;

/** The admin account every multi-space e2e test provisions via `silverbullet setup`. */
export const ADMIN_USER = "admin";
export const ADMIN_PASSWORD = "adminpw123";

export type SpaceAccess = "read" | "write" | "none";

export type DataRootOptions = {
  /** What visitors without an account may do in the space. */
  access: SpaceAccess;
  /** An admin account; without one the root is accountless (`users.json` is `{}`). */
  admin?: { username: string; password: string };
  /** Revisions mode of the space (default: unmanaged). */
  revisions?: "managed";
};

/**
 * Builds a multi-space data root holding one space bound at `/` whose folder
 * is the absolute `spaceDir` (so tests keep reading and writing the space
 * folder directly), and returns the data root path.
 */
export function provisionDataRoot(
  spaceDir: string,
  opts: DataRootOptions,
  binary = "./target/debug/silverbullet",
): string {
  const root = mkdtempSync(join(tmpdir(), "sb-e2e-root-"));
  if (opts.admin) {
    execFileSync(
      binary,
      [
        "setup",
        root,
        "--admin",
        `${opts.admin.username}:${opts.admin.password}`,
      ],
      { cwd: join(import.meta.dirname, "../.."), stdio: "pipe" },
    );
  } else {
    writeFileSync(join(root, "users.json"), "{}");
  }
  // The server-side headless Chrome is never needed: in `?headless=1` the
  // client uses its own in-page runtime.
  const serverJson = join(root, "server.json");
  const serverConfig = existsSync(serverJson)
    ? JSON.parse(readFileSync(serverJson, "utf8"))
    : {};
  writeFileSync(
    serverJson,
    JSON.stringify({ ...serverConfig, runtimeApi: false }),
  );
  mkdirSync(spaceDir, { recursive: true });
  writeFileSync(
    join(root, "spaces.json"),
    JSON.stringify({
      main: {
        name: "Main",
        folder: spaceDir,
        binding: { prefix: "" },
        access: opts.access,
        ...(opts.revisions ? { revisions: opts.revisions } : {}),
      },
    }),
  );
  return root;
}

/**
 * Seeds the welcome page into a space without any page. The single-space
 * server did this at boot; a multi-space server only does it for the spaces it
 * creates itself, not for a folder named in `spaces.json`.
 */
export async function seedWelcomePage(spaceDir: string): Promise<void> {
  const entries = await readdir(spaceDir, { recursive: true });
  if (entries.some((entry) => entry.endsWith(".md"))) return;
  await copyFile(
    join(import.meta.dirname, "../../bin/silverbullet/space_template/index.md"),
    join(spaceDir, "index.md"),
  );
}

export type SBServer = {
  url: string;
  port: number;
  /** The folder holding the space's files (the data root when `provisionAdmin` or `freshInstall`). */
  spaceDir: string;
  /** The server's data root (`spaces.json`, `users.json`). */
  dataRoot: string;
  /** Stop the server process (simulates "server down"). */
  stop: () => Promise<void>;
};

type SBFixtures = {
  spaceFiles: Record<string, string>;
  provisionAdmin: boolean;
  disableServiceWorker: boolean;
  /** Boot an empty data root into the setup wizard instead of a ready space. */
  freshInstall: boolean;
  /** What visitors without an account may do in the default space. */
  spaceAccess: SpaceAccess;
  /** Revisions mode of the default space. */
  spaceRevisions: "managed" | undefined;
  /** An admin account; the default space then grants anonymous visitors nothing. */
  spaceAccount: { username: string; password: string } | undefined;
  /** Extra env vars for the spawned server, e.g. `{ SB_MCP: "0" }`. */
  serverEnv: Record<string, string>;
  sbServer: SBServer;
  sbPage: Page;
};

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on("error", reject);
  });
}

export async function waitForServer(
  url: string,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Server did not become ready at ${url} within ${timeoutMs}ms`,
  );
}

export type SpawnServerOptions = {
  disableServiceWorker?: boolean;
  env?: Record<string, string>;
};

/**
 * Spawns a `silverbullet` server process against `spaceDir` on `port`, with
 * stdout/stderr piped (not inherited). Shared by the `sbServer` fixture and
 * any test that needs to spawn a second/replacement server directly (e.g.
 * simulating a server restart) -- keeps the binary path, args shape, and env
 * vars in one place.
 */
export function spawnServerProcess(
  spaceDir: string,
  port: number,
  opts: SpawnServerOptions = {},
): ChildProcess {
  const { disableServiceWorker = true, env = {} } = opts;
  const args = [
    spaceDir,
    "-p",
    String(port),
    "-L",
    process.env.SB_E2E_HOST ?? "127.0.0.1",
  ];

  const inherited = { ...process.env };
  delete inherited.SB_DISABLE_SERVICE_WORKER;
  return spawn("./target/debug/silverbullet", args, {
    cwd: join(import.meta.dirname, "../.."),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...inherited,
      ...(disableServiceWorker ? { SB_DISABLE_SERVICE_WORKER: "1" } : {}),
      ...env,
    },
  });
}

export const test = base.extend<SBFixtures>({
  spaceFiles: [{}, { option: true }],
  disableServiceWorker: [true, { option: true }],
  freshInstall: [false, { option: true }],
  spaceAccess: ["write", { option: true }],
  spaceRevisions: [undefined, { option: true }],
  spaceAccount: [undefined, { option: true }],
  provisionAdmin: [false, { option: true }],
  serverEnv: [{}, { option: true }],

  sbServer: async (
    {
      spaceFiles,
      disableServiceWorker,
      freshInstall,
      spaceAccess,
      spaceRevisions,
      spaceAccount,
      serverEnv,
      provisionAdmin,
    },
    use,
  ) => {
    let spaceDir = await mkdtemp(join(tmpdir(), "sb-e2e-"));
    let dataRoot = spaceDir;
    let proc: ChildProcess | undefined;
    let stopping: Promise<void> | undefined;
    const stop = () => {
      if (stopping) return stopping;
      const running = proc;
      if (
        !running?.pid ||
        running.exitCode !== null ||
        running.signalCode !== null
      )
        return Promise.resolve();
      stopping = new Promise<void>((resolve) => {
        const timer = setTimeout(() => running.kill("SIGKILL"), 5000);
        running.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        running.kill("SIGTERM");
      });
      return stopping;
    };
    try {
      if (!provisionAdmin && !freshInstall) {
        dataRoot = provisionDataRoot(spaceDir, {
          access: spaceAccount ? "none" : spaceAccess,
          admin: spaceAccount,
          revisions: spaceRevisions,
        });
      }
      if (provisionAdmin) {
        execFileSync(
          "./target/debug/silverbullet",
          ["setup", spaceDir, "--admin", `${ADMIN_USER}:${ADMIN_PASSWORD}`],
          { cwd: join(import.meta.dirname, "../.."), stdio: "pipe" },
        );
      }
      for (const [path, content] of Object.entries(spaceFiles)) {
        const fullPath = join(spaceDir, path);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content);
      }
      if (!provisionAdmin && !freshInstall) await seedWelcomePage(spaceDir);
      const port = await getFreePort();
      proc = spawnServerProcess(dataRoot, port, {
        disableServiceWorker,
        env: serverEnv,
      });
      let serverOutput = "";
      proc.stdout?.on("data", (data: Buffer) => {
        serverOutput += data.toString();
      });
      proc.stderr?.on("data", (data: Buffer) => {
        serverOutput += data.toString();
      });
      proc.on("error", (error) => {
        serverOutput += error.message;
      });
      const url = `http://${process.env.SB_E2E_HOST ?? "127.0.0.1"}:${port}`;
      try {
        await waitForServer(
          `${url}/${provisionAdmin ? ".dashboard" : ".ping"}`,
        );
      } catch (error) {
        throw new Error(
          `Server failed to start. Output:\n${serverOutput}\n${error}`,
        );
      }
      await use({ url, port, spaceDir, dataRoot, stop });
    } finally {
      await stop();
      await rm(spaceDir, { recursive: true, force: true });
      await rm(dataRoot, { recursive: true, force: true });
    }
  },

  sbPage: async ({ sbServer, page }, use) => {
    await gotoSilverBulletPage(page, sbServer);
    await use(page);
  },
});

export async function gotoSilverBulletPage(
  page: Page,
  sbServer: SBServer,
  pagePath = "",
): Promise<void> {
  const encoded = pagePath.split("/").map(encodeURIComponent).join("/");
  await page.goto(`${sbServer.url}/${encoded}?headless=1`);
  await page
    .locator("#sb-editor .cm-editor")
    .waitFor({ state: "visible", timeout: 30_000 });
  await waitForEditorReady(page);
}

export async function waitForEditorReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (globalThis as any).sbRuntime?.ready === true,
    undefined,
    { timeout: 15_000 },
  );
}

export { expect } from "@playwright/test";

export async function waitForPersistedContent(
  server: SBServer,
  path: string,
  expected: string | RegExp,
  request?: APIRequestContext,
): Promise<void> {
  const content = expect.poll(
    async () => {
      const url = `${server.url}/.fs/${path.split("/").map(encodeURIComponent).join("/")}`;
      if (request) {
        const response = await request.get(url);
        return response.ok() ? response.text() : null;
      }
      const response = await fetch(url);
      return response.ok ? response.text() : null;
    },
    { timeout: 10_000 },
  );
  if (typeof expected === "string") await content.toBe(expected);
  else await content.toMatch(expected);
}
