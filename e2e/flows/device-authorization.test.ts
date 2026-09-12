import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "../fixtures/core.ts";

function startCli(configHome: string, args: string[], input = "") {
  const proc = spawn("./target/debug/sb", args, {
    cwd: join(import.meta.dirname, "../.."),
    env: { ...process.env, XDG_CONFIG_HOME: configHome },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (data: Buffer) => {
    stderr += data.toString();
  });
  proc.stdout.resume();
  const exited = new Promise<number | null>((resolve, reject) => {
    proc.once("error", reject);
    proc.once("exit", resolve);
  });
  proc.stdin.end(input);
  return { proc, exited, stderr: () => stderr };
}

async function verificationUrl(cli: ReturnType<typeof startCli>) {
  await expect.poll(cli.stderr).toContain("Waiting for authorization");
  expect(cli.stderr()).not.toContain("Opening your browser");
  const link = cli
    .stderr()
    .match(/http:\/\/127\.0\.0\.1:\d+\/\.auth\/device\?user_code=[^\s]+/);
  expect(link).not.toBeNull();
  const url = new URL(link![0]);
  expect(url.searchParams.has("device_code")).toBe(false);
  expect(cli.stderr()).toContain(
    `Confirmation code: ${url.searchParams.get("user_code")}`,
  );
  return url.toString();
}

test.use({ serverEnv: { SB_USER: "river:harbor-password" } });

test("browser approval completes a separately running CLI sign-in", async ({
  sbServer,
  page,
}) => {
  const configHome = await mkdtemp(join(tmpdir(), "sb-device-cli-"));
  const configPath = join(configHome, "silverbullet", "config.json");
  let cli = startCli(
    configHome,
    ["space", "add", "--no-browser"],
    `harbor\n${sbServer.url}\n\n`,
  );
  try {
    const url = await verificationUrl(cli);
    await page.goto(url);
    await page.locator("#username").fill("river");
    await page.locator("#password").fill("harbor-password");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(
      page.getByRole("heading", { name: "Authorize access" }),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText("river");
    await expect(page.locator("main")).toContainText(
      new URL(url).searchParams.get("user_code")!,
    );
    expect(cli.proc.exitCode).toBeNull();
    await expect(access(configPath)).rejects.toThrow();
    await page
      .getByRole("button", {
        name: "Approve",
        exact: true,
      })
      .click();
    await expect(page.locator("body")).toContainText("Decision saved");
    expect(await cli.exited, cli.stderr()).toBe(0);
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    expect(saved.spaces).toHaveLength(1);
    expect(saved.spaces[0]).toMatchObject({
      name: "harbor",
      url: sbServer.url,
      auth: { method: "browser", username: "river" },
    });
    const auth = saved.spaces[0].auth;
    expect(auth.encryptedToken).toBeTruthy();
    expect(auth.encryptedRefreshToken).toBeTruthy();
    expect(auth.expiresAt).toBeGreaterThan(Date.now() / 1000);
    expect(auth).not.toHaveProperty("access_token");
    expect(auth).not.toHaveProperty("refresh_token");
    cli = startCli(configHome, ["space", "login", "harbor", "--no-browser"]);
    await page.goto(await verificationUrl(cli));
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    expect(await cli.exited, cli.stderr()).toBe(0);
    const refreshed = JSON.parse(await readFile(configPath, "utf8"));
    expect(refreshed.spaces).toHaveLength(1);
    expect(refreshed.spaces[0].id).toBe(saved.spaces[0].id);
    expect(refreshed.spaces[0].auth.encryptedRefreshToken).not.toBe(
      auth.encryptedRefreshToken,
    );
  } finally {
    if (cli.proc.exitCode === null) cli.proc.kill();
    await cli.exited;
    await rm(configHome, { recursive: true, force: true });
  }
});
