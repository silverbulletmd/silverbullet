import { expect, mod, test } from "./fixtures.ts";

test.describe("Command palette", () => {
	test("open and close command palette", async ({ sbPage }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome");

		// Open command palette
		await sbPage.keyboard.press(`${mod}+/`);
		const modal = sbPage.locator(".sb-modal-box");
		await expect(modal).toBeVisible();

		// Close with Escape
		await sbPage.keyboard.press("Escape");
		await expect(modal).not.toBeVisible();
	});

	test("filter commands by typing", async ({ sbPage }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome");

		// Open command palette
		await sbPage.keyboard.press(`${mod}+/`);
		const modal = sbPage.locator(".sb-modal-box");
		await expect(modal).toBeVisible();

		// Type to filter
		const paletteInput = modal.locator(".cm-content");
		await paletteInput.click();
		await sbPage.keyboard.type("Stats", { delay: 30 });

		// Should show filtered results including "Stats: Show"
		await expect(modal.locator(".sb-option .sb-name", { hasText: "Stats" })).toBeVisible();

		await sbPage.keyboard.press("Escape");
	});

	test("run a command from the palette", async ({ sbPage }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome");

		// Open command palette and run "Stats: Show"
		await sbPage.keyboard.press(`${mod}+/`);
		const modal = sbPage.locator(".sb-modal-box");
		const paletteInput = modal.locator(".cm-content");
		await paletteInput.click();
		await sbPage.keyboard.type("Stats: Show", { delay: 30 });

		// Select the matching command
		await sbPage.keyboard.press("Enter");

		// The modal should close
		await expect(modal).not.toBeVisible();
	});
});
