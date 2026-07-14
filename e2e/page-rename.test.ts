import { expect, gotoSilverBulletPage, mod, test } from "./fixtures.ts";

test.describe("Top-bar page rename", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome to the wondrous world of SilverBullet",
      "OldName.md": "Content to keep",
    },
  });

  test("rename via Enter moves the page on the server", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "OldName");
    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "OldName",
    );

    const nameInput = sbPage.locator("#sb-current-page input.sb-input");
    await nameInput.click();
    await sbPage.keyboard.press(`${mod}+a`);
    await sbPage.keyboard.type("NewName");
    await sbPage.keyboard.press("Enter");

    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "NewName",
    );

    // Wait for the rename round-trip to land: the client navigates to the new
    // page once `index.renamePageCommand` resolves on the server.
    await sbPage.waitForURL(/\/NewName$/);

    const newResp = await fetch(`${sbServer.url}/.fs/NewName.md`);
    expect(newResp.ok).toBe(true);
    expect(await newResp.text()).toContain("Content to keep");

    const oldResp = await fetch(`${sbServer.url}/.fs/OldName.md`);
    expect(oldResp.status).toBe(404);
  });

  test("rename via blur commits", async ({ sbPage, sbServer }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "OldName");
    const nameInput = sbPage.locator("#sb-current-page input.sb-input");
    await nameInput.click();
    await sbPage.keyboard.press(`${mod}+a`);
    await sbPage.keyboard.type("BlurRenamed");
    await sbPage.locator("#sb-editor .cm-content").click(); // blur the field
    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "BlurRenamed",
    );
    // Wait for the rename round-trip to land (client navigates to the new page).
    await sbPage.waitForURL(/\/BlurRenamed$/);
    const resp = await fetch(`${sbServer.url}/.fs/BlurRenamed.md`);
    expect(resp.ok).toBe(true);
  });

  test("editor shortcuts still fire while the page-name field is focused", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "OldName");
    const nameInput = sbPage.locator("#sb-current-page input.sb-input");
    await nameInput.click();
    // The global key forwarder must still route mod+k to the editor and open
    // the page picker even though a native input is focused (parity with the
    // old CodeMirror page-name editor).
    await sbPage.keyboard.press(`${mod}+k`);
    await expect(sbPage.locator(".sb-modal-box")).toBeVisible();
  });
});
