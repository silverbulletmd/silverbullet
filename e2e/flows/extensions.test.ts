import {
  currentPage,
  navFrame,
  navInput,
  runCommandViaPalette,
} from "../fixtures/actions.ts";
import { expect, test } from "../fixtures/core.ts";

const viewConfig = `# Route view
\`\`\`space-lua
view.define {
  name = "fixture.routes",
  title = "Routes",
  command = "Fixture: Open Routes",
  dock = "modal",
  presentation = { mode = "list" },
  source = function()
    return { { name = "Open Destination", ref = "Destination" } }
  end,
  onSelect = function(item) editor.navigate(item.ref) end,
}
\`\`\`
`;

test.describe("Lua-defined views", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "CONFIG.md": viewConfig,
      "Destination.md": "# Destination",
    },
  });

  test("a Space Lua view runs its source and selection handlers", async ({
    sbPage,
  }) => {
    await runCommandViaPalette(sbPage, "Fixture: Open Routes");
    const frame = navFrame(sbPage);
    await expect(frame.locator(".sb-nav-title")).toHaveText("Routes");
    await frame.locator(".sb-nav-row", { hasText: "Open Destination" }).click();

    await expect(currentPage(sbPage)).toHaveValue("Destination");
    await expect(sbPage.locator(".sb-modal")).toBeHidden();
  });
});

const pickConfig = `# Pick command
\`\`\`space-lua
command.define {
  name = "Fixture: Pick Produce",
  run = function()
    local item = navigator.pick {
      title = "Choose Produce",
      placeholder = "Produce",
      source = function()
        return {
          { name = "Pear", value = "pear" },
          { name = "Plum", value = "plum" },
        }
      end,
    }
    return item and item.value or nil
  end,
}
\`\`\`
`;

test.describe("Lua picker", () => {
  test.use({
    spaceFiles: {
      "index.md": "Welcome",
      "CONFIG.md": pickConfig,
    },
  });

  test("selecting a row returns its full object to the suspended Lua command", async ({
    sbPage,
  }) => {
    const result = sbPage.evaluate(() =>
      (globalThis as any).sbRuntime.evalLua(
        'editor.invokeCommand("Fixture: Pick Produce")',
      ),
    );
    await expect(navInput(sbPage)).toHaveAttribute("placeholder", "Produce", {
      timeout: 20_000,
    });
    await navFrame(sbPage).locator(".sb-nav-row", { hasText: "Plum" }).click();

    await expect(sbPage.locator(".sb-modal")).toBeHidden();
    expect(await result).toBe("plum");
  });
});

test.describe("configuration extension", () => {
  test.use({ spaceFiles: { "index.md": "Workspace text" } });

  test("configuration tabs work inside the iframe without replacing the editor", async ({
    sbPage,
  }) => {
    const before = await sbPage.evaluate(() =>
      (globalThis as any).client.editorView.state.doc.toString(),
    );
    await runCommandViaPalette(sbPage, "Configuration: Open");

    const frame = sbPage.frameLocator(".sb-modal iframe");
    const configuration = frame.getByRole("tab", {
      name: "Configuration",
      exact: true,
    });
    await expect(configuration).toBeVisible();
    await configuration.focus();
    await sbPage.keyboard.press("ArrowRight");
    const shortcuts = frame.getByRole("tab", {
      name: "Keyboard Shortcuts",
      exact: true,
    });
    await expect(shortcuts).toBeFocused();
    await expect(shortcuts).toHaveAttribute("aria-selected", "true");
    await sbPage.keyboard.press("Home");
    await expect(configuration).toHaveAttribute("aria-selected", "true");

    expect(
      await sbPage.evaluate(() =>
        (globalThis as any).client.editorView.state.doc.toString(),
      ),
    ).toBe(before);
  });
});
