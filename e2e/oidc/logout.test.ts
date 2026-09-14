import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USER } from "../fixtures/core.ts";
import { coreApi, startCoreOidcFixture } from "./core-fixture.ts";

const isolated = true;
for (const uploadBlocked of [false, true]) {
  test(
    (isolated ? "isolated primary: " : "") +
      (uploadBlocked
        ? "blocked synchronization retains encrypted drafts until force logout"
        : "logout synchronizes pending encrypted edits to the server and deletes local databases"),
    async () => {
      test.setTimeout(180_000);
      const fixture = await startCoreOidcFixture({
        disableServiceWorker: false,
      });
      try {
        if (isolated)
          await coreApi(fixture.adminPage, "PUT", "admin/server-config", {
            primaryUrl: fixture.oidc.centralOrigin,
          });
        const space = await coreApi<{ id: string }>(
          fixture.adminPage,
          "POST",
          "admin/spaces",
          {
            name: "Research",
            binding: { host: new URL(fixture.oidc.researchOrigin).host },
            seedIndex: true,
          },
        );
        const context = await fixture.browser.newContext();
        try {
          const page = await context.newPage();
          await page.goto(fixture.oidc.researchOrigin);
          await page.getByLabel("Username", { exact: true }).fill(ADMIN_USER);
          await page
            .getByLabel("Password", { exact: true })
            .fill(ADMIN_PASSWORD);
          await page
            .getByRole("checkbox", { name: /encryption|Encrypt local/ })
            .check();
          const popup = page.waitForEvent("popup");
          await page
            .getByRole("button", { name: "Log in", exact: true })
            .click();
          await popup;
          await expect(page.locator("#sb-editor .cm-editor")).toBeVisible();
          await page.waitForFunction(() => !!(window as any).client);
          await page.evaluate(() => (window as any).client.widgetsReady);
          await expect.poll(() => context.pages().length).toBe(1);
          const other = await context.newPage();
          await other.goto(`${fixture.oidc.researchOrigin}/Draft`);
          await expect(other.locator("#sb-editor .cm-editor")).toBeVisible();
          await other.waitForFunction(() => !!(window as any).client);
          await other.evaluate(() => (window as any).client.widgetsReady);
          expect(
            await other.evaluate(() => !!navigator.serviceWorker.controller),
          ).toBe(true);
          let blockedRequests = 0;
          if (uploadBlocked)
            await context.route("**/.fs**", (route) => {
              blockedRequests++;
              return route.abort();
            });
          await other.evaluate(() => {
            const client = (window as any).client;
            const manager = client.contentManager;
            const realSave = manager.save.bind(manager);
            manager.save = async (immediate: boolean) => {
              if (!immediate) return;
              await realSave(true);
            };
            const view = client.editorView;
            view.dispatch({
              changes: {
                from: 0,
                to: view.state.doc.length,
                insert: "Unsynced research draft survives logout",
              },
            });
            clearTimeout(manager.saveTimeout);
          });
          await expect(
            other.locator("#sb-current-page.sb-unsaved"),
          ).toBeVisible();
          await page.locator("#sb-top button:has(.sb-profile-avatar)").click();
          expect(
            await other.evaluate(() => ({
              text: (window as any).client.editorView.state.doc.toString(),
              unsaved: (window as any).client.ui.viewState.unsavedChanges,
              path: (window as any).client.currentPath(),
            })),
          ).toEqual({
            text: "Unsynced research draft survives logout",
            unsaved: true,
            path: "Draft.md",
          });
          const savedFile = join(fixture.root, "spaces", space.id, "Draft.md");
          expect(
            await readFile(savedFile, "utf8").catch(() => ""),
          ).not.toContain("Unsynced research draft survives logout");
          await page
            .getByRole("button", { name: "Log out", exact: true })
            .click();
          if (uploadBlocked) {
            await expect(
              page.getByText("Force logout", { exact: true }),
            ).toBeVisible();
            await page.screenshot({
              path: test.info().outputPath("force-logout.png"),
            });
            expect(blockedRequests).toBeGreaterThan(0);
            expect(
              await page.evaluate(
                async (isolated) =>
                  (
                    await fetch(
                      isolated
                        ? "/.auth/central/profile"
                        : "/.spaces/api/session",
                    )
                  ).status,
                isolated,
              ),
            ).toBe(200);
            page.once("dialog", (dialog) => dialog.accept());
            await page.getByText("Force logout", { exact: true }).click();
          }

          await expect(page).toHaveURL(
            `${fixture.oidc.researchOrigin}${isolated ? "/.auth/central/signed-out" : "/.spaces/login?signedOut=true"}`,
          );
          await expect(other).toHaveURL(
            `${fixture.oidc.researchOrigin}${isolated ? "/.auth/central/signed-out" : "/.spaces/login?signedOut=true"}`,
          );
          await expect(
            page.getByText("You are signed out", { exact: true }),
          ).toBeVisible();
          await expect(
            page.getByText(
              "Local space data has been removed from this browser.",
            ),
          ).toBeVisible();
          await expect(
            other.getByText(
              "Local space data has been removed from this browser.",
            ),
          ).toBeVisible();
          await page.screenshot({
            path: test.info().outputPath("signed-out.png"),
          });
          const serverText = await readFile(savedFile, "utf8").catch(() => "");
          if (uploadBlocked)
            expect(serverText).not.toContain(
              "Unsynced research draft survives logout",
            );
          else
            expect(serverText).toBe("Unsynced research draft survives logout");
          expect(
            await other.evaluate(async () =>
              (await indexedDB.databases()).filter((db) =>
                db.name?.startsWith("sb_"),
              ),
            ),
          ).toEqual([]);
          expect(
            await other.evaluate(
              async () =>
                (await navigator.serviceWorker.getRegistrations()).length,
            ),
          ).toBe(0);
          expect(
            await page.evaluate(
              async (isolated) =>
                (
                  await fetch(
                    isolated
                      ? "/.auth/central/profile"
                      : "/.spaces/api/profile",
                  )
                ).status,
              isolated,
            ),
          ).toBe(401);
        } finally {
          await context.close();
        }
      } catch (error) {
        throw new Error(`${error}\nCore output:\n${fixture.output()}`);
      } finally {
        await fixture.stop();
      }
    },
  );
}
