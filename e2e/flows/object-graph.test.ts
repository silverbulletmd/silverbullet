import { runCommandViaPalette } from "../fixtures/actions.ts";
import { expect, test } from "../fixtures/core.ts";

for (const viewport of [
  { width: 360, height: 780 },
  { width: 780, height: 360 },
  { width: 1280, height: 800 },
]) {
  test.describe(`object graph at ${viewport.width}x${viewport.height}`, () => {
    test.use({
      viewport,
      spaceFiles: {
        "index.md": "# Home\n\n[[Notes]]\n",
        "Notes.md": "# Notes\n\n[[index]]\n",
      },
    });

    test("toolbar fits and the sidebar toggle gives the canvas the full width", async ({
      sbPage,
    }) => {
      await runCommandViaPalette(sbPage, "Graph: Explore");
      const graph = sbPage.frameLocator(".sb-modal iframe");
      const sidebar = graph.locator(".gv-sidebar");
      const canvas = graph.locator(".gv-canvas-wrap");
      const hideSidebar = graph.getByRole("button", { name: "Hide sidebar" });
      await expect(hideSidebar).toBeVisible();
      await expect(hideSidebar).toHaveAttribute("aria-expanded", "true");

      const toolbarFits = await graph
        .locator(".gv-header")
        .evaluate((header) => {
          const width = header.ownerDocument.defaultView!.innerWidth;
          return [
            ...header.querySelectorAll("button, label, .gv-header-title"),
          ].every((element) => {
            const bounds = element.getBoundingClientRect();
            return (
              bounds.width > 0 && bounds.left >= 0 && bounds.right <= width
            );
          });
        });
      expect(toolbarFits).toBe(true);

      const headerOrder = await graph
        .locator(".gv-header")
        .evaluate((header) => {
          const toggle = header.querySelector('[aria-label="Hide sidebar"]')!;
          const close = header.querySelector('[aria-label="Close (Esc)"]')!;
          const actions = header.querySelector(".gv-header-actions")!;
          const title = header.querySelector(".gv-header-title")!;
          const toggleBounds = toggle.getBoundingClientRect();
          const actionsBounds = actions.getBoundingClientRect();
          const isWide = header.ownerDocument.defaultView!.innerWidth >= 700;
          return isWide
            ? Math.abs(toggleBounds.left - actionsBounds.right - 8) < 1 &&
                close.getBoundingClientRect().left >= toggleBounds.right
            : toggleBounds.top < actionsBounds.top &&
                title.getBoundingClientRect().top < actionsBounds.top;
        });
      expect(headerOrder).toBe(true);

      const sidebarWidth = await sidebar.evaluate(
        (element) => element.getBoundingClientRect().width,
      );
      const bodyWidth = await graph
        .locator(".gv-body")
        .evaluate((element) => element.getBoundingClientRect().width);
      expect(sidebarWidth).toBeLessThanOrEqual(bodyWidth * 0.45 + 1);

      await hideSidebar.click();
      await expect(sidebar).toBeHidden();
      await expect(graph.locator(".gv-resizer")).toBeHidden();
      const showSidebar = graph.getByRole("button", { name: "Show sidebar" });
      await expect(showSidebar).toHaveAttribute("aria-expanded", "false");
      await expect
        .poll(() =>
          canvas.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const drawn = element
              .querySelector("canvas")
              ?.getBoundingClientRect();
            return (
              bounds.left === 0 &&
              Math.abs(
                bounds.width - element.ownerDocument.defaultView!.innerWidth,
              ) < 1 &&
              bounds.height > 0 &&
              drawn !== undefined &&
              Math.abs(drawn.width - bounds.width) < 1
            );
          }),
        )
        .toBe(true);

      await showSidebar.click();
      await expect(sidebar).toBeVisible();
      await expect
        .poll(() =>
          sidebar.evaluate((element) => element.getBoundingClientRect().width),
        )
        .toBe(sidebarWidth);
      await graph.getByRole("button", { name: "Close (Esc)" }).click();
      await expect(sbPage.locator(".sb-modal")).toHaveCount(0);
    });
  });
}
