import {
  navigateViaPagePicker,
  runCommandViaPalette,
} from "../fixtures/actions.ts";
import { expect, test } from "../fixtures/core.ts";

// Made-up pages that link to each other
test.use({
  spaceFiles: {
    "index.md": "Welcome",
    "Projects/Garden Shed.md":
      "---\ntags: project\nstatus: active\n---\nAsk [[People/Sam Ortiz]] about [[Home/Garden]].",
    "People/Sam Ortiz.md":
      "---\ntags: person\n---\nOwns [[Projects/Garden Shed]].",
    "Home/Garden.md": "The shed is in [[Projects/Garden Shed]].",
  },
});

test("the object graph opens on the page, switches tabs, docks and follows the editor", async ({
  sbPage: page,
}) => {
  await navigateViaPagePicker(page, "Projects/Garden Shed");

  // The plug's panel view, in the modal on its Local tab
  await runCommandViaPalette(page, "Graph: Explore");
  const modal = page.locator(".sb-nav-root-modal");
  await expect(modal.locator(".sb-nav-title")).toHaveText("Graph");
  const graph = page.frameLocator(".sb-panel-view iframe");
  const selected = graph.getByRole("region", { name: "Selected" });
  await expect(selected).toContainText("Projects/Garden Shed");
  await expect(selected).toContainText("active");

  // The Global tab rebuilds the panel over every page
  await modal.getByRole("radio", { name: "Global" }).click();
  await expect(graph.locator(".gv-stats")).toContainText("4 objects");
  await modal.getByRole("radio", { name: "Local" }).click();
  await expect(selected).toContainText("Projects/Garden Shed");

  // Docked beside the editor, the local graph follows the page opened
  await modal.locator(".sb-dock-button").click();
  await page
    .locator(".sb-dock-menu-item", { hasText: "Right sidebar" })
    .click();
  const docked = page.locator(".sb-nav-root-rhs");
  await expect(docked.locator(".sb-nav-title")).toHaveText("Graph");
  await navigateViaPagePicker(page, "People/Sam Ortiz");
  const dockedGraph = docked.frameLocator(".sb-panel-view iframe");
  // A narrow dock starts with the filters (and the selected object) closed
  await dockedGraph.getByRole("button", { name: "Filters" }).click();
  await expect(
    dockedGraph.getByRole("region", { name: "Selected" }),
  ).toContainText("People/Sam Ortiz");
});
