import { expect, test, waitForSaveAndReadFromServer } from "./fixtures.ts";

test.describe("First load on empty space", () => {
	test("page loads and shows editor", async ({ sbPage }) => {
		await expect(sbPage.locator("#sb-editor")).toBeVisible();
		await expect(sbPage.locator("#sb-editor .cm-editor")).toBeVisible();
	});

	test("welcome page content appears", async ({ sbPage }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome to the wondrous world of SilverBullet");
	});

	test("editor is editable and saves to server", async ({ sbPage, sbServer }) => {
		const editor = sbPage.locator("#sb-editor .cm-content");
		await expect(editor).toContainText("Welcome to the wondrous world of SilverBullet");

		// Move to end of document, then type on a new line
		await editor.click();
		await sbPage.keyboard.press("End");
		await sbPage.keyboard.press("Enter");
		await sbPage.keyboard.type("Hello from Playwright");
		await expect(editor).toContainText("Hello from Playwright");

		// Verify the edit was saved to the server
		const content = await waitForSaveAndReadFromServer(sbPage, sbServer, "index.md");
		expect(content).toContain("Hello from Playwright");
	});
});
