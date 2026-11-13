import { runCommandViaPalette } from "../fixtures/actions.ts";
import { expect, test } from "../fixtures/core.ts";

test.describe("persistent docks", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n\nWelcome",
      "Projects/Alpha.md": "# Alpha",
    },
  });

  test("moving the space tree to the right sidebar survives a reload", async ({
    sbPage,
  }) => {
    await runCommandViaPalette(sbPage, "Navigate: Tree");
    const left = sbPage.locator(".sb-nav-root-lhs");
    await expect(left.locator("[data-path='Projects']")).toBeVisible({
      timeout: 20_000,
    });

    await left.locator(".sb-dock-button").click();
    await sbPage
      .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
      .click();
    await expect(sbPage.locator(".sb-nav-root-lhs")).toHaveCount(0);
    await expect(sbPage.locator(".sb-nav-root-rhs")).toBeVisible();

    await sbPage.reload();
    const restored = sbPage.locator(".sb-nav-root-rhs");
    await expect(restored).toBeVisible({ timeout: 20_000 });
    await expect(restored.locator(".sb-nav-title")).toHaveText("Open");
    await expect(restored.locator("[data-path='Projects']")).toBeVisible();
  });
});
