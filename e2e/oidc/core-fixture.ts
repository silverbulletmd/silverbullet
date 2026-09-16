import { type ChildProcess, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import {
  type Browser,
  type BrowserContext,
  chromium,
  expect,
  type Page,
} from "@playwright/test";
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  getFreePort,
  spawnServerProcess,
  waitForServer,
} from "../fixtures/core.ts";
import { type OidcEnvironment, startOidcEnvironment } from "./environment.ts";
import { installPasskeyAuthenticator } from "./passkeys.ts";
import { createPocketIdClient, provisionPocketIdUser } from "./provider.ts";

export type CoreOidcFixture = {
  adminPage: Page;
  browser: Browser;
  corePort: number;
  root: string;
  oidc: OidcEnvironment;
  providerPage: Page;
  output(): string;
  stop(): Promise<void>;
};

export async function coreApi<T>(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const response = await fetch(`/.spaces/api/${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          `${method} ${path}: ${response.status} ${JSON.stringify(result)}`,
        );
      }
      return result;
    },
    { method, path, body },
  ) as Promise<T>;
}

async function configurePocketId(
  adminPage: Page,
  providerPage: Page,
  oidc: OidcEnvironment,
): Promise<void> {
  const client = await createPocketIdClient(
    providerPage,
    `${oidc.centralOrigin}/.auth/central/oidc/callback`,
  );
  await adminPage.goto(`${oidc.centralOrigin}/.spaces/login`);
  await adminPage.getByLabel("Username", { exact: true }).fill(ADMIN_USER);
  await adminPage.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await adminPage.getByRole("button", { name: "Log in", exact: true }).click();
  await adminPage.getByRole("link", { name: "Admin", exact: true }).click();
  await adminPage
    .getByRole("navigation", { name: "Admin settings" })
    .getByRole("link", { name: "Authentication", exact: true })
    .click();
  await adminPage
    .getByRole("button", { name: "Set up SSO", exact: true })
    .click();
  await adminPage.getByLabel("Provider", { exact: true }).selectOption("oidc");
  await adminPage
    .getByLabel("Central login URL", { exact: true })
    .fill(oidc.centralOrigin);
  await adminPage
    .getByLabel("Issuer URL", { exact: true })
    .fill(oidc.issuerOrigin);
  await adminPage
    .getByLabel("Client ID", { exact: true })
    .fill(client.clientId);
  await adminPage
    .getByLabel("Client secret", { exact: true })
    .fill(client.clientSecret);
  await adminPage
    .getByLabel("Sign-in button label", { exact: true })
    .fill("Sign in with Pocket ID");
  const popupPromise = adminPage.waitForEvent("popup");
  await adminPage
    .getByRole("button", { name: "Save and test sign-in", exact: true })
    .click();
  const popup = await popupPromise;
  await installPasskeyAuthenticator(popup, providerPage);
  await expect(popup).toHaveURL(/identity.test/);
  try {
    await completePocketIdInteraction(popup);
  } catch (error) {
    if (!popup.isClosed())
      await popup.screenshot({
        path: "test-results/oidc-negative/provider-setup.png",
        fullPage: true,
      });
    throw new Error(
      `${error}\nPocket ID setup stopped at ${popup.url()}: ${popup.isClosed() ? "Popup closed" : await popup.locator("body").innerText()}`,
    );
  }
  await expect(
    adminPage.getByRole("heading", {
      name: "Review and enable",
      exact: true,
    }),
  ).toBeVisible();
  await adminPage
    .getByRole("button", { name: "Enable SSO", exact: true })
    .click();
  await expect(
    adminPage.getByText("SSO is enabled.", { exact: true }),
  ).toBeVisible();
}

async function completePocketIdInteraction(page: Page): Promise<void> {
  for (let step = 0; step < 4; step++) {
    if (page.isClosed() || new URL(page.url()).hostname !== "identity.test")
      return;
    const action = page
      .getByRole("button", {
        name: /^(authenticate|sign in|allow|authorize|continue)$/i,
      })
      .first();
    await action.waitFor({ state: "visible", timeout: 15_000 });
    const previousUrl = page.url();
    await action.click();
    try {
      await page.waitForURL((url) => url.href !== previousUrl, {
        timeout: 15_000,
        waitUntil: "domcontentloaded",
      });
    } catch (error) {
      if (page.isClosed()) return;
      throw error;
    }
  }
  if (new URL(page.url()).hostname === "identity.test") {
    throw new Error("Pocket ID sign-in used too many interaction steps");
  }
}

export async function newPocketUserPage(
  fixture: CoreOidcFixture,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await fixture.browser.newContext();
  const page = await context.newPage();
  await installPasskeyAuthenticator(page, fixture.providerPage);
  return { context, page };
}

export async function signInWithPocketId(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Sign in with Pocket ID", exact: true })
    .click();
  await expect(page).toHaveURL(/identity.test/);
  await completePocketIdInteraction(page);
}

export async function startCoreOidcFixture(
  options: { disableServiceWorker?: boolean; backForwardCache?: boolean } = {},
): Promise<CoreOidcFixture> {
  const port = await getFreePort();
  const oidc = await startOidcEnvironment({ corePort: port });
  const root = await mkdtemp(join(tmpdir(), "sb-oidc-negative-"));
  let process: ChildProcess | undefined;
  let browser: Browser | undefined;
  let output = "";
  try {
    execFileSync(
      "./target/debug/silverbullet",
      ["setup", root, "--admin", `${ADMIN_USER}:${ADMIN_PASSWORD}`],
      { stdio: "pipe" },
    );
    process = spawnServerProcess(root, port, {
      singleSpace: false,
      disableServiceWorker: options.disableServiceWorker,
      env: {
        HTTPS_PROXY: oidc.outboundProxy,
        SB_OIDC_CA_FILE: oidc.certificatePath,
      },
    });
    process.stderr?.on("data", (data) => {
      output += data.toString();
    });
    process.stdout?.on("data", (data) => {
      output += data.toString();
    });
    await waitForServer(`http://127.0.0.1:${port}/.spaces`);
    browser = await chromium.launch({
      args: oidc.browserArgs,
      channel: env.SB_TEST_CHROME_CHANNEL,
      ignoreDefaultArgs: options.backForwardCache
        ? ["--disable-back-forward-cache"]
        : [],
    });
    const adminContext = await browser.newContext();
    adminContext.on("page", (page) => {
      page.on("pageerror", (error) => {
        output += `Browser error: ${error.message}\n`;
      });
      page.on("response", (response) => {
        if (response.status() >= 400)
          output += `HTTP ${response.status()} ${new URL(response.url()).pathname}\n`;
      });
    });
    const adminPage = await adminContext.newPage();
    const providerPage = await adminContext.newPage();
    await installPasskeyAuthenticator(providerPage);
    await provisionPocketIdUser(providerPage, oidc.issuerOrigin);
    await configurePocketId(adminPage, providerPage, oidc);
    let stopped = false;
    return {
      adminPage,
      browser,
      corePort: port,
      root,
      oidc,
      providerPage,
      output: () => output,
      stop: async () => {
        if (stopped) return;
        stopped = true;
        await browser!.close();
        if (process && process.exitCode === null) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              process!.kill("SIGKILL");
              resolve();
            }, 5_000);
            process!.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
            process!.kill("SIGTERM");
          });
        }
        await oidc.stop();
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await browser?.close();
    process?.kill("SIGKILL");
    await oidc.stop();
    await rm(root, { recursive: true, force: true });
    throw new Error(`${error}\nCore output:\n${output}`);
  }
}
