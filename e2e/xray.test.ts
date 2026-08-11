import {
  expect,
  gotoSilverBulletPage,
  mod,
  test,
  waitForEditorReady,
} from "./fixtures.ts";
import { navInput, navRows, openPicker } from "./navigator-ui.ts";

const XRAY_PAGE = `# XRay Test

This paragraph links to [[Other]] and has a tag. #alpha

* [ ] Task #beta #gamma
`;

test.describe("X-Ray lens", () => {
  test.use({
    spaceFiles: {
      "XRayTest.md": XRAY_PAGE,
      // Seed the link target so it doesn't become an aspiring page
      "Other.md": "# Other\nSome content.",
    },
  });

  test("underlines indexed ranges and shows stacked tooltip on wikilink hover, toggles off cleanly", async ({
    sbServer,
    page,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "XRayTest");
    const editor = page.locator("#sb-editor .cm-content");
    await expect(editor).toContainText("XRay Test");

    // Wait for the initial indexer pass so all ranged objects are available
    // when we activate X-Ray.
    await waitForEditorReady(page);

    const runToggle = async () => {
      const frame = await openPicker(page, `${mod}+/`, "Command");
      await navInput(page).fill("Toggle X-Ray");
      // By name: a row's text also carries its description and key hint.
      const name = navRows(frame).filter({ hasText: "Toggle X-Ray" }).first();
      await expect(name).toBeVisible({ timeout: 20_000 });
      await name.click();
      await expect(page.locator(".sb-modal")).toBeHidden();
    };

    await runToggle();

    await expect(page.locator(".sb-xray-range").first()).toBeVisible({
      timeout: 10_000,
    });

    const wikiLink = page
      .locator(".sb-wiki-link", { hasText: "Other" })
      .first();
    await expect(wikiLink).toBeVisible({ timeout: 5_000 });
    await wikiLink.hover({ force: true });

    const tooltip = page.locator(".cm-tooltip-lint");
    await expect(tooltip).toBeVisible({ timeout: 5_000 });
    await expect(tooltip).toContainText("tag: relation");
    await expect(tooltip).toContainText("tag: paragraph");
    await expect(
      tooltip.locator(".sb-xray-tooltip-tag", {
        hasText: /^paragraph, alpha$/,
      }),
    ).toBeVisible();

    // ── 4. Toggle X-Ray off; all decorations must disappear ───────────────
    await runToggle();
    await expect(page.locator(".sb-xray-range")).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
