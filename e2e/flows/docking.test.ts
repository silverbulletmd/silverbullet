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

  test("the bottom panel resizes vertically and survives a reload", async ({
    sbPage,
  }) => {
    await runCommandViaPalette(sbPage, "Navigate: Tree");
    const left = sbPage.locator(".sb-nav-root-lhs");
    await expect(left.locator("[data-path='Projects']")).toBeVisible({
      timeout: 20_000,
    });

    await left.locator(".sb-dock-button").click();
    await left
      .locator(".sb-dock-menu-item", { hasText: "Bottom panel" })
      .click();
    const bottom = sbPage.locator(".sb-bhs");
    await expect(bottom.locator(".sb-nav-root-bhs")).toBeVisible();
    const initialHeight = await bottom.evaluate(
      (element) => element.getBoundingClientRect().height,
    );

    const handle = bottom.locator(".sb-resizer-bhs");
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    await sbPage.mouse.move(box!.x + box!.width / 2, box!.y + 2);
    await sbPage.mouse.down();
    await sbPage.mouse.move(box!.x + box!.width / 2, box!.y - 80);
    await sbPage.mouse.up();
    await expect
      .poll(() =>
        bottom.evaluate((element) => element.getBoundingClientRect().height),
      )
      .toBeGreaterThan(initialHeight + 60);
    const resizedHeight = await bottom.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await expect
      .poll(
        async () =>
          Math.abs(
            (await sbPage.evaluate(() =>
              (globalThis as any).client.clientSystem.localSyscall(
                "datastore.get",
                [["navigator", "std.spaceTree", "height"]],
              ),
            )) - resizedHeight,
          ) <= 2,
      )
      .toBe(true);

    await sbPage.reload();
    await expect(sbPage.locator(".sb-nav-root-bhs")).toBeVisible({
      timeout: 20_000,
    });
    await expect
      .poll(
        async () =>
          Math.abs(
            (await sbPage
              .locator(".sb-bhs")
              .evaluate((element) => element.getBoundingClientRect().height)) -
              resizedHeight,
          ) <= 2,
      )
      .toBe(true);
  });

  test("the last opener wins when navigator and plug panels share the bottom slot", async ({
    sbPage,
  }) => {
    await runCommandViaPalette(sbPage, "Navigate: Tree");
    const left = sbPage.locator(".sb-nav-root-lhs");
    await expect(left).toBeVisible({ timeout: 20_000 });
    await left.locator(".sb-dock-button").click();
    await left
      .locator(".sb-dock-menu-item", { hasText: "Bottom panel" })
      .click();
    await expect(sbPage.locator(".sb-nav-root-bhs")).toBeVisible();

    await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
    const right = sbPage.locator(".sb-nav-root-rhs");
    await expect(right).toBeVisible();
    await right.locator(".sb-dock-button").click();
    await right
      .locator(".sb-dock-menu-item", { hasText: "Bottom panel" })
      .click();
    await expect(sbPage.locator(".sb-nav-root-bhs .sb-nav-title")).toHaveText(
      "Table of Contents",
    );

    await sbPage.evaluate(async () => {
      await (globalThis as any).client.clientSystem.localSyscall(
        "editor.showPanel",
        ["bhs", 220, "<p>Plug bottom panel</p>", ""],
      );
    });
    await expect(sbPage.locator(".sb-bhs iframe")).toBeVisible();
    await expect(sbPage.locator(".sb-nav-root-bhs")).toHaveCount(0);

    await runCommandViaPalette(sbPage, "Navigate: Tree");
    await expect(sbPage.locator(".sb-nav-root-bhs")).toBeVisible();
    await expect(sbPage.locator(".sb-bhs iframe")).toHaveCount(0);
  });
});

test.describe("page-aware docks", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Home\n\n## Overview\n\n## Notes\n",
      "Manual.md": "# Manual\n\n## Install\n\n## Configure\n",
    },
  });

  test("a table of contents opens on the right and follows page navigation", async ({
    sbPage,
  }) => {
    await runCommandViaPalette(sbPage, "Navigate: Table of Contents");
    const right = sbPage.locator(".sb-nav-root-rhs");
    await expect(right.locator(".sb-nav-title")).toHaveText(
      "Table of Contents",
    );
    await expect(navRows(right)).toHaveText(["Home", "Overview", "Notes"], {
      timeout: 20_000,
    });
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
