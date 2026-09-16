import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USER } from "../fixtures/core.ts";
import {
  coreApi,
  newPocketUserPage,
  signInWithPocketId,
  startCoreOidcFixture,
} from "./core-fixture.ts";

test("Core web setup, real Pocket ID admission, cross-host sessions and revocation", async () => {
  test.setTimeout(120_000);
  const fixture = await startCoreOidcFixture();
  const { adminPage, oidc } = fixture;
  try {
    const settings = await coreApi<{
      active: { providerId: string; clientSecret?: string };
    }>(adminPage, "GET", "admin/authentication");
    expect(settings.active.clientSecret).toBeUndefined();
    await coreApi(adminPage, "POST", "admin/users", {
      username: "river",
      loginMethod: "sso",
      providerId: settings.active.providerId,
      expectedEmail: "fixture-user@example.test",
      admin: false,
    });
    await coreApi(adminPage, "POST", "admin/spaces", {
      name: "Notes",
      binding: { host: new URL(oidc.notesOrigin).host },
      members: { river: {} },
      seedIndex: true,
    });
    await coreApi(adminPage, "POST", "admin/spaces", {
      name: "Research",
      binding: { host: new URL(oidc.researchOrigin).host },
      members: { river: {} },
      seedIndex: true,
    });
    await coreApi(adminPage, "POST", "admin/spaces", {
      name: "Team",
      binding: { prefix: "/team" },
      members: { river: {} },
      seedIndex: true,
    });
    const { page, context } = await newPocketUserPage(fixture);
    await page.goto(`${oidc.centralOrigin}/.dashboard/login`);
    await page.getByLabel("Username", { exact: true }).fill(ADMIN_USER);
    await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page
      .getByRole("button", { name: "Profile menu", exact: true })
      .click();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(
      page.getByText("Local space data has been removed from this browser."),
    ).toBeVisible();
    await page.goto(`${oidc.centralOrigin}/team/Deep?headless=1`);
    await signInWithPocketId(page);
    await expect(page).toHaveURL(
      (url) =>
        url.origin === oidc.centralOrigin && url.pathname === "/team/Deep",
    );
    await expect(page.locator("#sb-editor .cm-editor")).toBeVisible();
    expect(await page.evaluate(() => (window as any).sbRuntime.headless)).toBe(
      true,
    );
    expect(
      await page.evaluate(async () =>
        (await fetch("/.dashboard/api/session")).json(),
      ),
    ).toEqual({ username: "river", admin: false });
    for (const endpoint of ["users", "spaces", "authentication"]) {
      expect(
        await page.evaluate(
          async (endpoint) =>
            (await fetch(`/.dashboard/api/admin/${endpoint}`)).status,
          endpoint,
        ),
      ).toBe(403);
    }
    for (const [endpoint, body] of [
      ["users", { username: "unexpected", password: "synthetic-password" }],
      ["spaces", { name: "Unexpected", binding: { prefix: "/unexpected" } }],
      ["authentication/disable", {}],
    ] as const) {
      expect(
        await page.evaluate(
          async ({ endpoint, body }) =>
            (
              await fetch(`/.dashboard/api/admin/${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              })
            ).status,
          { endpoint, body },
        ),
      ).toBe(403);
    }
    await page.goto(`${oidc.notesOrigin}/?headless=1`);
    await expect(page.locator("#sb-editor .cm-editor")).toBeVisible();
    await page.goto(`${oidc.researchOrigin}/?headless=1`);
    await expect(page.locator("#sb-editor .cm-editor")).toBeVisible();
    const cookies = await context.cookies();
    expect(
      cookies
        .filter((cookie) => cookie.name.startsWith("auth_"))
        .map((cookie) => cookie.domain),
    ).toEqual(
      expect.arrayContaining(["login.sb.test", "notes.test", "research.test"]),
    );
    const second = await newPocketUserPage(fixture);
    await second.page.goto(`${oidc.notesOrigin}/?headless=1`);
    await signInWithPocketId(second.page);
    await expect(second.page.locator("#sb-editor .cm-editor")).toBeVisible();
    expect(
      await page.evaluate(
        async () => (await fetch("/.dashboard/api/logout")).status,
      ),
    ).toBe(200);
    const expired = await context.newPage();
    await expired.goto(`${oidc.notesOrigin}/.dashboard/login?signedOut=true`);
    expect(
      await expired.evaluate(async () => (await fetch("/.config")).status),
    ).toBe(401);
    await page.goto(`${oidc.researchOrigin}/.dashboard/login?signedOut=true`);
    expect(
      await page.evaluate(async () => (await fetch("/.config")).status),
    ).toBe(401);
    expect(
      await second.page.evaluate(async () => (await fetch("/.config")).status),
    ).toBe(200);
    await coreApi(adminPage, "POST", "admin/authentication/disable");
    await page.goto(`${oidc.notesOrigin}/?headless=1`);
    await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in with Pocket ID", exact: true }),
    ).toHaveCount(0);
    await context.close();
    await second.context.close();
  } catch (error) {
    const pages = [];
    for (const context of fixture.browser.contexts()) {
      for (const page of context.pages()) {
        if (!page.isClosed())
          pages.push(
            `${page.url()}: ${await page
              .locator("body")
              .innerText()
              .catch(() => "unavailable")}`,
          );
      }
    }
    throw new Error(
      `${error}\nBrowser pages:\n${pages.join("\n")}\nCore output:\n${fixture.output()}`,
    );
  } finally {
    await fixture.stop();
  }
});
