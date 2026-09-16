import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USER } from "../fixtures/core.ts";
import {
  coreApi,
  newPocketUserPage,
  signInWithPocketId,
  startCoreOidcFixture,
} from "./core-fixture.ts";

test("SSO defers encryption in the Dashboard, then chooses and safely unlocks the space", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(180_000);
  const fixture = await startCoreOidcFixture({ disableServiceWorker: false });
  try {
    await coreApi(fixture.adminPage, "PUT", "admin/server-config", {
      primaryUrl: fixture.oidc.centralOrigin,
    });
    const settings = await coreApi<any>(
      fixture.adminPage,
      "GET",
      "admin/authentication",
    );
    await coreApi(fixture.adminPage, "POST", "admin/users", {
      username: "river",
      loginMethod: "sso",
      providerId: settings.active.providerId,
      expectedEmail: "fixture-user@example.test",
      admin: false,
    });
    await coreApi(fixture.adminPage, "POST", "admin/spaces", {
      name: "Notes",
      binding: { host: new URL(fixture.oidc.notesOrigin).host },
      members: { river: {} },
      seedIndex: true,
    });
    const { context, page } = await newPocketUserPage(fixture);
    try {
      await page.goto(`${fixture.oidc.centralOrigin}/.dashboard/login`);
      await expect(page).toHaveURL(/login\.sb\.test.*\/central\/login/);
      await page
        .getByRole("checkbox", { name: /encryption|Encrypt local/ })
        .check();
      await signInWithPocketId(page);
      await expect(page.getByRole("link", { name: /^Notes/ })).toBeVisible();
      await expect(
        page.getByLabel("Local encryption passphrase", { exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          async () => (await navigator.serviceWorker.getRegistrations()).length,
        ),
      ).toBe(0);
      const spaceLink = page.getByRole("link", { name: /^Notes/ });
      await expect(spaceLink).toHaveAttribute(
        "href",
        /notes\.test.*\/central\/start.*encrypt=true/,
      );
      await spaceLink.click();
      await page
        .getByLabel("Local encryption passphrase", { exact: true })
        .waitFor();
      await page
        .getByLabel("Local encryption passphrase", { exact: true })
        .fill("fixture-private-passphrase");
      await page
        .getByLabel("Confirm passphrase", { exact: true })
        .fill("fixture-private-passphrase");
      await page
        .getByRole("button", { name: "Enable local encryption", exact: true })
        .click();
      await expect(page.locator("#sb-editor .cm-editor")).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(async () =>
            (await indexedDB.databases()).some((database) =>
              database.name?.startsWith("sb_files_"),
            ),
          ),
        )
        .toBe(true);
      const initialDatabases = await page.evaluate(async () =>
        (await indexedDB.databases()).map((database) => database.name).sort(),
      );
      expect(
        initialDatabases.some((name) => name?.startsWith("sb_files_")),
      ).toBe(true);
      const storage = await page.evaluate(() => JSON.stringify(localStorage));
      expect(storage).not.toContain("fixture-private-passphrase");
      expect(storage).toContain("sb-local-encryption-verifier:river");
      await page.reload();
      await expect(page.locator("#sb-editor .cm-editor")).toBeVisible();
      await page.evaluate(async () => {
        for (const registration of await navigator.serviceWorker.getRegistrations())
          await registration.unregister();
      });
      await page.goto(
        `${fixture.oidc.notesOrigin}/.auth/central/start?destination=${encodeURIComponent(`${fixture.oidc.notesOrigin}/`)}&encrypt=true`,
      );
      await page
        .getByLabel("Local encryption passphrase", { exact: true })
        .fill("fixture-private-passphrase");
      await page.getByRole("button", { name: "Unlock", exact: true }).click();
      await expect(page.locator("#sb-editor .cm-editor")).toBeVisible();
    } catch (error) {
      await page.screenshot({
        path: testInfo.outputPath("failure.png"),
        fullPage: true,
      });
      throw new Error(
        `${error}\nPage ${page.url()}: ${await page.locator("body").innerText()}`,
      );
    } finally {
      await context.close();
    }
  } catch (error) {
    throw new Error(`${error}\nCore output:\n${fixture.output()}`);
  } finally {
    await fixture.stop();
  }
});

test("local login unlocks an encrypted space through its popup", async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(180_000);
  const fixture = await startCoreOidcFixture({ disableServiceWorker: false });
  try {
    await coreApi(fixture.adminPage, "POST", "admin/spaces", {
      name: "Research",
      binding: { host: new URL(fixture.oidc.researchOrigin).host },
      seedIndex: true,
    });
    const context = await fixture.browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(fixture.oidc.researchOrigin);
      await expect(page).toHaveURL(/login\.sb\.test.*\/central\/login/);
      await page.getByLabel("Username", { exact: true }).fill(ADMIN_USER);
      await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
      await page
        .getByRole("checkbox", { name: /encryption|Encrypt local/ })
        .check();
      const popupPromise = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Log in", exact: true }).click();
      await popupPromise;
      await expect(page).toHaveURL(/research\.test/);
      await expect(page.locator("#sb-editor .cm-editor")).toBeVisible();
      expect(
        await page.evaluate(() => localStorage.getItem("enableEncryption")),
      ).toBe("true");
      await expect.poll(() => context.pages().length).toBe(1);
    } catch (error) {
      await page.screenshot({
        path: testInfo.outputPath("failure.png"),
        fullPage: true,
      });
      throw new Error(
        `${error}\nPage ${page.url()}: ${await page.locator("body").innerText()}`,
      );
    } finally {
      await context.close();
    }
  } catch (error) {
    throw new Error(`${error}\nCore output:\n${fixture.output()}`);
  } finally {
    await fixture.stop();
  }
});
