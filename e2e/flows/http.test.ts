import type { Route } from "@playwright/test";
import { login, test } from "../fixtures/authenticated.ts";
import { expect, mod } from "../fixtures/core.ts";

test.use({
  disableServiceWorker: false,
  launchOptions: process.env.SB_E2E_HOST
    ? {}
    : { args: ["--host-resolver-rules=MAP http.test 127.0.0.1"] },
});
test.skip(
  ({ browserName }) => browserName !== "chromium" && !process.env.SB_E2E_HOST,
  "The default HTTP hostname mapping uses Chromium; set SB_E2E_HOST for other browsers.",
);

test("HTTP password login, fresh indexing, copying, saving and logout work without secure APIs", async ({
  page,
  sbServer,
  browserName,
}) => {
  const server = {
    ...sbServer,
    url: sbServer.url.replace("127.0.0.1", "http.test"),
  };
  const request = (path: string, method = "GET", data?: unknown) =>
    page.evaluate(
      async ({ url, method, data }) => {
        const response = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: data === undefined ? undefined : JSON.stringify(data),
          cache: "no-store",
        });
        return { status: response.status, text: await response.text() };
      },
      { url: server.url + path, method, data },
    );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${server.url}/.dashboard/login`);
  expect(await page.evaluate(() => isSecureContext)).toBe(false);
  await expect(page.getByLabel("Encrypt local data")).toHaveCount(0);
  await login(page, server);
  expect(
    (
      await request("/.dashboard/api/admin/server-config", "PUT", {
        primaryUrl: server.url,
      })
    ).status,
  ).toBe(200);
  expect(
    JSON.parse((await request("/.auth/central/public")).text).configured,
  ).toBeNull();
  expect((await request("/.auth/central/start")).status).toBe(403);
  expect(
    (
      await request("/.dashboard/api/admin/spaces", "POST", {
        name: "HTTP Notebook",
        binding: { prefix: "/notes" },
      })
    ).status,
  ).toBe(200);
  await page.goto(`${server.url}/notes/HTTP%20Note`);
  const editor = page.locator("#sb-editor .cm-content");
  await expect(editor).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as any).client?.fullIndexCompleted),
    )
    .toBe(true);
  await editor.click();
  await page.keyboard.insertText(
    "A durable HTTP note.\n\n```text\nCopy this text\n```\n",
  );
  const notePath = "/notes/.fs/HTTP%20Note.md";
  await expect
    .poll(async () => (await request(notePath)).text)
    .toContain("A durable HTTP note");
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(
    page.getByText("Copied to clipboard", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    const field = document.createElement("textarea");
    field.id = "clipboard-check";
    document.body.appendChild(field);
    field.focus();
  });
  await page.keyboard.press(`${mod}+v`);
  await expect(page.locator("#clipboard-check")).toHaveValue(/Copy this text/);
  await page.reload();
  await expect(editor).toContainText("A durable HTTP note.");
  const offlineRoute = (route: Route) =>
    route.fulfill({ status: 503, body: "Temporary server failure" });
  await page.route("**/*", offlineRoute);
  await page.evaluate(() =>
    (globalThis as any).client.navigate({ path: "HTTP Offline Target.md" }),
  );
  await expect(page).toHaveURL(/\/notes\/HTTP%20Note$/);
  await expect(editor).toContainText("A durable HTTP note.");
  await expect(page.getByText("Failed to navigate: Offline")).toBeVisible();
  expect(
    await page.evaluate(() => (globalThis as any).client.ui.viewState.isOnline),
  ).toBe(false);
  await page.unroute("**/*", offlineRoute);
  await page.evaluate(() =>
    (globalThis as any).client.httpSpacePrimitives.ping(),
  );
  expect(
    await page.evaluate(() => (globalThis as any).client.ui.viewState.isOnline),
  ).toBe(true);
  await page.route("**/notes/.fs/**", (route) =>
    ["PUT", "POST"].includes(route.request().method())
      ? route.fulfill({ status: 503, body: "Temporary write failure" })
      : route.continue(),
  );
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("Retain this edit until saving recovers.");
  await expect(
    page.getByText("Could not save page, retrying again in 10 seconds", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(editor).toContainText("Retain this edit until saving recovers.");
  expect(
    await page.evaluate(
      () => (globalThis as any).client.ui.viewState.unsavedChanges,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      globalThis.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  expect((await request(notePath)).text).not.toContain("Retain this edit");
  await page.unroute("**/notes/.fs/**");
  await page.evaluate(() =>
    (globalThis as any).client.contentManager.save(true),
  );
  await expect
    .poll(async () => (await request(notePath)).text)
    .toContain("Retain this edit until saving recovers");
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      globalThis.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
  const other = await page.context().newPage();
  await other.goto(`${server.url}/notes/HTTP%20Note`);
  await expect(other.locator("#sb-editor .cm-content")).toBeVisible();
  await page.locator("#sb-top button:has(.sb-profile-avatar)").click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(
    page.getByText(/Close other SilverBullet tabs and windows/),
  ).toBeVisible();
  expect((await request("/.dashboard/api/session")).status).toBe(200);
  await other.close();
  await page.locator("#sb-top button:has(.sb-profile-avatar)").click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  // WebKit's automated tab close omits pagehide, exercising stale-tab recovery.
  if (browserName === "webkit") {
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Force logout", exact: true })
      .last()
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "You are signed out" }),
  ).toBeVisible();
  expect((await request("/.dashboard/api/session")).status).toBe(401);
  expect(errors).toEqual([]);
});
