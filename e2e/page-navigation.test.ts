import { expect, mod, test, waitForSaveAndReadFromServer } from "./fixtures.ts";

test.describe("Page navigation", () => {
	test("create a new page via page picker", async ({ sbPage, sbServer }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome to the wondrous world of SilverBullet");

		// Open page picker
		await sbPage.keyboard.press(`${mod}+k`);
		await expect(sbPage.locator(".sb-modal-box")).toBeVisible();

		// Type the new page name (with delay to avoid dropped keystrokes)
		const pickerInput = sbPage.locator(".sb-modal-box .cm-content");
		await pickerInput.click();
		await sbPage.keyboard.type("My New Page", { delay: 30 });

		// Should see "Create page" hint in the list
		await expect(sbPage.locator(".sb-option .sb-hint", { hasText: "Create page" })).toBeVisible();

		// Shift+Enter to create new page
		await sbPage.keyboard.press("Shift+Enter");

		// Modal should close
		await expect(sbPage.locator(".sb-modal-box")).not.toBeVisible();

		// Page name should update in top bar
		await expect(sbPage.locator("#sb-current-page")).toContainText("My New Page");

		// Editor should be empty (new page)
		await expect(editor).toHaveText("");

		// Type content and verify it saves to server
		await editor.click();
		await sbPage.keyboard.type("New page content");
		await expect(editor).toContainText("New page content");

		const content = await waitForSaveAndReadFromServer(sbPage, sbServer, "My New Page.md");
		expect(content).toContain("New page content");
	});

	test("navigate back to index via page picker", async ({ sbPage }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome to the wondrous world of SilverBullet");

		// First, create and navigate to a new page
		await sbPage.keyboard.press(`${mod}+k`);
		const pickerInput = sbPage.locator(".sb-modal-box .cm-content");
		await pickerInput.click();
		await sbPage.keyboard.type("Temporary Page", { delay: 30 });
		await sbPage.keyboard.press("Shift+Enter");
		await expect(sbPage.locator("#sb-current-page")).toContainText("Temporary Page");

		// Now navigate back to index
		await sbPage.keyboard.press(`${mod}+k`);
		await expect(sbPage.locator(".sb-modal-box")).toBeVisible();
		const pickerInput2 = sbPage.locator(".sb-modal-box .cm-content");
		await pickerInput2.click();
		await sbPage.keyboard.type("index", { delay: 30 });
		await sbPage.keyboard.press("Enter");

		// Should be back on the index/welcome page
		await expect(sbPage.locator("#sb-current-page")).toContainText("index");
		await expect(editor).toContainText("Welcome to the wondrous world of SilverBullet");
	});

	test("create a page in a subfolder and verify on server", async ({ sbPage, sbServer }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome to the wondrous world of SilverBullet");

		// Open page picker and create a page with folder path
		await sbPage.keyboard.press(`${mod}+k`);
		const pickerInput = sbPage.locator(".sb-modal-box .cm-content");
		await pickerInput.click();
		await sbPage.keyboard.type("Notes/My Subfolder Page", { delay: 30 });
		await sbPage.keyboard.press("Shift+Enter");

		// Page name should show the full path
		await expect(sbPage.locator("#sb-current-page")).toContainText("Notes/My Subfolder Page");
		await expect(editor).toHaveText("");

		// Type something and verify it saves to server
		await editor.click();
		await sbPage.keyboard.type("Content in a subfolder page");
		await expect(editor).toContainText("Content in a subfolder page");

		const content = await waitForSaveAndReadFromServer(sbPage, sbServer, "Notes/My Subfolder Page.md");
		expect(content).toContain("Content in a subfolder page");
	});
});
