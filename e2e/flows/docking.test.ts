import {
  navigateViaPagePicker,
  navRows,
  runCommandViaPalette,
} from "../fixtures/actions.ts";
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
    await left
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

test.describe("page-aware docks", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n\n## Overview\n\n## Notes\n",
      "Manual.md": "# Manual\n\n## Install\n\n## Configure\n",
    },
  });

  test("a table of contents moved from the modal follows page navigation", async ({
    sbPage,
  }) => {
    await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
    const modal = sbPage.locator(".sb-nav-root-modal");
    await expect(navRows(modal)).toHaveText(["Home", "Overview", "Notes"], {
      timeout: 20_000,
    });

    await modal.locator(".sb-dock-button").click();
    await modal
      .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
      .click();
    const right = sbPage.locator(".sb-nav-root-rhs");
    await expect(right.locator(".sb-nav-title")).toHaveText(
      "Table of Contents",
    );
    await expect(sbPage.locator(".sb-nav-root-modal")).toHaveCount(0);

    await sbPage.locator("#sb-editor .cm-content").click();
    await navigateViaPagePicker(sbPage, "Manual");
    await expect(navRows(right)).toHaveText(
      ["Manual", "Install", "Configure"],
      {
        timeout: 20_000,
      },
    );
  });
});
